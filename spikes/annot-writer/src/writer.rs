//! The annotation writer: open a PDF with lopdf, add, replace or delete annotations, and
//! append the changes as an incremental update (the original bytes are untouched).

use std::time::Instant;

use lopdf::{Dictionary, Document, IncrementalDocument, LoadOptions, Object, ObjectId, Stream, StringFormat, dictionary};

use crate::appearance::{self as ap, Appearance, BBox, End, Pt, Rgb, Style};

/// A markup in PDF user space (points, y up, unrotated page).
#[derive(Clone, Debug)]
pub enum Markup {
    Arrow { from: Pt, to: Pt, style: Style },
    Rect { rect: BBox, style: Style },
    Polygon { vertices: Vec<Pt>, style: Style },
    Cloud { vertices: Vec<Pt>, intensity: f64, style: Style },
    Text { rect: BBox, text: String, size: f64, colour: Rgb, style: Style },
    Callout { rect: BBox, leader: Vec<Pt>, text: String, size: f64, colour: Rgb, style: Style },
    Ink { strokes: Vec<Vec<Pt>>, style: Style },
    /// Distance at a drawing scale; `ratio` 100 means 1:100, `unit` "m" or "mm".
    Distance { from: Pt, to: Pt, ratio: f64, unit: &'static str, size: f64, style: Style },
    /// Area at a drawing scale.
    Area { vertices: Vec<Pt>, ratio: f64, unit: &'static str, size: f64, style: Style },
}

/// Common fields every annotation gets.
#[derive(Clone, Debug)]
pub struct Meta {
    pub id: String,
    pub author: String,
    /// PDF date string, e.g. "D:20261113120000Z".
    pub date: String,
}

/// What we learnt about the file on open.
#[derive(Clone, Debug, Default)]
pub struct FileInfo {
    pub bytes: usize,
    pub objects: usize,
    pub pages: usize,
    pub xref_stream: bool,
    /// Some(description) when the file is encrypted.
    pub encryption: Option<String>,
    /// /P permission bits of an encrypted file.
    pub permissions: Option<i64>,
    /// lopdf repaired the cross-reference data (the file is malformed but readable).
    pub recovered: bool,
    /// Number of filled signature fields.
    pub signatures: usize,
    /// DocMDP permission level of a certified file (1 no changes, 2 forms, 3 annotations).
    pub docmdp: Option<i64>,
    pub load_ms: f64,
}

/// One entry of a page's /Annots array, in order (so it lines up with PDFium's index).
#[derive(Clone, Debug)]
pub struct AnnotEntry {
    pub index: usize,
    /// The object number, or None for a direct (inline) dictionary or a non-dictionary entry.
    pub id: Option<ObjectId>,
    pub subtype: Option<String>,
    pub rect: Option<[f64; 4]>,
    pub nm: Option<String>,
}

pub struct Writer {
    pub inc: IncrementalDocument,
    pages: Vec<ObjectId>,
    pub info: FileInfo,
}

fn real(v: f64) -> Object {
    Object::Real(v as f32)
}
fn reals(v: &[f64]) -> Object {
    Object::Array(v.iter().map(|x| real(*x)).collect())
}
fn rgb(c: Rgb) -> Object {
    reals(&c)
}
fn text(s: &str) -> Object {
    // PDFDocEncoding covers Latin-1 for what we write; anything else goes as UTF-16BE with a BOM.
    if s.chars().all(|c| (c as u32) < 0x80) {
        Object::String(s.as_bytes().to_vec(), StringFormat::Literal)
    } else {
        let mut b = vec![0xfe, 0xff];
        for u in s.encode_utf16() {
            b.extend_from_slice(&u.to_be_bytes());
        }
        Object::String(b, StringFormat::Hexadecimal)
    }
}
fn pts(v: &[Pt]) -> Object {
    Object::Array(v.iter().flat_map(|p| [real(p.0), real(p.1)]).collect())
}

fn obj_f64(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(i) => Some(*i as f64),
        Object::Real(r) => Some(*r as f64),
        _ => None,
    }
}

fn decode_text(b: &[u8]) -> String {
    if b.starts_with(&[0xfe, 0xff]) {
        let u: Vec<u16> = b[2..].chunks(2).filter(|c| c.len() == 2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
        String::from_utf16_lossy(&u)
    } else {
        b.iter().map(|&c| c as char).collect()
    }
}

impl Writer {
    /// Parse the file. An encrypted file is decrypted with `password` ("" for the usual
    /// owner-password-only file) so new strings and streams can be encrypted with its key.
    pub fn open(bytes: Vec<u8>, password: &str) -> Result<Self, String> {
        let t0 = Instant::now();
        let options = LoadOptions { password: Some(password.to_string()), ..LoadOptions::default() };
        let doc = Document::load_mem_with_options(&bytes, options).map_err(|e| format!("lopdf could not read the file: {e}"))?;
        let load_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let mut info = FileInfo {
            bytes: bytes.len(),
            objects: doc.objects.len(),
            pages: 0,
            xref_stream: matches!(doc.reference_table.cross_reference_type, lopdf::xref::XrefType::CrossReferenceStream),
            recovered: doc.xref_recovery.is_some(),
            load_ms,
            ..FileInfo::default()
        };
        // lopdf decrypts on load and takes /Encrypt out of the trailer, keeping the key and the
        // dictionary's object number in `encryption_state` (it puts /Encrypt back on save).
        if let Some(state) = doc.encryption_state.as_ref() {
            info.encryption = Some(format!("V{} R{}", state.version(), state.revision()));
            info.permissions = Some(state.permissions().bits() as i64);
            let d = state.encrypt_object_id().and_then(|id| doc.get_dictionary(id).ok());
            if let Some(d) = d {
                let get = |k: &[u8]| d.get(k).ok().and_then(obj_f64).map(|v| v as i64);
                let cf = d
                    .get(b"CF")
                    .ok()
                    .and_then(|o| o.as_dict().ok())
                    .and_then(|cf| cf.get(b"StdCF").ok())
                    .and_then(|o| o.as_dict().ok())
                    .and_then(|s| s.get(b"CFM").ok())
                    .and_then(|o| o.as_name().ok())
                    .map(|n| String::from_utf8_lossy(n).into_owned());
                info.encryption = Some(format!(
                    "V{} R{}{}",
                    get(b"V").unwrap_or(0),
                    get(b"R").unwrap_or(0),
                    cf.map(|c| format!(" {c}")).unwrap_or_default()
                ));
                info.permissions = get(b"P");
            }
        }
        // Signatures and certification.
        if let Ok(cat) = doc.catalog() {
            if let Ok(af) = cat.get(b"AcroForm").and_then(|o| doc.dereference(o)).and_then(|(_, o)| o.as_dict()) {
                if let Ok(fields) = af.get(b"Fields").and_then(|o| doc.dereference(o)).and_then(|(_, o)| o.as_array()) {
                    for f in fields {
                        if let Ok((_, Object::Dictionary(fd))) = doc.dereference(f) {
                            let is_sig = fd.get(b"FT").and_then(|o| o.as_name()).map(|n| n == b"Sig").unwrap_or(false);
                            if is_sig && fd.has(b"V") {
                                info.signatures += 1;
                            }
                        }
                    }
                }
            }
            if let Ok(perms) = cat.get(b"Perms").and_then(|o| doc.dereference(o)).and_then(|(_, o)| o.as_dict()) {
                if let Ok((_, Object::Dictionary(sig))) = perms.get(b"DocMDP").and_then(|o| doc.dereference(o)) {
                    if let Ok(refs) = sig.get(b"Reference").and_then(|o| o.as_array()) {
                        for r in refs {
                            if let Ok((_, Object::Dictionary(sr))) = doc.dereference(r) {
                                if let Ok((_, Object::Dictionary(tp))) = sr.get(b"TransformParams").and_then(|o| doc.dereference(o)) {
                                    info.docmdp = Some(tp.get(b"P").ok().and_then(obj_f64).unwrap_or(2.0) as i64);
                                }
                            }
                        }
                    }
                }
            }
        }
        let pages: Vec<ObjectId> = doc.get_pages().values().copied().collect();
        info.pages = pages.len();
        let mut inc = IncrementalDocument::create_from(bytes, doc);
        // The new section's trailer starts as a copy of the last one. Keys that describe the old
        // cross-reference data itself must not be carried into ours.
        for k in [&b"XRefStm"[..], b"DecodeParms", b"Filter", b"Index", b"W", b"Length", b"Type"] {
            inc.new_document.trailer.remove(k);
        }
        Ok(Self { inc, pages, info })
    }

    pub fn page_id(&self, page: usize) -> Result<ObjectId, String> {
        self.pages.get(page).copied().ok_or_else(|| format!("no page {page}"))
    }

    /// The page's visible box (CropBox, else MediaBox, inherited through the page tree) as
    /// [x0, y0, x1, y1], and its /Rotate.
    pub fn page_box(&self, page: usize) -> Result<([f64; 4], i64), String> {
        let mut id = self.page_id(page)?;
        let (mut crop, mut media, mut rotate) = (None, None, None);
        for _ in 0..64 {
            let d = self.get(id).and_then(|o| o.as_dict().ok()).ok_or("page tree node is not a dictionary")?;
            let rect = |k: &[u8]| {
                d.get(k).ok().and_then(|o| self.resolve(o).as_array().ok()).and_then(|a| {
                    let v: Vec<f64> = a.iter().filter_map(|x| obj_f64(self.resolve(x))).collect();
                    (v.len() == 4).then(|| [v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
                })
            };
            crop = crop.or_else(|| rect(b"CropBox"));
            media = media.or_else(|| rect(b"MediaBox"));
            rotate = rotate.or_else(|| d.get(b"Rotate").ok().and_then(|o| obj_f64(self.resolve(o))).map(|v| v as i64));
            match d.get(b"Parent").ok().and_then(|o| o.as_reference().ok()) {
                Some(p) => id = p,
                None => break,
            }
        }
        let b = crop.or(media).ok_or("page has no MediaBox")?;
        Ok((b, rotate.unwrap_or(0).rem_euclid(360)))
    }

    fn prev(&self) -> &Document {
        self.inc.get_prev_documents()
    }

    /// Look an object up in the new section first, then the original.
    fn get(&self, id: ObjectId) -> Option<&Object> {
        self.inc.new_document.get_object(id).ok().or_else(|| self.prev().get_object(id).ok())
    }

    fn resolve<'a>(&'a self, o: &'a Object) -> &'a Object {
        match o {
            Object::Reference(id) => self.get(*id).unwrap_or(o),
            _ => o,
        }
    }

    /// The page's /Annots entries in order, as PDFium indexes them.
    pub fn annots(&self, page: usize) -> Result<Vec<AnnotEntry>, String> {
        let pid = self.page_id(page)?;
        let page_dict = self.get(pid).and_then(|o| o.as_dict().ok()).ok_or("page is not a dictionary")?;
        let arr = match page_dict.get(b"Annots") {
            Ok(o) => match self.resolve(o) {
                Object::Array(a) => a.clone(),
                _ => vec![],
            },
            Err(_) => vec![],
        };
        Ok(arr
            .iter()
            .enumerate()
            .map(|(index, e)| {
                let id = if let Object::Reference(id) = e { Some(*id) } else { None };
                let d = self.resolve(e).as_dict().ok();
                AnnotEntry {
                    index,
                    id: id.filter(|_| d.is_some()),
                    subtype: d.and_then(|d| d.get(b"Subtype").ok()).and_then(|o| o.as_name().ok()).map(|n| String::from_utf8_lossy(n).into_owned()),
                    rect: d.and_then(|d| d.get(b"Rect").ok()).and_then(|o| self.resolve(o).as_array().ok()).and_then(|a| {
                        let v: Vec<f64> = a.iter().filter_map(|x| obj_f64(self.resolve(x))).collect();
                        (v.len() == 4).then(|| [v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])])
                    }),
                    nm: d.and_then(|d| d.get(b"NM").ok()).and_then(|o| o.as_str().ok()).map(decode_text),
                }
            })
            .collect())
    }

    /// The page's /Annots array in the new section, copying the page (and the array, when it
    /// is an indirect object) forward first.
    fn annots_mut(&mut self, page: usize) -> Result<&mut Vec<Object>, String> {
        let pid = self.page_id(page)?;
        self.inc.opt_clone_object_to_new_document(pid).map_err(|e| e.to_string())?;
        let existing = self.inc.new_document.get_dictionary(pid).map_err(|e| e.to_string())?.get(b"Annots").ok().cloned();
        match existing {
            Some(Object::Reference(aid)) => {
                self.inc.opt_clone_object_to_new_document(aid).map_err(|e| e.to_string())?;
                match self.inc.new_document.get_object_mut(aid).map_err(|e| e.to_string())? {
                    Object::Array(a) => Ok(a),
                    _ => Err("/Annots does not point at an array".into()),
                }
            }
            Some(Object::Array(_)) => match self.inc.new_document.get_dictionary_mut(pid).unwrap().get_mut(b"Annots").unwrap() {
                Object::Array(a) => Ok(a),
                _ => unreachable!(),
            },
            _ => {
                let d = self.inc.new_document.get_dictionary_mut(pid).unwrap();
                d.set("Annots", Object::Array(vec![]));
                match d.get_mut(b"Annots").unwrap() {
                    Object::Array(a) => Ok(a),
                    _ => unreachable!(),
                }
            }
        }
    }

    /// Build the annotation dictionary and its appearance stream; returns the dictionary.
    fn build(&mut self, page: usize, m: &Markup, meta: &Meta) -> Result<Dictionary, String> {
        let pid = self.page_id(page)?;
        let (_, rot) = self.page_box(page)?;
        // Text reads upright on screen on a rotated page; Acrobat also looks for /Rotate on the
        // annotation to keep it that way when the text is edited there.
        let reader_width = |r: &BBox| ap::reader_frame(*r, rot).0;
        let mut d = dictionary! {
            "Type" => "Annot",
            "P" => Object::Reference(pid),
            "NM" => text(&meta.id),
            "T" => text(&meta.author),
            "M" => text(&meta.date),
            "CreationDate" => text(&meta.date),
            "F" => 4, // Print: markups print by default
        };
        let border = |d: &mut Dictionary, s: &Style| {
            let mut bs = dictionary! { "Type" => "Border", "W" => real(s.width) };
            if let Some(dash) = &s.dash {
                bs.set("S", "D");
                bs.set("D", reals(dash));
            }
            d.set("BS", bs);
            d.set("C", rgb(s.stroke));
            if let Some(f) = s.fill {
                d.set("IC", rgb(f));
            }
            if s.opacity < 1.0 {
                d.set("CA", real(s.opacity));
            }
        };
        let appearance: Appearance = match m {
            Markup::Arrow { from, to, style } => {
                d.set("Subtype", "Line");
                d.set("L", pts(&[*from, *to]));
                d.set("LE", Object::Array(vec![Object::Name(b"None".to_vec()), Object::Name(b"OpenArrow".to_vec())]));
                border(&mut d, style);
                ap::line(*from, *to, (End::None, End::OpenArrow), style)
            }
            Markup::Rect { rect, style } => {
                d.set("Subtype", "Square");
                border(&mut d, style);
                let a = ap::rect(*rect, style);
                // /RD: how far the drawn square sits inside /Rect.
                let (r, o) = (a.bbox.0, rect.0);
                d.set("RD", reals(&[o[0] - r[0] - style.width / 2.0, o[1] - r[1] - style.width / 2.0, r[2] - o[2] - style.width / 2.0, r[3] - o[3] - style.width / 2.0]));
                a
            }
            Markup::Polygon { vertices, style } => {
                d.set("Subtype", "Polygon");
                d.set("Vertices", pts(vertices));
                border(&mut d, style);
                ap::polygon(vertices, style)
            }
            Markup::Cloud { vertices, intensity, style } => {
                d.set("Subtype", "Polygon");
                d.set("Vertices", pts(vertices));
                d.set("BE", dictionary! { "S" => "C", "I" => real(*intensity) });
                d.set("IT", "PolygonCloud");
                border(&mut d, style);
                ap::cloud(vertices, *intensity, style)
            }
            Markup::Text { rect, text: t, size, colour, style } => {
                d.set("Subtype", "FreeText");
                d.set("Contents", text(t));
                d.set("DA", text(&format!("{} {} {} rg /Helv {} Tf", ap::n(colour[0]), ap::n(colour[1]), ap::n(colour[2]), ap::n(*size))));
                d.set("DS", text(&format!("font: Helvetica,sans-serif {}pt; text-align:left; color:{}", ap::n(*size), hex(*colour))));
                d.set("Q", 0);
                border(&mut d, style);
                // FreeText uses /C for the background, not the border (ISO 32000-1, 12.5.6.6).
                d.remove(b"C");
                d.remove(b"IC");
                if let Some(f) = style.fill {
                    d.set("C", rgb(f));
                }
                if rot != 0 {
                    d.set("Rotate", rot);
                }
                let layout = ap::layout_text(t, reader_width(rect), *size);
                ap::text_box(*rect, &layout, *colour, style, rot)
            }
            Markup::Callout { rect, leader, text: t, size, colour, style } => {
                d.set("Subtype", "FreeText");
                d.set("IT", "FreeTextCallout");
                d.set("Contents", text(t));
                d.set("DA", text(&format!("{} {} {} rg /Helv {} Tf", ap::n(colour[0]), ap::n(colour[1]), ap::n(colour[2]), ap::n(*size))));
                d.set("Q", 0);
                d.set("CL", pts(leader));
                d.set("LE", "OpenArrow");
                border(&mut d, style);
                d.remove(b"C");
                d.remove(b"IC");
                if let Some(f) = style.fill {
                    d.set("C", rgb(f));
                }
                if rot != 0 {
                    d.set("Rotate", rot);
                }
                let layout = ap::layout_text(t, reader_width(rect), *size);
                let a = ap::callout(*rect, &layout, *colour, leader, style, rot);
                let (r, o) = (a.bbox.0, rect.0);
                d.set("RD", reals(&[o[0] - r[0], o[1] - r[1], r[2] - o[2], r[3] - o[3]]));
                a
            }
            Markup::Ink { strokes, style } => {
                d.set("Subtype", "Ink");
                d.set("InkList", Object::Array(strokes.iter().map(|s| pts(s)).collect()));
                border(&mut d, style);
                ap::ink(strokes, style)
            }
            Markup::Distance { from, to, ratio, unit, size, style } => {
                let paper_pt = ((to.0 - from.0).powi(2) + (to.1 - from.1).powi(2)).sqrt();
                let real_units = paper_pt * per_point(*ratio, unit);
                let label = format!("{} {}", fmt_measure(real_units), unit);
                d.set("Subtype", "Line");
                d.set("IT", "LineDimension");
                d.set("L", pts(&[*from, *to]));
                d.set("LE", Object::Array(vec![Object::Name(b"ClosedArrow".to_vec()), Object::Name(b"ClosedArrow".to_vec())]));
                d.set("Cap", true);
                d.set("CP", "Top");
                d.set("Contents", text(&label));
                d.set("Measure", measure(*ratio, unit));
                border(&mut d, style);
                ap::dimension(*from, *to, &label, *size, style, rot)
            }
            Markup::Area { vertices, ratio, unit, size, style } => {
                let k = per_point(*ratio, unit);
                let a = ap::signed_area(vertices).abs() * k * k;
                let label = format!("{} {}\u{b2}", fmt_measure(a), unit);
                d.set("Subtype", "Polygon");
                d.set("IT", "PolygonDimension");
                d.set("Vertices", pts(vertices));
                d.set("Contents", text(&label));
                d.set("Measure", measure(*ratio, unit));
                border(&mut d, style);
                ap::area(vertices, &label, *size, style, rot)
            }
        };
        d.set("Rect", reals(&appearance.bbox.0));
        let ap_id = self.appearance_stream(&appearance)?;
        d.set("AP", dictionary! { "N" => Object::Reference(ap_id) });
        Ok(d)
    }

    fn appearance_stream(&mut self, a: &Appearance) -> Result<ObjectId, String> {
        let mut res = Dictionary::new();
        if let Some(op) = a.opacity {
            res.set("ExtGState", dictionary! { "GS0" => dictionary! { "Type" => "ExtGState", "CA" => real(op), "ca" => real(op) } });
        }
        if a.font {
            res.set(
                "Font",
                dictionary! { "Helv" => dictionary! {
                    "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding",
                } },
            );
        }
        let dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "FormType" => 1,
            "BBox" => reals(&a.bbox.0),
            "Resources" => res,
        };
        let mut s = Stream::new(dict, a.ops.clone().into_bytes());
        s.compress().map_err(|e| e.to_string())?;
        Ok(self.inc.new_document.add_object(s))
    }

    /// Add a markup to a page. Returns its new object number.
    pub fn add(&mut self, page: usize, m: &Markup, meta: &Meta) -> Result<ObjectId, String> {
        let d = self.build(page, m, meta)?;
        let id = self.inc.new_document.add_object(d);
        self.annots_mut(page)?.push(Object::Reference(id));
        Ok(id)
    }

    /// Replace the annotation at `index` in the page's /Annots with a new drawing of `m`,
    /// keeping its object number (so other apps' replies and popups still point at it).
    pub fn replace(&mut self, page: usize, index: usize, m: &Markup, meta: &Meta) -> Result<ObjectId, String> {
        let entries = self.annots(page)?;
        let e = entries.get(index).ok_or("no such annotation")?;
        let d = self.build(page, m, meta)?;
        match e.id {
            Some(id) => {
                // Keep the old object's links to other annotations.
                let mut d = d;
                if let Some(Object::Dictionary(old)) = self.get(id).cloned() {
                    for k in [&b"Popup"[..], b"IRT", b"RT", b"Parent", b"StructParent"] {
                        if let Ok(v) = old.get(k) {
                            d.set(k.to_vec(), v.clone());
                        }
                    }
                }
                self.inc.new_document.set_object(id, d);
                Ok(id)
            }
            None => {
                let id = self.inc.new_document.add_object(d);
                self.annots_mut(page)?[index] = Object::Reference(id);
                Ok(id)
            }
        }
    }

    /// Remove the annotation at `index` (and its Popup, if it has one) from the page.
    pub fn delete(&mut self, page: usize, index: usize) -> Result<(), String> {
        let entries = self.annots(page)?;
        let e = entries.get(index).ok_or("no such annotation")?;
        let popup = e.id.and_then(|id| self.get(id)).and_then(|o| o.as_dict().ok()).and_then(|d| d.get(b"Popup").ok()).and_then(|o| o.as_reference().ok());
        let arr = self.annots_mut(page)?;
        arr.remove(index);
        if let Some(p) = popup {
            arr.retain(|o| o.as_reference().map(|r| r != p).unwrap_or(true));
        }
        Ok(())
    }

    /// Append the update to the original bytes.
    pub fn save(&mut self) -> Result<Vec<u8>, String> {
        let mut out = Vec::with_capacity(self.info.bytes + 64 * 1024);
        self.inc.save_to(&mut out).map_err(|e| format!("lopdf could not write the update: {e}"))?;
        Ok(out)
    }
}

fn hex(c: Rgb) -> String {
    format!("#{:02X}{:02X}{:02X}", (c[0] * 255.0).round() as u8, (c[1] * 255.0).round() as u8, (c[2] * 255.0).round() as u8)
}

/// Real-world units per point on paper at 1:`ratio`.
pub fn per_point(ratio: f64, unit: &str) -> f64 {
    let mm = 25.4 / 72.0 * ratio;
    match unit {
        "m" => mm / 1000.0,
        _ => mm,
    }
}

fn fmt_measure(v: f64) -> String {
    if v >= 100.0 { format!("{v:.1}") } else { format!("{v:.2}") }
}

/// The /Measure dictionary (ISO 32000-1, 12.9): how other apps turn the geometry back into
/// real-world distances and areas.
fn measure(ratio: f64, unit: &str) -> Dictionary {
    let fmt = |u: &str, c: f64| dictionary! { "Type" => "NumberFormat", "U" => text(u), "C" => real(c), "D" => 100, "SS" => text("") };
    dictionary! {
        "Type" => "Measure",
        "Subtype" => "RL",
        "R" => text(&format!("1:{}", ratio)),
        "X" => Object::Array(vec![fmt(unit, per_point(ratio, unit)).into()]),
        "D" => Object::Array(vec![fmt(unit, 1.0).into()]),
        "A" => Object::Array(vec![fmt(&format!("sq {unit}"), 1.0).into()]),
    }
}
