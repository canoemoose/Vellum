//! Saving markups into a PDF as standard annotations, appended as an incremental update.
//!
//! The front end does the drawing: every annotation arrives as a finished spec in PDF user
//! space, with its appearance stream's operators already worked out (src/lib/markup/), so what
//! Vellum draws on screen is what every other app shows. This module only turns specs into PDF
//! objects with `lopdf` and appends them (phase 0 of docs/editing-scope.md chose `lopdf`).

pub mod commands;
pub mod measure; // Measuring
pub mod spec;
pub mod writer;

use serde::Serialize;
use std::path::{Path, PathBuf};

pub use spec::{AnnotSpec, Change};
pub use writer::{FileInfo, Writer};

/// What `prepare` produced: a finished file waiting to be moved into place.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    /// The temporary file beside the target.
    pub temp: String,
    /// The file it is meant to replace (or create).
    pub target: String,
    /// Bytes the update added.
    pub added: u64,
    /// The original had broken cross-reference data, so PDFium rewrote it first and the save
    /// is a full rewrite rather than an append.
    pub rebuilt: bool,
}

/// A file's size and modification time, to notice when it changed on disk.
#[derive(Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Stamp {
    pub size: u64,
    /// Milliseconds since the Unix epoch.
    pub mtime_ms: u64,
}

pub fn stamp(path: &Path) -> Result<Stamp, String> {
    let m = std::fs::metadata(path).map_err(|e| crate::errcode::coded(crate::errcode::io_code(&e), e))?;
    let mtime_ms = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok(Stamp { size: m.len(), mtime_ms })
}

/// The temporary file used while saving `target`: beside it, so the final rename stays on one
/// volume and is atomic.
pub fn temp_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file.pdf".into());
    target.with_file_name(format!(".{name}.vellum-save-{}.tmp", std::process::id()))
}

/// Apply `changes` to `bytes` and return the new file's bytes.
pub fn apply(bytes: Vec<u8>, password: &str, changes: &[Change]) -> Result<Vec<u8>, String> {
    let mut w = Writer::open(bytes, password)?;
    for c in changes {
        w.apply(c)?;
    }
    w.save()
}

/// Write `bytes` to the temporary file for `target`.
pub fn write_temp(target: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let tmp = temp_path(target);
    std::fs::write(&tmp, bytes).map_err(|e| crate::errcode::coded(crate::errcode::io_code(&e), format!("Couldn't write beside {}: {e}", target.display())))?;
    Ok(tmp)
}

/// Move a prepared temporary file over its target. On failure the temporary file is removed
/// and the target is untouched.
pub fn commit(temp: &Path, target: &Path) -> Result<(), String> {
    match std::fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(temp);
            Err(crate::errcode::coded(crate::errcode::io_code(&e), format!("Couldn't replace {}: {e}", target.display())))
        }
    }
}

/// Apply `changes` to the file at `src` and write the result to a temporary file beside
/// `target` (`src` when None). Fails with `[changed_on_disk]` if `expect` is given and the file
/// no longer matches it. A file with broken cross-reference data can't take an appended update
/// (phase 0 finding 1), so PDFium rewrites it cleanly first and `rebuilt` says so.
pub fn prepare(
    pdf: &crate::pdfium::PdfiumState,
    src: &Path,
    password: &str,
    changes: &[Change],
    target: Option<&Path>,
    expect: Option<Stamp>,
) -> Result<Prepared, String> {
    if let Some(want) = expect {
        if stamp(src)? != want {
            return Err(crate::errcode::coded("changed_on_disk", format!("{} changed since it was opened", src.display())));
        }
    }
    let mut bytes = std::fs::read(src).map_err(|e| crate::errcode::io(&e, format!("Couldn't read {}: {e}", src.display())))?;
    let rebuilt = Writer::open(bytes.clone(), password)?.info.recovered;
    if rebuilt {
        bytes = pdf.rewrite(bytes, (!password.is_empty()).then(|| password.to_string()))?;
    }
    let before = bytes.len() as u64;
    let out = apply(bytes, password, changes)?;
    let target = target.unwrap_or(src);
    let temp = write_temp(target, &out)?;
    Ok(Prepared {
        temp: temp.to_string_lossy().into_owned(),
        target: target.to_string_lossy().into_owned(),
        added: (out.len() as u64).saturating_sub(before),
        rebuilt,
    })
}

/// Throw a prepared temporary file away (the save was cancelled).
pub fn discard(temp: &Path) {
    let _ = std::fs::remove_file(temp);
}
