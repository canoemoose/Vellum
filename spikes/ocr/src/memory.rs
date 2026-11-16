//! This process's memory and CPU time, as Task Manager reports them.

#[derive(Clone, Copy, Debug, Default)]
pub struct Mem {
    /// Private bytes (commit charge), MB.
    pub private_mb: f64,
    /// Working set now, MB.
    pub ws_mb: f64,
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
        let mb = |v: usize| v as f64 / 1048576.0;
        Mem { private_mb: mb(c.PrivateUsage), ws_mb: mb(c.WorkingSetSize), peak_ws_mb: mb(c.PeakWorkingSetSize) }
    }
}

/// User plus kernel CPU time of the whole process so far, ms.
#[cfg(windows)]
pub fn cpu_ms() -> f64 {
    use windows_sys::Win32::Foundation::FILETIME;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    unsafe {
        let z = FILETIME { dwLowDateTime: 0, dwHighDateTime: 0 };
        let (mut a, mut b, mut k, mut u) = (z, z, z, z);
        GetProcessTimes(GetCurrentProcess(), &mut a, &mut b, &mut k, &mut u);
        let t = |f: FILETIME| ((f.dwHighDateTime as u64) << 32 | f.dwLowDateTime as u64) as f64 / 10_000.0;
        t(k) + t(u)
    }
}
