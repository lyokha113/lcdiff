use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("path is empty")]
    EmptyPath,
    #[error("File/Folder not found: {0}")]
    FileNotFound(PathBuf),
    #[error("path is not a file: {0}")]
    NotAFile(PathBuf),
    #[error("path is neither a file nor a directory: {0}")]
    NotAFileOrDirectory(PathBuf),
    #[error("permission denied: {0}")]
    PermissionDenied(PathBuf),
    #[error("not a valid zip/jar: {0}")]
    InvalidArchive(PathBuf),
    #[error("entry not found: {0}")]
    EntryNotFound(String),
    #[error("cannot copy directory entry: {0}")]
    CannotCopyDirectory(String),
    #[error("encrypted archive entry is not supported: {0}")]
    EncryptedEntry(String),
    #[error("invalid archive entry path: {0}")]
    InvalidEntryPath(String),
    #[error("duplicate normalized archive entry path: {0}")]
    DuplicateEntryPath(String),
    #[error("target archive changed since it was opened: {0}")]
    ArchiveChanged(PathBuf),
    #[error("cannot commit an empty merge plan")]
    EmptyMergePlan,
    #[error("staged copies must target the same archive")]
    MixedTargets,
    #[error("class file is malformed: {0}")]
    MalformedClass(&'static str),
    #[error("sidecar protocol error: {0}")]
    SidecarProtocol(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}

pub type Result<T> = std::result::Result<T, Error>;
