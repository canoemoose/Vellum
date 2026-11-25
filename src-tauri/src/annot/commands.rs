//! Tauri commands for saving markups (registered in lib.rs).
//!
//! A save is three steps so the front end can close the document in PDFium in between (PDFium
//! holds the file open, so it can't be replaced while it's open):
//!   1. `annot_prepare`: read the file, apply the changes, write a temporary file beside it.
//!   2. the front end closes the document (`doc_close_wait`), then `annot_commit` renames the
//!      temporary file over the original (or `annot_discard` throws it away).
//!   3. the front end reopens the document.
//! "Save a copy" does 1 and 2 without closing anything.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::{Change, FileInfo, Prepared, Stamp, Writer};
use crate::docs::Docs;
use crate::pdfium::PdfiumState;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| crate::errcode::io(&e, format!("Couldn't read {}: {e}", path.display())))
}

/// What the first-save confirmation needs to know about a file: encrypted, signed, certified,
/// permissions, malformed.
#[tauri::command]
pub async fn annot_inspect(path: String, password: Option<String>) -> Result<FileInfo, String> {
    blocking(move || {
        let w = Writer::open(read(Path::new(&path))?, password.as_deref().unwrap_or(""))?;
        Ok(w.info)
    })
    .await
}

/// The file's size and modification time.
#[tauri::command]
pub fn file_stamp(path: String) -> Result<Stamp, String> {
    super::stamp(Path::new(&path))
}

/// Apply `changes` to the file at `path` and write the result to a temporary file beside
/// `target` (the original when None). Fails with `[changed_on_disk]` if `expect` is given and
/// the file no longer matches it.
#[tauri::command]
pub async fn annot_prepare(
    pdf: tauri::State<'_, PdfiumState>,
    path: String,
    password: Option<String>,
    changes: Vec<Change>,
    target: Option<String>,
    expect: Option<Stamp>,
) -> Result<Prepared, String> {
    let pdf = pdf.inner().clone();
    blocking(move || super::prepare(&pdf, Path::new(&path), password.as_deref().unwrap_or(""), &changes, target.as_deref().map(Path::new), expect)).await
}

/// Move a prepared file into place.
#[tauri::command]
pub async fn annot_commit(temp: String, target: String) -> Result<(), String> {
    blocking(move || super::commit(Path::new(&temp), Path::new(&target))).await
}

/// Throw a prepared file away.
#[tauri::command]
pub fn annot_discard(temp: String) {
    super::discard(Path::new(&temp));
}

/// Close a document on every PDFium worker and wait until they have let go of the file.
#[tauri::command]
pub async fn doc_close_wait(pdf: tauri::State<'_, PdfiumState>, docs: tauri::State<'_, Arc<Docs>>, doc_id: u64) -> Result<(), String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || {
        docs.close(&pdf, doc_id);
        pdf.wait_idle()
    })
    .await
}

/// A page's rotation and visible box in user space, for turning page points into PDF user space.
#[tauri::command]
pub async fn doc_page_frame(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    page: usize,
) -> Result<crate::text::FrameInfo, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || docs.page_frame(&pdf, doc_id, page)).await
}

/// Hide (or show again) annotations on a page, by /NM or by position in the page's /Annots
/// (phase 7b: one that came with the file may have no /NM), in every worker's copy of the
/// document, so markups the overlay draws aren't drawn twice.
#[tauri::command]
pub async fn doc_hide_annots(
    pdf: tauri::State<'_, PdfiumState>,
    docs: tauri::State<'_, Arc<Docs>>,
    doc_id: u64,
    page: usize,
    nms: Vec<String>,
    indices: Option<Vec<usize>>,
    hidden: bool,
) -> Result<usize, String> {
    let (pdf, docs) = (pdf.inner().clone(), docs.inner().clone());
    blocking(move || docs.hide_annots(&pdf, doc_id, page, nms, indices.unwrap_or_default(), hidden)).await
}

// ---------------------------------------------------------------- existing annotations (7b)

/// Every page's annotations as the file holds them (annot/read.rs). Read straight from the
/// file, off the render workers.
#[tauri::command]
pub async fn annot_read(path: String, password: Option<String>) -> Result<super::read::AnnotRead, String> {
    blocking(move || {
        let bytes = read(Path::new(&path))?;
        let r = super::read::read(&bytes, password.as_deref().unwrap_or(""))?;
        let n: usize = r.pages.iter().map(|p| p.annots.len()).sum();
        eprintln!("[annot] read {n} annotations on {} pages in {:.1} ms", r.pages.len(), r.ms);
        Ok(r)
    })
    .await
}

/// The pictures of image stamps Vellum wrote into the file, by hash (PNG, base64).
#[tauri::command]
pub async fn annot_stamp_images(path: String, password: Option<String>, hashes: Vec<String>) -> Result<std::collections::BTreeMap<String, String>, String> {
    blocking(move || super::read::stamp_images(&read(Path::new(&path))?, password.as_deref().unwrap_or(""), &hashes)).await
}

// ---------------------------------------------------------------- crash recovery

/// Where unsaved markups are kept between changes: %LOCALAPPDATA%\Vellum\recovery.
pub fn recovery_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join("Vellum").join("recovery")
}

/// A recovery file's name: the key, which the front end makes from the file's path, kept to
/// safe characters.
pub fn recovery_file(dir: &Path, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.len() > 120 || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("bad recovery key".into());
    }
    Ok(dir.join(format!("{key}.json")))
}

// Records are protected with DPAPI from phase 5 on (a placed signature must never sit on
// disk readable): see the Stamps block at the end of this file.
#[tauri::command]
pub fn recovery_write(key: String, json: String) -> Result<(), String> {
    write_sealed(&recovery_dir(), &key, &json)
}

#[tauri::command]
pub fn recovery_read(key: String) -> Result<Option<String>, String> {
    read_record(&recovery_dir(), &key)
}

#[tauri::command]
pub fn recovery_delete(key: String) -> Result<(), String> {
    delete_record(&recovery_dir(), &key)
}

// ---------------------------------------------------------------- author

/// The Windows account's display name ("Matt James"), or the login name if it has none.
#[tauri::command]
pub fn user_display_name() -> String {
    display_name().unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_default())
}

#[cfg(windows)]
fn display_name() -> Option<String> {
    use windows_sys::Win32::Security::Authentication::Identity::{GetUserNameExW, NameDisplay};
    let mut len: u32 = 0;
    unsafe { GetUserNameExW(NameDisplay, std::ptr::null_mut(), &mut len) };
    if len == 0 || len > 1024 {
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    if !unsafe { GetUserNameExW(NameDisplay, buf.as_mut_ptr(), &mut len) } {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..len as usize]).trim().to_string();
    (!s.is_empty()).then_some(s)
}

#[cfg(not(windows))]
fn display_name() -> Option<String> {
    None
}

// Stamps
// Crash-recovery records are encrypted for the Windows account (DPAPI, as the signature
// library is): unsaved markups can hold a signature, which must never be readable on disk.
// `<key>.vrec` is a magic header and the DPAPI blob of the JSON. A plain `<key>.json` left by
// an older Vellum is still read, once: it's sealed and the plain file removed as it's read.

const SEALED_MAGIC: &[u8] = b"VREC1 ";
/// Extra entropy, so a blob some other program protected for the same account isn't accepted
/// (and a signature library blob isn't either).
const SEALED_ENTROPY: &[u8] = b"Vellum recovery record v1";

/// A sealed recovery record's file.
pub fn sealed_file(dir: &Path, key: &str) -> Result<PathBuf, String> {
    Ok(recovery_file(dir, key)?.with_extension("vrec"))
}

fn write_file_atomic(f: &Path, bytes: &[u8]) -> Result<(), String> {
    // Write then rename, so a crash mid-write never leaves half a file.
    let tmp = f.with_extension("tmp");
    // Not flushed (fsutil.rs): this runs on the main thread a second after every edit, and only
    // a power cut, not a crash, could lose it.
    std::fs::write(&tmp, bytes).map_err(|e| crate::errcode::io(&e, format!("Couldn't write {}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, f).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        crate::errcode::io(&e, format!("Couldn't write {}: {e}", f.display()))
    })
}

fn remove_if_there(f: &Path) -> Result<(), String> {
    match std::fs::remove_file(f) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(crate::errcode::io(&e, format!("Couldn't delete {}: {e}", f.display()))),
    }
}

/// Write a record, encrypted, in `dir`; any plain one for the key goes.
pub fn write_sealed(dir: &Path, key: &str, json: &str) -> Result<(), String> {
    let f = sealed_file(dir, key)?;
    std::fs::create_dir_all(dir).map_err(|e| crate::errcode::io(&e, format!("Couldn't create {}: {e}", dir.display())))?;
    let blob = crate::signature::dpapi::protect(json.as_bytes(), SEALED_ENTROPY, "Vellum recovery")?;
    let mut bytes = Vec::with_capacity(SEALED_MAGIC.len() + blob.len());
    bytes.extend_from_slice(SEALED_MAGIC);
    bytes.extend_from_slice(&blob);
    write_file_atomic(&f, &bytes)?;
    remove_if_there(&recovery_file(dir, key)?)
}

/// A record's JSON: the sealed one, else an old plain one (sealed now, the plain file removed).
/// None when there's neither. A sealed record that can't be opened (another account's, or
/// damaged) is `[recovery_unreadable]`; its contents are never put in the message.
pub fn read_record(dir: &Path, key: &str) -> Result<Option<String>, String> {
    let sealed = sealed_file(dir, key)?;
    match std::fs::read(&sealed) {
        Ok(b) => {
            let plain = b
                .strip_prefix(SEALED_MAGIC)
                .ok_or_else(|| "not a sealed record".to_string())
                .and_then(|blob| crate::signature::dpapi::unprotect(blob, SEALED_ENTROPY))
                .and_then(|p| String::from_utf8(p).map_err(|_| "not text".to_string()))
                .map_err(|e| crate::errcode::coded("recovery_unreadable", format!("{}: {e}", sealed.display())))?;
            return Ok(Some(plain));
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(crate::errcode::io(&e, format!("Couldn't read {}: {e}", sealed.display()))),
    }
    let old = recovery_file(dir, key)?;
    match std::fs::read_to_string(&old) {
        Ok(s) => {
            // Seal it straight away, so it doesn't stay readable on disk.
            if let Err(e) = write_sealed(dir, key, &s) {
                eprintln!("[recovery] couldn't seal an old record: {e}");
            }
            Ok(Some(s))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(crate::errcode::io(&e, format!("Couldn't read {}: {e}", old.display()))),
    }
}

/// Remove a record, sealed or plain.
pub fn delete_record(dir: &Path, key: &str) -> Result<(), String> {
    remove_if_there(&sealed_file(dir, key)?)?;
    remove_if_there(&recovery_file(dir, key)?)
}
