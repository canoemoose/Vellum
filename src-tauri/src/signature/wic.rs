//! Decoding through Windows Imaging Component, for pictures the `image` crate can't read: above
//! all HEIC, an iPhone's default photo format. WIC uses the codecs installed in Windows, so HEIC
//! needs Microsoft's "HEIF Image Extensions" and "HEVC Video Extensions" (Store apps; often
//! preinstalled). Without them it fails, and the caller says what to install.
//!
//! WIC hands back the pixels as stored. The orientation tag is read separately
//! (System.Photo.Orientation) and applied by the caller, as for JPEG.

use image::RgbaImage;

pub enum WicError {
    /// No codec in Windows reads this format.
    NoCodec,
    /// More pixels than the caller allows (width, height): refused before the pixels are read.
    TooLarge(u32, u32),
    Failed(String),
}

pub struct Decoded {
    pub rgba: RgbaImage,
    /// The EXIF-style orientation (1 to 8), if the picture has one.
    pub orientation: Option<u16>,
}

/// Whether the bytes look like a HEIF file (HEIC or AVIF): an ISO base media `ftyp` box with a
/// HEIF brand.
pub fn looks_like_heif(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || &bytes[4..8] != b"ftyp" {
        return false;
    }
    let brand = &bytes[8..12];
    [b"heic", b"heix", b"heim", b"heis", b"hevc", b"hevx", b"mif1", b"msf1", b"avif", b"avis"]
        .iter()
        .any(|b| brand == *b)
}

/// Decode the first frame, refusing one of more than `max_pixels` before allocating for it.
#[cfg(windows)]
pub fn decode(bytes: &[u8], max_pixels: u64) -> Result<Decoded, WicError> {
    use windows::Win32::Graphics::Imaging::*;
    use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PropVariantClear, PropVariantToUInt16};
    use windows::Win32::System::Com::{CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoUninitialize};
    use windows::core::w;

    // COM on this thread. Already initialised (either model) is fine: WIC's factory works in both.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    struct Uninit(bool);
    impl Drop for Uninit {
        fn drop(&mut self) {
            if self.0 {
                unsafe { CoUninitialize() };
            }
        }
    }
    let _com = Uninit(hr.is_ok());

    let failed = |what: &str, e: windows::core::Error| WicError::Failed(format!("WIC {what}: {e}"));
    // SAFETY: plain COM calls; `bytes` outlives the stream that reads it (both end here).
    unsafe {
        let factory: IWICImagingFactory =
            CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER).map_err(|e| failed("factory", e))?;
        let stream = factory.CreateStream().map_err(|e| failed("stream", e))?;
        stream.InitializeFromMemory(bytes).map_err(|e| failed("stream", e))?;
        let decoder = factory
            .CreateDecoderFromStream(&stream, std::ptr::null(), WICDecodeMetadataCacheOnDemand)
            .map_err(|e| if e.code() == windows::Win32::Foundation::WINCODEC_ERR_COMPONENTNOTFOUND { WicError::NoCodec } else { failed("decoder", e) })?;
        let frame = decoder.GetFrame(0).map_err(|e| failed("frame", e))?;
        // Its size first: a huge picture is refused without being read.
        let (mut fw, mut fh) = (0u32, 0u32);
        frame.GetSize(&mut fw, &mut fh).map_err(|e| failed("size", e))?;
        if fw as u64 * fh as u64 > max_pixels {
            return Err(WicError::TooLarge(fw, fh));
        }

        let orientation = frame.GetMetadataQueryReader().ok().and_then(|reader| {
            let mut v = PROPVARIANT::default();
            reader.GetMetadataByName(w!("System.Photo.Orientation"), &mut v).ok()?;
            let o = PropVariantToUInt16(&v).ok();
            let _ = PropVariantClear(&mut v);
            o.filter(|o| (1..=8).contains(o))
        });

        let conv = factory.CreateFormatConverter().map_err(|e| failed("converter", e))?;
        conv.Initialize(&frame, &GUID_WICPixelFormat32bppRGBA, WICBitmapDitherTypeNone, None, 0.0, WICBitmapPaletteTypeCustom)
            .map_err(|e| failed("convert", e))?;
        let (mut w, mut h) = (0u32, 0u32);
        conv.GetSize(&mut w, &mut h).map_err(|e| failed("size", e))?;
        if w == 0 || h == 0 {
            return Err(WicError::Failed(format!("WIC size {w} x {h}")));
        }
        if w as u64 * h as u64 > max_pixels {
            return Err(WicError::TooLarge(w, h));
        }
        let stride = w * 4;
        // Asked for, not assumed: a failed allocation is an error here, not the end of the app.
        let len = (stride as usize) * h as usize;
        let mut buf = Vec::new();
        buf.try_reserve_exact(len).map_err(|_| WicError::TooLarge(w, h))?;
        buf.resize(len, 0u8);
        conv.CopyPixels(std::ptr::null(), stride, &mut buf).map_err(|e| failed("pixels", e))?;
        let rgba = RgbaImage::from_raw(w, h, buf).ok_or_else(|| WicError::Failed("WIC buffer size".into()))?;
        Ok(Decoded { rgba, orientation })
    }
}

#[cfg(not(windows))]
pub fn decode(_bytes: &[u8], _max_pixels: u64) -> Result<Decoded, WicError> {
    Err(WicError::NoCodec)
}
