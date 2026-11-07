// Copies the pdf.js runtime assets (CMaps, standard font data, WASM decoders,
// ICC profiles) into public/pdfjs so Vite serves them in dev and bundles them in
// the build. Runs automatically after `npm install`. The output is git-ignored.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

if (!existsSync(src)) {
  console.log("copy-pdfjs-assets: pdfjs-dist not installed yet, skipping");
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true });
}
console.log("copy-pdfjs-assets: copied to public/pdfjs");
