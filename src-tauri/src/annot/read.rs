//! Reading the annotations a file already holds (phase 7b), so they can be listed and, once
//! lifted, edited like markups made here.
//!
//! Read with `lopdf`, straight from the file, rather than through PDFium's `FPDFAnnot_Get*`:
//! PDFium's API has no getter for /LE, /BS /D, /BE, /IT, /CL, /RD or /DA, which a faithful
//! mapping needs, and every PDFium read loads (parses) the page's content on a render worker,
//! which on a heavy drawing costs as much as rendering it. `lopdf` reads the dictionaries
//! without touching the render workers; stream contents (page content, images, fonts) are
//! dropped as they're read, so a big drawing costs little more than its object dictionaries.
//!
//! Positions line up with PDFium's: an annotation's `index` is its position in the page's
//! /Annots array, Popups and nulls counted, which is PDFium's annotation index (phase 0).
//! Values are in PDF user space; the front end maps them onto the page
//! (src/lib/markup/fileAnnots.ts).

use std::collections::{BTreeMap, HashSet};
use std::time::Instant;

use lopdf::{Dictionary, Document, LoadOptions, Object, ObjectId};
use serde::Serialize;

use super::writer::REEDIT_KEY;
use crate::text::FrameInfo;

/// One annotation as the file has it. Absent keys are None.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileAnnot {
    /// Position in the page's /Annots (PDFium's annotation index).
    pub index: usize,
    pub subtype: String,
    pub nm: Option<String>,
    /// [x0, y0, x1, y1], user space, normalised.
    pub rect: [f64; 4],
    /// /F.
    pub flags: i64,
    /// /C and /IC: 0, 1, 3 or 4 components, as written.
    pub colour: Option<Vec<f64>>,
    pub interior: Option<Vec<f64>>,
    /// /CA.
    pub opacity: Option<f64>,
    /// /BS /W, else /Border's third number.
    pub border_width: Option<f64>,
    /// /BS /D when /BS /S is /D (or /Border's dash array).
    pub dash: Option<Vec<f64>>,
    /// /BE /I when /BE /S is /C (a cloudy border).
    pub cloud: Option<f64>,
    pub line: Option<[f64; 4]>,
    /// /LE: one name (FreeText) or two (Line, PolyLine).
    pub line_ends: Option<Vec<String>>,
    pub vertices: Option<Vec<f64>>,
    pub ink: Option<Vec<Vec<f64>>>,
    pub quad_points: Option<Vec<f64>>,
    pub callout: Option<Vec<f64>>,
    /// /RD.
    pub inset: Option<[f64; 4]>,
    pub intent: Option<String>,
    pub contents: Option<String>,
    /// /T, /M, /CreationDate.
    pub author: Option<String>,
    pub modified: Option<String>,
    pub created: Option<String>,
    pub default_appearance: Option<String>,
    pub default_style: Option<String>,
    pub quadding: Option<i64>,
    /// /Name (a note's icon, a stamp's name).
    pub name: Option<String>,
    pub rotate: Option<i64>,
    /// Vellum's private copy (/Vellum_Markup), unparsed.
    pub vellum: Option<String>,
    /// It has a /Measure dictionary.
    pub measured: bool,
    // Notes (tool consistency stage 7)
    /// Its /Popup's /Open (false when the pop-up has none), or None with no pop-up: a note's
    /// pin. The Popup itself is never read as a markup of its own (NOT_MARKUPS).
    pub popup_open: Option<bool>,
    // Dimensions (stage 5)
    /// A Line's /LL, /LLE, /LLO (0 where absent), when it has /LL.
    pub leader: Option<[f64; 3]>,
    /// A Line's /CO.
    pub caption_offset: Option<[f64; 2]>,
}

/// A page's annotations and the frame to map them with.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageAnnots {
    pub page: usize,
    pub frame: FrameInfo,
    pub annots: Vec<FileAnnot>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AnnotRead {
    /// Pages with at least one annotation read, in order.
    pub pages: Vec<PageAnnots>,
    pub ms: f64,
}

/// Subtypes that aren't markups: a Popup belongs to its parent, a Link is navigation, a Widget
/// is a form field (phase 6).
const NOT_MARKUPS: &[&str] = &["Popup", "Link", "Widget"];
/// /F Hidden.
const HIDDEN: i64 = 2;

/// Drop stream contents while loading (keeping object streams, which hold dictionaries), so
/// reading a heavy drawing's annotations doesn't hold its page content and images in memory.
/// lopdf uses the object it passes in for top-level objects and the returned one for objects
/// inside object streams, so the object is changed in place and returned too.
fn drop_contents(id: (u32, u16), o: &mut Object) -> Option<((u32, u16), Object)> {
    if let Object::Stream(s) = o {
        if !s.dict.has_type(b"ObjStm") && !s.dict.has_type(b"XRef") {
            s.content = Vec::new();
            return Some((id, Object::Stream(s.clone())));
        }
        return Some((id, Object::Null));
    }
    Some((id, o.clone()))
}

fn num(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(*r as f64),
        _ => None,
    }
}

/// A PDF text string: UTF-16BE or UTF-8 with a byte-order mark, else PDFDocEncoding (taken as
/// Latin-1, which it matches for everything printable but a few punctuation marks).
pub fn decode_text(b: &[u8]) -> String {
    if let Some(rest) = b.strip_prefix(&[0xfe, 0xff]) {
        let u: Vec<u16> = rest.chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&u)
    } else if let Some(rest) = b.strip_prefix(&[0xef, 0xbb, 0xbf]) {
        String::from_utf8_lossy(rest).into_owned()
    } else {
        b.iter().map(|&c| c as char).collect()
    }
}

struct Reader<'a> {
    doc: &'a Document,
}

impl<'a> Reader<'a> {
    fn resolve(&self, o: &'a Object) -> &'a Object {
        let mut o = o;
        for _ in 0..8 {
            match o {
                Object::Reference(id) => match self.doc.get_object(*id) {
                    Ok(x) => o = x,
                    Err(_) => return &Object::Null,
                },
                _ => return o,
            }
        }
        o
    }

    fn get(&self, d: &'a Dictionary, k: &[u8]) -> Option<&'a Object> {
        d.get(k).ok().map(|o| self.resolve(o)).filter(|o| !matches!(o, Object::Null))
    }

    fn nums(&self, d: &'a Dictionary, k: &[u8]) -> Option<Vec<f64>> {
        match self.get(d, k)? {
            Object::Array(a) => Some(a.iter().filter_map(|x| num(self.resolve(x))).collect()),
            _ => None,
        }
    }

    fn rect(&self, d: &'a Dictionary, k: &[u8]) -> Option<[f64; 4]> {
        let v = self.nums(d, k)?;
        (v.len() == 4).then(|| [v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
    }

    fn number(&self, d: &'a Dictionary, k: &[u8]) -> Option<f64> {
        self.get(d, k).and_then(num)
    }

    fn name(&self, d: &'a Dictionary, k: &[u8]) -> Option<String> {
        match self.get(d, k)? {
            Object::Name(n) => Some(String::from_utf8_lossy(n).into_owned()),
            _ => None,
        }
    }

    fn string(&self, d: &'a Dictionary, k: &[u8]) -> Option<String> {
        match self.get(d, k)? {
            Object::String(s, _) => Some(decode_text(s)),
            _ => None,
        }
    }

    /// The page's visible box as PDFium takes it (the CropBox clipped to the MediaBox, each
    /// inherited through the page tree) and its /Rotate in quarter turns.
    fn frame(&self, page: ObjectId) -> FrameInfo {
        let (mut crop, mut media, mut rotate) = (None, None, None);
        let mut id = page;
        for _ in 0..64 {
            let Some(d) = self.doc.get_object(id).ok().and_then(|o| o.as_dict().ok()) else { break };
            crop = crop.or_else(|| self.rect(d, b"CropBox"));
            media = media.or_else(|| self.rect(d, b"MediaBox"));
            rotate = rotate.or_else(|| self.number(d, b"Rotate"));
            match d.get(b"Parent").ok().and_then(|o| o.as_reference().ok()) {
                Some(p) => id = p,
                None => break,
            }
        }
        let media = media.filter(|m| m[2] > m[0] && m[3] > m[1]).unwrap_or([0.0, 0.0, 612.0, 792.0]);
        let bbox = match crop {
            Some(c) => {
                let i = [c[0].max(media[0]), c[1].max(media[1]), c[2].min(media[2]), c[3].min(media[3])];
                if i[2] > i[0] && i[3] > i[1] { i } else { media }
            }
            None => media,
        };
        let turns = ((rotate.unwrap_or(0.0) as i64).rem_euclid(360) / 90) as i32;
        FrameInfo { quarter_turns: turns, bbox }
    }

    fn annot(&self, index: usize, d: &'a Dictionary) -> Option<FileAnnot> {
        let subtype = self.name(d, b"Subtype")?;
        if NOT_MARKUPS.contains(&subtype.as_str()) {
            return None;
        }
        let flags = self.number(d, b"F").unwrap_or(0.0) as i64;
        // Hidden by its own app, and replies (comments in a thread): neither is drawn as a markup.
        if flags & HIDDEN != 0 || d.has(b"IRT") {
            return None;
        }
        let rect = self.rect(d, b"Rect")?;
        let mut a = FileAnnot {
            index,
            subtype,
            nm: self.string(d, b"NM").filter(|s| !s.is_empty()),
            rect,
            flags,
            colour: self.nums(d, b"C"),
            interior: self.nums(d, b"IC"),
            opacity: self.number(d, b"CA"),
            line: self.nums(d, b"L").filter(|v| v.len() == 4).map(|v| [v[0], v[1], v[2], v[3]]),
            vertices: self.nums(d, b"Vertices"),
            quad_points: self.nums(d, b"QuadPoints"),
            callout: self.nums(d, b"CL"),
            inset: self.nums(d, b"RD").filter(|v| v.len() == 4).map(|v| [v[0], v[1], v[2], v[3]]),
            intent: self.name(d, b"IT"),
            contents: self.string(d, b"Contents"),
            author: self.string(d, b"T"),
            modified: self.string(d, b"M"),
            created: self.string(d, b"CreationDate"),
            default_appearance: self.string(d, b"DA"),
            default_style: self.string(d, b"DS"),
            quadding: self.number(d, b"Q").map(|v| v as i64),
            name: self.name(d, b"Name"),
            rotate: self.number(d, b"Rotate").map(|v| v as i64),
            vellum: self.string(d, REEDIT_KEY.as_bytes()),
            measured: self.get(d, b"Measure").is_some(),
            ..Default::default()
        };
        // The border: /BS wins over the older /Border array.
        if let Some(Object::Dictionary(bs)) = self.get(d, b"BS") {
            a.border_width = self.number(bs, b"W");
            if self.name(bs, b"S").as_deref() == Some("D") {
                a.dash = Some(self.nums(bs, b"D").unwrap_or_else(|| vec![3.0]));
            }
        } else if let Some(Object::Array(b)) = self.get(d, b"Border") {
            a.border_width = b.get(2).and_then(|x| num(self.resolve(x)));
            a.dash = b.get(3).and_then(|x| match self.resolve(x) {
                Object::Array(v) => Some(v.iter().filter_map(|y| num(self.resolve(y))).collect()),
                _ => None,
            });
        }
        if let Some(Object::Dictionary(be)) = self.get(d, b"BE") {
            if self.name(be, b"S").as_deref() == Some("C") {
                a.cloud = Some(self.number(be, b"I").unwrap_or(0.0));
            }
        }
        a.line_ends = match self.get(d, b"LE") {
            Some(Object::Name(n)) => Some(vec![String::from_utf8_lossy(n).into_owned()]),
            Some(Object::Array(v)) => Some(
                v.iter()
                    .filter_map(|x| match self.resolve(x) {
                        Object::Name(n) => Some(String::from_utf8_lossy(n).into_owned()),
                        _ => None,
                    })
                    .collect(),
            ),
            _ => None,
        };
        // Dimensions (stage 5)
        if let Some(ll) = self.number(d, b"LL") {
            a.leader = Some([ll, self.number(d, b"LLE").unwrap_or(0.0), self.number(d, b"LLO").unwrap_or(0.0)]);
        }
        a.caption_offset = self.nums(d, b"CO").filter(|v| v.len() == 2).map(|v| [v[0], v[1]]);
        if let Some(Object::Array(strokes)) = self.get(d, b"InkList") {
            a.ink = Some(
                strokes
                    .iter()
                    .filter_map(|s| match self.resolve(s) {
                        Object::Array(v) => Some(v.iter().filter_map(|x| num(self.resolve(x))).collect()),
                        _ => None,
                    })
                    .collect(),
            );
        }
        // Notes (stage 7): the pop-up's /Open is the note's pin.
        if let Some(Object::Dictionary(pd)) = self.get(d, b"Popup") {
            a.popup_open = Some(matches!(self.get(pd, b"Open"), Some(Object::Boolean(true))));
        }
        Some(a)
    }

    fn page(&self, page: usize, id: ObjectId) -> Option<PageAnnots> {
        let d = self.doc.get_object(id).ok()?.as_dict().ok()?;
        let Some(Object::Array(arr)) = self.get(d, b"Annots") else { return None };
        let annots: Vec<FileAnnot> = arr
            .iter()
            .enumerate()
            .filter_map(|(i, e)| match self.resolve(e) {
                Object::Dictionary(ad) => self.annot(i, ad),
                _ => None,
            })
            .collect();
        (!annots.is_empty()).then(|| PageAnnots { page, frame: self.frame(id), annots })
    }
}

fn load(bytes: &[u8], password: &str, light: bool) -> Result<Document, String> {
    let mut options = LoadOptions { password: Some(password.to_string()), ..LoadOptions::default() };
    if light {
        options.filter = Some(drop_contents);
    }
    Document::load_mem_with_options(bytes, options).map_err(|e| format!("lopdf could not read the file: {e}"))
}

/// Every page's annotations, as the file holds them.
pub fn read(bytes: &[u8], password: &str) -> Result<AnnotRead, String> {
    let t0 = Instant::now();
    let doc = load(bytes, password, true)?;
    let r = Reader { doc: &doc };
    let pages = doc.get_pages().values().enumerate().filter_map(|(i, id)| r.page(i, *id)).collect();
    Ok(AnnotRead { pages, ms: t0.elapsed().as_secs_f64() * 1000.0 })
}

/// The pictures of image stamps Vellum wrote, found by the hash kept beside each image
/// (`annot/image.rs`, /Vellum_Image), as PNGs in base64: the private copy of a stamp refers to
/// its picture by hash, so a stamp brought back for editing needs it to draw. Pictures are
/// never logged.
pub fn stamp_images(bytes: &[u8], password: &str, hashes: &[String]) -> Result<BTreeMap<String, String>, String> {
    let want: HashSet<String> = hashes.iter().map(|h| h.to_ascii_lowercase()).collect();
    let mut out = BTreeMap::new();
    if want.is_empty() {
        return Ok(out);
    }
    let doc = load(bytes, password, false)?;
    let key = super::image::IMAGE_HASH_KEY.as_bytes();
    for o in doc.objects.values() {
        let Object::Stream(s) = o else { continue };
        let Some(h) = s.dict.get(key).ok().and_then(|v| v.as_str().ok()).map(|h| String::from_utf8_lossy(h).to_ascii_lowercase()) else { continue };
        if !want.contains(&h) || out.contains_key(&h) {
            continue;
        }
        match image_png(&doc, s) {
            Ok(png) => {
                out.insert(h, super::image::base64_encode(&png));
            }
            Err(e) => eprintln!("[annot] stamp image {} unreadable: {e}", &h[..h.len().min(12)]),
        }
    }
    Ok(out)
}

/// An image XObject Vellum wrote (8-bit RGB, optionally an 8-bit grey soft mask) as a PNG.
fn image_png(doc: &Document, s: &lopdf::Stream) -> Result<Vec<u8>, String> {
    let dim = |k: &[u8]| s.dict.get(k).ok().and_then(num).map(|v| v as u32).unwrap_or(0);
    let (w, h) = (dim(b"Width"), dim(b"Height"));
    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return Err(format!("{w} x {h}"));
    }
    let rgb = s.decompressed_content().map_err(|e| e.to_string())?;
    if rgb.len() < (w * h * 3) as usize {
        return Err("short image data".into());
    }
    let alpha = match s.dict.get(b"SMask").ok().and_then(|o| o.as_reference().ok()).and_then(|id| doc.get_object(id).ok()) {
        Some(Object::Stream(m)) => m.decompressed_content().ok().filter(|a| a.len() >= (w * h) as usize),
        _ => None,
    };
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for i in 0..(w * h) as usize {
        rgba.extend_from_slice(&rgb[i * 3..i * 3 + 3]);
        rgba.push(alpha.as_ref().map(|a| a[i]).unwrap_or(255));
    }
    let img = image::RgbaImage::from_raw(w, h, rgba).ok_or("bad image size")?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(png)
}
