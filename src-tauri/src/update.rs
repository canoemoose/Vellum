//! In-app updates: the two things the updater plugin doesn't do for the front end.
//!
//! - Counting other running copies of this exe. The installer, run by the updater in passive
//!   mode, shuts down every running copy without asking (Tauri's NSIS template,
//!   CheckIfAppIsRunning), so the front end asks first and tells the user to close them.
//! - Opening a version's release page ("What's new") in the browser. The address is built
//!   here from a checked version, so the window can't be made to open anything else.
//!
//! - Keeping the note of open tabs across the restart in a file. The installer step ends
//!   this process at once, and the WebView's own storage isn't certain to have reached the
//!   disk by then; a file written here is.
//!
//! The update itself (check, download, signature check, install, restart) is
//! tauri-plugin-updater, driven from src/lib/updater.ts. See docs/release-pipeline-scope.md.

use std::path::{Path, PathBuf};

/// The releases live here; the updater's endpoint (tauri.conf.json) points at the same place.
const RELEASES: &str = "https://github.com/canoemoose/Vellum/releases";

/// The release page for `version` ("0.1.2", "0.2.0-rc1"), or None if it isn't a version.
/// Digits, dots and a plain pre-release part only: nothing that could change the address.
pub fn release_url(version: &str) -> Option<String> {
    let (core, pre) = match version.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (version, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    let numeric = |p: &&str| !p.is_empty() && p.len() <= 9 && p.bytes().all(|b| b.is_ascii_digit());
    if parts.len() != 3 || !parts.iter().all(numeric) {
        return None;
    }
    if let Some(p) = pre {
        let ok = !p.is_empty() && p.len() <= 40 && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-');
        if !ok {
            return None;
        }
    }
    Some(format!("{RELEASES}/tag/v{version}"))
}

/// How many of `processes` (pid, exe path) are another copy of the exe at `me_path`.
/// Paths compare without regard to case or slash direction, as Windows does.
pub fn count_other_copies(processes: &[(u32, String)], me_pid: u32, me_path: &Path) -> u32 {
    let norm = |s: &str| s.replace('/', "\\").to_lowercase();
    let me = norm(&me_path.to_string_lossy());
    processes.iter().filter(|(pid, path)| *pid != me_pid && norm(path) == me).count() as u32
}

/// Every process this user can query, with its exe path.
#[cfg(windows)]
fn running_processes() -> Vec<(u32, String)> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW};

    let mut pids: Vec<u32> = Vec::with_capacity(512);
    let mut out = Vec::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                pids.push(e.th32ProcessID);
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        for pid in pids {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                continue; // a system process, or another user's: not ours to count
            }
            let mut buf = [0u16; 1024];
            let mut len = buf.len() as u32;
            if QueryFullProcessImageNameW(h, 0, buf.as_mut_ptr(), &mut len) != 0 {
                out.push((pid, String::from_utf16_lossy(&buf[..len as usize])));
            }
            CloseHandle(h);
        }
    }
    out
}

#[cfg(not(windows))]
fn running_processes() -> Vec<(u32, String)> {
    Vec::new()
}

/// Other running copies of this Vellum (windows started with --new-instance, benchmark runs).
/// Zero if the answer can't be had: the update then goes ahead as it would have.
#[tauri::command]
pub async fn update_other_instances() -> u32 {
    tauri::async_runtime::spawn_blocking(|| {
        let Ok(me) = std::env::current_exe() else { return 0 };
        count_other_copies(&running_processes(), std::process::id(), &me)
    })
    .await
    .unwrap_or(0)
}

/// The note's file: update-handover.json in Vellum's folder under LOCALAPPDATA (beside the
/// performance log).
fn handover_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    base.join("Vellum").join("update-handover.json")
}

/// Write the note of open tabs (JSON from the front end, src/lib/shell/update.ts) to `path`.
pub fn save_handover(path: &Path, json: &str) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, json)
}

/// The note at `path`, if there is one, removing it: it is acted on once at most.
pub fn take_handover(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok();
    let _ = std::fs::remove_file(path);
    text
}

/// Note the open tabs just before an update restarts Vellum.
#[tauri::command]
pub fn update_save_handover(json: String) -> Result<(), String> {
    save_handover(&handover_path(), &json).map_err(|e| crate::errcode::io(&e, format!("update handover: {e}")))
}

/// The note left by the run an update ended, or null. Removes it.
#[tauri::command]
pub fn update_take_handover() -> Option<String> {
    take_handover(&handover_path())
}

/// Open the release page for `version` in the default browser.
#[tauri::command]
pub fn update_open_release_page(version: String) -> Result<(), String> {
    let url = release_url(&version).ok_or_else(|| crate::errcode::coded("not_supported", format!("not a version: {version}")))?;
    #[cfg(windows)]
    {
        // explorer.exe hands an address to the default browser.
        std::process::Command::new("explorer.exe")
            .arg(&url)
            .spawn()
            .map_err(|e| crate::errcode::coded("explorer_failed", format!("Couldn't open the browser: {e}")))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Opening the release page only works on Windows".into())
    }
}
