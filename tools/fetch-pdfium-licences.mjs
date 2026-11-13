// Fetch the licences for PDFium and the libraries built into pdfium.dll, for the notices file
// (tools/make-notices.mjs). Run after updating PDFium: it reads the build number from
// src-tauri/pdfium/VERSION and writes src-tauri/licenses/pdfium/, which is committed.
//
//   node tools/fetch-pdfium-licences.mjs
//
// Sources: PDFium's own tree at the matching chromium/<build> branch, and the upstream
// mirrors on chromium.googlesource.com for libraries PDFium pulls in through DEPS (their
// licence texts rarely change, so the main branch is used; GitHub for the external ones). The list follows the libraries
// named in PDFium's third_party/README.pdfium files and DEPS for a build without XFA or V8,
// which is how bblanchon/pdfium-binaries builds it (src-tauri/pdfium/args.gn). Including a
// licence for something not linked in is harmless; missing one isn't, so it errs wide.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(root, "src-tauri/pdfium/VERSION"), "utf8");
const build = /BUILD=(\d+)/.exec(version)?.[1];
if (!build) throw new Error("No BUILD= in src-tauri/pdfium/VERSION");

const pdfium = (path) => `https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/${build}/${path}?format=TEXT`;
/** A file in a chromium.googlesource.com mirror, on its main or master branch (they differ). */
const chromium = (repo, path) => ["main", "master"].map((b) => `https://chromium.googlesource.com/${repo}/+/refs/heads/${b}/${path}?format=TEXT`);

/** A file on GitHub, plain text (the googlesource mirrors of these have no branches to name). */
const github = (repo, path) => ["main", "master"].map((b) => `https://raw.githubusercontent.com/${repo}/${b}/${path}`);

/** [title, url or urls, ...fallbacks] */
const SOURCES = [
  ["PDFium", pdfium("LICENSE")],
  ["Anti-Grain Geometry 2.3", pdfium("third_party/agg23/copying")],
  ["C++ Big Integer Library", pdfium("third_party/bigint/LICENSE")],
  ["Little CMS", pdfium("third_party/lcms/src/LICENSE"), pdfium("third_party/lcms/LICENSE")],
  ["OpenJPEG", pdfium("third_party/libopenjpeg/src/LICENSE"), pdfium("third_party/libopenjpeg/LICENSE")],
  ["Highway", pdfium("third_party/highway/LICENSE")],
  ["FP16", pdfium("third_party/fp16/LICENSE")],
  ["FreeType (FreeType License)", pdfium("third_party/freetype/FTL.TXT"), chromium("chromium/src/third_party/freetype2", "docs/FTL.TXT")],
  ["libjpeg-turbo", chromium("chromium/deps/libjpeg_turbo", "LICENSE.md")],
  ["libjpeg-turbo: Independent JPEG Group", chromium("chromium/deps/libjpeg_turbo", "README.ijg")],
  ["libpng", chromium("chromium/src/third_party/libpng", "LICENSE")],
  ["zlib", chromium("chromium/src/third_party/zlib", "LICENSE")],
  ["Abseil", chromium("chromium/src/third_party/abseil-cpp", "LICENSE")],
  ["simdutf", chromium("chromium/src/third_party/simdutf", "LICENSE")],
  ["fast_float", github("fastfloat/fast_float", "LICENSE-MIT")],
  ["Dragonbox (Apache 2.0 with LLVM exception)", github("jk-jeon/dragonbox", "LICENSE-Apache2-LLVM")],
  ["Dragonbox (Boost)", github("jk-jeon/dragonbox", "LICENSE-Boost")],
  ["HarfBuzz", github("harfbuzz/harfbuzz", "COPYING")],
  ["cpu_features", github("google/cpu_features", "LICENSE")],
  ["ICU", chromium("chromium/deps/icu", "LICENSE")],
];

const out = join(root, "src-tauri/licenses/pdfium");
mkdirSync(out, { recursive: true });

const parts = [];
for (const [title, ...given] of SOURCES) {
  const urls = given.flat();
  let text = null;
  for (const url of urls) {
    // googlesource throttles bursts: retry a refusal that isn't "not found" after a pause.
    for (let attempt = 0; attempt < 4 && text === null; attempt++) {
      const r = await fetch(url);
      // googlesource answers ?format=TEXT in base64; GitHub's raw files are plain.
      if (r.ok) text = url.includes("format=TEXT") ? Buffer.from(await r.text(), "base64").toString("utf8") : await r.text();
      else if (r.status === 404) break;
      else await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
    if (text !== null) break;
  }
  if (text === null) throw new Error(`Couldn't fetch the licence for ${title}: ${urls.join(" , ")}`);
  console.log(`[licences] ${title}: ${text.length} chars`);
  parts.push({ title, text: text.replace(/\r\n/g, "\n").trimEnd() });
}

const header = `PDFium build ${build} (prebuilt by bblanchon/pdfium-binaries) and the libraries built into it.\n` +
  `Fetched by tools/fetch-pdfium-licences.mjs.\n`;
writeFileSync(join(out, "PDFIUM-LICENCES.txt"), header + parts.map((p) => `\n\n==== ${p.title} ====\n\n${p.text}\n`).join(""));
console.log(`[licences] wrote src-tauri/licenses/pdfium/PDFIUM-LICENCES.txt`);
