//! Windows' per-user data protection (DPAPI): data encrypted with the signed-in account's
//! key, which only that account (on this machine, or on others it roams to) can decrypt. The
//! blob carries its own integrity check, so a tampered file fails to decrypt rather than
//! decrypting to rubbish.

/// Encrypt `data` for the current Windows account. `entropy` is an extra secret mixed into
/// the key: the same bytes are needed to decrypt.
#[cfg(windows)]
pub fn protect(data: &[u8], entropy: &[u8], description: &str) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData};
    let input = blob(data);
    let ent = blob(entropy);
    let desc: Vec<u16> = description.encode_utf16().chain(std::iter::once(0)).collect();
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: every pointer is valid for the call; the input buffers outlive it, and the
    // output is copied and freed below.
    let ok = unsafe {
        CryptProtectData(&input, desc.as_ptr(), &ent, std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
    };
    if ok == 0 {
        return Err(format!("CryptProtectData failed: {}", std::io::Error::last_os_error()));
    }
    Ok(take(out))
}

/// Decrypt a blob made by `protect` for the current account with the same `entropy`. Fails
/// (rather than returning wrong bytes) for a blob that was altered, made by another account,
/// or made with other entropy.
#[cfg(windows)]
pub fn unprotect(data: &[u8], entropy: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::Security::Cryptography::{CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptUnprotectData};
    let input = blob(data);
    let ent = blob(entropy);
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    // SAFETY: as in `protect`. The description isn't asked for (null).
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            &ent,
            std::ptr::null(),
            std::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out,
        )
    };
    if ok == 0 {
        return Err(format!("CryptUnprotectData failed: {}", std::io::Error::last_os_error()));
    }
    Ok(take(out))
}

#[cfg(windows)]
fn blob(data: &[u8]) -> windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
    windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB {
        cbData: data.len() as u32,
        // The API takes *mut but doesn't write through input blobs.
        pbData: data.as_ptr() as *mut u8,
    }
}

/// Copy an output blob into a Vec and free the system's buffer.
#[cfg(windows)]
fn take(out: windows_sys::Win32::Security::Cryptography::CRYPT_INTEGER_BLOB) -> Vec<u8> {
    if out.pbData.is_null() {
        return Vec::new();
    }
    // SAFETY: DPAPI returned cbData bytes at pbData, allocated with LocalAlloc.
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { windows_sys::Win32::Foundation::LocalFree(out.pbData as _) };
    v
}

#[cfg(not(windows))]
pub fn protect(_data: &[u8], _entropy: &[u8], _description: &str) -> Result<Vec<u8>, String> {
    Err("signature library needs Windows data protection".into())
}

#[cfg(not(windows))]
pub fn unprotect(_data: &[u8], _entropy: &[u8]) -> Result<Vec<u8>, String> {
    Err("signature library needs Windows data protection".into())
}
