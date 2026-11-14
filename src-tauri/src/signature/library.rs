//! The signature library: one file per signature in a folder in the user's profile, each
//! encrypted with DPAPI for the signed-in Windows account.
//!
//! A file is `FILE_MAGIC` followed by the DPAPI blob. Inside the blob: `PLAIN_MAGIC`, then four
//! length-prefixed sections (u32, little-endian): the metadata as JSON, the full PNG, a small
//! preview PNG, and the drawn strokes as JSON (empty for an imported signature). The file name
//! is the signature's id, which is the only thing readable without the key.

use super::dpapi;
use crate::errcode;
use image::{GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const FILE_MAGIC: &[u8; 8] = b"VSIGLIB1";
const PLAIN_MAGIC: &[u8; 8] = b"VSIGENT1";
/// Mixed into the DPAPI key, so a blob some other program protected for this account isn't
/// accepted as a signature (and ours aren't readable through a plain CryptUnprotectData).
const ENTROPY: &[u8] = b"Vellum signature library v1";
const EXT: &str = "vsig";

pub const MAX_PNG_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_SIDE: u32 = 4096;
pub const MAX_STROKES_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_NAME_CHARS: usize = 80;
/// Previews fit in this box (twice the list's display size, for high-DPI screens).
pub const THUMB_W: u32 = 240;
pub const THUMB_H: u32 = 80;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Drawn,
    Imported,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    /// The full image's size in pixels.
    pub width: u32,
    pub height: u32,
    /// Milliseconds since 1970.
    pub created_ms: u64,
}

/// A whole signature.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub meta: Meta,
    pub png: Vec<u8>,
    pub thumb: Vec<u8>,
    pub strokes: Option<String>,
}

/// One row of the list: the metadata and the preview PNG.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    #[serde(flatten)]
    pub meta: Meta,
    pub thumb: Vec<u8>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub items: Vec<ListItem>,
    /// Ids of files that couldn't be read: tampered with, damaged, or saved by another Windows
    /// account (copied in, or a profile restored from elsewhere). They can still be deleted.
    pub unreadable: Vec<String>,
}

pub struct Library {
    dir: PathBuf,
}

/// An id is lower-case hex: it becomes a file name, so nothing else is let through.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn bad_id(id: &str) -> String {
    errcode::coded("signature_not_found", format!("bad signature id {id:?}"))
}

/// Trim, drop control characters, cap the length; empty becomes "Signature".
pub fn clean_name(name: &str) -> String {
    let s: String = name.chars().filter(|c| !c.is_control()).collect();
    let s: String = s.trim().chars().take(MAX_NAME_CHARS).collect();
    let s = s.trim_end().to_string();
    if s.is_empty() { "Signature".to_string() } else { s }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn new_id() -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let c = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{:x}{:04x}", nanos as u64, c & 0xffff)
}

/// A preview PNG that fits `THUMB_W` x `THUMB_H`.
pub fn make_thumb(png: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory_with_format(png, ImageFormat::Png).map_err(|e| format!("preview: {e}"))?;
    let thumb = if img.width() > THUMB_W || img.height() > THUMB_H {
        img.resize(THUMB_W, THUMB_H, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    super::import::encode_png(&thumb.to_rgba8())
}

/// Check a PNG we're asked to store: really a PNG, a sensible size. Returns its dimensions.
pub fn check_png(png: &[u8]) -> Result<(u32, u32), String> {
    if png.len() > MAX_PNG_BYTES {
        return Err(errcode::coded("signature_too_large", format!("{} bytes", png.len())));
    }
    if image::guess_format(png).ok() != Some(ImageFormat::Png) {
        return Err(errcode::coded("not_supported", "signature image isn't a PNG"));
    }
    let img = image::load_from_memory_with_format(png, ImageFormat::Png)
        .map_err(|e| errcode::coded("not_supported", format!("signature PNG: {e}")))?;
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return Err(errcode::coded("signature_too_large", format!("{w} x {h}")));
    }
    Ok((w, h))
}

fn push_section(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

fn read_section<'a>(buf: &mut &'a [u8]) -> Option<&'a [u8]> {
    if buf.len() < 4 {
        return None;
    }
    let len = u32::from_le_bytes(buf[..4].try_into().ok()?) as usize;
    let rest = &buf[4..];
    if rest.len() < len {
        return None;
    }
    let (s, tail) = rest.split_at(len);
    *buf = tail;
    Some(s)
}

/// The plaintext inside the DPAPI blob.
pub fn encode_entry(e: &Entry) -> Vec<u8> {
    let meta = serde_json::to_vec(&e.meta).expect("meta serialises");
    let mut out = Vec::with_capacity(e.png.len() + e.thumb.len() + meta.len() + 64);
    out.extend_from_slice(PLAIN_MAGIC);
    push_section(&mut out, &meta);
    push_section(&mut out, &e.png);
    push_section(&mut out, &e.thumb);
    push_section(&mut out, e.strokes.as_deref().unwrap_or("").as_bytes());
    out
}

pub fn decode_entry(plain: &[u8]) -> Option<Entry> {
    let mut buf = plain.strip_prefix(PLAIN_MAGIC.as_slice())?;
    let meta: Meta = serde_json::from_slice(read_section(&mut buf)?).ok()?;
    let png = read_section(&mut buf)?.to_vec();
    let thumb = read_section(&mut buf)?.to_vec();
    let strokes = std::str::from_utf8(read_section(&mut buf)?).ok()?.to_string();
    Some(Entry { meta, png, thumb, strokes: if strokes.is_empty() { None } else { Some(strokes) } })
}

/// Encrypt an entry into the bytes of a library file.
pub fn seal(e: &Entry) -> Result<Vec<u8>, String> {
    let blob = dpapi::protect(&encode_entry(e), ENTROPY, "Vellum signature")?;
    let mut out = Vec::with_capacity(blob.len() + FILE_MAGIC.len());
    out.extend_from_slice(FILE_MAGIC);
    out.extend_from_slice(&blob);
    Ok(out)
}

/// Decrypt the bytes of a library file. Any failure (not ours, altered, another account's) is
/// one clean error.
pub fn open(bytes: &[u8]) -> Result<Entry, String> {
    let unreadable = |why: &str| errcode::coded("signature_unreadable", why);
    let blob = bytes.strip_prefix(FILE_MAGIC.as_slice()).ok_or_else(|| unreadable("not a signature file"))?;
    let plain = dpapi::unprotect(blob, ENTROPY).map_err(|e| unreadable(&e))?;
    decode_entry(&plain).ok_or_else(|| unreadable("damaged signature data"))
}

impl Library {
    pub fn new(dir: impl Into<PathBuf>) -> Library {
        Library { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(format!("{id}.{EXT}"))
    }

    fn write(&self, e: &Entry) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|err| errcode::io(&err, format!("{}: {err}", self.dir.display())))?;
        let bytes = seal(e)?;
        let path = self.path(&e.meta.id);
        let tmp = self.dir.join(format!("{}.tmp", e.meta.id));
        std::fs::write(&tmp, &bytes).map_err(|err| errcode::io(&err, format!("{}: {err}", tmp.display())))?;
        std::fs::rename(&tmp, &path).map_err(|err| {
            let _ = std::fs::remove_file(&tmp);
            errcode::io(&err, format!("{}: {err}", path.display()))
        })
    }

    /// Read one signature in full.
    pub fn get(&self, id: &str) -> Result<Entry, String> {
        if !valid_id(id) {
            return Err(bad_id(id));
        }
        let path = self.path(id);
        let bytes = std::fs::read(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                errcode::coded("signature_not_found", id)
            } else {
                errcode::io(&e, format!("{}: {e}", path.display()))
            }
        })?;
        let mut e = open(&bytes)?;
        // The file name is the id; a file renamed on disk keeps working under its new name.
        e.meta.id = id.to_string();
        Ok(e)
    }

    /// Every signature's metadata and preview, oldest first. Unreadable files are reported by
    /// id rather than failing the whole list.
    pub fn list(&self) -> Result<Listing, String> {
        let mut out = Listing::default();
        let rd = match std::fs::read_dir(&self.dir) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
            Err(e) => return Err(errcode::io(&e, format!("{}: {e}", self.dir.display()))),
        };
        for ent in rd.flatten() {
            let p = ent.path();
            if p.extension().and_then(|x| x.to_str()) != Some(EXT) {
                continue;
            }
            let Some(id) = p.file_stem().and_then(|s| s.to_str()) else { continue };
            if !valid_id(id) {
                continue;
            }
            match self.get(id) {
                Ok(e) => out.items.push(ListItem { meta: e.meta, thumb: e.thumb }),
                Err(err) => {
                    eprintln!("[signature] unreadable library file {id}: {err}");
                    out.unreadable.push(id.to_string());
                }
            }
        }
        out.items.sort_by(|a, b| a.meta.created_ms.cmp(&b.meta.created_ms).then_with(|| a.meta.id.cmp(&b.meta.id)));
        out.unreadable.sort();
        Ok(out)
    }

    /// Add a signature. `png` must be a PNG (alpha expected); `strokes` is the drawing it came
    /// from, kept for vector placing later.
    pub fn add(&self, name: &str, kind: Kind, png: Vec<u8>, strokes: Option<String>) -> Result<ListItem, String> {
        let (width, height) = check_png(&png)?;
        if let Some(s) = &strokes
            && s.len() > MAX_STROKES_BYTES
        {
            return Err(errcode::coded("signature_too_large", format!("strokes are {} bytes", s.len())));
        }
        let thumb = make_thumb(&png)?;
        let mut id = new_id();
        while self.path(&id).exists() {
            id = new_id();
        }
        let meta = Meta { id, name: clean_name(name), kind, width, height, created_ms: now_ms() };
        let entry = Entry { meta: meta.clone(), png, thumb: thumb.clone(), strokes: strokes.filter(|s| !s.is_empty()) };
        self.write(&entry)?;
        Ok(ListItem { meta, thumb })
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<Meta, String> {
        let mut e = self.get(id)?;
        e.meta.name = clean_name(name);
        self.write(&e)?;
        Ok(e.meta)
    }

    /// Delete a signature, readable or not. Deleting one that's already gone is fine.
    pub fn delete(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err(bad_id(id));
        }
        let path = self.path(id);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(errcode::io(&e, format!("{}: {e}", path.display()))),
        }
    }
}
