use std::{ffi::OsStr, fs::File, path::Path};

use zip::ZipWriter;

use crate::{Error, Result};

pub fn create_empty_archive(path: impl AsRef<Path>) -> Result<()> {
    let path = path.as_ref();
    match path
        .extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jar" | "zip" | "war" | "ear") => {}
        _ => return Err(Error::UnsupportedTempArchiveExtension(path.to_path_buf())),
    }

    let file = File::create(path)?;
    ZipWriter::new(file).finish()?;
    Ok(())
}
