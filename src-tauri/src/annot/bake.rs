//! Baking a signature (or any stamp) into a page: drawing it as part of the page's own content
//! instead of as an annotation, so it can't be moved or lifted off.
//!
//! Done without rewriting the file, as an incremental update like every markup save
//! (docs/editing-phase5-scope.md, "Bake in, or keep movable"). PDFium's flatten would take every
//! annotation on the page, not one, and needs a full rewrite. Instead:
//!
//! - The annotation's appearance is written as a form XObject (the same stream an annotation
//!   would carry).
//! - The page is copied forward. Its /Contents becomes `[open, ...existing streams..., close]`:
//!   `open` is `q`, `close` is `Q` and then a `Do` of the form at the annotation's place. The
//!   wrap means whatever graphics state the original content leaves behind (an unbalanced `q`,
//!   a `cm` never undone, a clip, a colour) can't move or hide the signature. The existing
//!   streams are referred to, not copied: the original bytes stay where they were.
//! - The page gets its own copy of its resources (inherited ones resolved from the page tree,
//!   indirect ones copied, so a dictionary other pages share is never changed), with the form
//!   added under a name the page doesn't already use.

use lopdf::{Dictionary, Object, ObjectId, Stream};

use super::spec::AnnotSpec;
use super::writer::Writer;

/// Name prefix for baked stamps in a page's /XObject resources.
const NAME_PREFIX: &str = "VellumStamp";

fn num(v: f64) -> String {
    // Short, exact enough for a content stream (1/10000 pt), no exponent.
    let s = format!("{:.4}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" { "0".into() } else { s.into() }
}

/// The matrix that takes the appearance's /BBox onto the annotation's /Rect, as a viewer does
/// when it draws an annotation (PDF 32000 12.5.5, for a form with no /Matrix).
pub fn bbox_to_rect(bbox: [f64; 4], rect: [f64; 4]) -> [f64; 6] {
    let (bw, bh) = (bbox[2] - bbox[0], bbox[3] - bbox[1]);
    let (rw, rh) = (rect[2] - rect[0], rect[3] - rect[1]);
    let sx = if bw.abs() > 1e-9 { rw / bw } else { 1.0 };
    let sy = if bh.abs() > 1e-9 { rh / bh } else { 1.0 };
    [sx, 0.0, 0.0, sy, rect[0] - bbox[0] * sx, rect[1] - bbox[1] * sy]
}

impl Writer {
    /// The page's effective /Resources as a direct dictionary: its own, or the nearest one up
    /// the page tree, resolved (an empty one when there is none).
    fn effective_resources(&self, pid: ObjectId) -> Dictionary {
        let mut id = pid;
        for _ in 0..64 {
            let Some(d) = self.get(id).and_then(|o| o.as_dict().ok()) else { break };
            if let Ok(r) = d.get(b"Resources") {
                if let Ok(rd) = self.resolve(r).as_dict() {
                    return rd.clone();
                }
            }
            match d.get(b"Parent").ok().and_then(|o| o.as_reference().ok()) {
                Some(p) => id = p,
                None => break,
            }
        }
        Dictionary::new()
    }

    /// The page's content streams in order, as references (or direct objects, kept as they are).
    fn content_list(&self, pid: ObjectId) -> Vec<Object> {
        let Some(d) = self.get(pid).and_then(|o| o.as_dict().ok()) else { return vec![] };
        match d.get(b"Contents") {
            Ok(Object::Array(a)) => a.clone(),
            Ok(Object::Reference(r)) => match self.get(*r) {
                // /Contents pointing at an array of streams.
                Some(Object::Array(a)) => a.clone(),
                Some(_) => vec![Object::Reference(*r)],
                None => vec![],
            },
            _ => vec![],
        }
    }

    /// Draw the spec's appearance into its page's content, appended as part of this update.
    /// An annotation with the same /NM already on the page is removed (it is now part of the
    /// page). Returns the form XObject's object number.
    pub fn bake(&mut self, s: &AnnotSpec) -> Result<ObjectId, String> {
        if self.annots(s.page)?.iter().any(|e| e.nm.as_deref() == Some(s.nm.as_str())) {
            self.delete(s.page, &s.nm, None)?;
        }
        let pid = self.page_id(s.page)?;
        let form = self.appearance_stream(&s.appearance)?;

        // Resources: the page's own copy, with the form under a fresh name.
        let mut res = self.effective_resources(pid);
        let mut xo = match res.get(b"XObject") {
            Ok(o) => self.resolve(o).as_dict().cloned().unwrap_or_default(),
            Err(_) => Dictionary::new(),
        };
        let name = (0..)
            .map(|i| format!("{NAME_PREFIX}{i}"))
            .find(|n| !xo.has(n.as_bytes()))
            .expect("a free name");
        xo.set(name.as_bytes().to_vec(), Object::Reference(form));
        res.set("XObject", Object::Dictionary(xo));

        // Contents: wrapped in q/Q, then the stamp.
        let existing = self.content_list(pid);
        let m = super::bake::bbox_to_rect(s.appearance.bbox, s.rect);
        let open = self.inc.new_document.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
        let draw = format!(
            "\nQ\nq {} {} {} {} {} {} cm /{} Do Q\n",
            num(m[0]),
            num(m[1]),
            num(m[2]),
            num(m[3]),
            num(m[4]),
            num(m[5]),
            name
        );
        let close = self.inc.new_document.add_object(Stream::new(Dictionary::new(), draw.into_bytes()));
        let mut contents = Vec::with_capacity(existing.len() + 2);
        contents.push(Object::Reference(open));
        contents.extend(existing);
        contents.push(Object::Reference(close));

        self.inc.opt_clone_object_to_new_document(pid).map_err(|e| e.to_string())?;
        let page = self.inc.new_document.get_dictionary_mut(pid).map_err(|e| e.to_string())?;
        page.set("Resources", Object::Dictionary(res));
        page.set("Contents", Object::Array(contents));
        Ok(form)
    }
}
