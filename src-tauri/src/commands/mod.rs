mod app;
mod archive;
mod merge;
mod preview;
mod search;

#[cfg(test)]
pub(crate) use app::platform_hints_from;
pub(crate) use app::{list_system_fonts, pending_open_paths, platform_hints, validate_path};
pub(crate) use archive::{
    close_view_source, compute_diff, compute_nested_diff, compute_view_nested_entries,
    list_view_sources, open_archive, open_view_source,
};
#[cfg(test)]
pub(crate) use archive::{compute_nested_diff_from_archives, one_sided_diff};
pub(crate) use merge::{
    clear_staged, commit_merge, commit_view, stage_copy, stage_view_write, stage_write, unstage,
    unstage_view_write,
};
#[cfg(test)]
pub(crate) use preview::{class_source_path, language_for_path, read_entry_preview};
pub(crate) use preview::{
    disassemble, disassemble_view_entry, read_entry, read_view_entry, set_engine,
};
pub(crate) use search::{
    cancel_deep_search, deep_search, deep_search_view_source, prefetch_siblings, search,
    search_view_source,
};
#[cfg(test)]
pub(crate) use search::{deep_search_hit, is_prefetch_sibling, search_archive};
