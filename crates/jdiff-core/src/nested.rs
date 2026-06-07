//! On-demand extraction of nested archives to temp files.

pub const ARCHIVE_SEPARATOR: &str = "!/";

/// True when `path` addresses an entry inside a nested archive.
pub fn is_nested(path: &str) -> bool {
    path.contains(ARCHIVE_SEPARATOR)
}

use std::{collections::HashMap, fs, path::PathBuf};

use tempfile::TempDir;

use crate::{Archive, Result};

/// Extracts nested archives to temp files on demand and caches the opened
/// `Archive` keyed by its archive-chain prefix (e.g. `"lib/inner.jar"` or
/// `"lib/inner.jar!/inner2.jar"`).
pub struct NestedArchiveCache {
    temp_dir: TempDir,
    archives: HashMap<String, Archive>,
    counter: usize,
}

impl NestedArchiveCache {
    pub fn new() -> Result<Self> {
        Ok(Self {
            temp_dir: tempfile::tempdir()?,
            archives: HashMap::new(),
            counter: 0,
        })
    }

    /// Drop all cached archives. Temp files are removed when `temp_dir` is
    /// dropped (i.e. when the whole cache is replaced).
    pub fn clear(&mut self) {
        self.archives.clear();
    }

    /// Open the archive addressed by `archive_path` (every `!/`-segment is an
    /// archive, including the last).
    pub fn resolve_archive(&mut self, root: &Archive, archive_path: &str) -> Result<Archive> {
        let mut current = root.clone();
        let mut prefix = String::new();
        for segment in archive_path.split(ARCHIVE_SEPARATOR) {
            prefix = if prefix.is_empty() {
                segment.to_owned()
            } else {
                format!("{prefix}{ARCHIVE_SEPARATOR}{segment}")
            };
            if !self.archives.contains_key(&prefix) {
                let bytes = current.read_entry(segment)?;
                let path = self.next_temp_path();
                fs::write(&path, &bytes)?;
                let archive = Archive::open_validated(path)?;
                self.archives.insert(prefix.clone(), archive);
            }
            current = self.archives.get(&prefix).expect("just inserted").clone();
        }
        Ok(current)
    }

    /// Resolve a (possibly nested) entry path to its innermost `Archive` plus
    /// the leaf entry path inside that archive. Non-nested paths return a clone
    /// of `root` and the path unchanged.
    pub fn resolve(&mut self, root: &Archive, entry_path: &str) -> Result<(Archive, String)> {
        match entry_path.rsplit_once(ARCHIVE_SEPARATOR) {
            None => Ok((root.clone(), entry_path.to_owned())),
            Some((archive_chain, leaf)) => {
                let archive = self.resolve_archive(root, archive_chain)?;
                Ok((archive, leaf.to_owned()))
            }
        }
    }

    fn next_temp_path(&mut self) -> PathBuf {
        let name = format!("nested-{}.zip", self.counter);
        self.counter += 1;
        self.temp_dir.path().join(name)
    }
}

#[cfg(test)]
mod tests {
    use super::{ARCHIVE_SEPARATOR, is_nested};

    #[test]
    fn detects_nesting() {
        assert!(!is_nested("lib/inner.jar"));
        assert!(is_nested("lib/inner.jar!/com/A.class"));
        assert!(is_nested("a.jar!/b.jar!/B.class"));
        assert_eq!(ARCHIVE_SEPARATOR, "!/");
    }
}
