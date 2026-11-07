#!/usr/bin/env node
// Benchmark harness: launches the release build in --bench mode N times per file,
// measures cold start from outside the process, and aggregates medians.
//
//   node tools/bench.mjs [--runs 3] [--renderer pdfjs|pdfjs-cpu|pdfium] [--exe path]
//                        [--only substring] [files...]
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
const renderer = opt("renderer", "pdfjs");
const exe = resolve(opt("exe", join(root, "src-tauri", "target", "release", "vellum.exe")));
const only = opt("only", null);
const dpr = opt("dpr", null);
const tag = renderer + (dpr ? `-dpr${dpr}` : "");
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
    const args = [file, "--bench", "--bench-out", outJson, "--renderer", renderer];
    if (dpr) args.push("--dpr", dpr);
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

const summary = { renderer, dpr, runs, exe, date: new Date().toISOString(), files: [] };

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
    z[label] = {
      zoomPct: median(zs.map((q) => q.zoomPct)),
      panFps: median(pans.map((p) => p.fps)),
      panFpsMin: pans.length ? Math.min(...pans.map((p) => p.fps)) : null,
      intervalP95Ms: median(pans.map((p) => p.intervalP95Ms)),
      maxIntervalMs: pans.length ? Math.max(...pans.map((p) => p.maxIntervalMs)) : null,
      dropped: median(pans.map((p) => p.dropped)),
      drawP95Ms: median(pans.map((p) => p.drawP95Ms)),
      settleMs: median(settles),
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
    errors: perRun.filter((d) => !d || d.error).map((d) => d?.error?.split("\n")[0] ?? "no result"),
  };
  summary.files.push(entry);
  writeFileSync(join(root, "bench-output", `summary-${tag}.json`), JSON.stringify(summary, null, 2));
}

// Markdown tables for RESULTS.md
const n = (v, d = 0) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));
let md = `### ${renderer} (median of ${runs} runs)\n\n`;
md += "| File | Cold start (ms) | First page (ms) | Pan fps fit / 400% / 1600% | Settle→sharp ms fit / 400% / 1600% | Peak memory (MB) | Faults |\n";
md += "|---|---:|---:|---|---|---:|---|\n";
for (const e of summary.files) {
  const zs = ["fit", "400", "1600"].map((l) => e.zooms[l]);
  const faults = [];
  const inc = zs.reduce((a, q) => a + q.incomplete, 0);
  const to = zs.reduce((a, q) => a + q.timeouts, 0);
  if (inc) faults.push(`${inc} incomplete settles`);
  if (to) faults.push(`${to} settle timeouts`);
  if (e.renderErrors) faults.push(`${e.renderErrors} render errors`);
  if (e.errors.length) faults.push(`${e.errors.length} failed runs`);
  md += `| ${e.file} | ${n(e.coldStartMs)} | ${n(e.firstPageMs)} | ${zs.map((q) => n(q.panFps)).join(" / ")} | ${zs.map((q) => n(q.settleMs)).join(" / ")} | ${n(e.peakMemMb)} | ${faults.join("; ") || "none detected"} |\n`;
}
md += "\nDetail (pan worst-frame and draw cost, settle worst case):\n\n";
md += "| File | Zoom | Pan fps (min run) | Frame p95 / max (ms) | Dropped frames / 2 s | Draw p95 (ms) | Settle median / max (ms) | Regions |\n";
md += "|---|---|---:|---|---:|---:|---|---:|\n";
for (const e of summary.files) {
  for (const l of ["fit", "400", "1600"]) {
    const q = e.zooms[l];
    md += `| ${e.file} | ${l === "fit" ? `fit (${n(q.zoomPct, 1)}%)` : l + "%"} | ${n(q.panFpsMin)} | ${n(q.intervalP95Ms, 1)} / ${n(q.maxIntervalMs, 1)} | ${n(q.dropped)} | ${n(q.drawP95Ms, 2)} | ${n(q.settleMs)} / ${n(q.settleMaxMs)} | ${n(q.regions)} |\n`;
  }
}
writeFileSync(join(root, "bench-output", `summary-${tag}.md`), md);
console.log("\n" + md);
