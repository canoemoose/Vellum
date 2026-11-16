# Annotation writer spike (phase 0)

Can `lopdf` append standard PDF annotations to our files as an incremental update? Yes: see
"Phase 0 results" in [docs/editing-scope.md](../../docs/editing-scope.md) for the verdict and
findings. This folder is the evidence and the first cut of the writer.

- `src/writer.rs`: open a PDF with lopdf (decrypting it if needed), add, replace or delete
  annotations, append the update. `src/appearance.rs`: the appearance streams (arrowheads,
  cloud scallops, text boxes, dimensions). `src/helvetica.rs`: Helvetica widths and line
  breaking. These three are meant to move to `src-tauri/src/annot/` in phase 2.
- `src/pdfium_check.rs`: reads the output back through the same `pdfium.dll` and render flags
  Vellum uses. `src/main.rs`: the sample runner. `tests/writer.rs`: the fast checks.
- `fixtures.py` makes the awkward input files; `verify.py` checks the output with qpdf and
  pyHanko, which share no code with lopdf or PDFium.

It is a standalone crate (its own `[workspace]`), not part of the app build.

## Running it

From the repository root. Every cargo command on the GNU-toolchain machine needs
`source ~/.vellum-toolchain/env.sh` first. The two Python scripts need a virtual environment
(anywhere outside the repo) with `pikepdf` and `pyhanko` installed; `<pyenv>` below is its folder.

```bash
npm run gen:synthetic
```

```bash
<pyenv>/Scripts/python spikes/annot-writer/fixtures.py
```

```bash
cargo test --release --manifest-path spikes/annot-writer/Cargo.toml
```

```bash
cargo run --release --manifest-path spikes/annot-writer/Cargo.toml -- samples
```

```bash
<pyenv>/Scripts/python spikes/annot-writer/verify.py
```

`cargo run --release -- real <file.pdf> [password]` measures load time and memory on any file
and appends to it in memory only; it writes nothing.

## The samples

`samples` writes 22 files to `bench-output/annot-spike/samples/` (git-ignored), all made from
the synthetic PDFs, none from client drawings. Nine markups go on page 1 (and on the last page
of the two multi-page samples), in three rows:

| Where on the page | Markup | What it is in the file |
|---|---|---|
| Top row, left to right | Red arrow pointing up and right, open arrowhead | Line, `/LE [/None /OpenArrow]` |
| | Red rectangle | Square |
| | Red revision cloud, five sides, scallops bulging outwards | Polygon with a cloudy border (`/BE /S /C`) |
| | Pale yellow text box, blue border, two paragraphs wrapped to the box | FreeText |
| Middle row | Blue pen squiggle (a wave and a zigzag) | Ink |
| | Half-transparent yellow four-sided shape | Polygon, 50% opacity |
| | White box "Callout with a leader", teal border, leader with an open arrowhead pointing left | FreeText callout |
| Bottom row | Teal dimension, closed arrowheads both ends, labelled "32.80 m" on A1 (1:100) | Line with a measure dictionary |
| | Half-transparent teal area labelled "143.9 m²" on A1 | Polygon with a measure dictionary |

On A3 the labels read 16.39 m and 35.94 m², on A4 8.19 m and 17.96 m². The author is
"Vellum spike". Every markup has the Print flag set.

### What to check in every app (Acrobat, Edge or Chrome, macOS Preview)

1. All nine markups appear where the table says, looking the same as in the other apps.
2. Text in the text box and callout is upright, inside its box, not cut off.
3. Acrobat only: the Comments list shows nine comments by "Vellum spike". Click the dimension:
   Acrobat should treat it as a distance measurement ("32.80 m"); the area likewise. Double-click
   the text box: you can edit it. Move a markup and save: Acrobat may redraw it its own way,
   which is expected and worth a note if it looks very different (clouds especially).
4. Print one (or print to PDF): the markups print.

### Per sample

| File | What's special | What you should see |
|---|---|---|
| 01-a1-lines | Plain A1, classic cross-reference table | The baseline |
| 02-a1-text | 50,000 text objects | Same markups over dense text |
| 03-a3-set | 40 pages | Markups on page 1 and page 40 |
| 04-a1-raster | 64 MB with one huge image | Opens as fast as the original; the save added 13 KB |
| 05-a4-doc | 300-page A4 document | Markups on page 1 and page 300 |
| 06-a1-objstm | Object streams and a cross-reference stream (what Acrobat writes) | As 01 |
| 07 to 11 | Encrypted: RC4 40-bit, RC4 128-bit, AES-128, AES-256, AES-256 with object streams. Owner password only, so they open without asking | As 01. Acrobat's Document Properties > Security still says encrypted |
| 12-a3-aes256-password-vellum | Needs a password to open: **vellum** | Asks for the password, then as 01 |
| 13-a3-aes256-no-annot-permission | Encrypted with "no commenting" permission | Do the markups show? Does Acrobat refuse to let you comment? (Vellum ignored the permission; see the open question in the brief) |
| 14-a4-signed | Signed (approval signature) before the markups were added | Signature panel: the signature is valid for the version it signed, and the document "has been modified since"; the added comments listed as changes. "Identity unknown" is expected: it's a throwaway test certificate |
| 15-a4-certified-annots-allowed | Certified, comments permitted | Certification still valid, with permitted changes |
| 16-a4-certified-no-annots | Certified, no changes but form filling | Acrobat should say the certification is broken or the changes aren't permitted. Expected: it shows why Vellum must warn before saving markups into such a file |
| 17-a1-rotated | Page stored with `/Rotate 90` | Page shows rotated; the text box, callout and both labels still read upright on screen |
| 18-a4-broken-xref | The original's cross-reference table was wrong | Saved through PDFium first (a full rewrite), then the markups appended; opens cleanly everywhere |
| 19-a1-existing-edited | Already had a blue square, green line, sticky note with popup, text box | The square is now red and sits 60 pt right and 50 pt lower; the line is red with an open arrowhead; the sticky note is gone; "Existing text box" unchanged; plus the nine new markups |
| 20-a1-existing-objstm-edited | Same, with the originals inside object streams | As 19 |
| 21-a1-pdfium-rewrite-then-vellum | PDFium added a navy square at the top left and rewrote the file; then our markups were appended | The navy square and the nine markups |
| 22-a1-pdfium-incremental-then-vellum | Same, with PDFium's own incremental save first | As 21 |

Anything that looks wrong in one app and right in the others is the most useful thing to report.
