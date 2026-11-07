#!/usr/bin/env node
// Synthetic stress PDFs for the Vellum rendering spike (brief section 6.1).
// Zero dependencies: writes PDF syntax directly. Output is deterministic (seeded PRNG).
//
//   node tools/gen-synthetic.mjs [outDir]      (default: bench-output/synthetic)
//
// 1-a1-200k-lines.pdf    A1, 200,000 vector line segments plus hatching
// 2-a1-50k-text.pdf      A1, 50,000 small text objects (dimension-heavy drawing)
// 3-a3-40-pages.pdf      40-page A3 drawing set, moderate density per page
// 4-a1-raster.pdf        A1, one 8,000 x 6,000 px embedded raster with vectors over it
// 5-a4-300-pages.pdf     300-page ordinary text document

import { deflateSync } from "node:zlib";
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.argv[2] ?? join(root, "bench-output", "synthetic");
mkdirSync(outDir, { recursive: true });

// Paper sizes in points (landscape for drawings).
const A1 = { w: 2384, h: 1684 };
const A3 = { w: 1191, h: 842 };
const A4 = { w: 595, h: 842 };

// ------------------------------------------------------------------ PRNG

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n) => (Math.round(n * 100) / 100).toString(); // compact coordinates

// ------------------------------------------------------------------ PDF writer

class Pdf {
  constructor() {
    this.objects = []; // index = object number - 1; each a Buffer
  }
  alloc() {
    this.objects.push(null);
    return this.objects.length;
  }
  dict(n, body) {
    this.objects[n - 1] = Buffer.from(`${n} 0 obj\n${body}\nendobj\n`, "latin1");
  }
  stream(n, dictBody, data, compress = true) {
    const raw = typeof data === "string" ? Buffer.from(data, "latin1") : data;
    const body = compress ? deflateSync(raw, { level: 6 }) : raw;
    const head = Buffer.from(
      `${n} 0 obj\n<< ${dictBody} /Length ${body.length}${compress ? " /Filter /FlateDecode" : ""} >>\nstream\n`,
      "latin1",
    );
    this.objects[n - 1] = Buffer.concat([head, body, Buffer.from("\nendstream\nendobj\n", "latin1")]);
  }
  /** pages: [{ size, content (string), resources (string) }] */
  static build(pages, extra = () => ({})) {
    const pdf = new Pdf();
    const catalog = pdf.alloc();
    const pagesObj = pdf.alloc();
    const helv = pdf.alloc();
    const times = pdf.alloc();
    pdf.dict(helv, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    pdf.dict(times, "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>");
    const xobjs = extra(pdf); // { name: objNum }
    const xobjRes = Object.keys(xobjs).length
      ? `/XObject << ${Object.entries(xobjs).map(([k, v]) => `/${k} ${v} 0 R`).join(" ")} >>`
      : "";
    const kids = [];
    for (const p of pages) {
      const pageObj = pdf.alloc();
      const contentObj = pdf.alloc();
      pdf.stream(contentObj, "", p.content);
      pdf.dict(
        pageObj,
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${p.size.w} ${p.size.h}] ` +
          `/Resources << /Font << /F1 ${helv} 0 R /F2 ${times} 0 R >> ${xobjRes} >> /Contents ${contentObj} 0 R >>`,
      );
      kids.push(`${pageObj} 0 R`);
    }
    pdf.dict(pagesObj, `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`);
    pdf.dict(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
    return pdf;
  }
  write(path) {
    const fd = openSync(path, "w");
    let pos = 0;
    const put = (buf) => {
      writeSync(fd, buf);
      pos += buf.length;
    };
    put(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1"));
    const offsets = [];
    for (const o of this.objects) {
      offsets.push(pos);
      put(o);
    }
    const xref = pos;
    let x = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) x += `${String(off).padStart(10, "0")} 00000 n \n`;
    x += `trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    put(Buffer.from(x, "latin1"));
    closeSync(fd);
    return pos;
  }
}

// ------------------------------------------------------------------ drawing helpers

/** Accumulates content-stream operators and counts line segments. */
class Ops {
  constructor() {
    this.parts = [];
    this.segments = 0;
    this.texts = 0;
  }
  push(s) {
    this.parts.push(s);
  }
  toString() {
    return this.parts.join("\n");
  }
  style(w, rgb) {
    this.push(`${f(w)} w ${rgb.map(f).join(" ")} RG`);
  }
  line(x1, y1, x2, y2, stroke = true) {
    this.push(`${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l${stroke ? " S" : ""}`);
    this.segments++;
  }
  rect(x, y, w, h) {
    // Four explicit segments, as CAD exports usually emit them.
    this.push(`${f(x)} ${f(y)} m ${f(x + w)} ${f(y)} l ${f(x + w)} ${f(y + h)} l ${f(x)} ${f(y + h)} l h`);
    this.segments += 4;
  }
  text(x, y, size, s, rot = 0, font = "F1") {
    if (rot) {
      const c = Math.cos(rot), n = Math.sin(rot);
      this.push(`BT /${font} ${f(size)} Tf ${f(c)} ${f(n)} ${f(-n)} ${f(c)} ${f(x)} ${f(y)} Tm (${s}) Tj ET`);
    } else {
      this.push(`BT /${font} ${f(size)} Tf ${f(x)} ${f(y)} Td (${s}) Tj ET`);
    }
    this.texts++;
  }
  /** 45-degree hatching inside a rectangle, clipped. Returns segments added. */
  hatch(x, y, w, h, spacing) {
    this.push(`q ${f(x)} ${f(y)} ${f(w)} ${f(h)} re W n`);
    for (let d = -h; d < w; d += spacing) {
      this.line(x + d, y, x + d + h, y + h, false);
    }
    this.push("S Q");
  }
}

const COLOURS = [
  [0, 0, 0],
  [0.35, 0.35, 0.35],
  [0.8, 0.1, 0.1],
  [0.1, 0.3, 0.8],
  [0.1, 0.55, 0.2],
];

function titleBlock(o, size, title) {
  o.style(1.2, [0, 0, 0]);
  o.rect(20, 20, size.w - 40, size.h - 40);
  o.push("S");
  o.rect(size.w - 420, 20, 400, 110);
  o.push("S");
  o.text(size.w - 410, 100, 14, title);
  o.text(size.w - 410, 75, 8, "Vellum synthetic stress drawing - not to scale");
  o.text(size.w - 410, 55, 8, "Generated by tools/gen-synthetic.mjs");
}

/** Seating blocks: rows of small chair squares along arcs. Heavy on short segments. */
function seating(o, rnd, cx, cy, rows, perRow, r0, spread, chair) {
  for (let r = 0; r < rows; r++) {
    const radius = r0 + r * chair * 1.6;
    for (let k = 0; k < perRow; k++) {
      const a = -spread / 2 + (spread * k) / Math.max(1, perRow - 1) - Math.PI / 2;
      const x = cx + radius * Math.cos(a);
      const y = cy + radius * Math.sin(a);
      o.rect(x - chair / 2, y - chair / 2, chair, chair * 0.8);
    }
  }
  o.push("S");
}

// ------------------------------------------------------------------ file 1

function file1() {
  const rnd = mulberry32(1);
  const o = new Ops();
  const size = A1;
  titleBlock(o, size, "1 - A1, 200k line segments + hatching");

  // Structural grid.
  o.style(0.25, [0.6, 0.6, 0.6]);
  for (let x = 60; x < size.w - 60; x += 24) o.line(x, 60, x, size.h - 160);
  for (let y = 160; y < size.h - 60; y += 24) o.line(60, y, size.w - 60, y);

  // Seating bowls, batched into large paths (one stroke per block).
  o.style(0.2, [0.1, 0.3, 0.8]);
  const target = 200000;
  let blocks = 0;
  while (o.segments < target * 0.6) {
    const cx = 200 + rnd() * (size.w - 400);
    const cy = 300 + rnd() * (size.h - 500);
    seating(o, rnd, cx, cy, 12 + Math.floor(rnd() * 10), 40 + Math.floor(rnd() * 40), 30 + rnd() * 60, 1.2 + rnd(), 2.2);
    blocks++;
  }

  // Individually stroked lines (cable runs, truss, set pieces), mixed widths and colours.
  while (o.segments < target) {
    o.style([0, 0.25, 0.5, 1][Math.floor(rnd() * 4)], COLOURS[Math.floor(rnd() * COLOURS.length)]);
    const n = 50 + Math.floor(rnd() * 150);
    let x = 80 + rnd() * (size.w - 160);
    let y = 180 + rnd() * (size.h - 260);
    for (let i = 0; i < n && o.segments < target; i++) {
      const nx = Math.min(size.w - 60, Math.max(60, x + (rnd() - 0.5) * 40));
      const ny = Math.min(size.h - 60, Math.max(160, y + (rnd() - 0.5) * 40));
      o.line(x, y, nx, ny);
      x = nx;
      y = ny;
    }
  }
  const lineSegments = o.segments;

  // Hatching: 160 regions of 45-degree hatch.
  o.style(0.15, [0.3, 0.3, 0.3]);
  for (let i = 0; i < 160; i++) {
    const w = 40 + rnd() * 160;
    const h = 30 + rnd() * 120;
    o.hatch(80 + rnd() * (size.w - 260), 180 + rnd() * (size.h - 360), w, h, 1.5 + rnd() * 2);
  }
  return { pages: [{ size, content: o.toString() }], note: `${lineSegments} line segments + ${o.segments - lineSegments} hatch segments, ${blocks} seating blocks` };
}

// ------------------------------------------------------------------ file 2

function file2() {
  const rnd = mulberry32(2);
  const o = new Ops();
  const size = A1;
  titleBlock(o, size, "2 - A1, 50k text objects");
  o.style(0.15, [0.2, 0.2, 0.2]);
  for (let n = 0; n < 50000; n++) {
    const x = 60 + rnd() * (size.w - 140);
    const y = 160 + rnd() * (size.h - 240);
    const vertical = rnd() < 0.3;
    const len = 8 + rnd() * 30;
    const val = (len * 25).toFixed(rnd() < 0.5 ? 0 : 1);
    if (vertical) {
      o.line(x, y, x, y + len);
      o.text(x - 1, y + 2, 2.5, val, Math.PI / 2);
    } else {
      o.line(x, y, x + len, y);
      o.text(x + 2, y + 1, 2.5, val);
    }
  }
  return { pages: [{ size, content: o.toString() }], note: `${o.texts} text objects, ${o.segments} dimension segments` };
}

// ------------------------------------------------------------------ file 3

function file3() {
  const pages = [];
  let seg = 0, txt = 0;
  for (let p = 0; p < 40; p++) {
    const rnd = mulberry32(300 + p);
    const o = new Ops();
    const size = A3;
    titleBlock(o, size, `3 - A3 set, sheet ${p + 1} of 40`);
    o.style(0.25, [0.6, 0.6, 0.6]);
    for (let x = 40; x < size.w - 40; x += 20) o.line(x, 40, x, size.h - 140);
    o.style(0.2, [0.1, 0.3, 0.8]);
    for (let b = 0; b < 4; b++)
      seating(o, rnd, 150 + rnd() * (size.w - 300), 200 + rnd() * (size.h - 400), 10, 40, 40, 1.4, 2.2);
    o.style(0.5, [0, 0, 0]);
    while (o.segments < 9000) {
      const x = 50 + rnd() * (size.w - 100), y = 150 + rnd() * (size.h - 200);
      o.line(x, y, x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 60);
    }
    for (let t = 0; t < 600; t++)
      o.text(50 + rnd() * (size.w - 120), 150 + rnd() * (size.h - 200), 3, (rnd() * 9999).toFixed(0));
    o.style(0.15, [0.3, 0.3, 0.3]);
    for (let h = 0; h < 6; h++) o.hatch(60 + rnd() * (size.w - 260), 160 + rnd() * (size.h - 360), 60 + rnd() * 120, 40 + rnd() * 80, 2.5);
    seg += o.segments;
    txt += o.texts;
    pages.push({ size, content: o.toString() });
  }
  return { pages, note: `40 pages, ~${Math.round(seg / 40)} segments and ${Math.round(txt / 40)} texts per page` };
}

// ------------------------------------------------------------------ file 4

function file4() {
  const W = 8000, H = 6000;
  const rnd = mulberry32(4);
  // Aerial-photo-ish content: smooth large-scale variation plus low-amplitude noise,
  // so it neither compresses to nothing nor balloons the file.
  const img = Buffer.allocUnsafe(W * H * 3);
  let k = 0;
  for (let y = 0; y < H; y++) {
    const sy1 = Math.sin(y / 310), sy2 = Math.sin(y / 47 + 1.3);
    for (let x = 0; x < W; x++) {
      const v = 128 + 50 * Math.sin(x / 420) * sy1 + 25 * Math.sin(x / 61) * sy2;
      const n = (rnd() * 12) | 0;
      img[k++] = Math.max(0, Math.min(255, v * 0.9 + n));
      img[k++] = Math.max(0, Math.min(255, v + 10 + n));
      img[k++] = Math.max(0, Math.min(255, v * 0.8 + 20 + n));
    }
  }
  const o = new Ops();
  const size = A1;
  // Image placed over most of the sheet.
  o.push(`q ${size.w - 120} 0 0 ${size.h - 220} 60 160 cm /Im1 Do Q`);
  titleBlock(o, size, "4 - A1, 8000x6000 raster + vectors");
  o.style(0.5, [0.9, 0.1, 0.1]);
  const r2 = mulberry32(44);
  while (o.segments < 20000) {
    const x = 80 + r2() * (size.w - 160), y = 180 + r2() * (size.h - 260);
    o.line(x, y, x + (r2() - 0.5) * 80, y + (r2() - 0.5) * 80);
  }
  return {
    pages: [{ size, content: o.toString() }],
    extra: (pdf) => {
      const n = pdf.alloc();
      pdf.stream(n, `/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8`, img);
      return { Im1: n };
    },
    note: `${W}x${H} RGB Flate image, ${o.segments} vector segments over it`,
  };
}

// ------------------------------------------------------------------ file 5

const WORDS = (
  "the of and to in is that for it as with was on be by this are from or at an have not which " +
  "rigging truss motor point load venue stage audience sightline barrier riser deck lighting sound " +
  "power distribution cable safety clearance egress capacity schedule build derig crew access " +
  "structure engineer calculation weight span bridle chain hoist steel aluminium certificate"
).split(" ");

function file5() {
  const pages = [];
  const rnd = mulberry32(5);
  for (let p = 0; p < 300; p++) {
    const o = new Ops();
    o.push("0 g");
    o.text(72, 800, 14, `Chapter ${Math.floor(p / 12) + 1}`, 0, "F2");
    let y = 770;
    while (y > 80) {
      let line = "";
      while (line.length < 88) line += WORDS[Math.floor(rnd() * WORDS.length)] + " ";
      o.text(72, y, 10.5, line.trim(), 0, "F2");
      y -= 13.5;
    }
    o.text(A4.w / 2 - 8, 40, 9, String(p + 1), 0, "F2");
    pages.push({ size: A4, content: o.toString() });
  }
  return { pages, note: "300 pages of Times-Roman body text" };
}

// ------------------------------------------------------------------ main

const files = [
  ["1-a1-200k-lines.pdf", file1],
  ["2-a1-50k-text.pdf", file2],
  ["3-a3-40-pages.pdf", file3],
  ["4-a1-raster.pdf", file4],
  ["5-a4-300-pages.pdf", file5],
];

const only = process.env.ONLY;
for (const [name, gen] of files) {
  if (only && !name.startsWith(only)) continue;
  const t0 = Date.now();
  const r = gen();
  const pdf = Pdf.build(r.pages, r.extra);
  const bytes = pdf.write(join(outDir, name));
  console.log(`${name}: ${(bytes / 1e6).toFixed(1)} MB, ${r.note} (${Date.now() - t0} ms)`);
}
