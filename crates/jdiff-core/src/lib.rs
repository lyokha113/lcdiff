mod archive;
mod class_search;
mod detect;
mod diff;
pub mod edit;
mod error;
mod merge;
mod nested;
mod path;
mod sidecar_protocol;

pub use archive::{Archive, ArchiveEntry, ArchiveMetadata, ArchiveSourceKind};
pub use class_search::{ConstantPoolMatch, search_constant_pool};
pub use detect::EntryKind;
pub use diff::{ArchiveDiff, ComparePair, PairStatus, compare};
pub use error::{Error, Result};
pub use merge::{
    CommitOptions, CommitResult, MergePlan, StagedCopy, read_zip_entry_from_bytes,
    rewrite_zip_bytes,
};
pub use nested::{ARCHIVE_SEPARATOR, NestedArchiveCache, is_nested};
pub use path::{normalize_archive_entry_path, validate_path};
pub use sidecar_protocol::{
    DecompileEngine, DecompileOptions, SidecarAction, SidecarRequest, SidecarResponse, read_frame,
    write_frame,
};
