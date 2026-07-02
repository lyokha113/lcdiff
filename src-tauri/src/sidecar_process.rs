use std::{
    collections::{HashMap, VecDeque, hash_map::DefaultHasher},
    env, fs,
    hash::{Hash, Hasher},
    io::{BufReader, BufWriter},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, UNIX_EPOCH},
};

use lcdiff_core::{
    DecompileEngine, DecompileOptions, SidecarAction, SidecarRequest, SidecarResponse, read_frame,
    write_frame,
};

pub struct SidecarClient {
    child: Option<SidecarProcess>,
    next_id: u64,
    cache: std::sync::Arc<std::sync::Mutex<ResponseCache>>,
    resource_dir: Option<PathBuf>,
    request_timeout: Duration,
}

struct SidecarProcess {
    process: Child,
    stdin: BufWriter<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
}

#[derive(Default)]
struct ResponseCache {
    values: HashMap<String, String>,
    order: VecDeque<String>,
    bytes: usize,
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const CACHE_LIMIT_BYTES: usize = 128 * 1024 * 1024;

impl Default for SidecarClient {
    fn default() -> Self {
        Self::new(None)
    }
}

impl SidecarClient {
    pub fn new(resource_dir: Option<PathBuf>) -> Self {
        Self {
            child: None,
            next_id: 1,
            cache: std::sync::Arc::new(std::sync::Mutex::new(ResponseCache::default())),
            resource_dir,
            request_timeout: REQUEST_TIMEOUT,
        }
    }

    pub fn prefetch_worker(&self) -> Self {
        Self {
            child: None,
            next_id: 1,
            cache: std::sync::Arc::clone(&self.cache),
            resource_dir: self.resource_dir.clone(),
            request_timeout: self.request_timeout,
        }
    }

    pub fn decompile(
        &mut self,
        engine: DecompileEngine,
        archive_path: String,
        entry_path: String,
    ) -> Result<String, String> {
        self.request(
            SidecarAction::Decompile,
            Some(engine),
            archive_path,
            entry_path,
        )
    }

    pub fn warm_start(&mut self) -> Result<(), String> {
        if self.child.is_none() {
            self.start()?;
        }
        let id = self.next_request_id();
        let response = self.send(&SidecarRequest {
            id,
            action: SidecarAction::Ping,
            engine: None,
            classpath: Vec::new(),
            entry: None,
            target: None,
            options: DecompileOptions::default(),
        })?;
        if response.ok {
            Ok(())
        } else {
            Err(sidecar_error(response))
        }
    }

    pub fn disassemble(
        &mut self,
        archive_path: String,
        entry_path: String,
    ) -> Result<String, String> {
        self.request(SidecarAction::Disassemble, None, archive_path, entry_path)
    }

    pub fn cancel_current_request(&mut self) {
        self.stop();
    }

    fn request(
        &mut self,
        action: SidecarAction,
        engine: Option<DecompileEngine>,
        archive_path: String,
        entry_path: String,
    ) -> Result<String, String> {
        let options = DecompileOptions::default();
        let cache_key = cache_key(action, engine, &options, &archive_path, &entry_path)?;
        if let Some(source) = self
            .cache
            .lock()
            .map_err(|_| "sidecar cache lock is poisoned".to_owned())?
            .get(&cache_key)
        {
            return Ok(source);
        }
        let request = SidecarRequest {
            id: self.next_request_id(),
            action,
            engine,
            classpath: vec![archive_path],
            entry: Some(entry_path),
            target: None,
            options,
        };
        for attempt in 0..=1 {
            match self.send(&request) {
                Ok(response) if response.ok => {
                    let source = response
                        .source
                        .ok_or_else(|| "sidecar returned no source".to_owned())?;
                    self.cache
                        .lock()
                        .map_err(|_| "sidecar cache lock is poisoned".to_owned())?
                        .put(cache_key, source.clone());
                    return Ok(source);
                }
                Ok(response) => return Err(sidecar_error(response)),
                Err(error) if attempt == 0 => {
                    self.stop();
                    if self.start().is_err() {
                        return Err(error);
                    }
                }
                Err(error) => return Err(error),
            }
        }
        unreachable!("retry loop always returns")
    }

    fn send(&mut self, request: &SidecarRequest) -> Result<SidecarResponse, String> {
        if self.child.is_none() {
            self.start()?;
        }
        let child = self.child.as_mut().expect("child was started");
        write_frame(&mut child.stdin, request).map_err(|error| error.to_string())?;
        use std::io::Write;
        child.stdin.flush().map_err(|error| error.to_string())?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or("sidecar stdout reader is unavailable")?;
        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let response = read_frame(&mut stdout).map_err(|error| error.to_string());
            sender.send((response, stdout)).ok();
        });
        match receiver.recv_timeout(self.request_timeout) {
            Ok((response, stdout)) => {
                child.stdout = Some(stdout);
                response
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.stop();
                Err(format!(
                    "decompiler sidecar timed out after {} seconds",
                    self.request_timeout.as_secs_f32()
                ))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                self.stop();
                Err("decompiler sidecar response worker disconnected".to_owned())
            }
        }
    }

    fn start(&mut self) -> Result<(), String> {
        let jar = sidecar_jar(self.resource_dir.as_deref());
        if !jar.is_file() {
            return Err(format!(
                "decompiler sidecar is unavailable: build {}",
                jar.display()
            ));
        }
        let mut process = Command::new(java_executable(self.resource_dir.as_deref()))
            .arg("-jar")
            .arg(&jar)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|error| format!("cannot spawn decompiler sidecar: {error}"))?;
        let stdin = process.stdin.take().ok_or("sidecar stdin is unavailable")?;
        let stdout = process
            .stdout
            .take()
            .ok_or("sidecar stdout is unavailable")?;
        self.child = Some(SidecarProcess {
            process,
            stdin: BufWriter::new(stdin),
            stdout: Some(BufReader::new(stdout)),
        });
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.process.kill().ok();
            child.process.wait().ok();
        }
    }

    fn next_request_id(&mut self) -> String {
        let id = format!("desktop-{}", self.next_id);
        self.next_id += 1;
        id
    }
}

impl Drop for SidecarClient {
    fn drop(&mut self) {
        self.stop();
    }
}

fn sidecar_jar(resource_dir: Option<&std::path::Path>) -> PathBuf {
    env::var_os("LCDIFF_SIDECAR_JAR").map_or_else(
        || {
            resource_candidate(resource_dir, "sidecar/lcdiff-sidecar.jar").unwrap_or_else(|| {
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../sidecar/target/lcdiff-sidecar-0.3.2.jar")
            })
        },
        PathBuf::from,
    )
}

fn java_executable(resource_dir: Option<&std::path::Path>) -> PathBuf {
    env::var_os("LCDIFF_JAVA").map_or_else(
        || {
            resource_candidate(resource_dir, java_relative_path())
                .unwrap_or_else(|| PathBuf::from("java"))
        },
        PathBuf::from,
    )
}

fn java_relative_path() -> &'static str {
    if cfg!(windows) {
        "jre/bin/java.exe"
    } else {
        "jre/bin/java"
    }
}

fn resource_candidate(resource_dir: Option<&std::path::Path>, relative: &str) -> Option<PathBuf> {
    executable_resource_dirs()
        .into_iter()
        .chain(resource_dir.map(PathBuf::from))
        .flat_map(|root| [root.join(relative), root.join("resources").join(relative)])
        .chain([PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(relative)])
        .find(|candidate| candidate.is_file())
}

fn executable_resource_dirs() -> Vec<PathBuf> {
    let Ok(executable) = env::current_exe() else {
        return Vec::new();
    };
    let Some(parent) = executable.parent() else {
        return Vec::new();
    };
    let mut candidates = vec![parent.join("resources")];
    if parent.file_name().is_some_and(|name| name == "MacOS")
        && let Some(contents) = parent.parent()
    {
        candidates.push(contents.join("Resources"));
    }
    candidates
}

fn cache_key(
    action: SidecarAction,
    engine: Option<DecompileEngine>,
    options: &DecompileOptions,
    archive_path: &str,
    entry_path: &str,
) -> Result<String, String> {
    let metadata = fs::metadata(archive_path).map_err(|error| error.to_string())?;
    let canonical_path =
        fs::canonicalize(archive_path).unwrap_or_else(|_| PathBuf::from(archive_path));
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_nanos());
    let mut options_hash = DefaultHasher::new();
    options.hash(&mut options_hash);
    Ok(format!(
        "{action:?}|{engine:?}|{}|options={:016x}|{}|{}|{modified}|{entry_path}",
        engine_version(action, engine),
        options_hash.finish(),
        canonical_path.display(),
        metadata.len()
    ))
}

fn engine_version(action: SidecarAction, engine: Option<DecompileEngine>) -> &'static str {
    match (action, engine) {
        (SidecarAction::Decompile, Some(DecompileEngine::Cfr)) => "cfr-0.152",
        (SidecarAction::Decompile, Some(DecompileEngine::JdCore)) => "jd-core-1.3.3",
        (SidecarAction::Decompile, Some(DecompileEngine::JdCoreV0)) => "jd-core-v0-0.8.29",
        (SidecarAction::Decompile, Some(DecompileEngine::Vineflower)) => "vineflower-1.12.0",
        (SidecarAction::Disassemble, _) => "asm-9.10.1",
        _ => "control-v1",
    }
}

impl ResponseCache {
    fn get(&mut self, key: &str) -> Option<String> {
        let value = self.values.get(key).cloned()?;
        self.order.retain(|candidate| candidate != key);
        self.order.push_back(key.to_owned());
        Some(value)
    }

    fn put(&mut self, key: String, value: String) {
        if let Some(previous) = self.values.remove(&key) {
            self.bytes -= previous.len();
            self.order.retain(|candidate| candidate != &key);
        }
        self.bytes += value.len();
        self.order.push_back(key.clone());
        self.values.insert(key, value);
        while self.bytes > CACHE_LIMIT_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(value) = self.values.remove(&oldest) {
                self.bytes -= value.len();
            }
        }
    }
}

fn sidecar_error(response: SidecarResponse) -> String {
    format!(
        "{}: {}",
        response
            .error_kind
            .unwrap_or_else(|| "EngineError".to_owned()),
        response
            .message
            .unwrap_or_else(|| "decompiler sidecar failed".to_owned())
    )
}

#[cfg(test)]
mod tests {
    use std::{
        fs::File,
        process::{Command, Stdio},
        time::Duration,
    };

    use lcdiff_core::{DecompileEngine, DecompileOptions, SidecarAction, SidecarRequest};
    use tempfile::tempdir;

    use super::{ResponseCache, SidecarClient, SidecarProcess, cache_key};

    #[test]
    fn caches_source_values() {
        let mut cache = ResponseCache::default();
        cache.put("key".to_owned(), "source".to_owned());
        assert_eq!(cache.get("key").as_deref(), Some("source"));
    }

    #[test]
    fn cache_hits_refresh_lru_order() {
        let mut cache = ResponseCache::default();
        cache.put("first".to_owned(), "one".to_owned());
        cache.put("second".to_owned(), "two".to_owned());

        assert_eq!(cache.get("first").as_deref(), Some("one"));
        assert_eq!(cache.order, ["second", "first"]);
    }

    #[test]
    fn prefetch_worker_shares_cache() {
        let client = SidecarClient::default();
        let worker = client.prefetch_worker();
        client
            .cache
            .lock()
            .unwrap()
            .put("shared".to_owned(), "source".to_owned());
        assert_eq!(
            worker.cache.lock().unwrap().get("shared").as_deref(),
            Some("source")
        );
    }

    #[test]
    fn archive_metadata_changes_cache_key() {
        let dir = tempdir().unwrap();
        let archive = dir.path().join("app.jar");
        File::create(&archive).unwrap();
        let first = cache_key(
            SidecarAction::Decompile,
            Some(DecompileEngine::Cfr),
            &DecompileOptions::default(),
            archive.to_str().unwrap(),
            "pkg/A.class",
        )
        .unwrap();
        std::fs::write(&archive, b"changed").unwrap();
        let second = cache_key(
            SidecarAction::Decompile,
            Some(DecompileEngine::Cfr),
            &DecompileOptions::default(),
            archive.to_str().unwrap(),
            "pkg/A.class",
        )
        .unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn archive_paths_partition_cache_keys() {
        let dir = tempdir().unwrap();
        let left = dir.path().join("left.jar");
        let right = dir.path().join("right.jar");
        std::fs::write(&left, b"same bytes").unwrap();
        std::fs::write(&right, b"same bytes").unwrap();

        let left_key = cache_key(
            SidecarAction::Decompile,
            Some(DecompileEngine::Cfr),
            &DecompileOptions::default(),
            left.to_str().unwrap(),
            "pkg/A.class",
        )
        .unwrap();
        let right_key = cache_key(
            SidecarAction::Decompile,
            Some(DecompileEngine::Cfr),
            &DecompileOptions::default(),
            right.to_str().unwrap(),
            "pkg/A.class",
        )
        .unwrap();

        assert_ne!(left_key, right_key);
    }

    #[test]
    fn options_partition_cache_keys() {
        let dir = tempdir().unwrap();
        let archive = dir.path().join("app.jar");
        File::create(&archive).unwrap();
        let default_key = cache_key(
            SidecarAction::Decompile,
            Some(DecompileEngine::Cfr),
            &DecompileOptions::default(),
            archive.to_str().unwrap(),
            "pkg/A.class",
        )
        .unwrap();
        let configured_key = cache_key(
            SidecarAction::Decompile,
            Some(DecompileEngine::Cfr),
            &DecompileOptions {
                indent_string: Some("  ".to_owned()),
                ..DecompileOptions::default()
            },
            archive.to_str().unwrap(),
            "pkg/A.class",
        )
        .unwrap();

        assert_ne!(default_key, configured_key);
    }

    #[cfg(unix)]
    #[test]
    fn stops_process_after_timeout() {
        let mut process = Command::new("sh")
            .args(["-c", "sleep 5"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = process.stdin.take().unwrap();
        let stdout = process.stdout.take().unwrap();
        let mut client = SidecarClient::default();
        client.request_timeout = Duration::from_millis(20);
        client.child = Some(SidecarProcess {
            process,
            stdin: std::io::BufWriter::new(stdin),
            stdout: Some(std::io::BufReader::new(stdout)),
        });
        let error = client
            .send(&SidecarRequest {
                id: "timeout".to_owned(),
                action: SidecarAction::Ping,
                engine: None,
                classpath: Vec::new(),
                entry: None,
                target: None,
                options: DecompileOptions::default(),
            })
            .unwrap_err();
        assert!(error.contains("timed out"));
        assert!(client.child.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn cancel_current_request_stops_running_process() {
        let mut process = Command::new("sh")
            .args(["-c", "sleep 5"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = process.stdin.take().unwrap();
        let stdout = process.stdout.take().unwrap();
        let mut client = SidecarClient::default();
        client.child = Some(SidecarProcess {
            process,
            stdin: std::io::BufWriter::new(stdin),
            stdout: Some(std::io::BufReader::new(stdout)),
        });

        client.cancel_current_request();

        assert!(client.child.is_none());
    }
}
