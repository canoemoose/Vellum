#!/usr/bin/env node
// Builds the RESULTS.md comparison tables from bench-output/summary-*.json, marking each
// figure against the acceptance criteria in brief section 7.
//
//   node tools/results-table.mjs pdfjs pdfium pdfium-t8 ...   (summary tags, in column order)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tags = process.argv.slice(2);
if (!tags.length) {
  console.error("usage: node tools/results-table.mjs <tag> [<tag>...]");
  process.exit(1);
}
const sums = tags
  .map((t) => [t, join(root, "bench-output", `summary-${t}.json`)])
  .filter(([, p]) => existsSync(p))
  .map(([t, p]) => [t, JSON.parse(readFileSync(p, "utf8"))]);

// Section 7 criteria.
const C = {
  cold: 1000,
  first: 1500,
  fps: 50,
  settleFit: 300,
  settle1600: 500,
  mem: 1536,
};
const ok = (v, limit, higherIsBetter = false) =>
  v === null || v === undefined ? "" : (higherIsBetter ? v >= limit : v <= limit) ? " ✓" : " ✗";
const n = (v, d = 0) => (v === null || v === undefined ? "–" : Number(v).toFixed(d));

const files = [...new Set(sums.flatMap(([, s]) => s.files.map((f) => f.file)))];
const ACCEPT = (f) => /^projectlayout|^1-|^2-|^4-/.test(f); // files the decision rule uses

let md = "";
for (const file of files) {
  md += `\n#### ${file}${ACCEPT(file) ? " (acceptance file)" : ""}\n\n`;
  md += `| Measure | Target | ${sums.map(([t]) => t).join(" | ")} |\n`;
  md += `|---|---|${sums.map(() => "---:").join("|")}|\n`;
  const row = (label, target, get) => {
    md += `| ${label} | ${target} | ${sums
      .map(([, s]) => {
        const e = s.files.find((f) => f.file === file);
        return e ? get(e) : "–";
      })
      .join(" | ")} |\n`;
  };
  row("Cold start (ms)", "≤ 1000", (e) => n(e.coldStartMs) + ok(e.coldStartMs, C.cold));
  row("First page visible (ms)", "≤ 1500", (e) => n(e.firstPageMs) + ok(e.firstPageMs, C.first));
  for (const z of ["fit", "400", "1600"]) {
    const label = z === "fit" ? "fit page" : `${z}%`;
    row(`Pan fps, ${label}`, "≥ 50", (e) => n(e.zooms[z].panFps) + ok(e.zooms[z].panFps, C.fps, true));
  }
  row("Settle → sharp, fit (ms)", "≤ 300", (e) => n(e.zooms.fit.settleMs) + ok(e.zooms.fit.settleMs, C.settleFit));
  row("Settle → sharp, 400% (ms)", "–", (e) => n(e.zooms["400"].settleMs));
  row("Settle → sharp, 1600% (ms)", "≤ 500", (e) => n(e.zooms["1600"].settleMs) + ok(e.zooms["1600"].settleMs, C.settle1600));
  row("Peak memory (MB)", "< 1536", (e) => n(e.peakMemMb) + ok(e.peakMemMb, C.mem));
  row("Worst pan frame (ms)", "–", (e) => n(Math.max(...["fit", "400", "1600"].map((z) => e.zooms[z].maxIntervalMs ?? 0)), 0));
  row("Missing tiles / errors", "none", (e) => {
    const inc = ["fit", "400", "1600"].reduce((a, z) => a + e.zooms[z].incomplete + e.zooms[z].timeouts, 0);
    return inc || e.renderErrors || e.errors.length ? `${inc} / ${e.renderErrors + e.errors.length}` : "none";
  });
}
console.log(md);
