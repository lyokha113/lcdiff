use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Directory,
    Class,
    Text,
    Archive,
    Binary,
}

pub fn detect_entry_kind(path: &str, is_dir: bool) -> EntryKind {
    if is_dir {
        return EntryKind::Directory;
    }
    let extension = path
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase());
    match extension.as_deref() {
        Some("class") => EntryKind::Class,
        Some("jar" | "zip" | "war" | "ear") => EntryKind::Archive,
        Some(
            "css" | "csv" | "graphql" | "htm" | "html" | "java" | "js" | "json" | "kt" | "md"
            | "mf" | "properties" | "rs" | "sql" | "svg" | "toml" | "ts" | "tsx" | "txt" | "xml"
            | "yaml" | "yml",
        ) => EntryKind::Text,
        _ => EntryKind::Binary,
    }
}

#[cfg(test)]
mod tests {
    use super::{EntryKind, detect_entry_kind};

    #[test]
    fn classifies_archives() {
        assert_eq!(
            detect_entry_kind("lib/inner.jar", false),
            EntryKind::Archive
        );
        assert_eq!(detect_entry_kind("a.zip", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.war", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.ear", false), EntryKind::Archive);
        assert_eq!(detect_entry_kind("a.bin", false), EntryKind::Binary);
        assert_eq!(detect_entry_kind("A.class", false), EntryKind::Class);
    }
}
