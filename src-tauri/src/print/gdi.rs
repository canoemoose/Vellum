//! Windows printing through GDI: printer enumeration, capabilities, the driver's own
//! properties dialog, and sending a composed job.
//!
//! Output is "Image 300/600 dpi" by default: each sheet is rendered by PDFium in bands at that
//! resolution and sent with `StretchDIBits`, which every driver accepts. "Vector" hands the
//! printer DC to `FPDF_RenderPage` instead. The sheet's (0, 0) is the paper's top-left; the
//! printer DC's origin is the printable area's top-left, `PHYSICALOFFSET` in from the edge.

use super::job::{self, ColourMode, Paper, Rect};
use super::raster::{FPDF_GRAYSCALE, FPDF_PRINTING, SheetRenderer};
use crate::pdfium::PdfiumState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Graphics::Printing::*;
use windows::Win32::Storage::Xps::*;
use windows::core::{PCWSTR, PWSTR};

const LOGPIXELSY: GET_DEVICE_CAPS_INDEX = GET_DEVICE_CAPS_INDEX(90);
const PHYSICALHEIGHT: GET_DEVICE_CAPS_INDEX = GET_DEVICE_CAPS_INDEX(111);
const PHYSICALOFFSETY: GET_DEVICE_CAPS_INDEX = GET_DEVICE_CAPS_INDEX(113);
const IDOK: i32 = 1;
/// Rows per band: 600 dpi A3 is 7016 px wide, so a band is about 14 MB.
const BAND_ROWS: i32 = 512;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn from_wide(buf: &[u16]) -> String {
    let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..n])
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

/// Installed printers, local and network connections, default first.
pub fn printers() -> Result<Vec<PrinterInfo>, String> {
    let default = default_printer();
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed = 0u32;
    let mut count = 0u32;
    unsafe {
        let _ = EnumPrintersW(flags, PCWSTR::null(), 4, None, &mut needed, &mut count);
        if needed == 0 {
            return Ok(Vec::new());
        }
        // u64 storage keeps the PRINTER_INFO_4W records aligned.
        let mut buf = vec![0u64; (needed as usize).div_ceil(8)];
        let bytes = std::slice::from_raw_parts_mut(buf.as_mut_ptr() as *mut u8, needed as usize);
        EnumPrintersW(flags, PCWSTR::null(), 4, Some(bytes), &mut needed, &mut count).map_err(|e| format!("Could not list printers: {e}"))?;
        let infos = std::slice::from_raw_parts(buf.as_ptr() as *const PRINTER_INFO_4W, count as usize);
        let mut v: Vec<PrinterInfo> = infos
            .iter()
            .filter(|i| !i.pPrinterName.is_null())
            .map(|i| {
                let name = i.pPrinterName.to_string().unwrap_or_default();
                PrinterInfo { is_default: default.as_deref() == Some(name.as_str()), name }
            })
            .collect();
        v.sort_by_key(|p| !p.is_default);
        Ok(v)
    }
}

pub fn default_printer() -> Option<String> {
    let mut len = 0u32;
    unsafe {
        let _ = GetDefaultPrinterW(None, &mut len);
        if len == 0 {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        if GetDefaultPrinterW(Some(PWSTR(buf.as_mut_ptr())), &mut len).as_bool() {
            Some(from_wide(&buf))
        } else {
            None
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Bin {
    pub id: i16,
    pub name: String,
}

/// Unprintable margins in millimetres.
#[derive(Serialize, Clone, Copy, Debug, Default)]
pub struct Margins {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub papers: Vec<Paper>,
    pub bins: Vec<Bin>,
    pub duplex: bool,
    pub collate: bool,
    pub colour: bool,
    pub max_copies: u32,
    /// The driver's current paper and orientation.
    pub default_paper: Option<i16>,
    pub default_landscape: bool,
}

fn caps_count(name: &[u16], cap: PRINTER_DEVICE_CAPABILITIES, dm: Option<&DevMode>) -> i32 {
    unsafe { DeviceCapabilitiesW(PCWSTR(name.as_ptr()), PCWSTR::null(), cap, None, dm.map(|d| d.ptr())) }
}

fn caps_fill<T: Copy + Default>(name: &[u16], cap: PRINTER_DEVICE_CAPABILITIES, per: usize, n: usize, dm: Option<&DevMode>) -> Vec<T> {
    let mut v = vec![T::default(); n * per + per];
    unsafe {
        DeviceCapabilitiesW(PCWSTR(name.as_ptr()), PCWSTR::null(), cap, Some(PWSTR(v.as_mut_ptr() as *mut u16)), dm.map(|d| d.ptr()));
    }
    v.truncate(n * per);
    v
}

pub fn capabilities(printer: &str) -> Result<Capabilities, String> {
    let name = wide(printer);
    let dm = DevMode::default_for(printer)?;
    let n = caps_count(&name, DC_PAPERS, Some(&dm));
    if n < 0 {
        return Err(format!("Could not read the capabilities of {printer}"));
    }
    let n = n as usize;
    let ids: Vec<u16> = caps_fill(&name, DC_PAPERS, 1, n, Some(&dm));
    let names: Vec<u16> = caps_fill(&name, DC_PAPERNAMES, 64, n, Some(&dm));
    // POINT pairs in tenths of a millimetre.
    let sizes: Vec<i32> = caps_fill(&name, DC_PAPERSIZE, 2, n, Some(&dm));
    let papers = (0..n)
        .map(|i| Paper {
            id: ids[i] as i16,
            name: from_wide(&names[i * 64..(i + 1) * 64]),
            w: sizes[i * 2] as f64 / 10.0,
            h: sizes[i * 2 + 1] as f64 / 10.0,
        })
        .filter(|p| p.w > 0.0 && p.h > 0.0)
        .collect();
    let nb = caps_count(&name, DC_BINS, Some(&dm)).max(0) as usize;
    let bin_ids: Vec<u16> = caps_fill(&name, DC_BINS, 1, nb, Some(&dm));
    let bin_names: Vec<u16> = caps_fill(&name, DC_BINNAMES, 24, nb, Some(&dm));
    let bins = (0..nb).map(|i| Bin { id: bin_ids[i] as i16, name: from_wide(&bin_names[i * 24..(i + 1) * 24]) }).collect();
    let f = dm.fields();
    Ok(Capabilities {
        papers,
        bins,
        duplex: caps_count(&name, DC_DUPLEX, Some(&dm)) == 1,
        collate: caps_count(&name, DC_COLLATE, Some(&dm)) == 1,
        colour: caps_count(&name, DC_COLORDEVICE, Some(&dm)) == 1,
        max_copies: caps_count(&name, DC_COPIES, Some(&dm)).max(1) as u32,
        default_paper: Some(f.dmPaperSize),
        default_landscape: f.dmOrientation == DMORIENT_LANDSCAPE as i16,
    })
}

/// The unprintable margins for a paper and orientation, from an information context.
pub fn margins(printer: &str, paper: Option<i16>, landscape: bool) -> Result<Margins, String> {
    let mut dm = DevMode::current(printer)?;
    dm.set_paper(paper, landscape);
    let name = wide(printer);
    unsafe {
        let ic = CreateICW(PCWSTR::null(), PCWSTR(name.as_ptr()), PCWSTR::null(), Some(dm.ptr()));
        if ic.is_invalid() {
            return Err(format!("Could not query {printer}"));
        }
        let g = Geometry::of(ic);
        let _ = DeleteDC(ic);
        Ok(g.margins_mm())
    }
}

/// A DEVMODE with its driver-private tail, as DocumentProperties returns it.
pub struct DevMode {
    buf: Vec<u64>,
}

impl DevMode {
    fn default_for(printer: &str) -> Result<DevMode, String> {
        Self::current(printer)
    }

    /// The printer's current settings (or the ones last chosen in its properties dialog).
    pub fn current(printer: &str) -> Result<DevMode, String> {
        if let Some(bytes) = saved_devmode(printer) {
            return Ok(DevMode::from_bytes(&bytes));
        }
        let name = wide(printer);
        unsafe {
            let mut h = PRINTER_HANDLE::default();
            OpenPrinterW(PCWSTR(name.as_ptr()), &mut h, None).map_err(|e| format!("Could not open {printer}: {e}"))?;
            let size = DocumentPropertiesW(None, h, PCWSTR(name.as_ptr()), None, None, 0);
            if size <= 0 {
                let _ = ClosePrinter(h);
                return Err(format!("Could not read the settings of {printer}"));
            }
            let mut dm = DevMode { buf: vec![0u64; (size as usize).div_ceil(8)] };
            let r = DocumentPropertiesW(None, h, PCWSTR(name.as_ptr()), Some(dm.ptr_mut()), None, DM_OUT_BUFFER.0);
            let _ = ClosePrinter(h);
            if r != IDOK {
                return Err(format!("Could not read the settings of {printer}"));
            }
            Ok(dm)
        }
    }

    fn from_bytes(b: &[u8]) -> DevMode {
        let mut buf = vec![0u64; b.len().div_ceil(8)];
        unsafe { std::ptr::copy_nonoverlapping(b.as_ptr(), buf.as_mut_ptr() as *mut u8, b.len()) };
        DevMode { buf }
    }

    fn bytes(&self) -> Vec<u8> {
        let d = self.dm();
        let len = d.dmSize as usize + d.dmDriverExtra as usize;
        unsafe { std::slice::from_raw_parts(self.buf.as_ptr() as *const u8, len).to_vec() }
    }

    fn ptr(&self) -> *const DEVMODEW {
        self.buf.as_ptr() as *const DEVMODEW
    }
    fn ptr_mut(&mut self) -> *mut DEVMODEW {
        self.buf.as_mut_ptr() as *mut DEVMODEW
    }
    fn dm(&self) -> &DEVMODEW {
        unsafe { &*self.ptr() }
    }
    fn dm_mut(&mut self) -> &mut DEVMODEW {
        unsafe { &mut *self.ptr_mut() }
    }
    fn fields(&self) -> DEVMODEW_0_0 {
        unsafe { self.dm().Anonymous1.Anonymous1 }
    }
    fn fields_mut(&mut self) -> &mut DEVMODEW_0_0 {
        unsafe { &mut self.dm_mut().Anonymous1.Anonymous1 }
    }

    fn set_paper(&mut self, paper: Option<i16>, landscape: bool) {
        let f = self.fields_mut();
        if let Some(p) = paper {
            f.dmPaperSize = p;
        }
        f.dmOrientation = if landscape { DMORIENT_LANDSCAPE } else { DMORIENT_PORTRAIT } as i16;
        let d = self.dm_mut();
        d.dmFields |= DM_ORIENTATION;
        if paper.is_some() {
            d.dmFields |= DM_PAPERSIZE;
            // A form name or explicit dimensions would override the paper id on some drivers.
            d.dmFields &= !(DM_PAPERLENGTH | DM_PAPERWIDTH | DEVMODE_FIELD_FLAGS(0x10000));
        }
    }
}

/// Settings chosen in a printer's own properties dialog, by printer name, for this session.
fn devmodes() -> &'static std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>> {
    static M: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, Vec<u8>>>> = std::sync::OnceLock::new();
    M.get_or_init(Default::default)
}

fn saved_devmode(printer: &str) -> Option<Vec<u8>> {
    devmodes().lock().unwrap().get(printer).cloned()
}

/// Open the driver's own properties dialog, owned by `hwnd`. True if the user pressed OK
/// (the settings are then used for this printer until the app closes).
pub fn properties_dialog(hwnd: isize, printer: &str) -> Result<bool, String> {
    let mut dm = DevMode::current(printer)?;
    let name = wide(printer);
    unsafe {
        let mut h = PRINTER_HANDLE::default();
        OpenPrinterW(PCWSTR(name.as_ptr()), &mut h, None).map_err(|e| format!("Could not open {printer}: {e}"))?;
        let mut out = DevMode { buf: dm.buf.clone() };
        let r = DocumentPropertiesW(
            Some(HWND(hwnd as *mut _)),
            h,
            PCWSTR(name.as_ptr()),
            Some(out.ptr_mut()),
            Some(dm.ptr_mut()),
            (DM_IN_PROMPT | DM_IN_BUFFER | DM_OUT_BUFFER).0,
        );
        let _ = ClosePrinter(h);
        if r == IDOK {
            devmodes().lock().unwrap().insert(printer.to_string(), out.bytes());
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

/// A printer DC's geometry, in device pixels.
#[derive(Clone, Copy, Debug)]
struct Geometry {
    dpi_x: f64,
    dpi_y: f64,
    phys_w: i32,
    phys_h: i32,
    off_x: i32,
    off_y: i32,
    print_w: i32,
    print_h: i32,
}

impl Geometry {
    unsafe fn of(dc: HDC) -> Geometry {
        unsafe {
            let c = |i| GetDeviceCaps(Some(dc), i);
            Geometry {
                dpi_x: c(LOGPIXELSX).max(1) as f64,
                dpi_y: c(LOGPIXELSY).max(1) as f64,
                phys_w: c(PHYSICALWIDTH),
                phys_h: c(PHYSICALHEIGHT),
                off_x: c(PHYSICALOFFSETX),
                off_y: c(PHYSICALOFFSETY),
                print_w: c(HORZRES),
                print_h: c(VERTRES),
            }
        }
    }
    fn margins_mm(&self) -> Margins {
        let mx = 25.4 / self.dpi_x;
        let my = 25.4 / self.dpi_y;
        Margins {
            left: self.off_x as f64 * mx,
            top: self.off_y as f64 * my,
            right: (self.phys_w - self.print_w - self.off_x).max(0) as f64 * mx,
            bottom: (self.phys_h - self.print_h - self.off_y).max(0) as f64 * my,
        }
    }
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Duplex {
    #[default]
    None,
    LongEdge,
    ShortEdge,
}

#[derive(Deserialize, Serialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum Quality {
    Image300,
    #[default]
    Image600,
    Vector,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SendOptions {
    pub printer: String,
    #[serde(default = "one")]
    pub copies: u32,
    #[serde(default)]
    pub collate: bool,
    #[serde(default)]
    pub duplex: Duplex,
    #[serde(default)]
    pub colour: ColourMode,
    #[serde(default)]
    pub quality: Quality,
    /// Paper for sheets whose size no printer paper matches.
    #[serde(default)]
    pub paper: Option<i16>,
    /// Let the driver pick the tray from each sheet's paper size.
    #[serde(default)]
    pub tray_by_size: bool,
    #[serde(default)]
    pub bin: Option<i16>,
    #[serde(default)]
    pub reverse: bool,
    #[serde(default)]
    pub title: String,
    /// Print to this file (drivers that write files, e.g. Microsoft Print to PDF) instead of
    /// asking. Tests use it.
    #[serde(default)]
    pub output_file: Option<String>,
}

fn one() -> u32 {
    1
}

static CANCEL: AtomicBool = AtomicBool::new(false);

/// Ask the job being sent to stop after the current band.
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

/// Send a composed job (its PDF bytes and sheet sizes in points) to a printer. Blocking.
/// `progress(done, total)` is called after each sheet.
pub fn send(pdf: &PdfiumState, bytes: Arc<Vec<u8>>, sheets: &[(f64, f64)], o: &SendOptions, mut progress: impl FnMut(usize, usize)) -> Result<(), String> {
    // One job at a time: Microsoft Print to PDF silently lost one of three jobs sent from
    // this process at once (it wrote an empty file), and nobody needs two prints interleaved.
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _turn = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    CANCEL.store(false, Ordering::SeqCst);
    let caps = capabilities(&o.printer)?;
    let renderer = SheetRenderer::open(pdf, bytes)?;
    let mut dm = DevMode::current(&o.printer)?;
    {
        let copies = o.copies.clamp(1, 999);
        let driver_copies = copies <= caps.max_copies;
        let f = dm.fields_mut();
        f.dmCopies = if driver_copies { copies as i16 } else { 1 };
        if o.tray_by_size {
            f.dmDefaultSource = DMBIN_AUTO as i16;
        } else if let Some(b) = o.bin {
            f.dmDefaultSource = b;
        }
        let d = dm.dm_mut();
        d.dmFields |= DM_COPIES;
        if o.tray_by_size || o.bin.is_some() {
            d.dmFields |= DM_DEFAULTSOURCE;
        }
        d.dmCollate = if o.collate { DMCOLLATE_TRUE } else { DEVMODE_COLLATE(0) };
        d.dmFields |= DM_COLLATE;
        if caps.duplex {
            d.dmDuplex = match o.duplex {
                Duplex::None => DMDUP_SIMPLEX,
                Duplex::LongEdge => DMDUP_VERTICAL,
                Duplex::ShortEdge => DMDUP_HORIZONTAL,
            };
            d.dmFields |= DM_DUPLEX;
        }
        if caps.colour {
            d.dmColor = if o.colour == ColourMode::Colour { DMCOLOR_COLOR } else { DMCOLOR_MONOCHROME };
            d.dmFields |= DM_COLOR;
        }
    }
    // Copies the driver can't do itself are sent as repeated sheets.
    let manual_copies = if o.copies > caps.max_copies { o.copies.clamp(1, 999) as usize } else { 1 };
    let mut order: Vec<usize> = (0..sheets.len()).collect();
    if o.reverse {
        order.reverse();
    }
    let order: Vec<usize> = if manual_copies > 1 {
        if o.collate {
            (0..manual_copies).flat_map(|_| order.iter().copied()).collect()
        } else {
            order.iter().flat_map(|&i| std::iter::repeat_n(i, manual_copies)).collect()
        }
    } else {
        order
    };

    let paper_for = |w: f64, h: f64| -> (Option<i16>, bool) {
        match job::match_paper(&caps.papers, w * job::MM_PER_PT, h * job::MM_PER_PT) {
            Some((id, land)) => (Some(id), land),
            None => (o.paper.or(caps.default_paper), w > h),
        }
    };

    let name = wide(&o.printer);
    let (first_paper, first_land) = sheets.get(order[0]).map(|&(w, h)| paper_for(w, h)).unwrap_or((None, false));
    dm.set_paper(first_paper, first_land);
    let dc = unsafe { CreateDCW(PCWSTR::null(), PCWSTR(name.as_ptr()), PCWSTR::null(), Some(dm.ptr())) };
    if dc.is_invalid() {
        return Err(format!("Could not start printing on {}", o.printer));
    }
    struct Dc(HDC);
    impl Drop for Dc {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteDC(self.0);
            }
        }
    }
    let dc = Dc(dc);
    let title = wide(if o.title.is_empty() { "Vellum" } else { &o.title });
    let out = o.output_file.as_deref().map(wide);
    let di = DOCINFOW {
        cbSize: std::mem::size_of::<DOCINFOW>() as i32,
        lpszDocName: PCWSTR(title.as_ptr()),
        lpszOutput: out.as_ref().map_or(PCWSTR::null(), |v| PCWSTR(v.as_ptr())),
        lpszDatatype: PCWSTR::null(),
        fwType: 0,
    };
    if unsafe { StartDocW(dc.0, &di) } <= 0 {
        return Err(format!("{} refused the print job", o.printer));
    }
    let r = (|| -> Result<(), String> {
        let mut current = (first_paper, first_land);
        for (n, &si) in order.iter().enumerate() {
            let (sw, sh) = sheets[si];
            let want = paper_for(sw, sh);
            if want != current {
                dm.set_paper(want.0, want.1);
                if unsafe { ResetDCW(dc.0, dm.ptr()) }.is_invalid() {
                    return Err("The printer refused a paper size change".into());
                }
                current = want;
            }
            if unsafe { StartPage(dc.0) } <= 0 {
                return Err("The printer refused a page".into());
            }
            let g = unsafe { Geometry::of(dc.0) };
            let res = print_sheet(&renderer, si, sw, sh, dc.0, &g, o);
            renderer.release();
            res?;
            if unsafe { EndPage(dc.0) } <= 0 {
                return Err("The printer refused a page".into());
            }
            progress(n + 1, order.len());
        }
        Ok(())
    })();
    match r {
        Ok(()) => {
            if unsafe { EndDoc(dc.0) } <= 0 {
                return Err("The printer did not finish the job".into());
            }
            Ok(())
        }
        Err(e) => {
            unsafe { AbortDoc(dc.0) };
            Err(e)
        }
    }
}

fn print_sheet(r: &SheetRenderer, si: usize, sw: f64, sh: f64, dc: HDC, g: &Geometry, o: &SendOptions) -> Result<(), String> {
    // Sheet points to device pixels. The sheet is the paper, so a sheet that doesn't match
    // the paper exactly is centred on it (it shouldn't happen: the layout uses the paper).
    let sx = g.dpi_x / 72.0;
    let sy = g.dpi_y / 72.0;
    let dev_w = (sw * sx).round() as i32;
    let dev_h = (sh * sy).round() as i32;
    let ox = (g.phys_w - dev_w) / 2 - g.off_x;
    let oy = (g.phys_h - dev_h) / 2 - g.off_y;
    if o.quality == Quality::Vector {
        let mut flags = FPDF_PRINTING;
        if o.colour != ColourMode::Colour {
            flags |= FPDF_GRAYSCALE;
        }
        return r.render_to_dc(si, dc.0 as usize, ox, oy, dev_w, dev_h, flags);
    }
    let dpi = if o.quality == Quality::Image300 { 300.0 } else { 600.0 };
    let (rw, rh) = job::sheet_pixels(sw, sh, dpi);
    // The printable area in raster pixels: only that part is rendered and sent.
    let to_raster_x = |dev: i32| (dev - ox) as f64 * rw as f64 / dev_w as f64;
    let to_raster_y = |dev: i32| (dev - oy) as f64 * rh as f64 / dev_h as f64;
    let area = Rect::new(to_raster_x(0), to_raster_y(0), to_raster_x(g.print_w), to_raster_y(g.print_h))
        .intersect(&Rect::new(0.0, 0.0, rw as f64, rh as f64));
    let Some(area) = area else { return Ok(()) };
    let (x0, x1) = (area.x0.floor() as i32, area.x1.ceil() as i32);
    let (y0, y1) = (area.y0.floor() as i32, area.y1.ceil() as i32);
    let bw = x1 - x0;
    unsafe { SetStretchBltMode(dc, HALFTONE) };
    let to_dev_x = |px: i32| ox + (px as f64 * dev_w as f64 / rw as f64).round() as i32;
    let to_dev_y = |py: i32| oy + (py as f64 * dev_h as f64 / rh as f64).round() as i32;
    for (y, h) in job::bands(y0, y1, BAND_ROWS) {
        if CANCEL.load(Ordering::SeqCst) {
            return Err("Printing cancelled".into());
        }
        let mut px = r.render_band(si, rw, rh, x0, y, bw, h, FPDF_PRINTING)?;
        job::apply_colour(&mut px, o.colour);
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: bw,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let (dx0, dx1) = (to_dev_x(x0), to_dev_x(x1));
        let (dy0, dy1) = (to_dev_y(y), to_dev_y(y + h));
        let n = unsafe {
            StretchDIBits(dc, dx0, dy0, dx1 - dx0, dy1 - dy0, 0, 0, bw, h, Some(px.as_ptr() as *const _), &bmi, DIB_RGB_COLORS, SRCCOPY)
        };
        if n == 0 {
            return Err("The printer refused the image data".into());
        }
    }
    Ok(())
}
