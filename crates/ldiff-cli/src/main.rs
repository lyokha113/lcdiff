use std::path::{Path, PathBuf};

use anyhow::Context;
use clap::{Parser, Subcommand};
use ldiff_core::{Archive, CommitOptions, EntryKind, MergePlan, compare, search_constant_pool};

#[derive(Debug, Parser)]
#[command(name = "ldiff", about = "Inspect, compare, and merge JAR/ZIP archives")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    List {
        archive: PathBuf,
    },
    Diff {
        left: PathBuf,
        right: PathBuf,
    },
    Read {
        archive: PathBuf,
        entry: String,
    },
    Search {
        archive: PathBuf,
        query: String,
    },
    Copy {
        source: PathBuf,
        target: PathBuf,
        entry: String,
        #[arg(long)]
        backup: bool,
    },
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().command {
        Command::List { archive } => {
            let archive = open(&archive)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&archive.entries().collect::<Vec<_>>())?
            );
        }
        Command::Diff { left, right } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&compare(&open(&left)?, &open(&right)?))?
            );
        }
        Command::Read { archive, entry } => {
            let bytes = open(&archive)?.read_entry(&entry)?;
            print!("{}", String::from_utf8_lossy(&bytes));
        }
        Command::Search { archive, query } => {
            let query = query.trim();
            anyhow::ensure!(!query.is_empty(), "search query must not be empty");
            let query_lower = query.to_ascii_lowercase();
            let archive = open(&archive)?;
            for entry in archive.entries() {
                let path_match = entry.path.to_ascii_lowercase().contains(&query_lower);
                let payload_match = if path_match {
                    false
                } else {
                    match entry.kind {
                        EntryKind::Class => {
                            search_constant_pool(&archive.read_entry(&entry.path)?, query)
                                .map(|matches| !matches.is_empty())
                                .unwrap_or(false)
                        }
                        EntryKind::Text => {
                            String::from_utf8_lossy(&archive.read_entry(&entry.path)?)
                                .to_ascii_lowercase()
                                .contains(&query_lower)
                        }
                        EntryKind::Directory | EntryKind::Binary | EntryKind::Archive => false,
                    }
                };
                if path_match || payload_match {
                    println!("{}", entry.path);
                }
            }
        }
        Command::Copy {
            source,
            target,
            entry,
            backup,
        } => {
            let source = open(&source)?;
            let target = open(&target)?;
            let mut plan = MergePlan::new();
            plan.stage_copy(&source, &entry, &entry)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&plan.commit(&target, CommitOptions { backup })?)?
            );
        }
    }
    Ok(())
}

fn open(path: &Path) -> anyhow::Result<Archive> {
    Archive::open(path.to_string_lossy()).with_context(|| format!("cannot open {}", path.display()))
}
