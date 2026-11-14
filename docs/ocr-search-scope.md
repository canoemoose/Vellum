# OCR search on pages without text: scope

Status: **spike done, waiting for Matt's review** (14 November 2026). Listed under "Later phases"
in [editing-scope.md](editing-scope.md) as "Windows' built-in OCR; search only, nothing written
back". Worked autonomously (Matt's call); assumptions are listed for correction in one pass.
Spike: [spikes/ocr/](../spikes/ocr/README.md). Nothing is wired into the app.

## Verdict: go, for search, with honest expectations

Windows' OCR works from Rust on this toolchain, costs nothing to ship, runs entirely off the
PDFium workers, and on real files finds most of the words people would search for:

- **Scanned or plotted documents** (typed text): 96% of words found.
- **CAD drawings whose text was exploded to outlines** (no text layer, not a scan): a second
  case nobody had listed. Pages 2 to 12 of the MMA Curtis Hall set are like this. Page 3 (a code
  summary) reads almost word for word; page 1 (which does have a text layer, so can be scored)
  reads 86% at 300 dpi.
- **A stage plan** (Xero, scored against its own text): 70% at 300 dpi.
- **A hand-lettered 1960s survey scan** (Bayou pages 2 to 13, no ground truth): the main
  labels and most elevations by eye (GAS MAIN, WATER MAIN, AVENUE, SIDEWALK, HYDRANT, 10.23'),
  with gaps.

It is weak on: text under about 3 pt, text crossed by line work, text at angles other than 0, 90
and 270 degrees (none found), upside-down text (none found), and light text on a dark ground
unless inverted. So search on these pages will find most labels, not all, and the UI must say
so. A fuzzy or space-insensitive match would add 5 to 10 points (the "near" counts below).

## What was settled

### 1. Calling `Windows.Media.Ocr` from Rust

Works on the GNU toolchain with the `windows` crate 0.62 the app already depends on. The spike
needs these extra features on that crate: `Foundation`, `Foundation_Collections`,
`Globalization`, `Graphics_Imaging`, `Media_Ocr`, `Security_Cryptography`, `Storage_Streams`.
`windows` 0.62 links through `windows-link` (raw-dylib), so neither GNU nor MSVC needs import
libraries: **the MSVC build needs nothing else**. Not built with MSVC here (no MSVC machine);
the release pipeline's MSVC build would confirm it.

- The pixels go in as an 8-bit grey `SoftwareBitmap` (via `CryptographicBuffer`), and
  `RecognizeAsync(..).join()` blocks the calling thread (any thread but an STA UI thread).
- Nothing to ship: the engine and its language data are part of Windows (`%windir%\OCR`).
- `OcrEngine.MaxImageDimension` is **10,000 px** here (older Windows builds documented 2,600).
- No confidence scores: the API gives words, their boxes, lines, and one skew angle per image.

### 2. Accuracy

Scored by the spike against each page's own text layer (`score.rs`): a word is **found** when
an OCR word on top of it reads the same, ignoring case and trailing punctuation; **near** when
one character is wrong or the engine split or joined it. Final settings (300 dpi, 1600 px tiles,
three passes, 4 threads) unless the table says otherwise.

| Page | 200 dpi | 300 dpi | Notes |
|---|---|---|---|
| Fixture, clean (519 words, 2 to 12 pt, four angles) | 30% | 41% | 0 deg 65%, 90 deg 48%, 270 deg 50%, 45 deg 0% |
| Fixture, with line work and dimension lines | 14% | 21% | 0 deg 36%, 90 deg 27%, 270 deg 20% |
| Fixture, dimension lines touching the text | 1% | 2% | one pass, upright only |
| Scan of the synthetic A4 text (10.5 pt Times) | 96% | 96% | typed documents are easy |
| Scan of a synthetic A3 sheet (3 pt numbers on 9,000 random lines) | 2% | 13% | worst case |
| Xero stage plan (607 words) | 62% | 70% | one upright pass, 4096 px tiles: 70% / 75% |
| MMA page 1 (2,021 words, mostly 3 to 4 pt) | 74% | 86% | |
| MMA pages 3 and 5 (outline text, no truth) | 753 / 256 words | 992 / 371 words | page 3 checked by eye: near-complete |
| Bayou pages 2 and 7 (hand-lettered scans, no truth) | 1,015 / 235 words | 1,030 / 294 words | checked by eye on one crop |

By size on the clean fixture at 300 dpi (all angles): under 3 pt 4%, 3 to 4 pt 45%, 4 to 6 pt
47%, 6 to 9 pt 59%, 9 pt and up 62% (the 45-degree quarter is never read, so the ceiling is
75%). Upright text only: 3 to 4 pt 75%, 6 to 9 pt 84%, 9 pt and up 87%. Higher resolution
helps the smallest text (2 pt: 2% at 300 dpi, 15% at 400, 20% at 600) but costs 2 to 4 times
the time; 300 dpi is the knee.

What the measurements showed:

- **Lines touching text defeat it.** Dimension text sitting on its line (an underline) drops
  recall from 65% to 6%. With a realistic gap (a quarter of the text height, AutoCAD's default)
  it makes no difference; random lines crossing text halve recall.
- **One skew estimate per image.** The engine deskews each image by one angle. A tile holding
  45-degree text or dense diagonal line work gets a 40-degree estimate, and everything else in
  that tile is then misread. Smaller tiles limit the damage: 1600 px tiles took vertical text
  under line work from 2 to 9% (4096 px tiles) to 20 to 27%, for 20 to 65% more OCR time. The detected angle is
  reported, so a later phase could re-run a skewed tile in quarters.
- **Vertical text needs its own passes.** Upright OCR reads no vertical text. Rendering the page
  turned a quarter turn each way reads text running up (90) and down (270); both passes see
  every vertical word, one of them upside down. The merge keeps the reading whose word and line
  are most plausible as drawing text (capitals and digits; upside-down text comes out mixed case
  and symbols, "Lona" for DUCT), with the upright pass winning any clash with a turned one
  (without that, all-horizontal sheets lost 5 points). The losing reading is kept as a
  search-only alternate (+1 to 3 points for search).
- **Light text on dark** (the Bayou cover is a white-on-black print): tiles whose mean is dark are
  inverted first. Verified on a negative of the fixture's title block. The Bayou cover still
  reads only "OF" and "THE": its title is cut off by the edge of the scan itself.
- **Rotation and scans.** A page with `/Rotate 90` maps back correctly. An image-only "scan" of
  the fixture reads within a point of the vector page at the same resolution, so the pipeline
  doesn't care where the pixels came from.
- **Tiles don't lose words.** A word up to the overlap long (300 px, an inch at 300 dpi) is whole
  in the tile that owns its centre (tested).

### 3. Speed, memory and running in the background

OCR is single-threaded per call and scales almost linearly with threads (CPU time = OCR time).
Rendering is a small part of the cost and is the only part that needs PDFium.

| Page (A1 unless noted), 300 dpi, three passes | OCR CPU | 1 thread | 4 threads | 8 threads |
|---|---|---|---|---|
| Xero stage plan (144 tiles) | 4.4 s | 3.8 s | 1.5 s | 1.4 s |
| MMA page 1, A3 (36 tiles) | 2.7 s | | 0.8 s | |
| Bayou page 2, scan (189 tiles) | 25 s | | 6.5 s | |
| Bayou page 7, scan (189 tiles) | 36 to 48 s | 36 s | 11.5 s | 7.2 s |
| Bayou page 7 at 200 dpi | 12 s | | 4.1 s | |

- **Per tile**: rendering a 1600 px tile takes 1 to 30 ms on these files (the first render of a
  scan pays for decoding the image: 1 s for Bayou page 2, 8 s for its cover). One OCR call holds
  a thread for 15 ms to 1.4 s (busy scans are slowest).
- **Memory**: under 1 MB of working set per extra OCR thread (47 MB with one thread, 52 MB
  with eight, on the Xero plan) plus one 2.5 MB tile in flight each; private bytes rose by
  2 to 50 MB per page, mostly PDFium's own page and image caches. One warning: tiling the aerial
  drawing (`projectlayoutmarch2021.pdf`, 746 x 14,400 pt) at 200 dpi pushed PDFium to 2.5 GB.
  That page has a text layer, so it would never be OCR'd, but a heavy outline-text page could
  do the same; renders for OCR should go through the same paths (and image swaps) as tiles.
- **Background**: renders are short, separate jobs, so they can be queued one tile at a time on
  `run_on_worker` and interleave with the viewer's tiles, while OCR runs on its own threads at
  below-normal priority, never on a PDFium worker. Not measured: how a running OCR job feels
  while panning a heavy drawing (needs the app).

### 4. Fitting the existing pipeline

OCR words come back as text plus a box in **Vellum page coordinates** (points, y down, the page
as displayed, `/Rotate` applied), the same space `text::PageFrame` produces, so search hits and
highlights need no new maths. Each word also has its line, the pass it came from and whether it
is an alternate.

- **Text layer**: to reuse `src/lib/text/` (selection, word and line hit-testing, copy), the
  backend can synthesise characters: each word's box split evenly along its reading direction,
  a generated space between words of a line, a generated line break between lines, encoded with
  the existing `encode_layer`. Selection then works as on a real text layer, with approximate
  character boxes.
- **Search**: `doc_search_page` uses PDFium's own matcher, which can't see OCR text. For pages
  with `chars == 0` and an OCR result, a small Rust matcher over the same synthesised string
  (case-insensitive, whole-word option) returns the same `PageHits`, so `engine/search.ts`
  barely changes. Alternates are searched too, but not shown for selection.
- **Cache**: results are small (about 30 KB a page). Keyed like the preview cache (`previewcache.rs`:
  `content_key`, the file's size, time and first and last MiB) plus the page, the OCR language
  and a pipeline version, in `%LOCALAPPDATA%\Vellum\ocr-cache`, capped and pruned the same way.
  A second search of a scanned set is then instant.

### 5. Languages

- This machine has **en-GB and en-US** (the user's two profile languages); asking for fr-FR,
  de-DE or ja-JP is refused. Windows adds the OCR data when a language is added (one of its
  optional features), so a machine normally has OCR for its display language.
- `TryCreateFromUserProfileLanguages` picks the first profile language with OCR. With none it
  fails, and the fallback is the first of `AvailableRecognizerLanguages`; with that list empty,
  OCR is off and Vellum should say how to add it (Settings > Time & language > Language & region
  > the language > Language options > Optical character recognition; or, as administrator,
  `Add-WindowsCapability -Online -Name "Language.OCR~~~en-GB~0.0.1.0"`).
- Not verified: a machine without any OCR language (needs a clean VM), Windows N/LTSC editions,
  and Windows Server (where `Windows.Media.Ocr` may be missing).

## Proposed design

- **Backend** (`src-tauri/src/ocr/`, new): the engine (from `spikes/ocr/src/ocr.rs`), the
  geometry and merge (`geom.rs`, pure, with its tests), the cache, and a per-document job:
  for each page without text, render 1600 px grey tiles one per `run_on_worker` call (on
  whichever worker is free), recognise them on an OCR pool (2 threads by default, below-normal
  priority), merge, synthesise the text layer, store it. Cancelled when the document closes.
- **Settings**: 300 dpi (for an image-only page, the image's own resolution clamped to 200 to
  300 dpi: not built or measured), 1600 px tiles with 300 px overlap, passes at 0, 90 and 270
  degrees, invert dark tiles, upright reading wins clashes, alternates kept for search.
- **When**: when a search reaches a page whose text layer is empty (see questions). The results
  card says "Reading 4 of 13 scanned pages" and adds hits as pages finish; hits from OCR carry a
  small marker and the card notes that text read from images may be incomplete.
- **Selection and copy** on OCR pages through the synthesised layer; the text cursor appears
  there like anywhere else.
- **Nothing written back** to the file, ever.

Changes outside the new module, for whoever builds it (the editing session owns most of these
files now): `src-tauri/Cargo.toml` (the seven `windows` features above), `text.rs`
(`text_layer` and `search_page` fall back to the OCR layer when `chars == 0`), `lib.rs`
(commands to start, cancel and report OCR progress, plus an event), `pdfium.rs` (a grey or
BGRA tile render callable from `run_on_worker`; `render_strip` already does the work),
`previewcache.rs` (share `content_key` and the pruning), `engine/search.ts` and the results card
(progress, the marker, re-searching pages as they finish).

## Phases

1. **OCR-1, backend** (2 to 3 days): the module, cache, commands; search falls back to OCR
   layers; port the spike's tests to `src-tauri/tests`, including the fixture-based end-to-end
   test. After editing phases 2 and 3 land, since it touches `lib.rs`, `text.rs` and `pdfium.rs`.
2. **OCR-2, front end** (1 to 2 days): progress and the marker in the results card, selection and
   copy on OCR pages, a setting to turn OCR off, the "OCR not installed" message.
3. **OCR-3, quality, only if wanted** (each a day or so, each measurable with the spike):
   re-run tiles the engine found skewed, in quarters; angled text (render at the angle with
   `FPDF_RenderPageBitmapWithMatrix`); space-insensitive and one-typo matching; removing long
   straight lines before OCR.

## Assumed (Matt to correct)

1. Search, selection and copy (selection and copy confirmed by Matt, 14 November). No OCR text
   is ever saved into the file.
2. OCR runs when a search needs it, not on opening a file (opening must stay free).
3. OCR hits are shown like other hits but marked, with a note that recognition may miss words.
4. 300 dpi rather than 200: about twice the time, 10 to 15 points better on small text.
5. English only, from the user's own Windows languages; no language picker.

## Questions for Matt

1. Should OCR start on its own in the background as soon as a file with scanned pages opens
   (searches are then instant, at the cost of a busy CPU for a minute or two on a big scanned
   set), or only when you search (as assumed)?

Answered 14 November: **70% is useful** ("better than nothing"), and **selection and copy are
as important as search**, so they belong in the first cut (OCR-1 and OCR-2 together), not as
an extra.

### Where the rest is lost (Xero plan, 300 dpi)

Of the 184 words missed on the Xero plan (178 of them horizontal), 140 have OCR text on top of
them and 38 have nothing. The dominant pattern is short codes at about 4 pt (door and room tags
such as "D2.29A"): the engine reads them **in fragments** ("D2.1" then "0A", or just "D2.O"),
often with 0 read as O. Resolution doesn't fix it: 400, 500 and 600 dpi give 69%, 68% and 69%
(4 to 6 pt text stays at 42 to 46%), for 2 to 4 times the time. So the levers are after
recognition, not before it:

1. **Re-read fragmented lines on their own**: crop the line, pad it with white, enlarge it and
   OCR that crop alone, away from the door swings and symbols around it. Probably the biggest
   gain; unmeasured.
2. **Forgiving matching**: fold look-alikes (O/0, I/l/1, S/5, B/8, Z/2) on both sides of a
   search, and join fragments that sit next to each other on one line. Worth about 5 points
   on the measured "near" counts alone.
3. **Re-run skewed tiles in quarters** (helps vertical text under line work, not the Xero plan).

## Not verified

- The MSVC build (expected to need nothing; see section 1).
- A machine without an OCR language pack, other Windows editions, Windows 10.
- How the app feels while OCR runs during panning and zooming (needs the integration).
- Accuracy on the Bayou scans and the MMA outline pages beyond eyeballing (no ground truth;
  making some would mean transcribing client drawings, which stay out of the repo).
- Rendering image-only pages at the image's native resolution.
- `sample-50-MB-pdf-file.pdf` read 1% of its text: its text is a few points high on a 1,121 pt
  page, too small at 200 dpi; not representative of drawings, so not pursued.

## Files

`spikes/ocr/` (standalone crate) and this file. Nothing in the app changed. Measurements:
`bench-output/ocr/results.jsonl` on the development machine (git-ignored; regenerate with the
commands in the spike's README).
