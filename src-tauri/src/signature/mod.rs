//! Signatures (docs/editing-scope.md, "Stamps and signatures"; docs/signatures-backend.md):
//! importing one from a photo or scan, and the library of saved signatures, encrypted for the
//! Windows account. Placing a signature on a page is not here (it needs the markup model).

pub mod dpapi;
pub mod import;
pub mod library;
pub mod wic;

use library::{Kind, Library, ListItem, Listing, Meta};
use std::time::Instant;

/// The library lives in the roaming app data folder (DPAPI keys roam with the profile too).
/// (`VELLUM_DATA_DIR` points it at a scratch folder for scripted runs: crate::stamps::data_dir.)
fn library(app: &tauri::AppHandle) -> Result<Library, String> {
    Ok(Library::new(crate::stamps::data_dir(app)?.join("signatures")))
}

/// The upright picture as a JPEG, for choosing the framing on (binary, not JSON).
#[tauri::command]
pub async fn signature_preview(path: String) -> Result<tauri::ipc::Response, String> {
    let t = Instant::now();
    let r = tauri::async_runtime::spawn_blocking(move || import::preview_file(&path))
        .await
        .map_err(|e| e.to_string())?;
    match &r {
        Ok((jpeg, w, h)) => eprintln!(
            "[signature] preview of {w}x{h}: {} KB in {} ms",
            jpeg.len() / 1024,
            t.elapsed().as_millis()
        ),
        Err(e) => eprintln!("[signature] preview failed: {e}"),
    }
    r.map(|(jpeg, _, _)| tauri::ipc::Response::new(jpeg))
}

/// Knock the paper out of a photo or scan, framed as chosen on the preview (none: the whole
/// picture). Returns the PNG (binary, not JSON).
#[tauri::command]
pub async fn signature_import(path: String, adjust: Option<import::Adjust>) -> Result<tauri::ipc::Response, String> {
    let t = Instant::now();
    let adjust = adjust.unwrap_or_default();
    eprintln!("[signature] import with {adjust:?}");
    let r = tauri::async_runtime::spawn_blocking(move || import::import_file_adjusted(&path, &adjust))
        .await
        .map_err(|e| e.to_string())?;
    match &r {
        Ok(i) => eprintln!(
            "[signature] import {}x{} ink {:?} in {} ms",
            i.width,
            i.height,
            i.ink,
            t.elapsed().as_millis()
        ),
        Err(e) => eprintln!("[signature] import failed: {e}"),
    }
    r.map(|i| tauri::ipc::Response::new(i.png))
}

#[tauri::command]
pub async fn signature_list(app: tauri::AppHandle) -> Result<Listing, String> {
    let lib = library(&app)?;
    tauri::async_runtime::spawn_blocking(move || lib.list()).await.map_err(|e| e.to_string())?
}

/// Add a signature: `png` is the image's bytes, `strokes` the drawing (drawn signatures).
#[tauri::command]
pub async fn signature_add(
    app: tauri::AppHandle,
    name: String,
    kind: Kind,
    png: Vec<u8>,
    strokes: Option<String>,
) -> Result<ListItem, String> {
    let lib = library(&app)?;
    tauri::async_runtime::spawn_blocking(move || lib.add(&name, kind, png, strokes))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn signature_rename(app: tauri::AppHandle, id: String, name: String) -> Result<Meta, String> {
    let lib = library(&app)?;
    tauri::async_runtime::spawn_blocking(move || lib.rename(&id, &name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn signature_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let lib = library(&app)?;
    tauri::async_runtime::spawn_blocking(move || lib.delete(&id)).await.map_err(|e| e.to_string())?
}

/// The full PNG, for placing (binary, not JSON).
#[tauri::command]
pub async fn signature_get(app: tauri::AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let lib = library(&app)?;
    let e = tauri::async_runtime::spawn_blocking(move || lib.get(&id)).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(e.png))
}

/// The strokes a drawn signature was made from (JSON), or null for an imported one.
#[tauri::command]
pub async fn signature_strokes(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    let lib = library(&app)?;
    let e = tauri::async_runtime::spawn_blocking(move || lib.get(&id)).await.map_err(|e| e.to_string())??;
    Ok(e.strokes)
}
