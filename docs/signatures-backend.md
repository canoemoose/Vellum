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
| Import | `src-tauri/src/signature/import.rs` | Photo or scan in, PNG with alpha out: EXIF rotation, paper knocked out, one ink colour, cropped, capped at 1600 px. |
| DPAPI | `src-tauri/src/signature/dpapi.rs` | `CryptProtectData` / `CryptUnprotectData` for the signed-in account. |
| Library | `src-tauri/src/signature/library.rs` | One encrypted file per signature; list, add, rename, delete, get. |
| Commands | `src-tauri/src/signature/mod.rs` | `signature_import`, `_list`, `_add`, `_rename`, `_delete`, `_get`, `_strokes`. |
| Stroke model | `src/lib/signature/strokes.ts` | Capture, smoothing, simplification, drawing, PNG layout, SVG, stored form. Pure. |
| IPC and PNG export | `src/lib/signature/api.ts` | Command wrappers, drawing to PNG, error messages. |
| Pad | `src/lib/components/signature/SignaturePad.svelte` | Draw, undo, clear, import a picture, name, save. |
| Library list | `src/lib/components/signature/SignatureLibrary.svelte` | Previews and names; pick, rename, delete; unreadable files. |
| Dev page | `signature-pad.html`, `src/dev/`, `src-tauri/tauri.signature-pad.conf.json` | Both components in the app's window, with a preview of the picked signature. |

Neither component is in `App.svelte`. Shared files touched: `src-tauri/src/lib.rs` (one `pub mod`
line and seven command names in `generate_handler!`, between `// Signatures` and
`// End signatures`), `src-tauri/Cargo.toml` (one `windows-sys` feature,
`Win32_Security_Cryptography`), `package.json` (the `dev:signatures` script).

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
  uneven light is the point). It should come back as clean ink on the checkerboard, cropped
  close. Blue biro should stay blue.
- **Library:** Rename (Enter saves, Esc cancels), Delete (asks inline). Close and reopen the page:
  everything's still there.
- **Encryption (optional):** the files are in `%APPDATA%\io.github.canoemoose.vellum\signatures\`.
  Opening one in a text editor should show nothing readable. Copying one into another Windows
  account's folder should make that account's library say "One signature couldn't be read".

## Decisions and assumptions

- **Imported ink becomes one clean colour, keeping its hue.** Each pixel is painted the same ink
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
- **Pen:** one width (2.6 pad pixels, about a fine felt tip), one colour (near-black). Pressure
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
- **Not in the import picker:** HEIC (iPhone's default). The `image` crate can't read it; an
  iPhone set to "Most compatible" saves JPEG, and photos shared off the phone are usually JPEG
  already.

## Tests

One command each:

```bash
npm test
```

```bash
cd src-tauri && cargo test --test signature_import --test signature_library
```

(On the GNU-toolchain machine, `source ~/.vellum-toolchain/env.sh` first, and the build needs
`src-tauri/pdfium/` and `licenses/THIRD-PARTY-NOTICES.txt` present, as for any build.)

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
- *Stroke model* (20 tests): thinning, smoothing (ends pinned, jitter gone, straight stays
  straight), simplification (a straight run to its ends, a 4000-point circle to under 120 points
  within tolerance, a 100,000-point spiral without recursion), finishing (taps become dots),
  the drawing's undo and clear, bounds, the PNG layout and its caps, what gets drawn (curves,
  lines, dots, mapping), SVG output, and the stored form's round trip and rejection of junk.
- *Messages* (2 tests): codes to text, and the fallback.

**Not covered by automated tests (Matt's look, above):** how drawing feels with a mouse and a
pen, how the pad and library look, real phone photos (the fixtures are synthetic; a photo with
glare, a crumpled sheet, ruled or squared paper, or a hard shadow edge across the signature may
need tuning), and a file from a genuinely different Windows account (a test can't make one; DPAPI
rejects it the same way as the other-entropy case that is tested). The Svelte components have no
automated tests (the project has no component test set-up; their logic is in the tested
modules).

**Seen working:** `npm run dev:signatures` builds, starts, and its window comes up showing the
dev page (the page's own script shows the window, and the title was the dev page's). Nothing was
clicked or drawn in it: drawing, importing and the library in the real window are untried. The
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

1. **Ink colour for imports:** keep the ink's hue (built: blue stays blue), or always make it
   black?
2. **Pen colour for drawn signatures:** black only (built), or offer blue as well?
3. **HEIC:** worth adding (needs Windows' own decoder, or a library), or is "send it as JPEG"
   enough?
