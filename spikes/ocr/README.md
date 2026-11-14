# OCR search spike

Can Windows' built-in OCR (`Windows.Media.Ocr`) make pages without a text layer searchable in
Vellum? Mostly yes: see [docs/ocr-search-scope.md](../../docs/ocr-search-scope.md) for the
verdict, the measurements and the proposed design. This folder is the evidence and the first
cut of the pipeline.

It is a standalone crate (its own `[workspace]`), not part of the app build.

- `src/ocr.rs`: the WinRT calls. Languages, the engine, recognising an 8-bit grey image.
- `src/pipeline.rs`: one page: render tiles through PDFium on one thread, recognise them on
  `jobs` threads, keep each word from the tile that owns it, map boxes to page points, merge the
  passes.
- `src/geom.rs` (pure): tiling, which tile owns a word, mapping boxes back from renders turned a
  quarter turn, merging the upright and turned passes.
- `src/score.rs` (pure): scoring OCR words against a page's own text layer.
- `src/image.rs` (pure): inverting light-on-dark tiles.
- `src/fixture.rs` (pure) and `src/pdf.rs`: the drawing-like fixture with known text, and
  image-only "scans" of any page; PDFium rendering and the ground truth.
- `src/main.rs`: the runner. `tests/pure.rs` and `tests/ocr.rs`: the tests.

## Running it

From the repository root. Every cargo command on the GNU-toolchain machine needs
`source ~/.vellum-toolchain/env.sh` first. `pdfium.dll` is found through `VELLUM_PDFIUM_DLL` or
the first `src-tauri/pdfium/bin/pdfium.dll` above this folder (a worktree uses the main
checkout's). Output goes to `bench-output/ocr/` (git-ignored).

The tests (pure ones anywhere; the end-to-end ones skip themselves without PDFium or an OCR
language):

```bash
cargo test --release --manifest-path spikes/ocr/Cargo.toml
```

Make the fixtures (needs `npm run gen:synthetic` first for the synthetic scans):

```bash
cargo run --release --manifest-path spikes/ocr/Cargo.toml -- fixture
```

Measure a file. Pages without a text layer can be scored against another file's text with
`--truth`; every run appends a JSON line to `bench-output/ocr/results.jsonl`:

```bash
cargo run --release --manifest-path spikes/ocr/Cargo.toml -- bench bench-output/ocr/fixture-drawing.pdf --dpi 200,300 --jobs 4
```

Other commands: `langs` (installed OCR languages, the engine's size limit), `info <pdf>`
(characters and objects per page), `dump <pdf> --page n --dpi d [--save x,y,w,h]` (every word,
and optionally a rendered region as PNG to look at). Options: `--turns 0,1,3` (passes),
`--tile 1600 --overlap 300`, `--jobs n`, `--lang en-GB`, `--no-invert`, `--missed` (list
horizontal truth words not found), `--tag name` (labels the JSON line). `OCR_SPIKE_DEBUG=1` logs
each tile's word count and the skew the engine detected.

## The fixtures

`fixture` writes, from `src/fixture.rs` (so never anything derived from client drawings):

| File | What |
|---|---|
| `fixture-clean.pdf` | A1 sheet, four quadrants of text at 0, 90 (reading up), 270 (reading down) and 45 degrees; a row per size (2, 2.5, 3, 3.5, 4.5, 6, 8, 12 pt) of 16 drawing-style tokens; a title block. Nothing else. |
| `fixture-linework.pdf` | The same text over 3,000 random short lines (harsh: many tokens are crossed). |
| `fixture-drawing.pdf` | Line work plus a dimension line under every token, a quarter of the text height clear. |
| `fixture-underlined.pdf` | Line work with the dimension lines touching the text. |
| `fixture-drawing-rot90.pdf` | `fixture-drawing` with `/Rotate 90`. |
| `scan-*-{150,200,300}.pdf` | Image-only PDFs (one greyscale image per page) of the drawing fixture and of page 1 of the synthetic A3 sheet set and A4 text file. |
