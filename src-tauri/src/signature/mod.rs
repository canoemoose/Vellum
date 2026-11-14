//! Signatures (docs/editing-scope.md, "Stamps and signatures"; docs/signatures-backend.md):
//! importing one from a photo or scan, and the library of saved signatures, encrypted for the
//! Windows account. Placing a signature on a page is not here (it needs the markup model).

pub mod dpapi;
pub mod import;
pub mod library;
pub mod wic;

use library::{Kind, Library, ListItem, Listing, Meta};
use std::time::Instant;
use tauri::Manager;

/// The library lives in the roaming app data folder (DPAPI keys roam with the profile too).
fn library(app: &tauri::AppHandle) -> Result<Library, String> {
    let dir = app.path().app_data_dir().map_err(|e| format!("no app data folder: {e}"))?;
    Ok(Library::new(dir.join("signatures")))
}

/// Knock the paper out of a photo or scan. Returns the PNG (binary, not JSON).
#[tauri::command]
pub async fn signature_import(path: String) -> Result<tauri::ipc::Response, String> {
    let t = Instant::now();
    let r = tauri::async_runtime::spawn_blocking(move || import::import_file(&path))
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
