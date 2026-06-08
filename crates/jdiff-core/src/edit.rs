//! Helpers for editing text-based archive entries in place.

use crate::{ArchiveEntry, EntryKind};

/// Extensions treated as editable text even when content sniffing labelled the
/// entry binary. Lower-case, compared case-insensitively.
const EDITABLE_EXTENSIONS: &[&str] = &[
    "xml", "json", "ini", "txt", "properties", "yaml", "yml", "md", "csv", "cfg", "conf",
];

const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LineEnding {
    Lf,
    Crlf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntryEncoding {
    pub bom: bool,
    pub line_ending: LineEnding,
}

/// True when the entry's basename ends in a whitelisted text extension.
pub fn has_editable_extension(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((_, ext)) => EDITABLE_EXTENSIONS.iter().any(|known| known.eq_ignore_ascii_case(ext)),
        None => false,
    }
}

fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes)
}

/// Whether an entry may be edited as UTF-8 text. Directories and decompiled
/// class entries are never editable; binary payloads (null byte present, or not
/// valid UTF-8) are rejected. Text kind or a whitelisted extension qualifies.
pub fn editable_text(entry: &ArchiveEntry, bytes: &[u8]) -> bool {
    if matches!(entry.kind, EntryKind::Directory | EntryKind::Class) {
        return false;
    }
    if bytes.contains(&0) {
        return false;
    }
    let is_text = entry.kind == EntryKind::Text || has_editable_extension(&entry.path);
    is_text && std::str::from_utf8(strip_bom(bytes)).is_ok()
}

/// Detect leading UTF-8 BOM and the dominant line ending so an edit round-trips
/// byte-faithfully apart from the user's changes.
pub fn detect_encoding(bytes: &[u8]) -> EntryEncoding {
    let bom = bytes.starts_with(UTF8_BOM);
    let body = strip_bom(bytes);
    let line_ending = if body.windows(2).any(|window| window == b"\r\n") {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };
    EntryEncoding { bom, line_ending }
}

/// Encode edited content (Monaco emits LF newlines) back to the detected
/// encoding: re-apply CRLF if the original used it, and re-prepend the BOM.
pub fn encode_text(content: &str, encoding: &EntryEncoding) -> Vec<u8> {
    let normalized = content.replace("\r\n", "\n");
    let body = match encoding.line_ending {
        LineEnding::Lf => normalized,
        LineEnding::Crlf => normalized.replace('\n', "\r\n"),
    };
    let mut out = Vec::with_capacity(body.len() + if encoding.bom { UTF8_BOM.len() } else { 0 });
    if encoding.bom {
        out.extend_from_slice(UTF8_BOM);
    }
    out.extend_from_slice(body.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ArchiveEntry, EntryKind};

    fn entry(path: &str, kind: EntryKind) -> ArchiveEntry {
        ArchiveEntry {
            path: path.to_owned(),
            kind,
            uncompressed_size: 0,
            compressed_size: 0,
            crc32: 0,
        }
    }

    #[test]
    fn text_entry_is_editable() {
        assert!(editable_text(&entry("a/config.xml", EntryKind::Text), b"<x/>"));
    }

    #[test]
    fn whitelisted_extension_on_binary_kind_is_editable() {
        assert!(editable_text(&entry("app.properties", EntryKind::Binary), b"k=v"));
    }

    #[test]
    fn class_entry_is_not_editable() {
        assert!(!editable_text(&entry("A.class", EntryKind::Class), b"text"));
    }

    #[test]
    fn null_byte_content_is_not_editable() {
        assert!(!editable_text(&entry("a.txt", EntryKind::Text), b"a\0b"));
    }

    #[test]
    fn unknown_extension_binary_is_not_editable() {
        assert!(!editable_text(&entry("blob.dat", EntryKind::Binary), b"data"));
    }

    #[test]
    fn detect_lf_no_bom() {
        let enc = detect_encoding(b"a\nb\n");
        assert_eq!(enc, EntryEncoding { bom: false, line_ending: LineEnding::Lf });
    }

    #[test]
    fn detect_crlf_with_bom() {
        let enc = detect_encoding(b"\xEF\xBB\xBFa\r\nb\r\n");
        assert_eq!(enc, EntryEncoding { bom: true, line_ending: LineEnding::Crlf });
    }

    #[test]
    fn encode_preserves_bom_and_crlf() {
        let enc = EntryEncoding { bom: true, line_ending: LineEnding::Crlf };
        assert_eq!(encode_text("a\nb", &enc), b"\xEF\xBB\xBFa\r\nb".to_vec());
    }

    #[test]
    fn encode_lf_no_bom_roundtrip() {
        let enc = detect_encoding(b"a\nb\n");
        assert_eq!(encode_text("a\nb\n", &enc), b"a\nb\n".to_vec());
    }
}
