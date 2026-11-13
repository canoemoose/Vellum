//! WP-Shell: single instance and Explorer integration.
//!
//! Single instance: a second `vellum.exe` (Explorer "Open with", double-clicking an associated
//! file) forwards its file to the running instance and exits. The running instance opens it as
//! a new tab and comes to the front. Files that arrive before the front end is listening (several
//! files opened from Explorer at once, while the first instance is still starting) are queued
//! and collected with `shell_take_pending` once the front end is ready.
//!
//! The benchmark (`--bench`) and automated runs (`--new-instance`, or `VELLUM_MULTI_INSTANCE`
//! set) skip it, so every run gets its own process.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime};

/// Event the front end listens for: a list of absolute paths to open as tabs.
pub const OPEN_FILES_EVENT: &str = "vellum://open-files";

#[derive(Default)]
pub struct PendingOpens {
    inner: Mutex<(bool, Vec<String>)>,
}

impl PendingOpens {
    /// Queue `files` if the front end isn't listening yet. Returns true when queued.
    pub fn queue_if_not_ready(&self, files: &[String]) -> bool {
        let mut g = self.inner.lock().unwrap();
        if g.0 {
            return false;
        }
        g.1.extend_from_slice(files);
        true
    }

    /// Mark the front end ready and hand over everything queued so far.
    pub fn take(&self) -> Vec<String> {
        let mut g = self.inner.lock().unwrap();
        g.0 = true;
        std::mem::take(&mut g.1)
    }
}

/// Whether this launch should join the running instance.
pub fn single_instance_wanted(bench: bool, argv: &[String]) -> bool {
    !bench
        && !argv.iter().any(|a| a == "--new-instance")
        && std::env::var_os("VELLUM_MULTI_INSTANCE").is_none()
}

/// The file a forwarded command line asks for, made absolute against the sender's working
/// directory (a relative path from a terminal means nothing to the running instance).
pub fn forwarded_file(argv: Vec<String>, cwd: &str) -> Option<String> {
    let file = crate::parse_args(argv.into_iter()).file?;
    let p = Path::new(&file);
    let abs: PathBuf = if p.is_absolute() || cwd.is_empty() { p.to_path_buf() } else { Path::new(cwd).join(p) };
    Some(abs.to_string_lossy().into_owned())
}

/// Register the shell's plugins and state on the builder. Called first in `run()`, because the
/// single-instance plugin must be the first plugin registered.
pub fn register<R: Runtime>(builder: tauri::Builder<R>, bench: bool) -> tauri::Builder<R> {
    let argv: Vec<String> = std::env::args().collect();
    let builder = builder.manage(PendingOpens::default());
    if !single_instance_wanted(bench, &argv) {
        return builder;
    }
    builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let files: Vec<String> = forwarded_file(argv, &cwd).into_iter().collect();
        if !files.is_empty() {
            let pending = app.state::<PendingOpens>();
            if !pending.queue_if_not_ready(&files) {
                if let Err(e) = app.emit(OPEN_FILES_EVENT, &files) {
                    eprintln!("[shell] could not forward files to the window: {e}");
                }
            }
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }))
}

/// Files forwarded by other launches before the front end was listening. Also marks the
/// front end ready, so later ones arrive as events.
#[tauri::command]
pub fn shell_take_pending(pending: tauri::State<PendingOpens>) -> Vec<String> {
    pending.take()
}

/// Open the third-party notices installed beside the exe (tools/make-notices.mjs) in the
/// default text editor. In a dev build they're read from src-tauri/licenses, if generated.
#[tauri::command]
pub fn open_notices<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    const NAME: &str = "THIRD-PARTY-NOTICES.txt";
    let installed = app.path().resource_dir().map(|d| d.join(NAME)).ok();
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("licenses").join(NAME);
    let path = installed.filter(|p| p.exists()).or_else(|| dev.exists().then_some(dev)).ok_or_else(|| {
        crate::errcode::coded("not_found", "The third-party notices aren't installed (run node tools/make-notices.mjs in a dev build)")
    })?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer.exe opens a file with its default app.
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("\"{}\"", path.display()))
            .spawn()
            .map_err(|e| crate::errcode::coded("explorer_failed", format!("Couldn't open the notices: {e}")))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("Opening the notices only works on Windows".into())
    }
}

/// Open an Explorer window with the file selected.
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(crate::errcode::coded("not_found", format!("{path} no longer exists")));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // explorer.exe parses its own command line: the path goes in quotes after /select,
        // with no space, or paths containing commas or spaces open the wrong folder.
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.replace('/', "\\")))
            .spawn()
            .map_err(|e| crate::errcode::coded("explorer_failed", format!("Couldn't start Explorer: {e}")))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("Show in Explorer only works on Windows".into())
    }
}

