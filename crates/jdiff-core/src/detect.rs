use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryKind {
    Directory,
    Class,
    Text,
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
        Some(
            "css" | "csv" | "graphql" | "htm" | "html" | "java" | "js" | "json" | "kt" | "md"
            | "mf" | "properties" | "rs" | "sql" | "svg" | "toml" | "ts" | "tsx" | "txt" | "xml"
            | "yaml" | "yml",
        ) => EntryKind::Text,
        _ => EntryKind::Binary,
    }
}
