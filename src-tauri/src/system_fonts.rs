use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
    pub monospace_likely: bool,
}

pub fn monospace_likely(family: &str) -> bool {
    let lower = family.to_ascii_lowercase();
    [
        "mono", "code", "console", "terminal", "menlo", "consolas", "courier", "cascadia",
        "sfmono", "sf mono",
    ]
    .iter()
    .any(|hint| lower.contains(hint))
}

pub fn normalize_font_families<I, S>(families: I) -> Vec<SystemFont>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let mut fonts = families
        .into_iter()
        .filter_map(|family| {
            let family = family.as_ref().trim();
            if family.is_empty() {
                return None;
            }
            Some(SystemFont {
                family: family.to_owned(),
                monospace_likely: monospace_likely(family),
            })
        })
        .collect::<Vec<_>>();

    fonts.sort_by(|a, b| {
        b.monospace_likely.cmp(&a.monospace_likely).then_with(|| {
            a.family
                .to_ascii_lowercase()
                .cmp(&b.family.to_ascii_lowercase())
        })
    });
    fonts.dedup_by(|a, b| a.family.eq_ignore_ascii_case(&b.family));
    fonts
}

#[tauri::command]
pub fn list_system_fonts() -> Result<Vec<SystemFont>, String> {
    let families = font_kit::source::SystemSource::new()
        .all_families()
        .map_err(|error| format!("failed to list system fonts: {error}"))?;
    Ok(normalize_font_families(families))
}

#[cfg(test)]
mod tests {
    use super::{monospace_likely, normalize_font_families};

    #[test]
    fn classifies_common_monospace_family_names() {
        assert!(monospace_likely("JetBrains Mono"));
        assert!(monospace_likely("Menlo"));
        assert!(monospace_likely("Cascadia Code"));
        assert!(!monospace_likely("Helvetica Neue"));
    }

    #[test]
    fn normalizes_fonts_with_monospace_first_and_unique_families() {
        let fonts = normalize_font_families([
            "Helvetica Neue",
            "Menlo",
            "menlo",
            "",
            "Cascadia Code",
            "Arial",
        ]);

        assert_eq!(
            fonts
                .iter()
                .map(|font| font.family.as_str())
                .collect::<Vec<_>>(),
            ["Cascadia Code", "Menlo", "Arial", "Helvetica Neue"]
        );
        assert!(fonts[0].monospace_likely);
        assert!(fonts[1].monospace_likely);
        assert!(!fonts[2].monospace_likely);
    }
}
