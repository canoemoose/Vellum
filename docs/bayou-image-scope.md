# Bayou image fix: scope (10 November 2026)

**Status (11 November): done and committed (`7767993`), checked by Matt.** The rules that
shipped are in "Build plan" and "Built" further down, and in ARCHITECTURE.md ("Image swaps").
The Objective, Approach and Steps sections below are the original plan (a 16 MP rule) and
are kept as the record of how it got there; the measurement sections in between are what
changed it.

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

### What counts as a "large" image (11 November)

Two rules disagreed: banding called an image large if it covered over a quarter of the page;
the swap, if it had 16 MP or more. Cost follows pixel count (PDFium decodes the whole image
for every band crossing it, and every worker that swaps holds its own copy), not area.
Throwaway scan of every image in every test file, nested form XObjects included (there were
none):

| File | Biggest image | Area rule today |
|---|---|---|
| Aerial drawing | 1.0 MP JPEG tiles (757 of 1 to 4 MP, 139 smaller) | banded, and must stay so |
| Curtis Hall | p1 only: 5.5 MP at 8%, 4.3 MP at 100%, 2.3 MP at 4%; every other image under 1 MP | p1 one band |
| 50 MB sample | one 11.2 MP Flate image covering 11% | banded (test D: banding nearly doubles its work) |
| Bayou | 24 MP JPEG, 182 MP JBIG2 | one band |
| Stage plan | no images | banded |

Proposed single rule: **a page with any image of 4 MP or more renders as one band.** It sits
between the aerial tiles (1 MP) and everything that should be one band (4.3 MP and up). Only
the 50 MB sample changes. Huge JPEGs (16 MP and up) then always sit on one-band pages, so
only one worker ever swaps them and the shared decode can be freed after the swap. The
rule should look inside form XObjects too, as the scan did. Risk not covered by any test
file: a dense vector page with one 4 MP photo loses its parallel bands.

### What a JPEG costs PDFium per render (11 November)

Throwaway probe, since deleted (a first run at uneven sizes left the key gaps, so it was
rerun at these). Generated one-image PDFs, photo-like JPEG filling a 2000 pt sheet. Colour
images with no profile, a matrix sRGB profile, and Bayou's lookup-table scanner profile;
greyscale with none. Each rendered at fit (1.2 px/pt) three times, then a 512 px tile at 4x
near the bottom twice. Ours = `decode_full` plus `icc_to_srgb`, once. Milliseconds:

| Image | Decoded | No profile: fit ×3 | sRGB: fit ×3 | Scanner: fit ×3 | Deep tile (none / scanner) | Ours |
|---|---:|---|---|---|---|---:|
| 0.5 MP RGB | 1.5 MB | 7 / 7 / 7 | 12 / 10 / 10 | **98 / 97 / 97** | 0 / 0 | 3 to 9 |
| 1 MP RGB | 3 MB | 11 / 11 / 11 | 19 / 18 / 18 | **192 / 191 / 192** | 0 / 0 | 6 to 11 |
| 2 MP RGB | 6 MB | 16 / 16 / 16 | 31 / 30 / 30 | **378 / 379 / 373** | 0 / 0 | 11 to 17 |
| 4 MP RGB | 12 MB | 26 / 26 / 26 | 55 / 54 / 53 | **745 / 744 / 744** | 0 / 0 | 24 to 28 |
| 8 MP RGB | 24 MB | 62 / 25 / 25 | 120 / 25 / 25 | **1484** / 26 / 25 | 1 / 1 | 41 to 50 |
| 16 MP RGB | 48 MB | 113 / 40 / 40 | 222 / 40 / 40 | **2950** / 40 / 40 | 1 / 1 | 92 to 94 |
| 18 MP RGB | 54 MB | 124 / 44 / 44 | 249 / 43 / 44 | **3318** / 44 / 52 | 1 / 1 | 93 to 104 |
| 20 MP RGB | 60.0 MB | 136 / 48 / 46 | 271 / 47 / 46 | **3688** / 46 / 46 | 1 / 1 | 99 to 118 |
| 22 MP RGB | 66 MB | **142 / 141 / 141** | **292 / 286 / 286** | **4044 / 4047 / 4043** | **89 / 459** | 109 to 122 |
| 24 MP RGB | 72 MB | **152 / 151 / 151** | **314 / 310 / 311** | **4411 / 4404 / 4415** | **97 / 499** | 117 to 140 |
| 16 to 40 MP grey | 16 to 40 MB | 127 to 248, then 49 to 90 | | | 0 to 1 | 62 to 132 |
| 60 MP grey | 60.0 MB | **202 / 207 / 201** | | | **140** | 150 |
| 64 MP grey | 64 MB | **204 / 210 / 210** | | | **133** | 142 |

What it shows:

- **PDFium keeps a decoded image only between about 5 and 60 MB.** The upper limit is a
  decoded size of 60,000,000 bytes: a 20 MP colour image at 59.99 MB is kept and a 60 MP
  grey one at 60.01 MB isn't. Above it every render and every deep tile decodes again.
  Bayou's cover (24.4 MP, 73 MB) is over it; its JBIG2 pages (182 MP at 1 bit, 23 MB)
  under it, which is why those are slow only once. Below about 4 MP nothing is kept either
  (4 MP isn't, 8 MP and the earlier 5.7 MP are; 4 to 5.7 MP not measured).
- **A lookup-table profile is what makes it hurt:** 185 to 195 ms per MP for every render
  that isn't kept. A 0.5 MP scanner-profile image costs 98 ms on every render; a 4 MP one,
  745 ms. Mid-size ones are kept, but cost 1.5 to 3.7 s on first view.
- **A matrix sRGB profile only doubles the no-profile cost**, which stays small.
- **Ours is 5 to 8 ms per MP whatever the profile.**

Proposed swap rule, replacing "16 MP or more": swap a JPEG if **its decoded size is over
60,000,000 bytes** (PDFium will never keep it), **or it has a lookup-table ICC profile and is
at least 0.5 MP** (PDFium pays about 190 ms per MP whenever it isn't kept). Cap the swaps at
about 64 MP per page, biggest first, so a page full of profiled photos can't turn into
hundreds of swaps.

Still unmeasured: only one lookup-table profile (Bayou's); what a swapped page costs to
render at sizes other than Bayou's 24 MP; the 4 to 5.7 MP edge of PDFium's keep band.

### The full picture (11 November, second probe)

Same method, since deleted; raw output kept at `%TEMP%\vellum-smoke\imgcost-result.txt`.
Real profiles from the Adobe and Windows colour folders, CMYK JPEGs written by Windows'
own encoder (WIC). Milliseconds.

**Where PDFium starts keeping an image.** 4.0 MP RGB (12 MB) is decoded on every render;
4.5 MP (13.5 MB) and up is kept. So PDFium keeps a decoded image only **between about
12 and 60 MB**.

**RGB profiles** (fit, first render; "kept" = later renders cheap):

| Profile | 2 MP | 8 MP | 24 MP (every render) | Deep tile 24 MP | Ours 24 MP | Our colour vs PDFium (2 MP) |
|---|---:|---:|---:|---:|---:|---|
| Bayou scanner (Lab table, 188 KB) | 372 every render | 2,232 then kept | 4,635 to 4,780 | 527 to 541 | 161 | mean 0.96, 1.8% > 8 off |
| FilmTheater K2383 (Lab table, 400 KB) | 372 to 388 | 1,497 | 4,547 to 4,652 | 525 to 550 | 143 | mean 2.26, **6.7% > 8 off** |
| DCamScene (XYZ table, 38 KB) | 388 to 399 | 1,552 | 4,706 to 4,850 | 531 to 556 | 145 | mean 0.71, 1.9% > 8 off, max 75 |
| VideoHD 16-235 (XYZ table, 1.5 KB) | 342 to 348 | 1,396 | 4,098 to 4,188 | 475 to 479 | 155 | mean 1.77, **4.5% > 8 off** |
| Rec2100 HLG (XYZ table, 973 KB) | 464 to 485 | 1,877 | 5,483 to 5,495 | 603 to 666 | 146 | **mean 19.8, 24.5% > 8 off: wrong** |
| Adobe RGB 1998 (matrix) | 31 | 130 | 322 to 346 | 114 to 118 | 132 | mean 0.10, 0% > 8 off |

Every lookup-table profile costs PDFium 170 to 240 ms per MP whenever the image isn't kept,
whatever its size or connection space. A matrix profile costs about 2.5× no profile. Our
colours match PDFium closely for some table profiles, less well for others, and badly for
an HDR (HLG) one.

**CMYK JPEGs:**

| | 2 MP | 8 MP | 24 MP (every render) | Deep tile 24 MP | Our decode 24 MP |
|---|---:|---:|---:|---:|---:|
| DeviceCMYK, no profile | 38 every render | 153 then kept | 410 to 416 | 156 to 157 | 163 |
| US Web Coated SWOP | 417 to 424 | 1,679 | 5,056 to 5,153 | 591 to 601 | 158 |
| Coated FOGRA39 | 431 to 438 | 1,742 | 5,238 to 5,457 | 600 to 623 | 159 |

`jpeg-decoder` reads them (CMYK32). These JPEGs are stored inverted (Adobe APP14 marker):
inverted and converted with `moxcms` they match PDFium (mean 0.84 and 0.53, max 8 and 5).
A naive DeviceCMYK formula doesn't (mean 6).

**Grey with a grey profile** behaves like grey without one: 8 MP 55 then kept, 24 MP 127
then kept, 64 MP 275 to 291 every render.

**After the swap** (PDFium rendering our decoded pixels):

| Case | PDFium fit / deep tile | Swapped fit / deep tile |
|---|---|---|
| 0.5 MP, scanner profile | 102 to 109 every render / 0 | 4 to 6 / 0 |
| 2 MP, scanner profile | 391 to 413 every render / 0 | 8 / 0 |
| 8 MP, no profile | 63 then 26 / 0 to 1 | 25 to 29 / 0 |
| 8 MP, scanner profile | 1,612 then 26 / 0 to 1 | 25 to 30 / 0 to 1 |
| 24 MP, no profile | 155 to 164 every render / 101 | 55 to 58 / 1 |
| 24 MP, scanner profile | 4,707 to 4,760 every render / 536 to 559 | 56 to 60 / 1 |
| 64 MP grey, no profile | 199 to 205 every render / 136 | 105 to 116 / 2 |

The swapped image is never slow: it costs what PDFium's kept copy costs, at every size.

What it means for the rules:

- Swap any JPEG whose decoded size is **over 60 MB** (PDFium never keeps it): RGB, grey or
  CMYK, profile or not. 24 MP with no profile goes from 155 ms every render to 56, deep
  tiles from 101 to 1.
- Swap any JPEG with a **lookup-table profile** from 0.5 MP up (98 to 105 ms every render
  at 0.5 MP; 1.4 to 2.2 s first view in the kept band).
- Not worth it in the kept band without an expensive profile (8 MP, no profile: 63 then 26
  ms either way), nor for small images without one.
- **Our colour conversion can't simply be trusted for every profile.** It must be checked:
  per profile, convert a grid of test colours both with `moxcms` and with PDFium (a tiny
  image PDFium decodes in a few ms) and use ours only if they agree. If not, take
  PDFium's own decode once (`FPDFImageObj_GetBitmap`, exact, the slow cost paid once) and
  swap that in.

### Is our colour conversion wrong, or set up wrongly? (11 November, third probe)

Same profiles, but the test image stored uncompressed, so PDFium and `moxcms` convert
identical samples (the earlier comparison went through two different JPEG decoders, which
added their own differences). 2 MP sweep through the colour cube; difference per channel
against PDFium (LittleCMS):

| Profile (ICC version) | moxcms defaults: mean / > 8 off | Best setting: mean / > 8 off |
|---|---|---|
| Adobe RGB 1998 (v2, matrix) | 0.04 / 0% | same |
| US Web Coated SWOP (v2, CMYK) | 0.53 / 0.01% | 0.23 / 0% (floating point, tetrahedral) |
| Coated FOGRA39 (v2, CMYK) | 0.49 / 0.01% | 0.16 / 0.01% (floating point, tetrahedral) |
| Bayou scanner (v2) | 0.55 / 0.49% | 0.31 / 0.38% (floating point, tetrahedral) |
| DCamScene (v4) | 0.67 / 1.99% | 0.55 / 1.89% |
| FilmTheater K2383 (v4) | 1.27 / 2.96% | 1.17 / 3.00% |
| VideoHD 16-235 (v4) | 1.59 / 5.99% | **0.25 / 0%, but only with relative colorimetric** |
| Rec2100 HLG (v4, HDR) | 11.40 / 12.94% | 11.38 / 12.88% |

- **Our setup was mostly right.** Tetrahedral interpolation (what LittleCMS uses; needs
  `moxcms`'s `options` feature) and floating point narrow the gap a little; ignoring the
  HDR tag changes nothing. The earlier, bigger differences were partly the two JPEG
  decoders.
- **Every v2 profile matches**, to a fraction of a level. **Every v4 profile with a lookup
  table is off** by 2 to 6% of samples, or 13% for the HDR one. VideoHD matching exactly
  under relative colorimetric points at how the two engines treat v4's perceptual intent
  (its reference black point), not at a broken conversion. It's a genuine difference
  between the engines, and LittleCMS is the reference implementation, so PDFium's result
  is the one to match.
- So the per-profile check stays: v2 profiles and matrix profiles will pass it, v4 table
  profiles mostly won't and fall back to PDFium's own decode, once.

## Build plan (11 November): swap rules from the measurements

Replaces the "16 MP or more" rule committed in `acd32d2`. Code moves to a new
`src-tauri/src/pdfium_swap.rs`; `pdfium_lod.rs` goes back to being only the ⅛ prototype.

1. **One image plan per page**, shared by banding and swapping. Walks every image,
   including those nested in form XObjects. For each: pixels, decoded bytes, colour space,
   filter, ICC profile (and whether it has a lookup table), transparency.
2. **Swap an image** when its decoded size is over 60,000,000 bytes, or it has a
   lookup-table profile and is at least 0.5 MP. Never for images with transparency or
   masks, nor 1-bit images (JBIG2, CCITT: PDFium keeps them). At most 64 MP swapped per page,
   biggest first.
3. **Where the pixels come from:** our decode (`jpeg-decoder` plus `moxcms`, tetrahedral)
   for a single-filter JPEG in grey or RGB, with no profile or a profile that passes the
   check. Otherwise PDFium's own decode, once (`FPDFImageObj_GetBitmap`): v4 table
   profiles, CMYK (inversion and Decode arrays), Lab, Indexed, non-JPEG images.
4. **Profile check**, once per profile per process: a test grid of colours as a tiny
   in-memory image, converted by PDFium and by `moxcms`; ours is used only if they agree
   (mean ≤ 1 level, ≤ 1% of samples more than 8 off).
5. **One band** for a page with any image to swap (and, as built, any image of 50 MP or more; see below). Its renders
   all go to one worker, so only one worker ever holds the swapped copy: no shared decode
   cache needed.
6. **Memory:** each swapped page gets its own second document handle, so closing it frees
   the swapped pixels. At most about 1 GB of swapped pixels per worker, least recently used
   closed first.
7. **Tests:** decision rules and the colour comparison as unit tests; integration tests for
   our path (60 MB+ RGB JPEG, sRGB profile), the PDFium path (a raw RGB image over 60 MB),
   a hand-built lookup-table profile through the check, and the one-band rule.
8. Bench the five test files against `acd32d2`; Matt checks Bayou by eye.

### Built (11 November): what changed while building

- **The 4 MP one-band rule was wrong and is gone.** Benched against `acd32d2`, it made the
  50 MB sample's 400% settle 334 to 343 ms (from 137 to 145) and 1600% 233 ms (from 93):
  PDFium keeps its 11 MP image, decodes it once per worker and reuses it, so one band only
  threw away eight-way rendering.
- **But some big kept images do need one band.** Without the old area rule, Bayou's
  182 MP JBIG2 pages were split across eight workers, each decoding the scan (0.7 s each,
  5.5 s of CPU) while page 1 rendered: Bayou's first page went from about 600 to 870 ms.
  So pages with an image of **50 MP or more** render as one band, as do pages with a swap.
  50 MP is a judgement between those two measurements (11 MP banded is better, 182 MP isn't).
- **Colour settings:** tetrahedral with fixed point (the `moxcms` default) is both the
  fastest (353 ms for 24 MP on one thread, against 418 for the default interpolation and 407
  for floating point) and within a hair of the most accurate; that's what ships.
- **The check on real profiles:** Adobe RGB passes; the four v4 table profiles and both
  CMYK profiles go to PDFium's decode. Bayou's profile passes (5 ms check) and its cover
  swaps from our decode in 210 ms.

Final bench, alternating with `acd32d2` (median of 3, two rounds each):

| | `acd32d2` | Now |
|---|---|---|
| Bayou first page | 581 to 598 ms | 598 to 614 ms |
| Bayou settle fit / 400% / 1600% | 115 to 120 / 235 to 245 / 94 to 99 | 96 to 125 / 113 to 235 / 92 to 101 |
| Bayou peak memory | 908 to 913 MB | 822 to 868 MB |
| 50 MB sample fit / 400% | 129 to 139 / 128 to 129 | 96 to 132 / 122 to 130 |

Curtis Hall, the aerial drawing and the stage plan were level in the earlier full bench
(none of them has a swap or a 50 MP image, so none takes the new paths). Not yet checked by
Matt by eye.

### Decode cost by format, and the one-band rule from it (11 November)

Throwaway probe, since deleted. One worker's first decode of each image, on a fresh load
(`FPDFImageObj_GetBitmap`), plus the first render of an eighth of the page (what each of
eight banded workers pays), the whole page twice, and a 400% band twice. JBIG2 is Bayou's
real pages (nothing here can encode JBIG2); CCITT G4 is a drawing-like scan written by
Windows' TIFF encoder; JPEG from the Rust encoder. Milliseconds:

| Image | Decode | Eighth of page, fresh | Whole page, 1st / 2nd | 400% band, 1st / 2nd |
|---|---:|---:|---|---|
| JBIG2 182 MP (Bayou p2) | 660 | 500 | 602 / 116 | 3 / 3 |
| JBIG2 182 MP (Bayou p7) | 840 | 647 | 774 / 121 | 3 / 3 |
| CCITT G4 20 MP | 63 | 53 | 67 / 32 | 1 / 1 |
| CCITT G4 50 MP | 126 | 90 | 138 / 53 | 1 / 1 |
| CCITT G4 100 MP | 256 | 190 | 255 / 88 | 2 / 2 |
| JPEG grey 11 / 20 / 50 MP | 24 / 45 / 112 | 28 / 54 / 142 | 46 / 76 / 166, then 20 / 31 / 53 | 1 |
| JPEG grey 100 MP (over 60 MB, swapped) | 227 | 144 | 302 / 302 | 113 / 113 |
| JPEG RGB 11 / 20 MP | 52 / 95 | 56 / 101 | 86 / 142, then 32 / 49 | 1 |
| JPEG RGB 50 / 100 MP (swapped) | 229 / 507 | 126 / 264 | 306 / 299, 588 / 557 | 93 / 193 |

- Per megapixel: JPEG grey 2.3 ms, JPEG colour about 5, CCITT 2.5 to 3.2, JBIG2 3.6 to 4.6.
  JBIG2 isn't much slower per pixel; Bayou's scans are just very big.
- Once an image is kept, a zoomed render of it costs 1 to 3 ms whether the page is banded or
  not. So banding a page for a big kept image buys little and costs seven extra decodes and
  seven extra copies on first view.
- **Rule as built:** one band when an image's estimated decode (MP × the measured rate for
  its format) is 150 ms or more, or the page has a swap. At 150 ms, banding would waste at
  least a second of CPU on first view. The threshold is a judgement; the rates are
  measured, except JPEG 2000 (no encoder to hand; given a cautious 15 ms/MP) and other
  filters (3 ms/MP assumed).
- On the test files this decides exactly as the 50 MP rule did (Bayou's scans one band,
  everything else banded), so the bench above still stands.

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
