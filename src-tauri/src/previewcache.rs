//! Persistent page-preview cache: low-resolution page previews (encoded by the front end,
//! WebP) kept in %LOCALAPPDATA%\Vellum\preview-cache, so reopening a heavy drawing shows its
//! page at once while the real render runs.
//!
//! Entries are keyed by the file's content key (`content_key`): its size, modification time
//! and a hash of its first and last MiB. Editing or replacing the file changes the key, so a
//! stale preview is never shown. The folder is capped at `MAX_BYTES`; the least recently used
//! files (by modification time, refreshed on every read) go first.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Total size of the cache folder before old entries are deleted.
pub const MAX_BYTES: u64 = 256 * 1024 * 1024;
/// Largest single entry accepted (a 2048 px WebP preview is a few hundred KB).
pub const MAX_ENTRY_BYTES: usize = 16 * 1024 * 1024;
const SAMPLE: u64 = 1024 * 1024;

/// 64-bit FNV-1a, continuing from `h`. Stable across builds (unlike std's hasher), which a
/// key stored on disk needs.
pub fn fnv1a(mut h: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x100_0000_01b3);
    }
    h
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;

/// The content key from a file's size, modification time (ns since the epoch) and its first
/// and last bytes (up to 1 MiB each). Pure, for tests. 16 lower-case hex digits.
pub fn content_key_from(size: u64, mtime_ns: u128, head: &[u8], tail: &[u8]) -> String {
    let mut h = fnv1a(FNV_OFFSET, &size.to_le_bytes());
    h = fnv1a(h, &mtime_ns.to_le_bytes());
    h = fnv1a(h, head);
    h = fnv1a(h, tail);
    format!("{h:016x}")
}

/// The content key of a file, or None if it can't be read.
pub fn content_key(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    let mut f = std::fs::File::open(path).ok()?;
    let mut head = vec![0u8; size.min(SAMPLE) as usize];
    f.read_exact(&mut head).ok()?;
    let mut tail = Vec::new();
    if size > SAMPLE {
        let n = (size - SAMPLE).min(SAMPLE);
        f.seek(SeekFrom::End(-(n as i64))).ok()?;
        tail.resize(n as usize, 0);
        f.read_exact(&mut tail).ok()?;
    }
    Some(content_key_from(size, mtime, &head, &tail))
}

/// True for a key `content_key` could have produced (guards the file name).
pub fn valid_key(key: &str) -> bool {
    key.len() == 16 && key.bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn cache_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Vellum")
        .join("preview-cache")
}

fn entry_path(dir: &Path, key: &str, page: usize) -> PathBuf {
    dir.join(format!("{key}-p{page}.webp"))
}

/// The stored preview for a page, if any (and mark it recently used).
pub fn get(dir: &Path, key: &str, page: usize) -> Option<Vec<u8>> {
    if !valid_key(key) {
        return None;
    }
    let p = entry_path(dir, key, page);
    let bytes = std::fs::read(&p).ok()?;
    if let Ok(f) = std::fs::OpenOptions::new().write(true).open(&p) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
    Some(bytes)
}

/// Store a page preview, then trim the folder to `max_bytes`.
pub fn put(dir: &Path, key: &str, page: usize, bytes: &[u8], max_bytes: u64) -> Result<(), String> {
    if !valid_key(key) {
        return Err("bad cache key".into());
    }
    if bytes.is_empty() || bytes.len() > MAX_ENTRY_BYTES {
        return Err("preview too large".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    // Write to a temporary name and rename, so a reader never sees half a file.
    let p = entry_path(dir, key, page);
    let tmp = p.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })?;
    trim(dir, max_bytes);
    Ok(())
}

/// Delete the least recently used entries until the folder is within `max_bytes`.
pub fn trim(dir: &Path, max_bytes: u64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            m.is_file().then(|| (m.modified().unwrap_or(std::time::UNIX_EPOCH), m.len(), e.path()))
        })
        .collect();
    let mut total: u64 = files.iter().map(|f| f.1).sum();
    if total <= max_bytes {
        return;
    }
    files.sort_by_key(|f| f.0);
    for (_, len, p) in files {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&p).is_ok() {
            total -= len;
        }
    }
}
