# WP-Images handoff

**Status (26 November 2026): a hand-over note from v0.1 (8 November), kept as a record.** How
things work now is in [ARCHITECTURE.md](../../ARCHITECTURE.md); known problems nobody has gone
back to are indexed in [backlog.md](../backlog.md).

Built by the integrator session itself: the app refused to start a separate worker session
or subagent overnight (see the report), and this package was small and self-contained.

## What was built

- `src-tauri/src/imagedoc.rs`: image documents behind the `doc_*` commands, replacing
  WP-Engine's stub without changing its signatures. JPEG, PNG, WebP, TIFF, BMP and GIF (first
  frame) through the `image` crate; region renders cropped and resampled with
  `fast_image_resize`.
- `src-tauri/tests/imagedoc.rs`: 34 tests (geometry, DPI parsing, decode and render) plus an
  ignored `write_fixture_images` that writes a set of manual test images.
- `src/lib/render/imageRenderer.ts` is unchanged: WP-Engine's thin `BackendRenderer` wrapper
  already does everything, since the Rust side dispatches on kind.

## Decisions and assumptions

- Page size uses the embedded DPI exactly as the brief says, even the meaningless 72 DPI most
  cameras write: a 4000 px phone photo at 72 DPI opens 55 inches wide. Fit page hides it;
  actual size and 100% printing show it. Worth a decision (see questions).
- DPI sources, in order: JPEG EXIF, then JFIF density; PNG pHYs (metre unit only); TIFF
  XResolution/YResolution with ResolutionUnit (missing unit = inches, "none" = ignored); BMP
  pixels per metre; WebP EXIF chunk. Values outside 10 to 50,000 DPI are ignored.
- EXIF orientation is applied at open; a quarter turn swaps the X and Y DPI too.
- Transparency is flattened onto white at open (pages always render on white).
- Levels of detail: the full image and a quarter-size copy (a quarter of each side). A render
  uses the quarter level whenever it still has at least one source pixel per device pixel.
  Filter: bilinear convolution for both down- and upscaling.
- Over 120 MP: the decoded image is halved before the quarter level is built; the page size
  still comes from the original pixel size, so actual size stays right. Peak memory during that
  open is the full decode (about 4 bytes per pixel) plus the half copy; there's no
  decode-at-reduced-size for JPEG in the `image` crate.
- Decoding runs on Tauri's blocking pool (WP-Engine's `doc_open` uses `spawn_blocking`), never
  on a PDFium worker, so a big image doesn't hold up PDF renders.
- Errors: unknown content is "Not a PDF or supported image"; a damaged file says "This image
  looks damaged and couldn't be decoded (...)"; an unsupported variant says "This image uses a
  format Vellum can't read yet (...)".
- File association list unchanged from WP-Engine's stub: .jpg .jpeg .png .webp .tif .tiff
  .bmp .gif.
- HEIC skipped: Windows Imaging Component through the `windows` crate on this GNU toolchain
  was more than an hour's work with real build risk, and most HEIC on Windows needs a Store
  codec anyway.

## ARCHITECTURE.md text (for the integrator to fold in)

### Images

Image files open as one-page documents through the same `doc_*` commands as PDFs;
`docs.rs` routes them to `imagedoc.rs` by extension (or content sniffing for unknown
extensions). `ImageDoc::open` decodes once on Tauri's blocking pool with the `image` crate,
applies the EXIF orientation, flattens alpha onto white and keeps two levels in memory: full
size and a quarter-size copy (each side divided by four). The page size is the pixel size at
the file's embedded DPI (EXIF/JFIF, PNG pHYs, TIFF resolution tags, BMP header, WebP EXIF),
96 DPI if none, so actual size and 100% printing are right. A region render picks the smaller
level when it still has a source pixel per device pixel, maps the device-pixel region to a
fractional source rectangle (`imagedoc::geom::map_region`, which clips the parts off the page
and the half-pixel past the page's exact extent) and resamples just that with
`fast_image_resize` (bilinear convolution). Streaming sends an image region as one band.
Images over 120 megapixels are kept at half resolution, page size unchanged, and
`DocMeta.note` says so for the tab.

Dependencies (for the table):

| Crate | Why |
|---|---|
| `image` 0.25 (jpeg, png, webp, tiff, bmp, gif features only) | Decodes image documents, including EXIF orientation, 16-bit and CMYK JPEG. MIT/Apache. |
| `fast_image_resize` 5 | SIMD crop-and-resample of image regions, the same job PDFium's renderer does for PDFs. MIT/Apache. |

## Verification

- `cargo test` (all suites) green; `npm test` and `npm run check` green (no TypeScript change).
- Release exe run in bench mode (`--runs 1`) on both test PDFs and the generated images
  (`write_fixture_images`). Every file opened with no render errors and panned at 60 fps:

| File | Opens as | Open (ms) | Fit settle (ms) | Peak private memory (MB) |
|---|---|---:|---:|---:|
| photo, 4000 x 3000 JPEG, EXIF rotate 90, 300 dpi | 720 x 960 pt (turned, right DPI) | 64 | 32 | 705 |
| 16-bit PNG, 2000 x 1500, 200 dpi | 720 x 540 pt | 29 | 45 | 155 |
| transparent PNG, 800 x 600 | 600 x 450 pt (96 dpi) | 6 | 38 | 217 |
| animated GIF | 300 x 225 pt, first frame | 5 | 40 | 135 |
| TIFF / BMP / WebP, 1200 x 900 | 900 x 675 pt | 8 / 9 / 6 | 38 / 38 / 35 | 655 / 720 / 660 |
| JPEG 13000 x 10000 (130 MP) | 9750 x 7500 pt, half resolution, note shown | 409 | 46 | 749 |
| text file named .png | refused: "Not a PDF or supported image" | | | |

  Both PDFs still open and render as before (aerial fit settle 763 ms, the stage plan 143 ms; one run
  on a machine also building other branches, so not benchmark figures).

## What couldn't be verified

- CMYK JPEGs: no CMYK encoder here to make one. The `image` crate's decoder converts CMYK
  to RGB; untested.
- Multi-page TIFF: the `image` crate's encoder can't write one. The decoder reads the first
  page; there is no "showing page 1 of N" note.
- How it looks: page sizes and orientation were checked numerically, not by eye.

## Known problems

- Opening a very large image costs the full decode in memory first (a 200 MP JPEG briefly
  needs about 1 GB) before the half-resolution copy replaces it.
- No progress while a big image decodes; the tab just waits.
