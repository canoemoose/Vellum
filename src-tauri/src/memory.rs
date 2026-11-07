//! Process-tree memory sampling.
//!
//! WebView2 runs the page, GPU and utility work in separate `msedgewebview2.exe`
//! processes parented (directly or indirectly) by our own process, so measuring
//! only `vellum.exe` would miss most of the cost. We sum the private working set
//! of the whole tree, which is what Task Manager's "Memory" column shows.

use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Serialize, Clone, Copy, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemSample {
    /// Sum of private working set across the process tree (MB).
    pub private_ws_mb: f64,
    /// Sum of full working set (includes shared pages, so double counts DLLs) (MB).
    pub working_set_mb: f64,
    /// Sum of private commit (MB).
    pub commit_mb: f64,
    pub processes: u32,
}

#[derive(Serialize, Clone, Copy, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemStats {
    pub current: MemSample,
    pub peak: MemSample,
}

#[derive(Default)]
pub struct MemState(pub Arc<Mutex<MemStats>>);

impl MemState {
    pub fn reset_peak(&self) {
        let mut s = self.0.lock().unwrap();
        s.peak = s.current;
    }
}

/// Start a background thread sampling every `interval`.
pub fn start_sampler(state: Arc<Mutex<MemStats>>, interval: Duration) {
    std::thread::Builder::new()
        .name("mem-sampler".into())
        .spawn(move || {
            let root = std::process::id();
            loop {
                let s = sample_tree(root);
                {
                    let mut st = state.lock().unwrap();
                    st.current = s;
                    let p = &mut st.peak;
                    p.private_ws_mb = p.private_ws_mb.max(s.private_ws_mb);
                    p.working_set_mb = p.working_set_mb.max(s.working_set_mb);
                    p.commit_mb = p.commit_mb.max(s.commit_mb);
                    p.processes = p.processes.max(s.processes);
                }
                std::thread::sleep(interval);
            }
        })
        .expect("spawn mem sampler");
}

#[cfg(windows)]
pub fn sample_tree(root: u32) -> MemSample {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX2,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};

    let mut pairs: Vec<(u32, u32)> = Vec::with_capacity(512);
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return MemSample::default();
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                pairs.push((e.th32ProcessID, e.th32ParentProcessID));
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }

    // Breadth-first walk of the descendants of `root`.
    let mut tree = vec![root];
    let mut i = 0;
    while i < tree.len() {
        let p = tree[i];
        for &(pid, ppid) in &pairs {
            if ppid == p && pid != p && !tree.contains(&pid) {
                tree.push(pid);
            }
        }
        i += 1;
    }

    let mut out = MemSample::default();
    const MB: f64 = 1024.0 * 1024.0;
    for pid in tree {
        unsafe {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if h.is_null() {
                continue;
            }
            let mut c: PROCESS_MEMORY_COUNTERS_EX2 = std::mem::zeroed();
            c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX2>() as u32;
            if K32GetProcessMemoryInfo(h, &mut c as *mut _ as *mut PROCESS_MEMORY_COUNTERS, c.cb)
                != 0
            {
                out.private_ws_mb += c.PrivateWorkingSetSize as f64 / MB;
                out.working_set_mb += c.WorkingSetSize as f64 / MB;
                out.commit_mb += c.PrivateUsage as f64 / MB;
                out.processes += 1;
            }
            CloseHandle(h);
        }
    }
    out
}

#[cfg(not(windows))]
pub fn sample_tree(_root: u32) -> MemSample {
    MemSample::default()
}
