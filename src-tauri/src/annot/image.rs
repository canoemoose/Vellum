//! Images in appearance streams (stamps and signatures): a PNG from the front end becomes an
//! image XObject, its transparency a soft mask (/SMask), so the page shows through wherever the
//! picture is clear. One image placed several times in one save is written once: each XObject
//! carries the image's hash under a private key, and a second use finds the first.
//!
//! What the front end sends (Appearance::images): resource name to { hash, png }, the PNG as
//! base64, the hash its own (SHA-256 of the PNG bytes, hex). The bytes are never logged.

use lopdf::{Dictionary, Object, ObjectId, Stream, dictionary};
use serde::Deserialize;

use super::writer::Writer;

/// The private key an image XObject's hash is kept under (phase 7b finds a stamp's image by it).
pub const IMAGE_HASH_KEY: &str = "Vellum_Image";

/// Biggest image accepted, pixels a side: well over what the signature library and the stamps
/// library keep (1600 and 2000).
const MAX_SIDE: u32 = 4096;

#[derive(Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRes {
    /// Hex SHA-256 of the PNG bytes: the same picture always has the same hash.
    pub hash: String,
    /// The PNG, base64 (standard alphabet, padding optional).
    pub png: String,
}

/// Standard base64 (RFC 4648), whitespace ignored. None if it isn't base64.
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        })
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in s.as_bytes() {
        if c == b'=' {
            break;
        }
        if c.is_ascii_whitespace() {
            continue;
        }
        acc = (acc << 6) | val(c)?;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// Standard base64 with padding (phase 7b: a stamp's picture read back from the file).
pub fn base64_encode(b: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(A[(n >> 18) as usize & 63] as char);
        out.push(A[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { A[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { A[n as usize & 63] as char } else { '=' });
    }
    out
}

/// A PNG (or anything the `image` crate reads) as an image XObject and, when any pixel is
/// partly clear, its soft mask. Returns (image stream, mask stream).
pub fn png_to_streams(bytes: &[u8]) -> Result<(Stream, Option<Stream>), String> {
    let img = image::load_from_memory(bytes).map_err(|e| crate::errcode::coded("stamp_image", format!("couldn't read a stamp's image: {e}")))?;
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 || w > MAX_SIDE || h > MAX_SIDE {
        return Err(crate::errcode::coded("stamp_image", format!("a stamp's image is {w} x {h} pixels")));
    }
    let rgba = img.to_rgba8();
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    let mut alpha = Vec::with_capacity((w * h) as usize);
    for p in rgba.pixels() {
        rgb.extend_from_slice(&p.0[..3]);
        alpha.push(p.0[3]);
    }
    let mask = if alpha.iter().any(|&a| a != 255) {
        let d = dictionary! {
            "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
            "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
        };
        let mut s = Stream::new(d, alpha);
        s.compress().map_err(|e| e.to_string())?;
        Some(s)
    } else {
        None
    };
    let d = dictionary! {
        "Type" => "XObject", "Subtype" => "Image", "Width" => w as i64, "Height" => h as i64,
        "ColorSpace" => "DeviceRGB", "BitsPerComponent" => 8,
        // Smooth when scaled, as the overlay draws it.
        "Interpolate" => true,
    };
    let mut s = Stream::new(d, rgb);
    s.compress().map_err(|e| e.to_string())?;
    Ok((s, mask))
}

/// A stream's content, decoded (Flate, or none); None for any other filter.
fn plain_content(s: &Stream) -> Option<Vec<u8>> {
    match s.dict.get(b"Filter") {
        Err(_) => Some(s.content.clone()),
        Ok(_) => s.decompressed_content().ok(),
    }
}

/// Whether `s`, in `doc`, is exactly the image XObject (and soft mask) `png_to_streams` made:
/// an /Image of the same size and colour, nothing that changes how it draws, the same pixels,
/// and the same mask or none.
fn same_image(doc: &lopdf::Document, s: &Stream, img: &Stream, mask: Option<&Stream>) -> bool {
    let name = |d: &Dictionary, k: &[u8]| d.get(k).ok().and_then(|v| v.as_name().ok()).map(|n| n.to_vec());
    let int = |d: &Dictionary, k: &[u8]| d.get(k).ok().and_then(|v| v.as_i64().ok());
    let alike = |a: &Stream, b: &Stream| {
        name(&a.dict, b"Subtype").as_deref() == Some(b"Image".as_slice())
            && ["Width", "Height", "BitsPerComponent"].iter().all(|k| int(&a.dict, k.as_bytes()).is_some() && int(&a.dict, k.as_bytes()) == int(&b.dict, k.as_bytes()))
            && name(&a.dict, b"ColorSpace").is_some()
            && name(&a.dict, b"ColorSpace") == name(&b.dict, b"ColorSpace")
            && ["Decode", "Mask", "ImageMask", "Alternates", "SMaskInData", "OC"].iter().all(|k| !a.dict.has(k.as_bytes()))
            && plain_content(a).is_some_and(|c| Some(c) == plain_content(b))
    };
    if !alike(s, img) {
        return false;
    }
    let file_mask = match s.dict.get(b"SMask") {
        Err(_) => None,
        Ok(Object::Reference(r)) => match doc.get_object(*r) {
            Ok(Object::Stream(m)) => Some(m),
            _ => return false,
        },
        Ok(_) => return false,
    };
    match (file_mask, mask) {
        (None, None) => true,
        (Some(f), Some(m)) => !f.dict.has(b"SMask") && alike(f, m),
        _ => false,
    }
}

fn hash_ok(h: &str) -> bool {
    !h.is_empty() && h.len() <= 128 && h.bytes().all(|c| c.is_ascii_hexdigit())
}

impl Writer {
    /// The image XObject already written in this save for `hash`, if any.
    fn image_in_update(&self, hash: &str) -> Option<ObjectId> {
        self.inc.new_document.objects.iter().find_map(|(id, o)| match o {
            Object::Stream(s) => {
                let h = s.dict.get(IMAGE_HASH_KEY.as_bytes()).ok().and_then(|v| v.as_str().ok())?;
                (h == hash.as_bytes()).then_some(*id)
            }
            _ => None,
        })
    }

    /// The image XObject an earlier save wrote for `hash`, if the file has one and it is the
    /// same picture: an /Image whose size, pixels and soft mask are what `img` and `mask` (this
    /// picture, just converted) would write. The hash alone isn't proof: anyone can put it on
    /// a stream in a file they prepare, having read it from a file you signed before, and the
    /// signature placed would then show their picture (docs/review-0.2.0.md, 5).
    ///
    /// With no picture (`img` None: a stamp read from this file whose picture couldn't be read
    /// back, sent without one), any /Image under the hash: nothing was supplied to swap.
    fn image_in_file(&self, hash: &str, img: Option<(&Stream, Option<&Stream>)>) -> Option<ObjectId> {
        let prev = self.inc.get_prev_documents();
        prev.objects.iter().find_map(|(id, o)| match o {
            Object::Stream(s) => {
                let h = s.dict.get(IMAGE_HASH_KEY.as_bytes()).ok().and_then(|v| v.as_str().ok())?;
                let same = match img {
                    Some((img, mask)) => same_image(prev, s, img, mask),
                    None => s.dict.get(b"Subtype").ok().and_then(|v| v.as_name().ok()) == Some(b"Image".as_slice()),
                };
                (h.eq_ignore_ascii_case(hash.as_bytes()) && same).then_some(*id)
            }
            _ => None,
        })
    }

    /// The image XObject for `img`, written now unless this save (or the file) already holds it.
    pub fn image_object(&mut self, img: &ImageRes) -> Result<ObjectId, String> {
        if !hash_ok(&img.hash) {
            return Err(crate::errcode::coded("stamp_image", "a stamp's image has no usable hash"));
        }
        let hash = img.hash.to_ascii_lowercase();
        if let Some(id) = self.image_in_update(&hash) {
            return Ok(id);
        }
        // Phase 7b: a stamp brought back from the file reuses the picture already in it, once
        // it's checked to be the same picture (or sent without one: the file's is the picture).
        if img.png.trim().is_empty() {
            if let Some(id) = self.image_in_file(&hash, None) {
                return Ok(id);
            }
        }
        let bytes = base64_decode(&img.png).ok_or_else(|| crate::errcode::coded("stamp_image", "a stamp's image isn't base64"))?;
        let (mut st, mask) = png_to_streams(&bytes)?;
        if let Some(id) = self.image_in_file(&hash, Some((&st, mask.as_ref()))) {
            return Ok(id);
        }
        if let Some(m) = mask {
            let mid = self.inc.new_document.add_object(m);
            st.dict.set("SMask", Object::Reference(mid));
        }
        st.dict.set(IMAGE_HASH_KEY, Object::string_literal(hash));
        Ok(self.inc.new_document.add_object(st))
    }

    /// Add the appearance's images to its resources (/XObject), each under its own name.
    pub(super) fn add_images(&mut self, images: &std::collections::BTreeMap<String, ImageRes>, res: &mut Dictionary) -> Result<(), String> {
        if images.is_empty() {
            return Ok(());
        }
        let mut xo = Dictionary::new();
        for (name, img) in images {
            if name.is_empty() || !name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') {
                return Err(format!("bad image resource name {name:?}"));
            }
            let id = self.image_object(img)?;
            xo.set(name.as_bytes().to_vec(), Object::Reference(id));
        }
        res.set("XObject", xo);
        Ok(())
    }
}
