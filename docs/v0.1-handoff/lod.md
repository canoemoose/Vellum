# WP-LOD handoff: image level of detail (prototype)

Built by the integrator session itself (worker sessions couldn't be started overnight; see
the report). Time-boxed to one evening, as the brief asked.

## Result: negative. The code stays, off by default, behind `VELLUM_IMAGE_LOD=1`

The prototype works as designed and still makes the aerial drawing **slower**, so it's off.

| projectlayoutmarch2021.pdf, 3 runs, 8 threads | LOD off | LOD on |
|---|---:|---:|
| First page (ms) | 3333 | 11348 |
| Fit, settle to sharp (ms) | 1051 | 5854 |
| 400%, settle (ms) | 150 | 366 |
| 1600%, settle (ms) | 143 | 119 |
| Peak memory (MB) | 2638 | 5093 |

One-run sanity checks with the final build: aerial with the flag off 3367 ms first page and
1070 ms fit settle (unchanged); the stage plan with the flag on 630 ms first page and 128 ms
fit settle (no images, so untouched). These were measured on a machine also building other
branches; compare the two columns with each other, not with RESULTS.md.

## What it does

`src-tauri/src/pdfium_lod.rs`. On the first render of a page, each PDFium worker looks at the
page's image objects. Images with a single DCTDecode filter, at least 512 px on each side, in
grey or RGB, are candidates. If they add up to 16 MP or more, the page counts as image-heavy:
their raw JPEG streams (`FPDFImageObj_GetImageDataRaw`) are decoded once at 1/8 size with
scaled IDCT and shared by every worker. Each worker then opens a **second handle on the same
file**, loads the page from it and swaps every candidate image for its reduced copy
(`FPDFImageObj_SetBitmap`). Strip renders at or below the page's threshold (where the 1/8
copy still has one pixel per device pixel; 1.16 device px per point on the aerial file) use
the reduced page, and sharper renders use the original, so zooming in never shows reduced
images.

The second document is needed because PDFium shares one image object per image stream
across a document, and `SetBitmap` rewrites it: swapping on a second copy of the page in the
same document would blur the original as well.

Hooks in `pdfium.rs` (each line marked `// WP-LOD`): `on_open` after a document opens,
`on_close` before it closes, `page_for_render` in `render_strip`. Plus `pub mod pdfium_lod;`
in `lib.rs`.

## Why it lost

With PDFium timing on (`VELLUM_PDFIUM_TIMING=1`):

- PDFium is already cheaper at small scales than RESULTS.md suggested: with LOD off the
  fit-scale strips render in 160 to 1180 ms each. The 3.3 s first page is mostly waiting for
  the slowest of the parallel strips, which is what WP-Engine's progressive paint fixes.
- Building the reduced page costs about 1 s **per worker** (8 workers, each its own second
  document and 726 `SetBitmap` calls), all competing for the CPU while the first page renders.
- Strips rendered from the swapped page took 1.5 to 7.7 s, slower than the originals. I
  didn't get to the bottom of that inside the time box. The likely cause is that
  `SetBitmap` stores each image as an uncompressed 24-bit stream that PDFium re-converts for
  every band on every worker, without the image cache the original JPEGs get.
- Memory doubled: eight second documents with 726 rewritten images each, on top of the
  originals.

## If someone picks it up again

- Do the reduction once, not per worker: build a reduced PDF in memory once (save the
  swapped document with `FPDF_SaveAsCopy`), then open it on every worker like any other
  document.
- Or skip PDFium for this case: for pages that are just a grid of JPEG tiles, decode the
  tiles at 1/8 and composite them ourselves, as the image documents do.
- Measure again after progressive paint has landed: the first band may already be fast
  enough that this isn't worth it.

## Tests

`src-tauri/tests/lod.rs`: thresholds, eligibility, page threshold, the 1/8 decode (sizes,
grey, odd sizes, garbage) and the BGRx conversion. 7 tests. `image` is a dev-dependency here
for building test JPEGs (WP-Images adds it as a normal dependency).

## ARCHITECTURE.md text (for the integrator to fold in)

### Image level of detail (experimental, off)

`pdfium_lod.rs` can render image-heavy pages from a second handle on the file whose large
JPEGs are swapped for 1/8 decodes, below a per-page scale threshold. It's off unless
`VELLUM_IMAGE_LOD=1` because it measured slower and used twice the memory on the aerial
drawing (see `docs/v0.1-handoff/lod.md`).

| Crate | Why |
|---|---|
| `jpeg-decoder` 0.3 (no default features) | Scaled-IDCT JPEG decode at 1/8 for the LOD prototype. Pure Rust, so it builds on the GNU toolchain with no NASM or CMake (`mozjpeg-sys` and `turbojpeg` weren't tried for that reason). MIT/Apache. |
