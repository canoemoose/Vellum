//! The system clipboard for markups and pictures (stage 9 of
//! docs/editing-tool-consistency-brief.md). Copying markups puts them on Windows' clipboard in
//! Vellum's own registered format, so there is one clipboard: whatever was copied last,
//! anywhere, is what Ctrl+V pastes (markups, or a picture as an Image markup), and markups
//! paste between Vellum windows. Other apps ignore the format.
//!
//! What Vellum puts there is kept out of Windows' clipboard history (Win+V) and the cloud
//! clipboard: the standard "ExcludeClipboardContentFromMonitorProcessing",
//! "CanIncludeInClipboardHistory" (0) and "CanUploadToCloudClipboard" (0) formats go with it.
//! A signature's picture or strokes are never here: the front end replaces each copied
//! signature with a reference only the running app that copied it can resolve
//! (src/lib/markup/clip.ts).

use serde::Serialize;

/// Vellum's markups format (UTF-8 JSON from the front end).
pub const MARKUPS_FORMAT: &str = "Vellum.Markups.v1";

/// A picture on the clipboard is scaled down to this on its long side on the way in (the
/// image size limit, stage 8).
pub const MAX_PICTURE_PX: u32 = 2000;

/// What the clipboard holds, as far as pasting markups goes.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Clip {
    /// Vellum's markups (the JSON the front end put there).
    Markups { json: String },
    /// A picture, as PNG bytes in base64, at most MAX_PICTURE_PX on its long side.
    Picture { png: String, w: u32, h: u32 },
    /// Nothing Vellum can paste.
    None,
}

/// A BMP file from a CF_DIB block: the 14-byte file header the clipboard leaves out, then the
/// block. The pixels start after the info header, any bit-field masks and any colour table.
pub fn bmp_from_dib(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let u32_at = |o: usize| u32::from_le_bytes([dib[o], dib[o + 1], dib[o + 2], dib[o + 3]]);
    let header = u32_at(0) as usize;
    if header < 40 || header > dib.len() {
        return None;
    }
    let bits = u16::from_le_bytes([dib[14], dib[15]]) as usize;
    let compression = u32_at(16);
    let used = u32_at(32) as usize;
    // BI_BITFIELDS (3) with a plain 40-byte header: three masks follow it.
    let masks = if header == 40 && compression == 3 { 12 } else { 0 };
    let colours = if bits <= 8 { if used > 0 { used } else { 1 << bits } } else { used };
    let offset = 14 + header + masks + colours * 4;
    let size = 14 + dib.len();
    let mut out = Vec::with_capacity(size);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(offset as u32).to_le_bytes());
    out.extend_from_slice(dib);
    Some(out)
}

/// A picture's bytes (PNG, or BMP) as a PNG no larger than MAX_PICTURE_PX on its long side.
pub fn picture_png(bytes: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let img = image::load_from_memory(bytes).map_err(|e| crate::errcode::coded("picture_unreadable", e))?;
    let (w, h) = (img.width(), img.height());
    let img = if w.max(h) > MAX_PICTURE_PX {
        img.resize(MAX_PICTURE_PX, MAX_PICTURE_PX, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|e| crate::errcode::coded("picture_unreadable", e))?;
    Ok((png, img.width(), img.height()))
}

/// Stage 8: a picture file (the Image tool) as a PNG no larger than MAX_PICTURE_PX on its long
/// side, as a pasted picture is. Anything the `image` crate reads (PNG, JPEG, WebP, TIFF, BMP,
/// GIF); an unreadable one is `[picture_unreadable]`, a missing one an I/O error.
pub fn picture_file(path: &std::path::Path) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| crate::errcode::io(&e, format!("{}: {e}", path.display())))?;
    picture_png(&bytes)
}

/// The picture file the Image tool picked, for placing: as `Clip::Picture`, or an error.
#[tauri::command]
pub async fn picture_open(path: String) -> Result<Clip, String> {
    let (png, w, h) = tauri::async_runtime::spawn_blocking(move || picture_file(std::path::Path::new(&path))).await.map_err(|e| e.to_string())??;
    Ok(Clip::Picture { png: base64(&png), w, h })
}

/// Standard base64 (the front end's `fromBase64` reads it).
pub fn base64(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                s.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}

#[cfg(windows)]
mod win {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::{GlobalFree, HANDLE, HWND};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows_sys::Win32::System::Ole::CF_DIB;

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn format(name: &str) -> u32 {
        let w = wide(name);
        unsafe { RegisterClipboardFormatW(w.as_ptr()) }
    }

    /// The clipboard, open until dropped. Another app may hold it for a moment: retried briefly.
    pub struct Open;
    impl Open {
        pub fn new(owner: HWND) -> Result<Open, String> {
            for _ in 0..20 {
                if unsafe { OpenClipboard(owner) } != 0 {
                    return Ok(Open);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Err(crate::errcode::coded("clipboard_busy", "another program is using the clipboard"))
        }
    }
    impl Drop for Open {
        fn drop(&mut self) {
            unsafe { CloseClipboard() };
        }
    }

    /// Put `bytes` on the open clipboard in `fmt` (the clipboard owns the memory after).
    fn put(fmt: u32, bytes: &[u8]) -> Result<(), String> {
        unsafe {
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
            if h.is_null() {
                return Err(crate::errcode::coded("clipboard_failed", "out of memory"));
            }
            let p = GlobalLock(h) as *mut u8;
            if p.is_null() {
                GlobalFree(h);
                return Err(crate::errcode::coded("clipboard_failed", "couldn't lock memory"));
            }
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
            GlobalUnlock(h);
            if SetClipboardData(fmt, h as HANDLE).is_null() {
                GlobalFree(h);
                return Err(crate::errcode::coded("clipboard_failed", "SetClipboardData failed"));
            }
        }
        Ok(())
    }

    /// The bytes in `fmt` on the open clipboard, if any.
    fn get(fmt: u32) -> Option<Vec<u8>> {
        unsafe {
            if IsClipboardFormatAvailable(fmt) == 0 {
                return None;
            }
            let h = GetClipboardData(fmt);
            if h.is_null() {
                return None;
            }
            let n = GlobalSize(h);
            let p = GlobalLock(h) as *const u8;
            if p.is_null() {
                return None;
            }
            let v = std::slice::from_raw_parts(p, n).to_vec();
            GlobalUnlock(h);
            Some(v)
        }
    }

    pub fn put_markups(owner: HWND, json: &str) -> Result<(), String> {
        let _open = Open::new(owner)?;
        if unsafe { EmptyClipboard() } == 0 {
            return Err(crate::errcode::coded("clipboard_failed", "EmptyClipboard failed"));
        }
        put(format(super::MARKUPS_FORMAT), json.as_bytes())?;
        // Kept out of Windows' clipboard history and the cloud clipboard.
        put(format("ExcludeClipboardContentFromMonitorProcessing"), &[0])?;
        put(format("CanIncludeInClipboardHistory"), &0u32.to_le_bytes())?;
        put(format("CanUploadToCloudClipboard"), &0u32.to_le_bytes())?;
        Ok(())
    }

    /// Vellum's markups, else a picture's bytes (PNG if offered, else a DIB as BMP).
    pub fn take() -> Result<(Option<String>, Option<Vec<u8>>), String> {
        let _open = Open::new(null_mut())?;
        if let Some(b) = get(format(super::MARKUPS_FORMAT)) {
            let end = b.iter().position(|&c| c == 0).unwrap_or(b.len());
            return Ok((Some(String::from_utf8_lossy(&b[..end]).into_owned()), None));
        }
        if let Some(b) = get(format("PNG")) {
            return Ok((None, Some(b)));
        }
        if let Some(b) = get(CF_DIB as u32) {
            return Ok((None, super::bmp_from_dib(&b)));
        }
        Ok((None, None))
    }
}

/// Put markups (Vellum's JSON) on the system clipboard, replacing whatever was there.
#[tauri::command]
pub fn clipboard_put_markups(window: tauri::WebviewWindow, json: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|e| crate::errcode::coded("clipboard_failed", e))?;
        win::put_markups(hwnd.0 as _, &json)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, json);
        Err(crate::errcode::coded("clipboard_failed", "not supported here"))
    }
}

/// What's on the system clipboard that Vellum can paste: its markups, a picture, or nothing.
#[tauri::command]
pub async fn clipboard_take() -> Result<Clip, String> {
    #[cfg(windows)]
    {
        let (markups, picture) = tauri::async_runtime::spawn_blocking(win::take).await.map_err(|e| e.to_string())??;
        if let Some(json) = markups {
            return Ok(Clip::Markups { json });
        }
        if let Some(bytes) = picture {
            let (png, w, h) = tauri::async_runtime::spawn_blocking(move || picture_png(&bytes)).await.map_err(|e| e.to_string())??;
            return Ok(Clip::Picture { png: base64(&png), w, h });
        }
        Ok(Clip::None)
    }
    #[cfg(not(windows))]
    {
        Ok(Clip::None)
    }
}
