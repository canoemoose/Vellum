//! Windows' built-in OCR (`Windows.Media.Ocr`) through the `windows` crate's WinRT bindings.
//!
//! Everything here is blocking: `RecognizeAsync` is joined on the calling thread, which must
//! not be an STA UI thread (the app would call it from a `spawn_blocking` thread or its own
//! OCR thread). The engine is agile, so one engine can be shared between threads.

use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Security::Cryptography::CryptographicBuffer;
use windows::core::HSTRING;

/// One recognised word. `rect` is [x0, y0, x1, y1] in pixels of the image passed in, y down.
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    pub text: String,
    pub rect: [f32; 4],
    /// Index of the line it belongs to, within one `recognise` call.
    pub line: u32,
}

/// What one image produced.
#[derive(Clone, Debug, Default)]
pub struct Recognised {
    pub words: Vec<Word>,
    pub lines: u32,
    /// The skew the engine detected and corrected for, degrees (None if it reported none).
    pub text_angle: Option<f64>,
}

pub struct Ocr {
    engine: OcrEngine,
}

fn err(e: windows::core::Error) -> String {
    format!("{} (0x{:08x})", e.message(), e.code().0)
}

impl Ocr {
    /// The engine for the first of the user's profile languages that has OCR installed.
    /// Fails when none has (no OCR language pack at all).
    pub fn from_user_languages() -> Result<Self, String> {
        match OcrEngine::TryCreateFromUserProfileLanguages() {
            Ok(engine) => Ok(Self { engine }),
            Err(e) => Err(format!("no OCR language installed for the user's languages: {}", err(e))),
        }
    }

    /// The engine for one BCP-47 language tag ("en-GB", "en", "de"), if installed.
    pub fn for_language(tag: &str) -> Result<Self, String> {
        let lang = Language::CreateLanguage(&HSTRING::from(tag)).map_err(err)?;
        if !OcrEngine::IsLanguageSupported(&lang).map_err(err)? {
            return Err(format!("OCR language not installed: {tag}"));
        }
        let engine = OcrEngine::TryCreateFromLanguage(&lang).map_err(err)?;
        Ok(Self { engine })
    }

    /// The language this engine recognises (a BCP-47 tag).
    pub fn language(&self) -> String {
        self.engine
            .RecognizerLanguage()
            .and_then(|l| l.LanguageTag())
            .map(|s| s.to_string())
            .unwrap_or_default()
    }

    /// The largest width or height an image may have; larger images are refused.
    pub fn max_dimension() -> Result<u32, String> {
        OcrEngine::MaxImageDimension().map_err(err)
    }

    /// Every OCR language installed on this machine.
    pub fn available_languages() -> Result<Vec<String>, String> {
        let v = OcrEngine::AvailableRecognizerLanguages().map_err(err)?;
        let mut out = Vec::new();
        for l in v {
            out.push(format!("{} ({})", l.LanguageTag().map_err(err)?, l.DisplayName().map_err(err)?));
        }
        Ok(out)
    }

    /// Recognise an 8-bit greyscale image (`stride` bytes per row, rows top to bottom).
    pub fn recognise_gray(&self, px: &[u8], w: u32, h: u32, stride: usize) -> Result<Recognised, String> {
        let packed: std::borrow::Cow<[u8]> = if stride == w as usize {
            std::borrow::Cow::Borrowed(&px[..w as usize * h as usize])
        } else {
            let mut v = Vec::with_capacity(w as usize * h as usize);
            for y in 0..h as usize {
                v.extend_from_slice(&px[y * stride..y * stride + w as usize]);
            }
            std::borrow::Cow::Owned(v)
        };
        let buf = CryptographicBuffer::CreateFromByteArray(&packed).map_err(err)?;
        let bmp = SoftwareBitmap::CreateCopyFromBuffer(&buf, BitmapPixelFormat::Gray8, w as i32, h as i32).map_err(err)?;
        let result = self.engine.RecognizeAsync(&bmp).map_err(err)?.join().map_err(err)?;
        let text_angle = result.TextAngle().ok().and_then(|r| r.Value().ok());
        let mut out = Recognised { text_angle, ..Default::default() };
        for (li, line) in result.Lines().map_err(err)?.into_iter().enumerate() {
            for word in line.Words().map_err(err)? {
                let r = word.BoundingRect().map_err(err)?;
                out.words.push(Word {
                    text: word.Text().map_err(err)?.to_string(),
                    rect: [r.X, r.Y, r.X + r.Width, r.Y + r.Height],
                    line: li as u32,
                });
            }
            out.lines = li as u32 + 1;
        }
        bmp.Close().ok();
        Ok(out)
    }
}
