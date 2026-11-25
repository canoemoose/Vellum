//! Resets: for a profile gone wrong, and for seeing Vellum as a new install would. Three
//! separate things, any mix of them: settings (everything in the web view's storage), the
//! stored page previews, and the signature and stamp libraries.
//!
//! From Help > About > Reset..., or `--reset settings,previews,library` on the command line
//! (with Vellum closed: a second copy only hands its file to the first and exits).
//!
//! Settings live in the web view, so nothing here can delete them directly. The command line
//! clears them with a script that runs before the page's own (`settings_plugin`); the dialog
//! leaves a mark the page clears them by at its next start (src/lib/shell/reset.ts).

use std::path::Path;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

/// What `--reset` asked for.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reset {
    pub settings: bool,
    pub previews: bool,
    pub library: bool,
}

impl Reset {
    /// From a comma-separated list. Words it doesn't know are ignored.
    pub fn parse(list: &str) -> Reset {
        let mut r = Reset::default();
        for word in list.split(',') {
            match word.trim().to_ascii_lowercase().as_str() {
                "settings" => r.settings = true,
                "previews" => r.previews = true,
                "library" => r.library = true,
                _ => {}
            }
        }
        r
    }
}

/// Delete a folder and everything in it. One that isn't there is already reset.
pub fn remove_dir(dir: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(crate::errcode::io(&e, format!("{}: {e}", dir.display()))),
    }
}

/// Delete the stored previews, the signature and stamp libraries, or both. Tries every folder
/// and reports the first that failed.
pub fn clear_files(app: &tauri::AppHandle, previews: bool, library: bool) -> Result<(), String> {
    let mut dirs = Vec::new();
    if previews {
        dirs.push(crate::previewcache::cache_dir());
    }
    if library {
        let data = crate::stamps::data_dir(app)?;
        dirs.push(data.join("signatures"));
        dirs.push(data.join("stamps"));
    }
    let mut first = Ok(());
    for d in dirs {
        let r = remove_dir(&d);
        eprintln!("[reset] {}: {}", d.display(), if r.is_ok() { "cleared" } else { "failed" });
        if first.is_ok() {
            first = r;
        }
    }
    first
}

#[tauri::command]
pub async fn reset_profile(app: tauri::AppHandle, previews: bool, library: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clear_files(&app, previews, library))
        .await
        .map_err(|e| format!("reset failed: {e}"))?
}

/// Clears the web view's storage before any of the page's own script runs. Once per run: a
/// reload of the page must not clear what has been set since.
const CLEAR_SETTINGS_JS: &str = r#"
try {
  if (!sessionStorage.getItem("vellum.reset.done")) {
    sessionStorage.setItem("vellum.reset.done", "1");
    localStorage.clear();
  }
} catch (e) {}
"#;

/// `--reset settings`: registered only when asked for.
pub fn settings_plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("reset-settings").js_init_script(CLEAR_SETTINGS_JS.to_string()).build()
}
