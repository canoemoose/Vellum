//! This process's memory, as Task Manager reports it.

#[derive(Clone, Copy, Debug, Default)]
pub struct Mem {
    /// Private bytes (commit charge), MB.
    pub private_mb: f64,
    /// Peak working set since the process started, MB.
    pub peak_ws_mb: f64,
}

#[cfg(windows)]
pub fn now() -> Mem {
    use windows_sys::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    unsafe {
        let mut c: PROCESS_MEMORY_COUNTERS_EX = std::mem::zeroed();
        c.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32;
        GetProcessMemoryInfo(GetCurrentProcess(), &mut c as *mut _ as *mut _, c.cb);
        Mem { private_mb: c.PrivateUsage as f64 / 1048576.0, peak_ws_mb: c.PeakWorkingSetSize as f64 / 1048576.0 }
    }
}

#[cfg(not(windows))]
pub fn now() -> Mem {
    Mem::default()
}
