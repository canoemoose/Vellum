# Bayou image fix: scope (10 November 2026)

## Objective

Make pages dominated by one huge JPEG fast. Bayou Towers page 1 (a 6144 × 3976 colour scan,
24 MP) costs PDFium about 4.15 s on **every** render, at any zoom: about 7.4 s settle→sharp in
real use, hidden at open only by the stored preview. Deep 400% tiles cost 0.75 to 1.5 s each.
Target: sharp at fit in well under 0.5 s on first visit, and zoomed renders in tens of
milliseconds, with colour that looks the same as today.

Background: [v0.1-heavy-pdfs.md](v0.1-heavy-pdfs.md) (ideas 1, 2 and 5) and the LOD prototype
write-up in [v0.1-handoff/lod.md](v0.1-handoff/lod.md).

## What's already known

- The JPEG data isn't slow; PDFium's image pipeline is. A throwaway probe on 8 Nov decoded
  the image once with `FPDFImageObj_GetBitmap` (4.1 s) and swapped the plain bitmap into a
  second handle on the page with `FPDFImageObj_SetBitmap`: fit render 37 ms, 400% tile 14 ms,
  fit with a ⅛ copy 3 ms.
- `jpeg-decoder` (already a dependency) decodes with scaled IDCT at ⅛, ¼, ½ or full size;
  it did this page at ⅛ in 59 ms.
- `src-tauri/src/pdfium_lod.rs` (off unless `VELLUM_IMAGE_LOD=1`) already has the mechanism:
  find eligible DCTDecode images, decode them once in a process-wide cache, swap them into a
  per-worker second document. It lost on the aerial file (731 tiles of about 1 MP: building
  the swapped page per worker cost more than it saved). Bayou is the opposite case: one
  image, so one `SetBitmap`.
- Pages whose image covers over a quarter of the page already render as one band on
  `page % workers` (`bands_for_page`), so only one worker would hold the swapped copy.

## Probe results (step 1, 10 November)

Throwaway `#[ignore]` test on Bayou page 1, release build, since deleted.

- **The page is one image and nothing else:** a single object, 6144 × 3976, 24-bit,
  DCTDecode only, covering the whole 2212 × 1431 pt page.
- **Colour space is ICCBased**, and the profile lives in the PDF, not the JPEG (no
  `ICC_PROFILE` or Adobe marker in the stream). It's a 188 KB HP Designjet T2300 scanner
  profile with a Lab connection space, so it's a big lookup table. Converting 24 MP through
  that is almost certainly PDFium's 4 s, every render.
- **Our decode is quick at every size:** ⅛ 54 ms, ¼ 56 ms, ½ 65 ms, **full 78 ms**
  (`jpeg-decoder`). PDFium's `GetBitmap` of the same image: 4,163 ms.
- **Ignoring the profile is visibly wrong:** our plain decode against PDFium differs by 17 to
  25 levels per channel on average, 70% of samples more than 8 off. It would look lighter and
  washed out.
- **Applying the profile with `moxcms` matches PDFium:** ICC → sRGB in 60 ms on one thread;
  mean difference R 0.16, G 0.74, B 1.06 levels, 0.12% of samples more than 8 off, max 28.
  `moxcms` 0.8.1 is already in the build (through `image`), pure Rust, so it adds no new
  download or toolchain risk. PDFium gives us the profile with
  `FPDFImageObj_GetIccProfileDataDecoded`.

- **Rendering intent makes no difference for this profile:** its A2B0, A2B1 and A2B2 tags
  all point at the same table, and perceptual, relative colorimetric, saturation and
  absolute colorimetric all gave identical pixels in `moxcms`. Matt's comparison by eye
  showed Acrobat lighter and more cyan, Foxit darker and richer, and Vellum between them.
  Ruled out by Matt's eye and the profile: the display path (plain vector navy matches
  Acrobat), ignoring the profile (much worse), black-point compensation (the profile's
  `bkpt` is 0, 0, 0, so it changes nothing), and absolute colorimetric from the profile's
  bluish media white (0.801, 0.823, 0.766). Untried: the profile's matrix-and-curves tags
  (`rXYZ`, `rTRC`) instead of its lookup table. Adobe's colour engine is closed, so this is
  **parked**: the speed fix keeps PDFium's colours, and matching Acrobat is a separate task.

So: **about 140 ms once per image (decode plus colour), against 4.2 s per render today.**
No levels needed: decode at full size and keep it.

### The aerial drawing checked too (10 November)

Throwaway probe on `projectlayoutmarch2021.pdf`, since deleted. Our decode wouldn't help it:

- One page, 746 × 14400 pt, **327,207 objects**: 280,109 paths, 46,202 text objects,
  896 images.
- The images: 730 DeviceRGB JPEG tiles of about 1 MP (no ICC profile) and 166 Indexed
  8-bit Flate images. No huge JPEGs, so nothing takes the new path.
- PDFium decodes a sample tile in 1.5 ms; ours takes 2.3 ms. Without a profile PDFium's
  JPEG path is fine.
- A whole-page render takes 1.3 to 2.4 s even at 50 × 965 px, so the cost is walking the
  327,000 vector and text objects, not the images. That's a different problem (fewer
  objects per render: bands by object count, or a cached display list).

## Approach

Reuse the LOD module, retargeted from "many JPEG tiles" to "one huge JPEG":

1. **Which images:** a single DCTDecode filter, grey, RGB or ICC-based, at least 16 MP **on
   its own**. That takes Bayou page 1 and leaves the aerial file's tiles alone, so the aerial
   result doesn't regress.
2. **Decode ourselves** at full size instead of PDFium, once per image, shared across
   workers. For ICC-based images, convert to sRGB with `moxcms` from the profile PDFium
   reports; if the profile won't parse or the transform fails, leave the image to PDFium.
3. **Swap it in** on a second handle of the page and render from that at every zoom (PDFium's
   own path for this image is never used once the swap exists).
4. ~~Levels~~: not needed, the full decode is 78 ms.

Out of scope: JBIG2 pages 2 to 13 (0.7 s first render per worker, then 25 ms; already on one
worker), banding big-image pages (idea 5: not needed if fit renders in tens of ms), the
aerial file, CMYK JPEGs (fall back to PDFium).

## Files in play

- `src-tauri/src/pdfium_lod.rs`: eligibility, decode, swap; the env flag goes for this case.
- `src-tauri/src/pdfium.rs`: the existing `// WP-LOD` hooks; possibly `bands_for_page`.
- `src-tauri/tests/lod.rs`: unit tests for the new rules and decode levels.
- A new Rust integration test against a generated PDF with one large JPEG.
- Docs: this file, the speed handoff, ARCHITECTURE.md.

## Steps

1. *Done, see Probe results.* **Probe** (throwaway `#[ignore]` test, deleted afterwards): on Bayou page 1, report the
   image's filters, colour space (and whether it's ICC), the other objects on the page, our
   decode time at ⅛ / ¼ / ½ / full, and how far our decoded pixels differ from PDFium's
   `GetBitmap`. Decides levels or not, and whether ICC needs handling.
2. *Done.* Pure helpers and their tests (`tests/lod.rs`): `huge_eligible`, `decode_full`,
   `icc_to_srgb` (sRGB profile is a no-op, a Display P3 profile moves colour but not grey,
   bad profiles and grey images are refused untouched).
3. *Done.* Built in `pdfium_lod.rs`, on by default for huge JPEGs only; the ⅛ path stays
   behind `VELLUM_IMAGE_LOD`. The ICC conversion runs a chunk of rows per core.
   `tests/huge_jpeg.rs` renders a generated two-page PDF (4096 × 4000 JPEG, ICC-based and
   DeviceRGB) at fit and 8x and checks colours, orientation and that both pages swapped.
4. *Done 10 Nov.* Bench, 3 runs, 8 threads, against `847df53` (median ms):

   | Bayou Towers | Before | After |
   |---|---:|---:|
   | First page | 4,381 | 612 |
   | Settle→sharp fit / 400% / 1600% | 4,283 / 936 / 369 | 187 / 90 / 233 |
   | Peak memory (MB) | 413 | 568 |

   The other files first looked 30 to 80 ms slower; an alternating rerun (new, old, new,
   old on Curtis Hall and the 50 MB sample) showed the machine drifting slower run by run
   whatever the build, with the new build fastest in its first slot, so no regression.
   Memory is up about 155 MB on Bayou: our shared decode (73 MB) plus PDFium's copy of the
   swapped image. Freeing the shared decode once swapped is a possible follow-up.
   Original plan for this step: Rust tests pass; bench Bayou, Curtis Hall, the aerial file and the 50 MB sample against
   main, to show the gain and that nothing else got slower or bigger.
5. Matt checks by eye: Bayou page 1 at fit and zoomed in, colour against Foxit or the
   current build.
6. Update the docs; commit when Matt asks.

## Open questions

- ~~Colour~~: answered by the probe. `moxcms` matches PDFium to about a level per channel.
  Still worth Matt comparing by eye. Is PDFium (and so Vellum) right to apply a scanner
  profile, and does Foxit do the same? If Foxit looks different, that's a separate question.
- **Memory:** a full-size copy is about 96 MB (24 MP × 4 bytes) in the shared cache, plus
  PDFium's copy in the one worker that renders the page. Fine for one page; a set of several
  such pages needs a cap on the cache.
- **First visit still decodes:** about 140 ms, against 4 s today. Worth checking that the
  stored preview still covers it on open.
- **The `SetBitmap` copy:** the 8 Nov probe swapped in PDFium's own decoded bitmap and got
  37 ms at fit. Ours is the same kind of bitmap, so it should be similar, but the bench in
  step 4 is what proves it.
