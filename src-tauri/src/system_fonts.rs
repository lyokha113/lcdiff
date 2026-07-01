use serde::Serialize;
use std::cmp::Ordering;

use font_kit::handle::Handle;
use font_kit::properties::{Properties, Style, Weight};
use font_kit::source::SystemSource;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
    pub monospace_likely: bool,
    pub local_names: Vec<String>,
    pub font_file: Option<String>,
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

#[cfg(test)]
fn normalize_font_families<I, S>(families: I) -> Vec<SystemFont>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    normalize_font_families_with_faces(families, |_| (Vec::new(), None))
}

fn dedupe_names(names: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for name in names {
        let name = name.trim();
        if name.is_empty() {
            continue;
        }
        if !deduped
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(name))
        {
            deduped.push(name.to_owned());
        }
    }
    deduped
}

fn regular_face_score(properties: Properties, local_names: &[String]) -> f32 {
    let style_penalty = match properties.style {
        Style::Normal => 0.0,
        Style::Italic | Style::Oblique => 10_000.0,
    };
    let regular_name_bonus = if local_names.iter().any(|name| {
        let lower = name.to_ascii_lowercase();
        lower.contains("regular") || lower.ends_with("-roman")
    }) {
        -50.0
    } else {
        0.0
    };
    (properties.weight.0 - Weight::NORMAL.0).abs() + style_penalty + regular_name_bonus
}

fn font_file_for_handle(handle: &Handle) -> Option<String> {
    match handle {
        Handle::Path { path, font_index } if *font_index == 0 => {
            Some(path.to_string_lossy().into_owned())
        }
        _ => None,
    }
}

fn names_for_handle(handle: &Handle) -> Option<(Vec<String>, Properties, Option<String>)> {
    let font = handle.load().ok()?;
    let names = dedupe_names(vec![
        font.postscript_name().unwrap_or_default(),
        font.full_name(),
        font.family_name(),
    ]);
    Some((names, font.properties(), font_file_for_handle(handle)))
}

fn regular_face_for_family(source: &SystemSource, family: &str) -> (Vec<String>, Option<String>) {
    let Ok(family_handle) = source.select_family_by_name(family) else {
        return (vec![family.to_owned()], None);
    };

    let mut candidates = family_handle
        .fonts()
        .iter()
        .filter_map(names_for_handle)
        .collect::<Vec<_>>();

    candidates.sort_by(
        |(left_names, left_properties, _), (right_names, right_properties, _)| {
            regular_face_score(*left_properties, left_names)
                .partial_cmp(&regular_face_score(*right_properties, right_names))
                .unwrap_or(Ordering::Equal)
        },
    );

    let (mut names, font_file) = candidates
        .into_iter()
        .next()
        .map(|(names, _, font_file)| (names, font_file))
        .unwrap_or_default();
    names.push(family.to_owned());
    (dedupe_names(names), font_file)
}

fn normalize_font_families_with_faces<I, S, F>(families: I, face: F) -> Vec<SystemFont>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
    F: Fn(&str) -> (Vec<String>, Option<String>),
{
    let mut fonts = families
        .into_iter()
        .filter_map(|family| {
            let family = family.as_ref().trim();
            if family.is_empty() {
                return None;
            }
            let (local_names, font_file) = face(family);
            Some(SystemFont {
                family: family.to_owned(),
                monospace_likely: monospace_likely(family),
                local_names: dedupe_names(local_names),
                font_file,
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
    let source = SystemSource::new();
    let families = source
        .all_families()
        .map_err(|error| format!("failed to list system fonts: {error}"))?;
    Ok(normalize_font_families_with_faces(families, |family| {
        regular_face_for_family(&source, family)
    }))
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
        assert!(fonts.iter().all(|font| font.local_names.is_empty()));
    }
}
