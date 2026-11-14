//! A page's text layer, links and search hits, in Vellum's page coordinates.
//!
//! PDFium reports text, link and search rectangles in PDF user space: y up, before the page's
//! /Rotate, measured from the page box's own origin (which needn't be 0,0). Vellum's page
//! coordinates are the page as PDFium renders it: /Rotate applied, points, y down from the
//! top-left corner. `PageFrame` converts one to the other; everything else here is plumbing
//! around PDFium's text API, run on a worker.

use crate::pdfium::{PdfiumState, with_text_page};
use pdfium_render::prelude::*;
use serde::Serialize;
use std::ffi::{c_double, c_int, c_ulong};

/// How a page's user space maps to Vellum's page coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PageFrame {
    /// /Rotate in quarter turns clockwise, 0..=3.
    pub quarter_turns: i32,
    /// The visible page box in user space: left, bottom, right, top.
    pub bbox: [f64; 4],
}

impl PageFrame {
    pub fn new(rotate_quarter_turns: i32, left: f64, bottom: f64, right: f64, top: f64) -> Self {
        Self {
            quarter_turns: rotate_quarter_turns.rem_euclid(4),
            bbox: [left.min(right), bottom.min(top), left.max(right), bottom.max(top)],
        }
    }

    /// The page as displayed: width and height in points.
    pub fn size(&self) -> (f64, f64) {
        let [l, b, r, t] = self.bbox;
        if self.quarter_turns % 2 == 1 { (t - b, r - l) } else { (r - l, t - b) }
    }

    /// A user-space point on the displayed page, y down.
    pub fn to_page(&self, x: f64, y: f64) -> (f64, f64) {
        let [l, b, r, t] = self.bbox;
        match self.quarter_turns {
            1 => (y - b, x - l),
            2 => (r - x, y - b),
            3 => (t - y, r - x),
            _ => (x - l, t - y),
        }
    }

    /// A user-space rectangle (any two opposite corners) as [x0, y0, x1, y1] on the page.
    pub fn rect(&self, x0: f64, y0: f64, x1: f64, y1: f64) -> [f32; 4] {
        let (ax, ay) = self.to_page(x0, y0);
        let (bx, by) = self.to_page(x1, y1);
        [ax.min(bx) as f32, ay.min(by) as f32, ax.max(bx) as f32, ay.max(by) as f32]
    }
}

/// A page's frame as the front end gets it (`doc_page_frame`).
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrameInfo {
    /// /Rotate in quarter turns clockwise.
    pub quarter_turns: i32,
    /// The visible page box in user space: left, bottom, right, top.
    pub bbox: [f64; 4],
}

impl From<PageFrame> for FrameInfo {
    fn from(f: PageFrame) -> Self {
        Self { quarter_turns: f.quarter_turns, bbox: f.bbox }
    }
}

/// The frame of a loaded page.
pub fn page_frame(b: &dyn PdfiumLibraryBindings, page: FPDF_PAGE) -> PageFrame {
    let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
    let ok = unsafe { b.FPDF_GetPageBoundingBox(page, &mut r) } != 0;
    let rot = unsafe { b.FPDFPage_GetRotation(page) };
    if ok {
        PageFrame::new(rot, r.left as f64, r.bottom as f64, r.right as f64, r.top as f64)
    } else {
        let (w, h) = unsafe { (b.FPDF_GetPageWidthF(page) as f64, b.FPDF_GetPageHeightF(page) as f64) };
        let (w, h) = if rot % 2 == 1 { (h, w) } else { (w, h) };
        PageFrame::new(rot, 0.0, 0.0, w, h)
    }
}

/// Where a link goes.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    /// Rectangles in page points, y down.
    pub rects: Vec<[f32; 4]>,
    /// A web address (annotation link or one written in the text).
    pub uri: Option<String>,
    /// A page in this document.
    pub page: Option<usize>,
    /// Target position from the top of that page, when the link gives one.
    pub y: Option<f32>,
}

/// One search hit on a page.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    /// First character (PDFium char index) and how many.
    pub index: i32,
    pub count: i32,
    /// Merged rectangles in page points, y down.
    pub rects: Vec<[f32; 4]>,
    /// Up to 40 characters either side, on one line, for the results list.
    pub before: String,
    pub text: String,
    pub after: String,
}

/// A page's search result.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PageHits {
    /// Characters on the page (0: no text layer, e.g. a scan).
    pub chars: i32,
    pub hits: Vec<Hit>,
    /// More hits than MAX_HITS_PER_PAGE: the rest were dropped.
    pub truncated: bool,
}

pub const MAX_HITS_PER_PAGE: usize = 1000;
const CONTEXT: i32 = 40;

const FLAG_GENERATED: u8 = 1;
const FLAG_BOX: u8 = 2;

/// Encode a text layer for the front end (little-endian):
/// u32 n | n x u32 code points | n x 4 x f32 boxes | n x u8 flags | padding to 4 |
/// u32 json length | links as JSON.
pub fn encode_layer(codes: &[u32], boxes: &[[f32; 4]], flags: &[u8], links: &[Link]) -> Vec<u8> {
    let n = codes.len();
    let json = serde_json::to_vec(links).unwrap_or_else(|_| b"[]".to_vec());
    let mut out = Vec::with_capacity(4 + n * 21 + 8 + json.len());
    out.extend_from_slice(&(n as u32).to_le_bytes());
    for c in codes {
        out.extend_from_slice(&c.to_le_bytes());
    }
    for b in boxes {
        for v in b {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out.extend_from_slice(flags);
    while out.len() % 4 != 0 {
        out.push(0);
    }
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out
}

/// Rectangles overlap by more than half the smaller one's area.
fn mostly_overlaps(a: &[f32; 4], b: &[f32; 4]) -> bool {
    let w = (a[2].min(b[2]) - a[0].max(b[0])).max(0.0);
    let h = (a[3].min(b[3]) - a[1].max(b[1])).max(0.0);
    let area = |r: &[f32; 4]| ((r[2] - r[0]) * (r[3] - r[1])).max(1e-6);
    w * h > 0.5 * area(a).min(area(b))
}

/// Web addresses found in the text that a link annotation already covers are dropped.
pub fn merge_links(mut annots: Vec<Link>, web: Vec<Link>) -> Vec<Link> {
    for w in web {
        let covered = annots.iter().any(|a| a.rects.iter().any(|ar| w.rects.iter().any(|wr| mostly_overlaps(ar, wr))));
        if !covered {
            annots.push(w);
        }
    }
    annots
}

const PDFACTION_GOTO: c_ulong = 1;
const PDFACTION_URI: c_ulong = 3;

fn annotation_links(b: &dyn PdfiumLibraryBindings, doc: FPDF_DOCUMENT, page: FPDF_PAGE, frame: &PageFrame) -> Vec<Link> {
    let mut out = Vec::new();
    let mut pos: c_int = 0;
    let mut link: FPDF_LINK = std::ptr::null_mut();
    for _ in 0..10_000 {
        if unsafe { b.FPDFLink_Enumerate(page, &mut pos, &mut link) } == 0 {
            break;
        }
        let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
        if unsafe { b.FPDFLink_GetAnnotRect(link, &mut r) } == 0 {
            continue;
        }
        let rect = frame.rect(r.left as f64, r.bottom as f64, r.right as f64, r.top as f64);
        let mut dest = unsafe { b.FPDFLink_GetDest(doc, link) };
        let mut uri = None;
        if dest.is_null() {
            let action = unsafe { b.FPDFLink_GetAction(link) };
            if !action.is_null() {
                match unsafe { b.FPDFAction_GetType(action) } {
                    PDFACTION_GOTO => dest = unsafe { b.FPDFAction_GetDest(doc, action) },
                    PDFACTION_URI => {
                        // The URI comes back as 7-bit ASCII bytes with a terminating NUL.
                        let need = unsafe { b.FPDFAction_GetURIPath(doc, action, std::ptr::null_mut(), 0) } as usize;
                        if need > 1 {
                            let mut buf = vec![0u8; need];
                            unsafe { b.FPDFAction_GetURIPath(doc, action, buf.as_mut_ptr() as *mut _, need as c_ulong) };
                            while buf.last() == Some(&0) {
                                buf.pop();
                            }
                            uri = Some(String::from_utf8_lossy(&buf).trim().to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
        let (mut target, mut y) = (None, None);
        if !dest.is_null() {
            let idx = unsafe { b.FPDFDest_GetDestPageIndex(doc, dest) };
            if idx >= 0 {
                target = Some(idx as usize);
                let (mut hx, mut hy, mut hz) = (0, 0, 0);
                let (mut dx, mut dy, mut dz) = (0f32, 0f32, 0f32);
                let ok = unsafe { b.FPDFDest_GetLocationInPage(dest, &mut hx, &mut hy, &mut hz, &mut dx, &mut dy, &mut dz) };
                if ok != 0 && hy != 0 {
                    // As the bookmarks do: from the page height, without parsing the target page.
                    let mut s = FS_SIZEF { width: 0.0, height: 0.0 };
                    if unsafe { b.FPDF_GetPageSizeByIndexF(doc, idx, &mut s) } != 0 {
                        y = Some((s.height - dy).clamp(0.0, s.height));
                    }
                }
            }
        }
        if uri.is_some() || target.is_some() {
            out.push(Link { rects: vec![rect], uri, page: target, y });
        }
    }
    out
}

fn web_links(b: &dyn PdfiumLibraryBindings, tp: FPDF_TEXTPAGE, frame: &PageFrame) -> Vec<Link> {
    let mut out = Vec::new();
    let lp = unsafe { b.FPDFLink_LoadWebLinks(tp) };
    if lp.is_null() {
        return out;
    }
    let n = unsafe { b.FPDFLink_CountWebLinks(lp) }.max(0);
    for i in 0..n.min(10_000) {
        let need = unsafe { b.FPDFLink_GetURL(lp, i, std::ptr::null_mut(), 0) };
        if need <= 1 {
            continue;
        }
        let mut buf = vec![0u16; need as usize];
        unsafe { b.FPDFLink_GetURL(lp, i, buf.as_mut_ptr(), need) };
        while buf.last() == Some(&0) {
            buf.pop();
        }
        let url = String::from_utf16_lossy(&buf);
        let nr = unsafe { b.FPDFLink_CountRects(lp, i) }.max(0);
        let mut rects = Vec::new();
        for k in 0..nr {
            let (mut l, mut t, mut r, mut bo): (c_double, c_double, c_double, c_double) = (0.0, 0.0, 0.0, 0.0);
            if unsafe { b.FPDFLink_GetRect(lp, i, k, &mut l, &mut t, &mut r, &mut bo) } != 0 {
                rects.push(frame.rect(l, bo, r, t));
            }
        }
        if !rects.is_empty() {
            out.push(Link { rects, uri: Some(url), page: None, y: None });
        }
    }
    unsafe { b.FPDFLink_CloseWebLinks(lp) };
    out
}

/// An annotation's string value (UTF-16 from PDFium).
fn annot_string(b: &dyn PdfiumLibraryBindings, a: FPDF_ANNOTATION, key: &str) -> String {
    let need = unsafe { b.FPDFAnnot_GetStringValue(a, key, std::ptr::null_mut(), 0) } as usize;
    if need <= 2 {
        return String::new();
    }
    let mut buf = vec![0u16; need / 2];
    unsafe { b.FPDFAnnot_GetStringValue(a, key, buf.as_mut_ptr(), need as c_ulong) };
    while buf.last() == Some(&0) {
        buf.pop();
    }
    String::from_utf16_lossy(&buf)
}

/// Text on one line for the results list.
fn one_line(s: String) -> String {
    s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect()
}

fn text_range(b: &dyn PdfiumLibraryBindings, tp: FPDF_TEXTPAGE, start: i32, count: i32) -> String {
    if count <= 0 {
        return String::new();
    }
    let mut buf = vec![0u16; count as usize + 1];
    let got = unsafe { b.FPDFText_GetText(tp, start, count, buf.as_mut_ptr()) }.max(0) as usize;
    buf.truncate(got.min(buf.len()));
    while buf.last() == Some(&0) {
        buf.pop();
    }
    one_line(String::from_utf16_lossy(&buf))
}

impl PdfiumState {
    /// A page's frame (rotation and page box).
    pub fn page_frame(&self, doc_id: u64, page: usize) -> Result<FrameInfo, String> {
        let w = self.page_worker(page)?;
        self.run_on_worker_index(w, move |ctx| {
            let b = ctx.bindings();
            let p = ctx.page(doc_id, page)?;
            Ok(page_frame(b, p).into())
        })?
    }

    /// Set or clear the Hidden flag on the annotations with these /NM values, on every worker's
    /// copy of the document. A parsed page picks the flag up on its next render. Returns how
    /// many annotations matched on one worker.
    pub fn hide_annots(&self, doc_id: u64, page: usize, nms: Vec<String>, hidden: bool) -> Result<usize, String> {
        const HIDDEN: i32 = 2;
        let mut matched = 0;
        for w in 0..self.worker_count()? {
            let nms = nms.clone();
            matched = self.run_on_worker_index(w, move |ctx| -> Result<usize, String> {
                let b = ctx.bindings();
                let p = ctx.page(doc_id, page)?;
                let mut n = 0;
                let count = unsafe { b.FPDFPage_GetAnnotCount(p) }.max(0);
                for i in 0..count {
                    let a = unsafe { b.FPDFPage_GetAnnot(p, i) };
                    if a.is_null() {
                        continue;
                    }
                    let nm = annot_string(b, a, "NM");
                    if nms.iter().any(|x| *x == nm) {
                        let f = unsafe { b.FPDFAnnot_GetFlags(a) };
                        let f = if hidden { f | HIDDEN } else { f & !HIDDEN };
                        unsafe { b.FPDFAnnot_SetFlags(a, f) };
                        n += 1;
                    }
                    unsafe { b.FPDFPage_CloseAnnot(a) };
                }
                Ok(n)
            })??;
        }
        Ok(matched)
    }

    /// Wait until every worker has finished what was queued before this call (e.g. a Close).
    pub fn wait_idle(&self) -> Result<(), String> {
        for w in 0..self.worker_count()? {
            self.run_on_worker_index(w, |_| ())?;
        }
        Ok(())
    }

    /// Rewrite a PDF through PDFium (open from memory, save as a whole new file): repairs
    /// broken cross-reference data so an update can be appended to the result.
    pub fn rewrite(&self, bytes: Vec<u8>, password: Option<String>) -> Result<Vec<u8>, String> {
        self.run_on_worker(move |ctx| {
            let b = ctx.bindings();
            let doc = unsafe { b.FPDF_LoadMemDocument64(&bytes, password.as_deref()) };
            if doc.is_null() {
                return Err(crate::errcode::coded("read_failed", "PDFium couldn't read the file to repair it"));
            }
            let out = crate::print::compose::save(b, doc);
            unsafe { b.FPDF_CloseDocument(doc) };
            out
        })?
    }

    /// The worker that renders this page's small regions, so its parsed page is reused.
    fn page_worker(&self, page: usize) -> Result<usize, String> {
        Ok(page % self.worker_count()?.max(1))
    }

    /// Every character on the page with its box, and the page's links, encoded for the front
    /// end (`encode_layer`).
    pub fn text_layer(&self, doc_id: u64, page: usize) -> Result<Vec<u8>, String> {
        let w = self.page_worker(page)?;
        self.run_on_worker_index(w, move |ctx| {
            let b = ctx.bindings();
            let doc = ctx.document(doc_id).ok_or("document not open")?;
            let p = ctx.page(doc_id, page)?;
            let frame = page_frame(b, p);
            let annots = annotation_links(b, doc, p, &frame);
            with_text_page(b, p, |tp| {
                let n = unsafe { b.FPDFText_CountChars(tp) }.max(0) as usize;
                let (mut codes, mut boxes, mut flags) = (Vec::with_capacity(n), Vec::with_capacity(n), Vec::with_capacity(n));
                for i in 0..n as c_int {
                    codes.push(unsafe { b.FPDFText_GetUnicode(tp, i) });
                    let mut f = 0u8;
                    if unsafe { b.FPDFText_IsGenerated(tp, i) } == 1 {
                        f |= FLAG_GENERATED;
                    }
                    let mut r = FS_RECTF { left: 0.0, top: 0.0, right: 0.0, bottom: 0.0 };
                    let has = unsafe { b.FPDFText_GetLooseCharBox(tp, i, &mut r) } != 0 && (r.right - r.left).abs() > 1e-4;
                    if has {
                        f |= FLAG_BOX;
                        boxes.push(frame.rect(r.left as f64, r.bottom as f64, r.right as f64, r.top as f64));
                    } else {
                        boxes.push([0.0; 4]);
                    }
                    flags.push(f);
                }
                let links = merge_links(annots, web_links(b, tp, &frame));
                Ok(encode_layer(&codes, &boxes, &flags, &links))
            })
        })?
    }

    /// Search one page with PDFium's own matcher.
    pub fn search_page(&self, doc_id: u64, page: usize, query: String, match_case: bool, whole_word: bool) -> Result<PageHits, String> {
        let w = self.page_worker(page)?;
        self.run_on_worker_index(w, move |ctx| {
            let b = ctx.bindings();
            let p = ctx.page(doc_id, page)?;
            let frame = page_frame(b, p);
            with_text_page(b, p, |tp| {
                let chars = unsafe { b.FPDFText_CountChars(tp) }.max(0);
                let mut out = PageHits { chars, hits: Vec::new(), truncated: false };
                let q: Vec<u16> = query.encode_utf16().chain(std::iter::once(0)).collect();
                if chars == 0 || q.len() <= 1 {
                    return Ok(out);
                }
                let flags = (match_case as c_ulong) | ((whole_word as c_ulong) << 1);
                let h = unsafe { b.FPDFText_FindStart(tp, q.as_ptr(), flags, 0) };
                if h.is_null() {
                    return Ok(out);
                }
                while unsafe { b.FPDFText_FindNext(h) } != 0 {
                    if out.hits.len() >= MAX_HITS_PER_PAGE {
                        out.truncated = true;
                        break;
                    }
                    let index = unsafe { b.FPDFText_GetSchResultIndex(h) };
                    let count = unsafe { b.FPDFText_GetSchCount(h) };
                    let nr = unsafe { b.FPDFText_CountRects(tp, index, count) }.max(0);
                    let mut rects = Vec::with_capacity(nr as usize);
                    for k in 0..nr {
                        let (mut l, mut t, mut r, mut bo): (c_double, c_double, c_double, c_double) = (0.0, 0.0, 0.0, 0.0);
                        if unsafe { b.FPDFText_GetRect(tp, k, &mut l, &mut t, &mut r, &mut bo) } != 0 {
                            rects.push(frame.rect(l, bo, r, t));
                        }
                    }
                    let s0 = (index - CONTEXT).max(0);
                    let e0 = (index + count).min(chars);
                    out.hits.push(Hit {
                        index,
                        count,
                        rects,
                        before: text_range(b, tp, s0, index - s0),
                        text: text_range(b, tp, index, count),
                        after: text_range(b, tp, e0, CONTEXT.min(chars - e0)),
                    });
                }
                unsafe { b.FPDFText_FindClose(h) };
                Ok(out)
            })
        })?
    }
}
