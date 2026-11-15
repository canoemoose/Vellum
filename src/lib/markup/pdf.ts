// From page coordinates to the PDF: the page frame (rotation and page box, from the backend's
// doc_page_frame, mirroring text::PageFrame in src-tauri/src/text.rs), and drawing operations
// as an appearance stream's operators in PDF user space. Pure.

import type { Pt, Rect } from "./types";
import type { Op } from "./ops";
import { baseFont, fontResource, pdfString } from "./fonts";
// Stamps
import { imageResName } from "./stamps";

/** A page's /Rotate (quarter turns clockwise) and visible box in user space [l, b, r, t]. */
export interface Frame {
  quarterTurns: number;
  bbox: [number, number, number, number];
}

/** A page point (y down, rotation applied) in PDF user space: the inverse of PageFrame::to_page. */
export function toUser(f: Frame, x: number, y: number): Pt {
  const [l, b, r, t] = f.bbox;
  switch (((f.quarterTurns % 4) + 4) % 4) {
    case 1:
      return [y + l, x + b];
    case 2:
      return [r - x, y + b];
    case 3:
      return [r - y, t - x];
    default:
      return [x + l, t - y];
  }
}

/** A user-space point back on the page (PageFrame::to_page). */
export function toPage(f: Frame, x: number, y: number): Pt {
  const [l, b, r, t] = f.bbox;
  switch (((f.quarterTurns % 4) + 4) % 4) {
    case 1:
      return [y - b, x - l];
    case 2:
      return [r - x, y - b];
    case 3:
      return [t - y, r - x];
    default:
      return [x - l, t - y];
  }
}

/** A page rectangle in user space. */
export function rectToUser(f: Frame, r: Rect): Rect {
  const a = toUser(f, r[0], r[1]);
  const b = toUser(f, r[2], r[3]);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** A direction (not a point) in user space. */
function dirToUser(f: Frame, d: Pt): Pt {
  const o = toUser(f, 0, 0);
  const p = toUser(f, d[0], d[1]);
  return [p[0] - o[0], p[1] - o[1]];
}

/** Compact number: at most 3 decimals, no trailing zeros. */
export function n(v: number): string {
  const s = v.toFixed(3).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

const rgb = (c: [number, number, number]) => `${n(c[0])} ${n(c[1])} ${n(c[2])}`;

export interface Content {
  ops: string;
  /** Line (/CA) and fill (/ca) opacity for /GS0, if any operation uses it. */
  opacity: number | null;
  fillOpacity: number | null;
  /** The fonts used: resource name to /BaseFont. */
  fonts: Record<string, string>;
}

/** Drawing operations as appearance-stream operators in user space. */
export function toContent(f: Frame, ops: Op[]): Content {
  const out: string[] = [];
  let opacity: number | null = null;
  let fillOpacity: number | null = null;
  const fonts: Record<string, string> = {};
  const pt = (x: number, y: number) => {
    const u = toUser(f, x, y);
    return `${n(u[0])} ${n(u[1])}`;
  };
  for (const op of ops) {
    out.push("q");
    // Stamps
    if (op.t === "image") {
      // The image's unit square onto its box: (0, 0) is the picture's bottom left, which sits
      // at the box's bottom left on the page (y down); worked out through toUser so a rotated
      // page keeps the picture upright as rendered.
      const [x0, y0, x1, y1] = op.rect;
      const o = toUser(f, x0, y1), u = toUser(f, x1, y1), v = toUser(f, x0, y0);
      out.push(`${n(u[0] - o[0])} ${n(u[1] - o[1])} ${n(v[0] - o[0])} ${n(v[1] - o[1])} ${n(o[0])} ${n(o[1])} cm`, `/${imageResName(op.hash)} Do`, "Q");
      continue;
    }

    // Text markups
    if (op.t === "path") {
      // One /GS0 serves every path: a markup's paths share its style.
      const so = !!op.stroke && op.strokeOpacity < 1, fo = !!op.fill && op.fillOpacity < 1;
      if (so) opacity = op.strokeOpacity;
      if (fo) fillOpacity = op.fillOpacity;
      if (so || fo) out.push("/GS0 gs");
      if (op.stroke) out.push(`${rgb(op.stroke)} RG`);
      if (op.fill) out.push(`${rgb(op.fill)} rg`);
      out.push(`${n(op.width)} w`, op.decoration ? "1 j 0 J" : "1 j 1 J");
      if (op.dash?.length) out.push(`[${op.dash.map(n).join(" ")}] 0 d`);
      for (const s of op.segs) {
        if (s[0] === "M") out.push(`${pt(s[1], s[2])} m`);
        else if (s[0] === "L") out.push(`${pt(s[1], s[2])} l`);
        else if (s[0] === "C") out.push(`${pt(s[1], s[2])} ${pt(s[3], s[4])} ${pt(s[5], s[6])} c`);
        else out.push("h");
      }
      out.push(op.fill && op.stroke ? "B" : op.fill ? "f" : op.stroke ? "S" : "n");
    } else {
      const res = fontResource(op.face);
      fonts[res] = baseFont(op.face);
      if (op.clip) {
        out.push(`${pt(op.clip[0][0], op.clip[0][1])} m`);
        for (const p of op.clip.slice(1)) out.push(`${pt(p[0], p[1])} l`);
        out.push("h W n");
      }
      // Reading direction and "up" on the page (y down: up is the direction rotated back a
      // quarter turn), carried into user space, so the text stays upright on screen.
      const d = dirToUser(f, op.dir);
      const up = dirToUser(f, [op.dir[1], -op.dir[0]]);
      out.push("BT", `${rgb(op.colour)} rg`, `/${res} ${n(op.size)} Tf`);
      op.lines.forEach((line, i) => {
        // Line i starts i leadings "down" from the first, down being (-dir.y, dir.x) on the page.
        // Moved along the line by its alignment offset.
        const o = op.offsets[i] ?? 0;
        const u = toUser(f, op.origin[0] - op.dir[1] * i * op.leading + op.dir[0] * o, op.origin[1] + op.dir[0] * i * op.leading + op.dir[1] * o);
        out.push(`${n(d[0])} ${n(d[1])} ${n(up[0])} ${n(up[1])} ${n(u[0])} ${n(u[1])} Tm`, `(${pdfString(line)}) Tj`);
      });
      out.push("ET");
    }
    out.push("Q");
  }
  // /GS0 sets both, so when it's used, name both (1 for whichever isn't see-through).
  if (opacity !== null || fillOpacity !== null) {
    opacity ??= 1;
    fillOpacity ??= 1;
  }
  return { ops: out.join("\n"), opacity, fillOpacity, fonts };
}
