#!/usr/bin/env node
// Downloads a prebuilt PDFium (BSD/Apache licensed) for Windows x64 from
// github.com/bblanchon/pdfium-binaries into src-tauri/pdfium/ (git-ignored).
// Only needed for the PDFium renderer (`--renderer pdfium`).
//
//   node tools/fetch-pdfium.mjs

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "chromium/8138"; // pinned; matches pdfium-render's pdfium_latest bindings
const ASSET = "pdfium-win-x64.tgz";
const url = `https://github.com/bblanchon/pdfium-binaries/releases/download/${VERSION}/${ASSET}`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "src-tauri", "pdfium");
const dll = join(dest, "bin", "pdfium.dll");

if (existsSync(dll) && !process.argv.includes("--force")) {
  console.log(`fetch-pdfium: already present at ${dll}`);
  process.exit(0);
}

console.log(`fetch-pdfium: downloading ${url}`);
const res = await fetch(url);
if (!res.ok) {
  console.error(`fetch-pdfium: download failed (HTTP ${res.status})`);
  process.exit(1);
}
const buf = Buffer.from(await res.arrayBuffer());
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
const tgz = join(dest, ASSET);
writeFileSync(tgz, buf);
// Windows 10+ ships bsdtar as tar.exe, which reads .tgz.
execFileSync("tar", ["-xzf", ASSET], { cwd: dest, stdio: "inherit" });
rmSync(tgz);
if (!existsSync(dll)) {
  console.error("fetch-pdfium: archive did not contain bin/pdfium.dll");
  process.exit(1);
}
console.log(`fetch-pdfium: ok (${(buf.length / 1e6).toFixed(1)} MB archive) -> ${dll}`);
