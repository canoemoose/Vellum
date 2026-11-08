# Vellum

Fast PDF/image viewer for CAD drawings. Tauri 2 + Svelte 5 + TypeScript. Phase 0 (the rendering
spike) is done: see [RESULTS.md](RESULTS.md), [ARCHITECTURE.md](ARCHITECTURE.md), [PLAN.md](PLAN.md)
and its brief in [docs/vellum-scope-spike.md](docs/vellum-scope-spike.md). The current work is
v0.1, the first real app: brief in [docs/vellum-v0.1-brief.md](docs/vellum-v0.1-brief.md).

## Commands

- `npm test`: unit tests (Vitest). `cd src-tauri && cargo test` for the Rust side.
- `npm run check`: svelte-check / TypeScript strict.
- `npm run tauri dev`: run in development.
- `npm run tauri build -- --no-bundle`: release exe only (what the benchmarks use).
- `npm run gen:synthetic`: write the synthetic stress PDFs to `bench-output/synthetic/`.
- `npm run bench -- --runs 3 [--pdfium-threads 8] [--dpr 2] [--only name] [--exe path] [files...]`
  (PDFium is the only renderer; `--renderer pdfium` is accepted). Honours `CARGO_TARGET_DIR`.
- `VELLUM_PDFIUM_TIMING=1` logs per-strip render times; `VELLUM_IMAGE_LOD=1` turns on the
  experimental image level of detail (off: it measured slower, see docs/v0.1-handoff/lod.md).
- `node tools/fetch-pdfium.mjs`: download `pdfium.dll` into `src-tauri/pdfium/`.

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
