use std::collections::BTreeSet;

use serde::Serialize;

use crate::{Archive, ArchiveEntry};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PairStatus {
    OnlyLeft,
    OnlyRight,
    Identical,
    Different,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComparePair {
    pub path: String,
    pub left: Option<ArchiveEntry>,
    pub right: Option<ArchiveEntry>,
    pub status: PairStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ArchiveDiff {
    pub pairs: Vec<ComparePair>,
}

pub fn compare(left: &Archive, right: &Archive) -> ArchiveDiff {
    let paths = left
        .entries()
        .map(|entry| entry.path.as_str())
        .chain(right.entries().map(|entry| entry.path.as_str()))
        .collect::<BTreeSet<_>>();
    let pairs = paths
        .into_iter()
        .map(|path| {
            let left = left.entry(path).cloned();
            let right = right.entry(path).cloned();
            let status = match (&left, &right) {
                (Some(left), Some(right))
                    if left.crc32 == right.crc32
                        && left.uncompressed_size == right.uncompressed_size =>
                {
                    PairStatus::Identical
                }
                (Some(_), Some(_)) => PairStatus::Different,
                (Some(_), None) => PairStatus::OnlyLeft,
                (None, Some(_)) => PairStatus::OnlyRight,
                (None, None) => unreachable!("path is collected from at least one archive"),
            };
            ComparePair {
                path: path.to_owned(),
                left,
                right,
                status,
            }
        })
        .collect();
    ArchiveDiff { pairs }
}
