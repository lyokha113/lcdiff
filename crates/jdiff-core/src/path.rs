use std::{
    env,
    ffi::OsString,
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
};

use crate::{Error, Result};

pub fn validate_path(raw: &str) -> Result<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(Error::EmptyPath);
    }
    let unquoted = strip_matching_quotes(trimmed);
    let unescaped = unescape_pasted_path(unquoted);
    let home = home_dir();
    let expanded = if unescaped == "~" {
        home.clone()
    } else if let Some(rest) = unescaped.strip_prefix("~/") {
        home.join(rest)
    } else {
        PathBuf::from(unescaped.as_ref())
    };
    let resolved = if expanded.is_absolute() {
        expanded
    } else {
        home.join(expanded)
    };
    if !resolved.exists() {
        return Err(Error::FileNotFound(resolved));
    }
    if resolved.is_dir() {
        return Ok(resolved);
    }
    if !resolved.is_file() {
        return Err(Error::NotAFileOrDirectory(resolved));
    }
    let mut file = File::open(&resolved).map_err(|error| {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Error::PermissionDenied(resolved.clone())
        } else {
            Error::Io(error)
        }
    })?;
    let mut magic = [0_u8; 4];
    if file.read_exact(&mut magic).is_err()
        || !matches!(
            magic,
            [b'P', b'K', 3, 4] | [b'P', b'K', 5, 6] | [b'P', b'K', 7, 8]
        )
    {
        return Err(Error::InvalidArchive(resolved));
    }
    Ok(resolved)
}

pub fn normalize_archive_entry_path(raw: &str) -> Result<String> {
    let replaced = raw.replace('\\', "/");
    let mut parts = Vec::new();
    for component in Path::new(&replaced).components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(Error::InvalidEntryPath(raw.to_owned()));
            }
        }
    }
    let mut normalized = parts.join("/");
    if raw.ends_with('/') && !normalized.is_empty() {
        normalized.push('/');
    }
    if normalized.is_empty() {
        return Err(Error::InvalidEntryPath(raw.to_owned()));
    }
    Ok(normalized)
}

fn strip_matching_quotes(value: &str) -> &str {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if matches!(
            (bytes[0], bytes[value.len() - 1]),
            (b'"', b'"') | (b'\'', b'\'')
        ) {
            return &value[1..value.len() - 1];
        }
    }
    value
}

fn unescape_pasted_path(value: &str) -> std::borrow::Cow<'_, str> {
    if !value.contains('\\') {
        return std::borrow::Cow::Borrowed(value);
    }
    let mut result = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\'
            && let Some(next) = chars.peek().copied()
            && (next.is_whitespace() || matches!(next, '"' | '\'' | '\\'))
        {
            result.push(next);
            chars.next();
            continue;
        }
        result.push(ch);
    }
    std::borrow::Cow::Owned(result)
}

fn home_dir() -> PathBuf {
    home_dir_from_env(
        env::var_os("HOME"),
        env::var_os("USERPROFILE"),
        env::var_os("HOMEDRIVE"),
        env::var_os("HOMEPATH"),
        env::current_dir().ok(),
    )
}

fn home_dir_from_env(
    home: Option<OsString>,
    userprofile: Option<OsString>,
    homedrive: Option<OsString>,
    homepath: Option<OsString>,
    current_dir: Option<PathBuf>,
) -> PathBuf {
    if let Some(home) = non_empty(home) {
        return PathBuf::from(home);
    }
    if let Some(userprofile) = non_empty(userprofile) {
        return PathBuf::from(userprofile);
    }
    if let (Some(homedrive), Some(homepath)) = (non_empty(homedrive), non_empty(homepath)) {
        let mut combined = homedrive;
        combined.push(homepath);
        return PathBuf::from(combined);
    }
    current_dir.unwrap_or_else(|| PathBuf::from("."))
}

fn non_empty(value: Option<OsString>) -> Option<OsString> {
    value.filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::{home_dir_from_env, unescape_pasted_path};
    use std::{ffi::OsString, path::PathBuf};

    #[test]
    fn home_dir_prefers_home_when_present() {
        assert_eq!(
            home_dir_from_env(
                Some(OsString::from("/Users/demo")),
                Some(OsString::from("C:\\Users\\demo")),
                None,
                None,
                Some(PathBuf::from("/cwd")),
            ),
            PathBuf::from("/Users/demo")
        );
    }

    #[test]
    fn home_dir_uses_windows_userprofile_without_home() {
        assert_eq!(
            home_dir_from_env(
                None,
                Some(OsString::from("C:\\Users\\demo")),
                None,
                None,
                Some(PathBuf::from("/cwd")),
            ),
            PathBuf::from("C:\\Users\\demo")
        );
    }

    #[test]
    fn home_dir_combines_windows_drive_and_path() {
        assert_eq!(
            home_dir_from_env(
                None,
                None,
                Some(OsString::from("C:")),
                Some(OsString::from("\\Users\\demo")),
                Some(PathBuf::from("/cwd")),
            ),
            PathBuf::from("C:\\Users\\demo")
        );
    }

    #[test]
    fn unescape_pasted_path_handles_shell_escaped_spaces() {
        assert_eq!(
            unescape_pasted_path("/tmp/sample\\ archive.jar"),
            "/tmp/sample archive.jar"
        );
    }

    #[test]
    fn unescape_pasted_path_preserves_windows_separators() {
        assert_eq!(
            unescape_pasted_path("C:\\Users\\demo\\archive.jar"),
            "C:\\Users\\demo\\archive.jar"
        );
    }
}
