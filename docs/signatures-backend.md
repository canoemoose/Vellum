# Signatures: the back end (phase 5, first part)

Status: **built and tested (14 November 2026), waiting for Matt's look at the pad.** Branch
`claude/signatures-834cd1`, cut from `editing` at 78c59d5, not pushed or merged. Built as a side
session while phases 2 and 3 of [editing-scope.md](editing-scope.md) were being built on
`editing`.

## Objective

The parts of "Stamps and signatures" (editing-scope.md) that don't need the markup foundation:
make a signature (draw it, or import a photo or scan with the paper knocked out), and keep it in
a library in the user's profile that only their Windows account can read. **Not here:** placing
a signature on a page as a Stamp annotation, the bake-in question on first save, text stamps.
Those are phase 5 proper, after phases 2 and 3.

## What was built

| Piece | Where | What it does |
|---|---|---|
| Import | `src-tauri/src/signature/import.rs` | Photo or scan in, PNG with alpha out: EXIF rotation, the user's framing (quarter turns, then a crop box that may be turned), paper knocked out, one ink colour, cropped to the ink, capped at 1600 px. Also the preview the framing is chosen on. |
| HEIC | `src-tauri/src/signature/wic.rs` | Pictures the `image` crate can't read (HEIC above all) decoded by Windows' own codecs. |
| DPAPI | `src-tauri/src/signature/dpapi.rs` | `CryptProtectData` / `CryptUnprotectData` for the signed-in account. |
| Library | `src-tauri/src/signature/library.rs` | One encrypted file per signature; list, add, rename, delete, get. |
| Commands | `src-tauri/src/signature/mod.rs` | `signature_preview`, `signature_import`, `_list`, `_add`, `_rename`, `_delete`, `_get`, `_strokes`. |
| Stroke model | `src/lib/signature/strokes.ts` | Capture, smoothing, simplification, drawing, PNG layout, SVG, stored form. Pure. |
| IPC and PNG export | `src/lib/signature/api.ts` | Command wrappers, drawing to PNG, recolouring an import, error messages. |
| Framing maths | `src/lib/signature/frame.ts` | Quarter turns, the crop box (turned or level: dragging, drawing, hit-testing, cursors), the view settling on the box. Pure. |
| Framing view | `src/lib/components/signature/SignatureFrame.svelte` | Turn a photo and put a crop box (which can be turned) round the signature before the paper is knocked out. |
| Ink | `src/lib/signature/ink.ts` | Ready-made inks, hex colours, recolouring pixels, the "too pale" check. Pure. |
| Pad | `src/lib/components/signature/SignaturePad.svelte` | Draw, undo, clear, import a picture, choose the ink, name, save. |
| Library list | `src/lib/components/signature/SignatureLibrary.svelte` | Previews and names; pick, rename, delete; unreadable files. |
| Dev page | `signature-pad.html`, `src/dev/`, `src-tauri/tauri.signature-pad.conf.json` | Both components in the app's window, with a preview of the picked signature. |

Merging into `editing` (checked against fcd5720 with `git merge-tree`): clean, no conflicts.
Neither component is in `App.svelte`. Shared files touched: `src-tauri/src/lib.rs` (one `pub mod`
line and seven command names in `generate_handler!`, between `// Signatures` and
`// End signatures`), `src-tauri/Cargo.toml` (one `windows-sys` feature,
`Win32_Security_Cryptography`, and four `windows` features for WIC at the end of the print
section's list), `package.json` (the `dev:signatures` script).

## How to try it (Matt)

```bash
npm run dev:signatures
```

That's `tauri dev` with the window pointed at `signature-pad.html` instead of the app (same
toolchain set-up as `npm run tauri dev`). It's dev only: `npm run build` builds `index.html`
alone, so the page never ships. What to look at:

- **Drawing:** sign in the white box with the mouse and with a pen. Strokes should follow the pen
  without lag, come out smooth (no polygon corners on loops), and a tap should leave a dot.
  Undo (or Ctrl+Z) removes the last stroke; Clear empties it. Save, and it appears in the library
  on the right.
- **Picked signature:** click one in the library. Below the pad: the full PNG on white and on a
  dark checkerboard (any leftover paper shows as a grey haze on the dark one), and for a drawn
  one, the vector form beside it, which should look identical.
- **Import:** "Import a picture…" and pick a phone photo of a signature on paper (shadowed and
  uneven light is the point). The photo opens in the framing view first: drag a box round the
  signature (corners and edges resize it, drag inside to move it, drag outside for a new box; while the box is still the whole photo, dragging inside it
  draws a new one too),
  turn the photo a quarter with the two page-and-arrow buttons, and turn the box to lie along a
  slanted signature by dragging the round handle above it (a fine grid and the angle show
  while you drag; it turns any way round with no snapping, and double-clicking the handle levels it). When you
  let go of the box or the handle, the view settles on the box with room round it, turning
  so the box is level on screen and the photo lies tilted under it. There's no
  manual zoom or pan.
  Enter or "Remove the paper" applies, Esc or Cancel goes back. The result should come back as
  clean ink on the checkerboard, cropped close; "Adjust the photo…" reopens the framing as you
  left it. Blue biro should stay blue. Try a HEIC straight off an iPhone too: **does it come in
  the right way up?** (See "Not covered" below.)
- **Ink:** the swatches at the right of the pad's first row. Black and Blue, and the rainbow
  ring is a colour picker for any other colour. The whole signature changes colour, drawn or
  imported; an import also has "Original" (its own ink, the default). A pale colour gets a
  warning under the pad. Saved signatures keep their colour (check the picked preview).
- **Library:** Rename (Enter saves, Esc cancels), Delete (asks inline). Close and reopen the page:
  everything's still there.
- **Encryption (optional):** the files are in `%APPDATA%\io.github.canoemoose.vellum\signatures\`.
  Opening one in a text editor should show nothing readable. Copying one into another Windows
  account's folder should make that account's library say "One signature couldn't be read".

## Decisions and assumptions

- **Framing comes before the knock-out** (Matt, 14 November 2026: "crop/scale/rotate etc before
  it tries to do background removal"). Rust sends an upright preview (JPEG, at most 2048 px; the
  webview can't show HEIC); the user frames it; the framing goes back as fractions of the frame
  and an angle, and Rust applies it to the full-size photo, re-reading the file (no cached
  image). Cropping happens before the shrink to the 3000 px working size, so a small signature in
  a big photo keeps its full resolution. Scale is set by the box's size (Matt); there's no zoom
  or pan (wheel, buttons or dragging), the view settles on the box each time it's let go, filling 3/4 of the stage, never
  further out than the whole photo nor closer than 6 screen pixels per preview pixel.
  Straightening turns the **box**, not the photo (Matt, 14 November 2026: "I expected it to
  rotate the crop box, not straighten the picture underneath", and then "a rotate handle on
  the crop box"): the photo stays put and what's
  in the box comes out level. Level, the box stays inside the photo; turned, it may stick out
  (its centre stays on the photo), and what's beyond the photo repeats its edge in Rust, which
  is paper and knocks out. Drawing a new box while the box is turned draws it at the same turn.
  When the view settles it also turns by the box's angle the other way, so the box always
  ends up level on screen (Matt: "why doesn't it level after release like the zoom does?");
  only the view turns, the framing sent to Rust is the same. The initial box is the whole
  photo, so a photo that's already tight is one click; dragging inside it draws a new box,
  since a whole-photo box can't move.
- **No control over how hard the edges are cut** (Matt, 14 November 2026: real photos came out
  clean). The thresholds already adapt to each photo: alpha starts at 5 times the paper's noise
  above the paper and is solid halfway to the ink's typical darkness. If faint pencil breaks up
  or a hazy photo keeps a grey fringe, the fix is an "Edges: thinner / fuller" control under an
  import that moves that 5 between about 3 and 8 and re-runs the knock-out.
- **Two importer changes the crop made necessary.** A tight crop makes the pen large against
  the picture, and two size rules were relative to the picture: (1) the "blob" filter dropped
  marks thicker than 3% of the short side, which a wavy biro line in a crop 400 px high exceeds;
  it's now the larger of that and 2% of the long side, and if that leaves too little ink it
  keeps the thick marks after all (nothing else is there). (2) The paper estimate erases strokes
  up to ~1.6% of the long side; a marker in a tight crop is wider, read as paper, and gave "no
  ink". When the first pass finds none, a second runs with a radius of 3%. Making 3% the only
  pass broke the shadow and desk cases, so it stays a fallback.

- **Ink colour is a choice on the pad** (Matt, 14 November 2026: an option for imports, a
  colour picker for drawn). One control for both: Black (default for drawn), Blue, and a colour
  picker; an import also offers Original (its default). A signature is always one colour:
  changing it recolours every stroke. Under APCA Lc 45 against white the pad warns the ink is
  pale; it doesn't stop you. An import is recoloured in the browser (pixels' colour set, alpha
  kept); a drawn one is drawn in the ink, and the colour is stored with its strokes.
- **What "Original" means: one clean colour, keeping the ink's hue.** Each pixel is painted the same ink
  colour; only the alpha varies. The colour is the ink's measured against its local paper (so a
  warm photo doesn't tint it), darkened to a solid ink: blue biro stays dark blue, black or grey
  ink becomes near-black (`#18181c`). Why: keeping each pixel's own colour carries paper texture,
  noise and shading into the strokes and fringes when scaled, and people often sign in blue on
  purpose, so turning everything black would lose something.
- **The knock-out**, in brief: the paper's brightness is estimated everywhere with a grey-scale
  closing (wipes out pen strokes, keeps a shadow's edge where it is), each pixel's darkness is
  measured against it, the paper's noise is read off the histogram, and alpha ramps from just
  above the noise to the ink's typical darkness (edges stay anti-aliased). Marks that are specks
  (smaller than a dot from the same pen), faint, or thick (a desk, the paper's edge) are dropped,
  and anything far darker than the sheet (a desk beyond the paper) is ignored. Full notes in the
  module comment.
- **Sizes:** photos are worked on at up to 3000 px on the long side; the result is at most
  1600 px (about 270 dpi at 150 mm wide). Drawn signatures export at up to 4x the pad's pixels,
  also capped at 1600 px.
- **Drawn signatures keep their strokes** alongside the PNG (JSON, 0.1 px precision), so phase 5
  can place them as vector paths in the Stamp's appearance stream (crisp at any zoom) rather than
  an image. The library doesn't care which is used.
- **Pen:** one width (2.6 pad pixels, about a fine felt tip). Pressure
  ignored (agreed default). Strokes are thinned (0.75 px), smoothed ([1 2 1], twice, ends
  pinned) and simplified (Ramer-Douglas-Peucker, 0.35 px), then drawn as curves through the
  midpoints: a 3000-sample loop becomes a few dozen points.
- **Library location:** the roaming app data folder (`app_data_dir()`), since DPAPI keys roam
  with the profile too. One file per signature (`<id>.vsig`): magic, then the DPAPI blob of the
  metadata, full PNG, a 240 x 80 preview PNG and the strokes. The id (file name) is the only
  thing readable without the key. DPAPI is given extra entropy, so a blob some other program
  protected for the same account isn't accepted.
- **Unreadable files don't break the list:** they're counted and named by id, the list says how
  many couldn't be read, and they can be deleted. Writes go to a temporary file and are renamed
  into place, so a crash mid-save can't leave half a file.
- **Errors carry codes** (`[signature_no_ink]`, `[signature_unreadable]`, ...) like the rest of
  the app; `api.ts` maps them to messages and falls back to `shell/messages.ts`. When the pad is
  wired in, the codes can move into `messages.ts` with the others.
- **HEIC goes through Windows Imaging Component** (Matt: "why not?"), which uses the codecs
  installed in Windows: no library added, nothing bundled. It needs Microsoft's "HEIF Image
  Extensions" and "HEVC Video Extensions" (Store apps, often preinstalled; both are on this
  machine). Without them, a HEIC import says which to install, or to save the photo as a JPEG.
  WIC is only tried when the `image` crate can't read a file, so it also picks up JPEG XR and
  anything else Windows has a codec for (AVIF with the AV1 extension), though only HEIC and HEIF
  are offered in the file picker. Its orientation tag (System.Photo.Orientation) is read and
  applied as for JPEG, and logged as a `[signature] decoded with WIC` line.

## Tests

One command each:

```bash
npm test
```

```bash
cd src-tauri && cargo test --test signature_import --test signature_library --test signature_wic --test signature_adjust
```

(On the GNU-toolchain machine, `source ~/.vellum-toolchain/env.sh` first, and the build needs
`src-tauri/pdfium/` and `licenses/THIRD-PARTY-NOTICES.txt` present, as for any build.)

For tuning the import by eye, an ignored test writes each synthetic photo and its result
(composited on magenta, so stray pixels show) to a folder:
`SIG_DUMP=<folder> cargo test --test signature_import dump_for_eyes -- --ignored`.

**Covered:**

- *Import* (10 tests): synthesised phone photos (grey gradient paper with a warm cast, sensor
  noise, the soft-edged shadow of a phone across half the sheet, dust specks, a dark desk at one
  edge) with a known wavy stroke and the dot of an "i" drawn on them, as PNG and JPEG, in black and
  in blue ink. Checked numerically: the stroke's centre line is opaque all along (in the shadow
  too), the dot survives, no paper pixel more than 3 px outside the pen is visible, the crop
  matches the stroke's bounds plus margin to within 4 px, neutral ink comes out near-black and
  blue stays blue and dark, every pixel is the ink colour. Also: blank paper (with specks) is
  "no ink", a non-image and a missing file give the right codes, tiny images are refused, a large
  photo is capped at 1600 px, EXIF orientation 6 turns the picture (checked by pixel and through
  a full import), and a PNG that's already a cut-out (transparent black) is read as on white.
- *Library* (6 tests): DPAPI round trip; the wrong entropy, a flipped bit, a truncated blob and
  an empty one all fail; add, list (order, previews' size and aspect), get (PNG back byte for
  byte, strokes), rename (keeps the image), delete (twice is fine); the file on disk contains no
  name, stroke data or PNG bytes; a tampered file, a DPAPI blob made with other entropy (standing
  in for another account's), junk and a truncated file are each "unreadable" without breaking the
  list, and unreadable ones can still be deleted; ids that could escape the folder are refused;
  names are trimmed, cleaned and capped; non-PNG, oversized images and oversized strokes are
  refused.
- *WIC and HEIC* (6 tests): a HEIC made with Windows' own encoder imports with the right crop
  and ink (skipped, and says so, on a Windows without the HEIF/HEVC extensions); a JPEG XR
  imports through WIC (every Windows has that codec); WIC reads a JPEG's orientation tag
  without turning the pixels, so it's applied exactly once; a broken HEIF says what to install;
  junk is still "not supported"; HEIF is recognised by its header.
- *Framing* (12 Rust tests): quarter turns go clockwise and wrap, a crop keeps exactly its part
  (out-of-range and NaN crops are clamped or ignored, never panic), a crop applies after the
  turn, a turned box turns the picture back (a dot lands where the maths says), a box turned
  90 degrees matches a quarter turn back to within one level, a box turned along a slanted pair
  of dots brings them out level and the right distance apart, a box turned over the photo's edge
  is paper there and silly sizes are capped, an import keeps only
  the cropped one of two signatures, cropping first keeps a small signature in a big photo at
  full resolution, the preview is capped at 2048 px, and a tight crop round a wavy biro line or
  a thick marker is still found. A blank photo with a desk at the edge is still "no ink".
- *Framing maths* (23 Vitest tests): the box turns with the picture, fractions to pixels and
  back, turned corners, a level box's corners and edges stay in the frame and above the
  minimum, moving keeps the size, drawing a new box either way round; a turned box resizes
  along its own sides with the opposite side fixed, may stick out but keeps its centre on the
  photo, and draws new boxes at the same turn; the whole frame sends no crop; fitting, settling
  on the box (centred, room round it, within limits; a turned box comes out level on screen,
  and the whole photo fits as it now lies), the view turning the short way round, the in-between views of the settle, zoom
  about the pointer, screen and frame mapping, what the pointer grabs on a level or turned box,
  and the resize cursor following the turn, and the rotate handle (where it sits, the angle from
  dragging it round the centre, any way round, no jump across the left of the circle, and no
  snapping, so a small slope stays as dragged).
- *Ink* (4 tests): hex colours, recolouring (alpha kept), APCA contrast, which inks count as
  pale (black, blue, mid grey and red pass; yellow, sky blue and pale grey are flagged).
- *Stroke model* (20 tests): thinning, smoothing (ends pinned, jitter gone, straight stays
  straight), simplification (a straight run to its ends, a 4000-point circle to under 120 points
  within tolerance, a 100,000-point spiral without recursion), finishing (taps become dots),
  the drawing's undo and clear, bounds, the PNG layout and its caps, what gets drawn (curves,
  lines, dots, mapping), SVG output, and the stored form's round trip (colour included; drawings stored without one read
  as black) and rejection of junk.
- *Messages* (2 tests): codes to text (HEIC's included), and the fallback.

**Not covered by automated tests (Matt's look, above):** how drawing feels with a mouse and a
pen, how the pad and library look, real phone photos (the fixtures are synthetic; a photo with
glare, a crumpled sheet, ruled or squared paper, or a hard shadow edge across the signature may
need tuning), and a file from a genuinely different Windows account (a test can't make one; DPAPI
rejects it the same way as the other-entropy case that is tested), and whether a real iPhone
HEIC comes in the right way up: the test HEIC has no rotation, and iPhones store some photos
sideways with a rotation in the HEIF container. If Windows' decoder already turns those and also
reports the orientation, the import would turn them twice. The log line above says what Windows
reported, which settles it. Recolouring an import goes through a canvas, which can shift the
colour of the faintest edge pixels by a step or two; not visible, but not exact. The Svelte components have no
automated tests (the project has no component test set-up; their logic is in the tested
modules).

**Seen working:** `npm run dev:signatures` builds, starts, and its window comes up showing the
dev page (the page's own script shows the window, and the title was the dev page's), before and
after the ink control was added. Nothing was clicked or drawn in it: drawing, importing, the ink
control and the library in the real window are untried. The
import's output was checked by eye on the synthetic photos: clean strokes, no shadow band, no
specks, no desk edge.

## For phase 5 proper

- Placing: `getSignature(id)` gives the PNG (Stamp with an image XObject, `SMask` from the alpha);
  `getSignatureStrokes(id)` + `parse()` gives vector strokes for a drawn one (an appearance
  stream of paths; `pathData()` already writes the curve maths as SVG path data, the PDF
  operators are the same shape: `m`, `c` from the quadratics, `l`).
- The pad and library belong in a dialog or popover off the toolbar's signature tool; both take
  callbacks and need no app state.
- Move the `signature_*` error codes into `src/lib/shell/messages.ts`.

## Open questions for Matt

Answered 14 November 2026: ink for imports is an option (Original or another ink), drawn
signatures get a colour picker, HEIC is in. Still open:

1. **The framing view** is untried by hand since the box became turnable: does the turned box
   feel right (the handles, the rotate handle, the settle after
   letting go), and does
   the result match what was in the box?
2. **iPhone HEIC orientation:** import one taken in portrait. If it comes in sideways, send the
   `[signature] decoded with WIC` line from the terminal.
