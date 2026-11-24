# Vellum

Fast PDF/image viewer for CAD drawings. Tauri 2 + Svelte 5 + TypeScript. Phase 0 (the rendering
spike) is done: see [RESULTS.md](RESULTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [PLAN.md](PLAN.md)
and its brief in [docs/vellum-scope-spike.md](docs/vellum-scope-spike.md). The current work is
v0.1, the first real app: brief in [docs/vellum-v0.1-brief.md](docs/vellum-v0.1-brief.md).
Next up, on separate branches: editing, markup, measuring and reading (scope, nothing built:
[docs/editing-scope.md](docs/editing-scope.md)). Releases are built by GitHub Actions and
installed copies update themselves: see Releasing below and
[docs/release-pipeline-scope.md](docs/release-pipeline-scope.md).

## Commands

- `npm test`: unit tests (Vitest). `cd src-tauri && cargo test` for the Rust side.
- `npm run check`: svelte-check / TypeScript strict.
- `npm run tauri dev`: run in development.
- `npm run tauri build -- --no-bundle`: release exe only (what the benchmarks use).
- `npm run gen:synthetic`: write the synthetic stress PDFs to `bench-output/synthetic/`.
- `npm run bench -- --runs 3 [--pdfium-threads 8] [--dpr 2] [--only name] [--exe path] [files...]`
  (PDFium is the only renderer; `--renderer pdfium` is accepted). Honours `CARGO_TARGET_DIR`.
  Zoom modes: `--flight` (zoom as a flight, timed landing to sharp), `--wheel N` (N notches
  40 ms apart, landing to sharp), `--spin --page N` (a steady wheel spin, counting long frames).
- `VELLUM_PDFIUM_TIMING=1` logs per-strip render times; `VELLUM_IMAGE_LOD=1` turns on the
  experimental image level of detail (off: it measured slower, see docs/v0.1-handoff/lod.md).
  `VELLUM_PERF_LOG=1` logs every settle-to-sharp time to perf-log.csv without the debug
  overlay (viewer-bench sets it).
  Image swaps (`pdfium_swap.rs`) are always on and log each swap and colour-profile check
  as `[swap]` lines on stderr.
- Speed work: start from [docs/speed-handoff.md](docs/speed-handoff.md) (state, numbers,
  ideas ranked, how to measure). The current baseline, the comparison with other viewers and
  the agreed order of fixes are in [docs/speed-diagnosis-scope.md](docs/speed-diagnosis-scope.md)
  (current truth; its dated log is [docs/speed-diagnosis-log.md](docs/speed-diagnosis-log.md)).
- `tools/viewer-bench` (C#, `dotnet build -c Release` in that folder): times Vellum and six
  other viewers from outside by watching the screen. `ViewerBench.exe run [--apps a,b]
  [--runs 3] [--quiet 10000] files...` for cold opens, fit page and fit width, and a Ctrl+wheel
  zoom at the middle of the sheet; `--whole-sheet` for launch to the whole sheet drawn;
  `--notches [--frames] [--keep-raw] [--tolerance 2] [--quiet 2500] [--no-warm]` for single
  wheel notches, timed from the zoom finishing to sharp (`analyse <run dir> [--why]` re-checks
  saved grabs). Results in `bench-output/viewers/`. Always set `VELLUM_EXE`
  to a known build, and check the saved frames by eye before quoting a figure. It takes over
  the mouse and keyboard on the primary monitor. Traps and what is parked: the scope doc above.
- `node tools/screenshots.mjs [--only name] [--theme dark|light|both]`: homepage screenshots,
  unattended, into `bench-output/screenshots/`. Drives the release exe through WebView2's
  DevTools port with a throwaway profile (your own settings untouched) and captures with
  CaptureGraphicsWin2D (Microsoft Store). Needs `test-files/fieldwork-festival-drawing-set.pdf`,
  made by `test-files/drawing-set.mjs` (both gitignored). Windows open on screen while it runs.
- `node tools/fetch-pdfium.mjs`: download `pdfium.dll` into `src-tauri/pdfium/`.
- `node tools/make-notices.mjs`: write `src-tauri/licenses/THIRD-PARTY-NOTICES.txt` (every
  shipped crate, front-end package and PDFium library with its licence). `tauri build` runs it;
  the installer ships it and Help > About opens it. After updating PDFium, run
  `node tools/fetch-pdfium-licences.mjs` and commit `src-tauri/licenses/pdfium/`.
- `node tools/make-icons.mjs [--only app|document]`: rebuild the app icon set and
  `document.ico` (the icon of PDFs that open in Vellum) in `src-tauri/icons` from the SVGs in
  `src-tauri/icons/source` (rendered with headless Edge; 16 and 24 px have their own drawings).
  Edge occasionally hangs on one size: run it again.

## Releasing

A `v*` tag on `main` becomes a draft GitHub Release (`.github/workflows/release.yml`);
publishing the draft is what makes installed copies offer the update. In order:

1. `node tools/set-version.mjs 0.2.0`: writes the version to every file that carries it.
2. Commit ("Release 0.2.0") and push `main`.
3. `git tag v0.2.0`, then `git push origin v0.2.0`. The Release workflow takes about 16 minutes
   and fails at once if the tag and the version files disagree. It runs the type check and
   every test before building, so a failure there means no draft: fix it, then delete the tag
   (`git push origin :refs/tags/v0.2.0`, `git tag -d v0.2.0`) and tag again.
4. On GitHub, open the draft, write the notes ("What's new" in the app opens this page), and
   publish. Or: `gh release edit v0.2.0 --draft=false --latest --notes "..."`.
5. GitHub serves the previous version's update file for up to a minute after publishing, so
   wait before testing with Help > Check for updates.

Notes:

- A version with a pre-release part (`0.2.0-rc1`) makes a draft marked prerelease, which is
  never offered to installed copies even if published. Use one to try the workflow.
- Updates are signed. The private key and its password live only in the repository's Actions
  secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) and Matt's
  password manager. Never commit or paste the key. The public half is in
  `src-tauri/tauri.conf.json`; changing it strands every installed copy.
- A local `npm run tauri build` builds the installer and then fails at the signing step
  without the key. Use `-- --no-bundle` for the exe.
- "Checks only (manual)" (`.github/workflows/ci.yml`: the same checks, no installer) runs only when asked:
  `gh workflow run ci.yml --ref <branch>`. Pushes don't trigger it.
- Third-party actions are pinned to commits. To update one, change the commit and the version
  comment together.
- After changing the PDFium version in `tools/fetch-pdfium.mjs`, update `SHA256` beside it
  (a mismatch prints the hash it got).

## Conventions

- Test runner: **Vitest**, because it reuses the Vite config and needs no extra setup. Tests live
  next to the code as `*.test.ts`. Navigation maths (`src/lib/view/viewMath.ts`) must stay pure and
  covered.
- UK English in UI text, docs and comments. Log/console strings ASCII only.
- Keep the engine (`src/lib/engine`, `src/lib/render`, `src/lib/view`) free of Svelte; components
  only call into it.

## Toolchain notes

- This repo builds with the standard MSVC Rust toolchain (Tauri's documented prerequisite).
  The machine v0.1 was built on has the GNU toolchain plus a portable MinGW instead: every
  cargo or tauri command there needs `source ~/.vellum-toolchain/env.sh` first.
- A release exe copied elsewhere needs `pdfium.dll` and (GNU target) `WebView2Loader.dll`
  beside it.
- The spike was developed on a machine without MSVC Build Tools, using the GNU toolchain plus a
  portable WinLibs MinGW on PATH. That's why `crate-type` is `["rlib"]` only (the MinGW linker
  can't produce the mobile `cdylib`). Harmless on MSVC.
