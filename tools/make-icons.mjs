// Builds the app icon set in src-tauri/icons from the SVG sources in src-tauri/icons/source.
//
//   node tools/make-icons.mjs [--edge "C:\path\to\msedge.exe"]
//
// vellum.svg is the icon from 32 px up; vellum-24.svg and vellum-16.svg are hand-drawn for those sizes and
// go into the .ico (the taskbar, title bar and Explorer use them). Rendering uses Microsoft Edge headless,
// which every Windows 10/11 machine has, so the script needs no npm packages. It writes:
//   32x32.png, 128x128.png, 128x128@2x.png, icon.png (512), icon.ico (16-256), icon.icns (16-1024).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconsDir = join(root, "src-tauri", "icons");
const srcDir = join(iconsDir, "source");

const edgeArg = process.argv.indexOf("--edge");
const EDGE_CANDIDATES = [
  edgeArg > 0 ? process.argv[edgeArg + 1] : null,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const edge = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!edge) {
  console.error("make-icons: Microsoft Edge not found; pass --edge <path to msedge.exe>");
  process.exit(1);
}

/** Which drawing each size uses. */
const sourceFor = (size) => (size <= 16 ? "vellum-16.svg" : size <= 24 ? "vellum-24.svg" : "vellum.svg");

const work = mkdtempSync(join(tmpdir(), "vellum-icons-"));
const profile = join(work, "edge-profile");
mkdirSync(profile);

/** Renders one SVG at `size` px square with a transparent background; returns the PNG bytes. */
function render(svgFile, size) {
  const html = join(work, `r${size}.html`);
  const png = join(work, `r${size}-${svgFile}.png`);
  const src = pathToFileURL(join(srcDir, svgFile)).href;
  writeFileSync(
    html,
    `<!doctype html><html><body style="margin:0;background:transparent">` +
      `<img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`,
  );
  execFileSync(
    edge,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      `--user-data-dir=${profile}`,
      "--force-device-scale-factor=1",
      "--default-background-color=00000000",
      `--window-size=${size},${size}`,
      `--screenshot=${png}`,
      pathToFileURL(html).href,
    ],
    { stdio: "ignore", timeout: 60_000 },
  );
  // msedge.exe hands the work to a child process and returns before the screenshot is written, so wait for
  // the file to appear and stop growing.
  if (!waitForFile(png, 30_000)) throw new Error(`Edge produced no image for ${svgFile} at ${size} px`);
  const bytes = readFileSync(png);
  const { width, height } = pngSize(bytes);
  if (width !== size || height !== size) throw new Error(`${svgFile} at ${size} px came out ${width}x${height}`);
  return bytes;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** True once `file` exists and its size has held still for two checks; false after `timeoutMs`. */
function waitForFile(file, timeoutMs) {
  let last = -1;
  for (const end = Date.now() + timeoutMs; Date.now() < end; sleep(150)) {
    if (!existsSync(file)) continue;
    const size = statSync(file).size;
    if (size > 0 && size === last) return true;
    last = size;
  }
  return false;
}

// ------------------------------------------------------------------ PNG reading (just enough for Edge's output)

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Decodes an 8-bit RGB or RGBA, non-interlaced PNG to RGBA pixels, top row first. */
function decodePng(buf) {
  const { width, height } = pngSize(buf);
  const depth = buf[24];
  const colour = buf[25];
  const interlace = buf[28];
  if (depth !== 8 || (colour !== 6 && colour !== 2) || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${depth}, colour type ${colour}, interlace ${interlace})`);
  }
  const chans = colour === 6 ? 4 : 3;
  const idat = [];
  for (let at = 8; at < buf.length; ) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * chans;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= chans ? cur[i - chans] : 0;
      const b = prev[i];
      const c = i >= chans ? prev[i - chans] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = cur[x * chans];
      out[o + 1] = cur[x * chans + 1];
      out[o + 2] = cur[x * chans + 2];
      out[o + 3] = chans === 4 ? cur[x * chans + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, rgba: out };
}

// ------------------------------------------------------------------ ICO and ICNS writing

/** A 32-bit BMP icon image (BITMAPINFOHEADER, bottom-up BGRA, empty AND mask), for sizes under 256. */
function icoBitmap(png) {
  const { width, height, rgba } = decodePng(png);
  const maskStride = Math.ceil(width / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // XOR bitmap plus AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(width * height * 4 + maskStride * height, 20);
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = ((height - 1 - y) * width + x) * 4;
      pixels[d] = rgba[s + 2];
      pixels[d + 1] = rgba[s + 1];
      pixels[d + 2] = rgba[s];
      pixels[d + 3] = rgba[s + 3];
    }
  }
  return Buffer.concat([header, pixels, Buffer.alloc(maskStride * height)]);
}

/** An .ico: bitmaps under 256 px, PNG at 256 (as Windows itself does). */
function buildIco(images) {
  const dir = Buffer.alloc(6 + 16 * images.length);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(images.length, 4);
  const blobs = [];
  let offset = dir.length;
  images.forEach(({ size, png }, i) => {
    const data = size >= 256 ? png : icoBitmap(png);
    const e = 6 + 16 * i;
    dir[e] = size >= 256 ? 0 : size;
    dir[e + 1] = size >= 256 ? 0 : size;
    dir.writeUInt16LE(1, e + 4); // planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
    blobs.push(data);
  });
  return Buffer.concat([dir, ...blobs]);
}

/** An .icns of PNG entries. */
function buildIcns(entries) {
  const parts = entries.map(({ type, png }) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write("icns", 0, "ascii");
  h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

// ------------------------------------------------------------------ build

try {
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const png = {};
  for (const s of sizes) {
    png[s] = render(sourceFor(s), s);
    console.log(`make-icons: rendered ${s} px from ${sourceFor(s)}`);
  }
  writeFileSync(join(iconsDir, "32x32.png"), png[32]);
  writeFileSync(join(iconsDir, "128x128.png"), png[128]);
  writeFileSync(join(iconsDir, "128x128@2x.png"), png[256]);
  writeFileSync(join(iconsDir, "icon.png"), png[512]);
  writeFileSync(join(iconsDir, "icon.ico"), buildIco([16, 24, 32, 48, 64, 256].map((size) => ({ size, png: png[size] }))));
  writeFileSync(
    join(iconsDir, "icon.icns"),
    buildIcns([
      { type: "icp4", png: png[16] },
      { type: "icp5", png: png[32] },
      { type: "icp6", png: png[64] },
      { type: "ic07", png: png[128] },
      { type: "ic08", png: png[256] },
      { type: "ic09", png: png[512] },
      { type: "ic10", png: png[1024] },
    ]),
  );
  console.log(`make-icons: wrote the icon set to ${iconsDir}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
