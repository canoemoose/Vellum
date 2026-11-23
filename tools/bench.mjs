#!/usr/bin/env node
// Benchmark harness: launches the release build in --bench mode N times per file,
// measures cold start from outside the process, and aggregates medians.
//
//   node tools/bench.mjs [--runs 3] [--renderer pdfium] [--pdfium-threads N] [--dpr N] [--exe path]
//                        [--only substring] [--page N] [--size WxH] [--flight] [--wheel N] [--spin]
//                        [files...]
//
// --page N zooms on page N (1-based) instead of the first; --size WxH sets the window in
// logical pixels (default 1600x1000).
//
// Default files: everything in test-files/ and bench-output/synthetic/.
// Results: bench-output/<renderer>/ (per-run JSON + snapshots) and
//          bench-output/summary-<renderer>.json + .md

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const runs = Number(opt("runs", "3"));
const renderer = opt("renderer", "pdfium");
// PDFium is the only renderer since v0.1 (pdf.js was removed). The flag stays so existing
// command lines and the summary file names (summary-pdfium-*.json) keep working.
if (renderer !== "pdfium") {
  console.error(`Unknown renderer "${renderer}": PDFium is the only renderer since v0.1 (pdf.js was removed). Use --renderer pdfium or leave it out.`);
  process.exit(2);
}
// Honours CARGO_TARGET_DIR (a shared target directory across worktrees).
const targetDir = process.env.CARGO_TARGET_DIR ? resolve(process.env.CARGO_TARGET_DIR) : join(root, "src-tauri", "target");
const exe = resolve(opt("exe", join(targetDir, "release", "vellum.exe")));
const only = opt("only", null);
const dpr = opt("dpr", null);
const threads = opt("pdfium-threads", null);
const page = opt("page", null);
const size = opt("size", null);
// --no-progressive: whole-region renders instead of streamed bands (for comparison).
const noProgressive = argv.includes("--no-progressive");
if (noProgressive) argv.splice(argv.indexOf("--no-progressive"), 1);
// --flight: zoom by a flight (typed zoom, fit) instead of a wheel step; the settle column is
// then landing -> sharp, the still wait after the flight lands.
const flight = argv.includes("--flight");
if (flight) argv.splice(argv.indexOf("--flight"), 1);
// --wheel N: zoom by N wheel notches 40 ms apart (1: one notch; 3: a quick spin), timed from
// the ease landing to sharp, like --flight.
const wheel = opt("wheel", null);
// --spin: instead of the zoom steps, spin the wheel from 80% (ten notches at 100, 200 and
// 300 ms gaps) and count long frames. Use with --page.
const spinMode = argv.includes("--spin");
if (spinMode) argv.splice(argv.indexOf("--spin"), 1);
const tag = renderer + (threads ? `-t${threads}` : "") + (dpr ? `-dpr${dpr}` : "") + (noProgressive ? "-noprog" : "") + (flight ? "-flight" : "") + (wheel ? `-wheel${wheel}` : "") + (spinMode ? "-spin" : "") +
  (page ? `-p${page}` : "") + (size ? `-${size}` : "");
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

let files = argv.map((f) => resolve(f));
if (!files.length) {
  for (const dir of [join(root, "test-files"), join(root, "bench-output", "synthetic")]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) if (f.toLowerCase().endsWith(".pdf")) files.push(join(dir, f));
  }
}
if (only) files = files.filter((f) => basename(f).includes(only));
if (!existsSync(exe)) {
  console.error(`No exe at ${exe}. Build it first: npm run tauri build -- --no-bundle`);
  process.exit(1);
}

const outDir = join(root, "bench-output", tag);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => {
  const s = a.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function runOnce(file, outJson) {
  return new Promise((res) => {
    const t0 = Date.now();
    const args = [file, "--bench", "--bench-out", outJson];
    if (dpr) args.push("--dpr", dpr);
    if (threads) args.push("--pdfium-threads", threads);
    if (noProgressive) args.push("--no-progressive");
    if (flight) args.push("--bench-flight");
    if (wheel) args.push("--bench-wheel", wheel);
    if (spinMode) args.push("--bench-spin");
    if (page) args.push("--bench-page", String(Number(page) - 1));
    if (size) args.push("--bench-size", size);
    const p = spawn(exe, args, {
      stdio: "ignore",
      windowsHide: false,
    });
    const timer = setTimeout(() => {
      p.kill();
      res({ spawnEpochMs: t0, timedOut: true });
    }, RUN_TIMEOUT_MS);
    p.on("exit", (code) => {
      clearTimeout(timer);
      res({ spawnEpochMs: t0, code, wallMs: Date.now() - t0 });
    });
  });
}

// Warm-up: the first launch of a freshly built exe is slowed by Defender's scan, which
// would otherwise land in run 1's cold-start figure. --bench with no file exits at once.
await new Promise((res) => spawn(exe, ["--bench"], { stdio: "ignore" }).on("exit", res));
await sleep(1500);

const summary = { renderer, dpr, threads, runs, exe, date: new Date().toISOString(), files: [] };

for (const file of files) {
  const base = basename(file, ".pdf");
  const perRun = [];
  for (let k = 1; k <= runs; k++) {
    const outJson = join(outDir, `${base}.run${k}.json`);
    process.stdout.write(`${base} run ${k}/${runs} ... `);
    const r = await runOnce(file, outJson);
    let data = null;
    try {
      data = JSON.parse(readFileSync(outJson, "utf8"));
    } catch {
      // missing or partial
    }
    if (data && !data.error) {
      data.coldStartMs = data.shownEpochMs - r.spawnEpochMs;
      data.rustInitMs = data.processStartEpochMs - r.spawnEpochMs;
      writeFileSync(outJson, JSON.stringify(data, null, 2));
      console.log(`ok (${Math.round(r.wallMs / 1000)} s)`);
    } else {
      console.log(`FAILED ${r.timedOut ? "(timeout)" : `(exit ${r.code})`} ${data?.error?.split("\n")[0] ?? ""}`);
    }
    perRun.push(data);
    await sleep(1500); // let WebView2 processes wind down
  }

  const ok = perRun.filter((d) => d && !d.error);
  const zoomLabels = ["fit", "400", "1600"];
  const z = {};
  for (const label of zoomLabels) {
    const zs = ok.map((d) => d.zooms?.find((q) => q.label === label)).filter(Boolean);
    const pans = zs.flatMap((q) => q.pan);
    const settles = zs.flatMap((q) => q.settleToSharpMs);
    const bands = zs.flatMap((q) => q.settleToFirstBandMs ?? []);
    z[label] = {
      zoomPct: median(zs.map((q) => q.zoomPct)),
      panFps: median(pans.map((p) => p.fps)),
      panFpsMin: pans.length ? Math.min(...pans.map((p) => p.fps)) : null,
      intervalP95Ms: median(pans.map((p) => p.intervalP95Ms)),
      maxIntervalMs: pans.length ? Math.max(...pans.map((p) => p.maxIntervalMs)) : null,
      dropped: median(pans.map((p) => p.dropped)),
      drawP95Ms: median(pans.map((p) => p.drawP95Ms)),
      settleMs: median(settles),
      firstBandMs: median(bands),
      settleMaxMs: settles.filter((s) => s !== null).length ? Math.max(...settles.filter((s) => s !== null)) : null,
      timeouts: settles.filter((s) => s === null).length,
      incomplete: zs.flatMap((q) => q.complete).filter((c) => !c).length,
      regions: median(zs.flatMap((q) => q.regions)),
    };
  }
  const entry = {
    file: basename(file),
    okRuns: ok.length,
    numPages: ok[0]?.numPages ?? null,
    pageSize: ok[0]?.pageSize ?? null,
    coldStartMs: median(ok.map((d) => d.coldStartMs)),
    coldStartFirstRunMs: ok[0]?.coldStartMs ?? null,
    rustInitMs: median(ok.map((d) => d.rustInitMs)),
    firstPageMs: median(ok.map((d) => d.firstPageMs)),
    firstBandMs: median(ok.map((d) => d.firstBandMs)),
    openParsedMs: median(ok.map((d) => d.openParsedMs)),
    peakMemMb: median(ok.map((d) => d.memPeak?.privateWsMb)),
    peakMemMaxMb: ok.length ? Math.max(...ok.map((d) => d.memPeak?.privateWsMb ?? 0)) : null,
    peakCommitMb: median(ok.map((d) => d.memPeak?.commitMb)),
    jsHeapPeakMb: median(ok.map((d) => d.jsHeapPeakMb)),
    renderErrors: ok.reduce((a, d) => a + (d.renderErrors ?? 0), 0),
    refreshHz: median(ok.map((d) => d.refreshHz)),
    dpr: ok[0]?.dpr ?? null,
    viewport: ok[0]?.viewport ?? null,
    zooms: z,
    // --spin: per gap, every rep of every run pooled.
    spin: spinMode
      ? [100, 200, 300].map((gapMs) => {
          const reps = ok.flatMap((d) => d.spin?.find((g) => g.gapMs === gapMs)?.reps ?? []);
          return {
            gapMs,
            reps: reps.length,
            droppedMedian: median(reps.map((r) => r.dropped)),
            droppedTotal: reps.reduce((a, r) => a + r.dropped, 0),
            over50Total: reps.reduce((a, r) => a + r.over50, 0),
            p95Ms: median(reps.map((r) => r.p95Ms)),
            maxMs: reps.length ? Math.max(...reps.map((r) => r.maxMs)) : null,
          };
        })
      : null,
    errors: perRun.filter((d) => !d || d.error).map((d) => d?.error?.split("\n")[0] ?? "no result"),
  };
  summary.files.push(entry);
  writeFileSync(join(root, "bench-output", `summary-${tag}.json`), JSON.stringify(summary, null, 2));
}

// Markdown tables for RESULTS.md
const n = (v, d = 0) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));
let md = `### ${tag} (median of ${runs} runs)\n\n`;
md += `| File | Cold start (ms) | First band (ms) | First page (ms) | Pan fps fit / 400% / 1600% | ${flight || wheel ? "Landing→sharp" : "Settle→sharp"} ms fit / 400% / 1600% | Peak memory (MB) | Faults |\n`;
md += "|---|---:|---:|---:|---|---|---:|---|\n";
for (const e of summary.files) {
  const zs = ["fit", "400", "1600"].map((l) => e.zooms[l]);
  const faults = [];
  const inc = zs.reduce((a, q) => a + q.incomplete, 0);
  const to = zs.reduce((a, q) => a + q.timeouts, 0);
  if (inc) faults.push(`${inc} incomplete settles`);
  if (to) faults.push(`${to} settle timeouts`);
  if (e.renderErrors) faults.push(`${e.renderErrors} render errors`);
  if (e.errors.length) faults.push(`${e.errors.length} failed runs`);
  md += `| ${e.file} | ${n(e.coldStartMs)} | ${n(e.firstBandMs)} | ${n(e.firstPageMs)} | ${zs.map((q) => n(q.panFps)).join(" / ")} | ${zs.map((q) => n(q.settleMs)).join(" / ")} | ${n(e.peakMemMb)} | ${faults.join("; ") || "none detected"} |\n`;
}
md += "\nDetail (pan worst-frame and draw cost, settle worst case):\n\n";
md += "| File | Zoom | Pan fps (min run) | Frame p95 / max (ms) | Dropped frames / 2 s | Draw p95 (ms) | Settle to first band (ms) | Settle median / max (ms) | Regions |\n";
md += "|---|---|---:|---|---:|---:|---:|---|---:|\n";
for (const e of summary.files) {
  for (const l of ["fit", "400", "1600"]) {
    const q = e.zooms[l];
    md += `| ${e.file} | ${l === "fit" ? `fit (${n(q.zoomPct, 1)}%)` : l + "%"} | ${n(q.panFpsMin)} | ${n(q.intervalP95Ms, 1)} / ${n(q.maxIntervalMs, 1)} | ${n(q.dropped)} | ${n(q.drawP95Ms, 2)} | ${n(q.firstBandMs)} | ${n(q.settleMs)} / ${n(q.settleMaxMs)} | ${n(q.regions)} |\n`;
  }
}
if (spinMode) {
  md = `### ${tag} spin (median of ${runs} runs x 3 reps)\n\n`;
  md += "| File | Gap between notches (ms) | Dropped frames per spin (median) | Frames over 50 ms (all spins) | Frame p95 (ms) | Longest frame (ms) |\n";
  md += "|---|---:|---:|---:|---:|---:|\n";
  for (const e of summary.files)
    for (const g of e.spin ?? [])
      md += `| ${e.file} | ${g.gapMs} | ${n(g.droppedMedian)} | ${n(g.over50Total)} of ${g.reps} | ${n(g.p95Ms, 1)} | ${n(g.maxMs, 1)} |\n`;
}
writeFileSync(join(root, "bench-output", `summary-${tag}.md`), md);
console.log("\n" + md);
