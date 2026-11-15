//! The annotation writer: open a PDF with lopdf (decrypting it if needed), add, replace or delete
//! annotations from specs, and append the changes as an incremental update. Moved from the
//! phase 0 spike (spikes/annot-writer/src/writer.rs), where it was proven on every kind of file
//! in docs/editing-scope.md "Phase 0 results".

use std::time::Instant;

use lopdf::{Dictionary, Document, IncrementalDocument, LoadOptions, Object, ObjectId, Stream, StringFormat, dictionary};
use serde::Serialize;

use super::spec::{AnnotSpec, Appearance, Change, PopupSpec};

/// The private key Vellum's own copy of a markup is written under (AnnotSpec::vellum). A
/// second-class name in the PDF's sense: other apps leave keys they don't know alone.
pub const REEDIT_KEY: &str = "Vellum_Markup";

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
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
    /// Per page changed so far: for each entry now in /Annots, its position when the file was
    /// read (None for one added by this save), so an annotation found by its original position
    /// (`at`) is still found after earlier deletes in the same save have moved it up.
    slots: std::collections::HashMap<usize, Vec<Option<usize>>>,
}

fn real(v: f64) -> Object {
    Object::Real(v as f32)
}
fn reals(v: &[f64]) -> Object {
    Object::Array(v.iter().map(|x| real(*x)).collect())
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
        Ok(Self { inc, pages, info, slots: Default::default() })
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
    pub(super) fn get(&self, id: ObjectId) -> Option<&Object> {
        self.inc.new_document.get_object(id).ok().or_else(|| self.prev().get_object(id).ok())
    }

    pub(super) fn resolve<'a>(&'a self, o: &'a Object) -> &'a Object {
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

    /// The page's map from current /Annots positions to the positions as read.
    fn slots(&mut self, page: usize) -> Result<&mut Vec<Option<usize>>, String> {
        if !self.slots.contains_key(&page) {
            let n = self.annots(page)?.len();
            self.slots.insert(page, (0..n).map(Some).collect());
        }
        Ok(self.slots.get_mut(&page).unwrap())
    }

    /// The annotation on a page: at position `at` in /Annots as the file was read, when given
    /// (phase 7b: one that came with the file, which may have no /NM), else the one with /NM
    /// `nm`. Its index in /Annots now.
    fn find(&mut self, page: usize, nm: &str, at: Option<usize>) -> Result<usize, String> {
        if let Some(at) = at {
            let n = self.annots(page)?.len();
            return self
                .slots(page)?
                .iter()
                .position(|s| *s == Some(at))
                .filter(|i| *i < n)
                .ok_or_else(|| format!("no annotation at {at} on page {}", page + 1));
        }
        self.annots(page)?
            .iter()
            .position(|e| e.nm.as_deref() == Some(nm))
            .ok_or_else(|| format!("no annotation {nm} on page {}", page + 1))
    }

    /// Build an annotation dictionary (and its appearance stream object) from a spec.
    fn build(&mut self, s: &AnnotSpec) -> Result<Dictionary, String> {
        let pid = self.page_id(s.page)?;
        let mut d = dictionary! {
            "Type" => "Annot",
            "Subtype" => Object::Name(s.subtype.as_bytes().to_vec()),
            "P" => Object::Reference(pid),
            "NM" => text(&s.nm),
            "Rect" => reals(&s.rect),
            "F" => s.flags.unwrap_or(4),
        };
        for (k, v) in [
            ("T", &s.author),
            ("M", &s.modified),
            ("CreationDate", &s.created),
            ("Contents", &s.contents),
            ("DA", &s.default_appearance),
            ("DS", &s.default_style),
        ] {
            if let Some(v) = v {
                d.set(k, text(v));
            }
        }
        if let Some(c) = s.colour {
            d.set("C", reals(&c));
        }
        if let Some(c) = s.interior {
            d.set("IC", reals(&c));
        }
        if let Some(o) = s.opacity {
            d.set("CA", real(o));
        }
        if s.border_width.is_some() || s.dash.is_some() {
            let mut bs = dictionary! { "Type" => "Border", "W" => real(s.border_width.unwrap_or(1.0)) };
            if let Some(dash) = &s.dash {
                bs.set("S", "D");
                bs.set("D", reals(dash));
            }
            d.set("BS", bs);
        }
        if let Some(l) = s.line {
            d.set("L", reals(&l));
        }
        if let Some(le) = &s.line_ends {
            let names: Vec<Object> = le.iter().map(|n| Object::Name(n.as_bytes().to_vec())).collect();
            // A callout's /LE is a single name; a line's is a pair.
            d.set("LE", if names.len() == 1 { names[0].clone() } else { Object::Array(names) });
        }
        if let Some(v) = &s.vertices {
            d.set("Vertices", reals(v));
        }
        if let Some(ink) = &s.ink {
            d.set("InkList", Object::Array(ink.iter().map(|st| reals(st)).collect()));
        }
        if let Some(i) = s.cloud {
            d.set("BE", dictionary! { "S" => "C", "I" => real(i) });
        }
        if let Some(it) = &s.intent {
            d.set("IT", Object::Name(it.as_bytes().to_vec()));
        }
        if let Some(q) = s.quadding {
            d.set("Q", q);
        }
        if let Some(rd) = s.inset {
            d.set("RD", reals(&rd));
        }
        if let Some(r) = s.rotate.filter(|r| *r != 0) {
            d.set("Rotate", r);
        }
        if let Some(cl) = &s.callout {
            d.set("CL", reals(cl));
        }
        if let Some(v) = &s.vellum {
            d.set(REEDIT_KEY, text(v));
        }
        // Measuring
        if let Some(m) = &s.measure {
            d.set("Measure", super::measure::measure_dict(m));
        }
        if s.caption == Some(true) {
            d.set("Cap", true);
            d.set("CP", Object::Name(b"Top".to_vec()));
        }
        // Dimensions (stage 5): the pulled-out line and the moved value, as ISO 32000-1 12.5.6.7
        // has them, so other apps draw the same. /LLE and /LLO only with a non-zero /LL.
        if let Some([ll, lle, llo]) = s.leader.filter(|l| l[0] != 0.0) {
            d.set("LL", real(ll));
            if lle > 0.0 {
                d.set("LLE", real(lle));
            }
            if llo > 0.0 {
                d.set("LLO", real(llo));
            }
        }
        if let Some(co) = s.caption_offset {
            d.set("CO", reals(&co));
        }

        // Stamps
        if let Some(n) = s.stamp_name.as_deref().filter(|n| !n.is_empty() && n.bytes().all(|c| c.is_ascii_alphanumeric())) {
            d.set("Name", Object::Name(n.as_bytes().to_vec()));
        }

        // Text markups
        if let Some(q) = &s.quad_points {
            d.set("QuadPoints", reals(q));
        }
        if let Some(n) = &s.icon {
            d.set("Name", Object::Name(n.as_bytes().to_vec()));
        }

        let ap = self.appearance_stream(&s.appearance)?;
        d.set("AP", dictionary! { "N" => Object::Reference(ap) });
        // Text markups: the blend mode goes into the appearance's /GS0 (made here if the
        // appearance had no opacity to give it).
        if let Some(bm) = &s.blend {
            self.set_blend(ap, bm)?;
        }
        Ok(d)
    }

    pub(super) fn appearance_stream(&mut self, a: &Appearance) -> Result<ObjectId, String> {
        let mut res = Dictionary::new();
        if a.opacity.is_some() || a.fill_opacity.is_some() {
            let line = a.opacity.unwrap_or(1.0);
            let fill = a.fill_opacity.or(a.opacity).unwrap_or(1.0);
            res.set("ExtGState", dictionary! { "GS0" => dictionary! { "Type" => "ExtGState", "CA" => real(line), "ca" => real(fill) } });
        }
        // Standard fonts, so nothing is embedded; WinAnsi, as the operators' strings are.
        let mut fonts = a.fonts.clone();
        if a.font {
            fonts.entry("Helv".into()).or_insert_with(|| "Helvetica".into());
        }
        if !fonts.is_empty() {
            let mut fd = Dictionary::new();
            for (name, base) in &fonts {
                fd.set(
                    name.as_bytes().to_vec(),
                    dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => Object::Name(base.as_bytes().to_vec()), "Encoding" => "WinAnsiEncoding" },
                );
            }
            res.set("Font", fd);
        }
        // Stamps
        self.add_images(&a.images, &mut res)?;
        let dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Form",
            "FormType" => 1,
            "BBox" => reals(&a.bbox),
            "Resources" => res,
        };
        let mut st = Stream::new(dict, a.ops.clone().into_bytes());
        st.compress().map_err(|e| e.to_string())?;
        Ok(self.inc.new_document.add_object(st))
    }

    // Text markups
    /// Give appearance stream `ap`'s /GS0 the blend mode `bm` (/BM), making /GS0 if need be.
    fn set_blend(&mut self, ap: ObjectId, bm: &str) -> Result<(), String> {
        let st = self.inc.new_document.get_object_mut(ap).and_then(|o| o.as_stream_mut()).map_err(|e| e.to_string())?;
        let res = match st.dict.get_mut(b"Resources") {
            Ok(Object::Dictionary(r)) => r,
            _ => return Err("appearance has no resources".into()),
        };
        if !matches!(res.get(b"ExtGState"), Ok(Object::Dictionary(_))) {
            res.set("ExtGState", Dictionary::new());
        }
        let Ok(Object::Dictionary(gs)) = res.get_mut(b"ExtGState") else { unreachable!() };
        if !matches!(gs.get(b"GS0"), Ok(Object::Dictionary(_))) {
            gs.set("GS0", dictionary! { "Type" => "ExtGState" });
        }
        let Ok(Object::Dictionary(g0)) = gs.get_mut(b"GS0") else { unreachable!() };
        g0.set("BM", Object::Name(bm.as_bytes().to_vec()));
        Ok(())
    }

    /// Add a new annotation. Returns its object number.
    pub fn add(&mut self, s: &AnnotSpec) -> Result<ObjectId, String> {
        let d = self.build(s)?;
        let id = self.inc.new_document.add_object(d);
        self.slots(s.page)?;
        self.annots_mut(s.page)?.push(Object::Reference(id));
        self.slots(s.page)?.push(None);
        // Notes (stage 7)
        if let Some(p) = &s.popup {
            self.write_popup(s.page, id, p)?;
        }
        Ok(id)
    }

    /// Redraw the annotation with the spec's /NM, keeping its object number and its links to
    /// other annotations (popups, replies) and its creation date.
    pub fn replace(&mut self, s: &AnnotSpec) -> Result<ObjectId, String> {
        let index = self.find(s.page, &s.nm, s.at)?;
        let entry = self.annots(s.page)?.swap_remove(index);
        let mut d = self.build(s)?;
        let id = match entry.id {
            Some(id) => {
                if let Some(Object::Dictionary(old)) = self.get(id).cloned() {
                    for k in [&b"Popup"[..], b"IRT", b"RT", b"Parent", b"StructParent", b"CreationDate"] {
                        if let Ok(v) = old.get(k) {
                            d.set(k.to_vec(), v.clone());
                        }
                    }
                }
                self.inc.new_document.set_object(id, d);
                id
            }
            None => {
                let id = self.inc.new_document.add_object(d);
                self.annots_mut(s.page)?[index] = Object::Reference(id);
                id
            }
        };
        // Notes (stage 7): its pop-up, the one it had if it had one.
        if let Some(p) = &s.popup {
            self.write_popup(s.page, id, p)?;
        }
        Ok(id)
    }

    /// Remove the annotation with this /NM (and its popup, if it has one) from the page.
    pub fn delete(&mut self, page: usize, nm: &str, at: Option<usize>) -> Result<(), String> {
        let index = self.find(page, nm, at)?;
        let entries = self.annots(page)?;
        let entry = &entries[index];
        let popup = entry.id.and_then(|id| self.get(id)).and_then(|o| o.as_dict().ok()).and_then(|d| d.get(b"Popup").ok()).and_then(|o| o.as_reference().ok());
        // Notes (stage 7): and any Popup whose /Parent is it, so none is left orphaned.
        let children = entry.id.map(|id| self.popups_of(&entries, id)).unwrap_or_default();
        // The entry and its popup, from the end so the positions stay right as they go.
        let mut gone: Vec<usize> = entries.iter().filter(|e| e.index == index || (popup.is_some() && e.id == popup) || children.contains(&e.index)).map(|e| e.index).collect();
        gone.sort_unstable();
        self.slots(page)?;
        for i in gone.into_iter().rev() {
            self.annots_mut(page)?.remove(i);
            self.slots(page)?.remove(i);
        }
        Ok(())
    }

    /// Move an annotation by (dx, dy) in user space, keeping its dictionary and appearance
    /// (Change::Move). Its object number stays, as a replace keeps it.
    pub fn move_by(&mut self, page: usize, nm: &str, at: Option<usize>, dx: f64, dy: f64, modified: Option<&str>) -> Result<(), String> {
        let index = self.find(page, nm, at)?;
        let entry = self.annots(page)?.swap_remove(index);
        let old = match entry.id {
            Some(id) => self.get(id).cloned(),
            None => self.annots_mut(page)?.get(index).cloned(),
        };
        let Some(Object::Dictionary(mut d)) = old else { return Err(format!("annotation {index} on page {} isn't a dictionary", page + 1)) };
        let shifted = |o: &Object, this: &Self| -> Option<Object> {
            match this.resolve(o) {
                Object::Array(a) => Some(Object::Array(
                    a.iter()
                        .enumerate()
                        .map(|(i, x)| match x {
                            Object::Array(_) => x.clone(),
                            _ => obj_f64(this.resolve(x)).map(|v| real(v + if i % 2 == 0 { dx } else { dy })).unwrap_or_else(|| x.clone()),
                        })
                        .collect(),
                )),
                _ => None,
            }
        };
        for k in [&b"Rect"[..], b"QuadPoints", b"Vertices", b"L", b"CL"] {
            if let Some(v) = d.get(k).ok().and_then(|o| shifted(o, self)) {
                d.set(k.to_vec(), v);
            }
        }
        if let Some(Object::Array(strokes)) = d.get(b"InkList").ok().map(|o| self.resolve(o).clone()) {
            let moved: Vec<Object> = strokes.iter().map(|st| shifted(st, self).unwrap_or_else(|| st.clone())).collect();
            d.set("InkList", Object::Array(moved));
        }
        if let Some(m) = modified {
            d.set("M", text(m));
        }
        match entry.id {
            Some(id) => self.inc.new_document.set_object(id, d),
            None => {
                let id = self.inc.new_document.add_object(d);
                self.annots_mut(page)?[index] = Object::Reference(id);
            }
        }
        Ok(())
    }

    // Notes (tool consistency stage 7)
    /// Write note `parent`'s pop-up from `p`: the Popup its /Popup already points at is updated
    /// in place (keeping its object number and its other keys), else a new one is added at the
    /// end of the page's /Annots (where other apps look for it; the end, so no other
    /// annotation's position moves). /Parent to the note, the note's /Popup to it, and /F
    /// without Print: pop-ups don't print (a callout is the tool for text that must).
    fn write_popup(&mut self, page: usize, parent: ObjectId, p: &PopupSpec) -> Result<ObjectId, String> {
        /// NoZoom and NoRotate (a fixed size and upright, as Vellum shows it); not Print.
        const POPUP_FLAGS: i64 = 8 | 16;
        let pid = self.page_id(page)?;
        let is_popup = |d: &Dictionary| d.get(b"Subtype").ok().and_then(|o| o.as_name().ok()) == Some(&b"Popup"[..]);
        let existing = self
            .get(parent)
            .and_then(|o| o.as_dict().ok())
            .and_then(|d| d.get(b"Popup").ok())
            .and_then(|o| o.as_reference().ok())
            .filter(|id| self.get(*id).and_then(|o| o.as_dict().ok()).is_some_and(is_popup));
        let mut d = existing.and_then(|id| self.get(id)).and_then(|o| o.as_dict().ok()).cloned().unwrap_or_default();
        d.set("Type", "Annot");
        d.set("Subtype", "Popup");
        d.set("P", Object::Reference(pid));
        d.set("Parent", Object::Reference(parent));
        d.set("Rect", reals(&p.rect));
        d.set("Open", p.open);
        d.set("F", POPUP_FLAGS);
        let id = match existing {
            Some(id) => {
                self.inc.new_document.set_object(id, d);
                id
            }
            None => self.inc.new_document.add_object(d),
        };
        if !self.annots(page)?.iter().any(|e| e.id == Some(id)) {
            self.slots(page)?;
            self.annots_mut(page)?.push(Object::Reference(id));
            self.slots(page)?.push(None);
        }
        self.inc.opt_clone_object_to_new_document(parent).map_err(|e| e.to_string())?;
        match self.inc.new_document.get_object_mut(parent) {
            Ok(Object::Dictionary(n)) => n.set("Popup", Object::Reference(id)),
            _ => return Err("a note's pop-up has no note to belong to".into()),
        }
        Ok(id)
    }

    /// The positions in `entries` (a page's /Annots) of the Popups whose /Parent is `parent`.
    fn popups_of(&self, entries: &[AnnotEntry], parent: ObjectId) -> Vec<usize> {
        entries
            .iter()
            .filter(|e| e.subtype.as_deref() == Some("Popup"))
            .filter(|e| {
                e.id.and_then(|id| self.get(id)).and_then(|o| o.as_dict().ok()).and_then(|d| d.get(b"Parent").ok()).and_then(|o| o.as_reference().ok()) == Some(parent)
            })
            .map(|e| e.index)
            .collect()
    }

    pub fn apply(&mut self, c: &Change) -> Result<(), String> {
        match c {
            Change::Add { spec } => self.add(spec).map(|_| ()),
            Change::Replace { spec } => self.replace(spec).map(|_| ()),
            Change::Delete { page, nm, at } => self.delete(*page, nm, *at),
            Change::Move { page, nm, at, dx, dy, modified } => self.move_by(*page, nm, *at, *dx, *dy, modified.as_deref()),
            // Stamps
            Change::Bake { spec } => self.bake(spec).map(|_| ()),
        }
    }

    pub fn save(&mut self) -> Result<Vec<u8>, String> {
        let mut out = Vec::with_capacity(self.info.bytes + 64 * 1024);
        self.inc.save_to(&mut out).map_err(|e| format!("lopdf could not write the update: {e}"))?;
        Ok(out)
    }
}

