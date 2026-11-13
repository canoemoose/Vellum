//! Codes on errors the user may see. An error string is "[code] detail": the front end picks
//! the message from the code (src/lib/shell/messages.ts) and never matches the wording, and the
//! detail is for the log, not the screen. Errors without a code are either written for people
//! already (shown as they are) or internal (shown as a plain "Couldn't ...").

use std::fmt::Display;

/// "[code] detail".
pub fn coded(code: &str, detail: impl Display) -> String {
    format!("[{code}] {detail}")
}

/// The code for a file-system error: missing, not allowed, in use, disk full, or a plain
/// read failure.
pub fn io_code(e: &std::io::Error) -> &'static str {
    use std::io::ErrorKind;
    match e.kind() {
        ErrorKind::NotFound => "not_found",
        ErrorKind::PermissionDenied => "access_denied",
        _ => match e.raw_os_error() {
            // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION
            Some(32) | Some(33) => "in_use",
            // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL
            Some(39) | Some(112) => "disk_full",
            _ => "read_failed",
        },
    }
}

/// A file-system error with its code; `detail` usually names the file and the OS's text.
pub fn io(e: &std::io::Error, detail: impl Display) -> String {
    coded(io_code(e), detail)
}
