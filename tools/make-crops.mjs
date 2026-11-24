// Cuts the homepage's feature close-ups out of the full screenshots in site/img.
//
//   node tools/make-crops.mjs [--ffmpeg <path>]
//
// Each feature card shows a close-up of the thing it's about rather than a whole shrunken window.
// Cropping in CSS would make every visitor download the full captures, so the crops are written
// as their own small WebP files, dark and light: site/img/crop-<name>-<theme>.webp. Run it again
// whenever a capture changes. Uses ffmpeg (the same tool site/img/README.md converts captures
// with), so it needs no npm packages. Crops stay at the capture's own pixels: the cards show
// them at a little under half that width, so they're sharp on high-DPI screens.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** x, y, width, height in capture pixels (the captures are 2146 x 1343). */
export const CROPS = {
  detail: { from: "detail", x: 750, y: 180, w: 890, h: 600 },
  site: { from: "site", x: 1530, y: 470, w: 610, h: 822 },
  "site-wide": { from: "site", x: 1395, y: 860, w: 745, h: 430 },
  measure: { from: "measure", x: 536, y: 470, w: 1190, h: 760 },
  markup: { from: "markup", x: 900, y: 350, w: 1190, h: 760 },
  print: { from: "print", x: 150, y: 400, w: 1830, h: 600 },
};

const THEMES = ["dark", "light"];

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const img = join(root, "site", "img");
  const arg = process.argv.indexOf("--ffmpeg");
  const ffmpeg = arg > 0 ? process.argv[arg + 1] : "ffmpeg";

  for (const [name, c] of Object.entries(CROPS)) {
    for (const theme of THEMES) {
      const src = join(img, `${c.from}-${theme}.webp`);
      const out = join(img, `crop-${name}-${theme}.webp`);
      if (!existsSync(src)) throw new Error(`make-crops: missing ${src}`);
      execFileSync(ffmpeg, ["-v", "error", "-y", "-i", src, "-vf", `crop=${c.w}:${c.h}:${c.x}:${c.y}`, "-c:v", "libwebp", "-quality", "88", out], { stdio: "inherit" });
      console.log(`make-crops: wrote crop-${name}-${theme}.webp (${c.w} x ${c.h})`);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(e?.message ?? e);
    process.exit(1);
  }
}
