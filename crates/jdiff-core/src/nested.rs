//! On-demand extraction of nested archives to temp files.

pub const ARCHIVE_SEPARATOR: &str = "!/";

/// True when `path` addresses an entry inside a nested archive.
pub fn is_nested(path: &str) -> bool {
    path.contains(ARCHIVE_SEPARATOR)
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
