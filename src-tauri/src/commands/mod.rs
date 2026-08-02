mod app;
mod archive;
mod merge;
mod preview;
mod search;
mod temp_merge;

#[cfg(test)]
pub(crate) use app::platform_hints_from;
pub(crate) use app::{list_system_fonts, pending_open_paths, platform_hints, validate_path};
pub(crate) use archive::{
    close_view_source, compute_diff, compute_nested_diff, compute_view_nested_entries,
    list_view_sources, open_archive, open_compare_sources, open_view_source,
};
#[cfg(test)]
pub(crate) use archive::{compute_nested_diff_from_archives, one_sided_diff};
pub(crate) use merge::{
    clear_staged, commit_merge, commit_view, stage_copy, stage_view_write, stage_write, unstage,
    unstage_view_write,
};
#[cfg(test)]
pub(crate) use preview::read_text_file_from_path;
#[cfg(test)]
pub(crate) use preview::{class_source_path, language_for_path, read_entry_preview};
pub(crate) use preview::{
    disassemble, disassemble_view_entry, read_entry, read_text_file, read_view_entry, set_engine,
};
pub(crate) use search::{
    cancel_deep_search, deep_search, deep_search_view_source, prefetch_siblings, search,
    search_view_source,
};
#[cfg(test)]
pub(crate) use search::{deep_search_hit, is_prefetch_sibling, search_archive};
pub(crate) use temp_merge::{
    apply_temp_merge, create_temp_target, discard_temp_target, preview_merge_all_conflicts,
    save_temp_target_as, stage_temp_merge_all,
};
