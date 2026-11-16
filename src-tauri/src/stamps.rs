//! Your own image stamps (docs/editing-phase5-scope.md, "Your own stamps"): a picture (PNG or
//! JPEG, or anything the `image` crate reads) kept as a PNG with its transparency, in
//! `stamps\` in the roaming app data folder. Not encrypted: a stamp isn't a signature.
//!
//! One folder entry per stamp: `<id>.png` (the picture, at most 2000 px a side), `<id>.thumb.png`
//! (a preview at most 240 x 80) and `<id>.json` (its name, size and when it was added). Writes go
//! to a temporary file renamed into place, so a crash can't leave half a stamp.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use image::GenericImageView;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::errcode;

/// Longest side kept, pixels: about 340 dpi at 150 mm, well past what a stamp needs.
pub const MAX_SIDE: u32 = 2000;
/// Smallest picture accepted, pixels a side.
pub const MIN_SIDE: u32 = 8;
const THUMB_W: u32 = 240;
const THUMB_H: u32 = 80;
const MAX_NAME_CHARS: usize = 80;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StampMeta {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub created_ms: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StampItem {
    #[serde(flatten)]
    pub meta: StampMeta,
    /// Preview PNG bytes.
    pub thumb: Vec<u8>,
}

pub struct StampLibrary {
    dir: PathBuf,
}

/// Lower-case hex only: an id becomes a file name.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn bad_id(id: &str) -> String {
    errcode::coded("stamp_not_found", format!("bad stamp id {id:?}"))
}

fn new_id() -> String {
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{:x}{:04x}", nanos as u64, COUNTER.fetch_add(1, Ordering::Relaxed) & 0xffff)
}

/// A stamp's name from its file name: trimmed, control characters dropped, capped.
pub fn name_from_path(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let s: String = stem.chars().filter(|c| !c.is_control()).collect::<String>().trim().chars().take(MAX_NAME_CHARS).collect();
    if s.trim().is_empty() { "Stamp".into() } else { s.trim().to_string() }
}

fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>, String> {
    let mut out = std::io::Cursor::new(Vec::new());
    img.write_to(&mut out, image::ImageFormat::Png).map_err(|e| format!("encode png: {e}"))?;
    Ok(out.into_inner())
}

/// A picture's bytes made into what the library keeps: (PNG, preview PNG, width, height).
/// Transparency is kept as it is (no knock-out); a picture over 2000 px is scaled down.
pub fn prepare(bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>, u32, u32), String> {
    let img = image::load_from_memory(bytes).map_err(|e| errcode::coded("not_supported", format!("stamp picture: {e}")))?;
    let (w, h) = img.dimensions();
    if w < MIN_SIDE || h < MIN_SIDE {
        return Err(errcode::coded("stamp_too_small", format!("{w} x {h}")));
    }
    let img = if w > MAX_SIDE || h > MAX_SIDE { img.resize(MAX_SIDE, MAX_SIDE, image::imageops::FilterType::Lanczos3) } else { img };
    // RGBA throughout, so a JPEG and a PNG come out the same way.
    let img = image::DynamicImage::ImageRgba8(img.to_rgba8());
    let thumb = if img.width() > THUMB_W || img.height() > THUMB_H { img.resize(THUMB_W, THUMB_H, image::imageops::FilterType::Triangle) } else { img.clone() };
    Ok((encode_png(&img)?, encode_png(&thumb)?, img.width(), img.height()))
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| errcode::io(&e, format!("{}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        errcode::io(&e, format!("{}: {e}", path.display()))
    })
}

impl StampLibrary {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn file(&self, id: &str, ext: &str) -> PathBuf {
        self.dir.join(format!("{id}.{ext}"))
    }

    /// Add a picture from a file on disk.
    pub fn add_file(&self, path: &Path) -> Result<StampItem, String> {
        let bytes = std::fs::read(path).map_err(|e| errcode::io(&e, format!("{}: {e}", path.display())))?;
        self.add(&name_from_path(path), &bytes)
    }

    /// Add a picture (its bytes) under `name`.
    pub fn add(&self, name: &str, bytes: &[u8]) -> Result<StampItem, String> {
        let (png, thumb, width, height) = prepare(bytes)?;
        std::fs::create_dir_all(&self.dir).map_err(|e| errcode::io(&e, format!("{}: {e}", self.dir.display())))?;
        let created_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        let meta = StampMeta { id: new_id(), name: name.to_string(), width, height, created_ms };
        write_atomic(&self.file(&meta.id, "png"), &png)?;
        write_atomic(&self.file(&meta.id, "thumb.png"), &thumb)?;
        // The metadata last: an entry is listed only once its pictures are there.
        write_atomic(&self.file(&meta.id, "json"), serde_json::to_string(&meta).map_err(|e| e.to_string())?.as_bytes())?;
        Ok(StampItem { meta, thumb })
    }

    /// Every stamp, oldest first. Entries that can't be read are left out.
    pub fn list(&self) -> Result<Vec<StampItem>, String> {
        let rd = match std::fs::read_dir(&self.dir) {
            Ok(r) => r,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(errcode::io(&e, format!("{}: {e}", self.dir.display()))),
        };
        let mut out = vec![];
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Some(id) = p.file_stem().and_then(|s| s.to_str()).filter(|s| valid_id(s)).map(str::to_string) else { continue };
            let Ok(meta) = std::fs::read(&p).map_err(|_| ()).and_then(|b| serde_json::from_slice::<StampMeta>(&b).map_err(|_| ())) else { continue };
            let Ok(thumb) = std::fs::read(self.file(&id, "thumb.png")) else { continue };
            out.push(StampItem { meta: StampMeta { id, ..meta }, thumb });
        }
        out.sort_by(|a, b| a.meta.created_ms.cmp(&b.meta.created_ms).then(a.meta.id.cmp(&b.meta.id)));
        Ok(out)
    }

    /// The picture, as a PNG.
    pub fn get(&self, id: &str) -> Result<Vec<u8>, String> {
        if !valid_id(id) {
            return Err(bad_id(id));
        }
        std::fs::read(self.file(id, "png")).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound { errcode::coded("stamp_not_found", format!("stamp {id}")) } else { errcode::io(&e, format!("stamp {id}: {e}")) }
        })
    }

    /// Give a stamp another name (trimmed; an empty one is refused). Only its metadata changes.
    pub fn rename(&self, id: &str, name: &str) -> Result<StampItem, String> {
        if !valid_id(id) {
            return Err(bad_id(id));
        }
        let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
        if name.is_empty() {
            return Err(errcode::coded("stamp_name_empty", "a stamp needs a name".to_string()));
        }
        let path = self.file(id, "json");
        let bytes = std::fs::read(&path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound { errcode::coded("stamp_not_found", format!("stamp {id}")) } else { errcode::io(&e, format!("stamp {id}: {e}")) }
        })?;
        let meta: StampMeta = serde_json::from_slice(&bytes).map_err(|e| format!("stamp {id}: {e}"))?;
        let meta = StampMeta { id: id.to_string(), name, ..meta };
        write_atomic(&path, serde_json::to_string(&meta).map_err(|e| e.to_string())?.as_bytes())?;
        let thumb = std::fs::read(self.file(id, "thumb.png")).map_err(|e| errcode::io(&e, format!("stamp {id}: {e}")))?;
        Ok(StampItem { meta, thumb })
    }

    /// Remove a stamp (twice is fine).
    pub fn delete(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err(bad_id(id));
        }
        for ext in ["json", "png", "thumb.png"] {
            match std::fs::remove_file(self.file(id, ext)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(errcode::io(&e, format!("stamp {id}: {e}"))),
            }
        }
        Ok(())
    }
}

/// The roaming app data folder, where the signature and stamp libraries live; or
/// `VELLUM_DATA_DIR` when set, so scripted runs and tests use a scratch folder and never the
/// user's own signatures.
pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(d) = std::env::var_os("VELLUM_DATA_DIR").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(d));
    }
    app.path().app_data_dir().map_err(|e| format!("no app data folder: {e}"))
}

fn library(app: &tauri::AppHandle) -> Result<StampLibrary, String> {
    Ok(StampLibrary::new(data_dir(app)?.join("stamps")))
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn stamp_list(app: tauri::AppHandle) -> Result<Vec<StampItem>, String> {
    let lib = library(&app)?;
    blocking(move || lib.list()).await
}

/// Add a picture from a file the user picked.
#[tauri::command]
pub async fn stamp_add(app: tauri::AppHandle, path: String) -> Result<StampItem, String> {
    let lib = library(&app)?;
    let r = blocking(move || lib.add_file(Path::new(&path))).await;
    match &r {
        Ok(i) => eprintln!("[stamps] added {} ({}x{})", i.meta.id, i.meta.width, i.meta.height),
        Err(e) => eprintln!("[stamps] add failed: {e}"),
    }
    r
}

/// The picture (binary, not JSON).
#[tauri::command]
pub async fn stamp_get(app: tauri::AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let lib = library(&app)?;
    blocking(move || lib.get(&id)).await.map(tauri::ipc::Response::new)
}

#[tauri::command]
pub async fn stamp_rename(app: tauri::AppHandle, id: String, name: String) -> Result<StampItem, String> {
    let lib = library(&app)?;
    blocking(move || lib.rename(&id, &name)).await
}

#[tauri::command]
pub async fn stamp_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let lib = library(&app)?;
    blocking(move || lib.delete(&id)).await
}
