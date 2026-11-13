//! Error codes the front end chooses messages by (src/lib/shell/messages.ts).

use std::io::{Error, ErrorKind};
use vellum_lib::errcode::{coded, io, io_code};

#[test]
fn coded_puts_the_code_first() {
    assert_eq!(coded("wrong_password", "Wrong password"), "[wrong_password] Wrong password");
}

#[test]
fn file_system_errors_get_their_codes() {
    assert_eq!(io_code(&Error::from(ErrorKind::NotFound)), "not_found");
    assert_eq!(io_code(&Error::from(ErrorKind::PermissionDenied)), "access_denied");
    assert_eq!(io_code(&Error::from_raw_os_error(32)), "in_use");
    assert_eq!(io_code(&Error::from_raw_os_error(112)), "disk_full");
    assert_eq!(io_code(&Error::other("x")), "read_failed");
    assert!(io(&Error::from(ErrorKind::NotFound), "C:\\a.pdf").starts_with("[not_found] "));
}

#[test]
fn the_open_errors_carry_codes() {
    use vellum_lib::pdfium::{ERR_DLL_MISSING, ERR_NOT_SUPPORTED, ERR_PASSWORD_REQUIRED, ERR_WRONG_PASSWORD};
    assert!(ERR_DLL_MISSING.starts_with("[pdfium_missing] "));
    assert!(ERR_PASSWORD_REQUIRED.starts_with("[password_required] "));
    assert!(ERR_WRONG_PASSWORD.starts_with("[wrong_password] "));
    assert!(ERR_NOT_SUPPORTED.starts_with("[not_supported] "));
}
