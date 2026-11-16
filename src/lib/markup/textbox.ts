// A text box's drawing, annotation keys and sizing: shared by the text box (kinds/text.ts) and
// the callout (kinds/callout.ts), which is a text box with a leader. A toolkit, as shape.ts and
// draw.ts are, so neither kind imports the other. Pure.

import { type HandleId, dragBox } from "./shape";
import { type MarkupBase, type Pt, type Rect, type Rgb, type Style, type TextStyle, faceOf, fullText, normRect } from "./base";
import { type Op, type Seg, ASCENT, TEXT_PAD, box, filled, innerWidth, path, textHeight, textLines } from "./draw";
import { fontResource, textWidth } from "./fonts";
import { type AnnotSpec, hex, r3 } from "./annotation";
import type { Frame } from "./pdf";

/** What a text box holds: a box, its text and text style, and the markup's style. */
export interface TextBox {
  rect: Rect;
  text: string;
  textStyle: TextStyle;
  style: Style;
}

/** A FreeText annotation's keys for a text box: its text, /DA, /DS, /Q, background, /Rotate. */
export function textBoxSpec(m: TextBox, f: Frame, spec: AnnotSpec): void {
  const s = m.style;
  spec.subtype = "FreeText";
  spec.contents = m.text;
  // For apps that redraw the box themselves (Acrobat when it's edited there).
  const t = fullText(m.textStyle);
  const c = t.colour;
  const face = faceOf(t);
  const css = t.family === "times" ? "Times New Roman,serif" : t.family === "courier" ? "Courier New,monospace" : "Helvetica,sans-serif";
  const deco = [t.underline ? "underline" : "", t.strike ? "line-through" : ""].filter(Boolean).join(" ");
  spec.defaultAppearance = `${c.map((v) => r3(v)).join(" ")} rg /${fontResource(face)} ${r3(t.size)} Tf`;
  spec.defaultStyle =
    `font: ${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${r3(t.size)}pt ${css}; text-align:${t.align}; color:${hex(c)}` +
    (deco ? `; text-decoration:${deco}` : "");
  spec.quadding = t.align === "center" ? 1 : t.align === "right" ? 2 : 0;
  // FreeText: /C is the background (ISO 32000-1, 12.5.6.6), not the border.
  delete spec.colour;
  delete spec.interior;
  if (s.fill) spec.colour = s.fill;
  // Acrobat keeps text upright on a rotated page, when it redraws it, by this.
  if (f.quarterTurns % 4) spec.rotate = (((f.quarterTurns % 4) + 4) % 4) * 90;
}

/** The box with grip `h` dragged to p, stopped where its text would no longer fit. */
export function dragTextBox(m: TextBox, h: HandleId, p: Pt, constrain: boolean, minSize: number): Rect {
  const old = normRect(m.rect);
  return holdText(m, dragBox(old, h, p, constrain, minSize), h, old);
}

/** A text box's drawing: its border and background, the text, and any underline or strikethrough. */
export function textOps(r: Rect, text: string, ts: TextStyle, s: Style): Op[] {
  const t = fullText(ts);
  const size = t.size, colour: Rgb = t.colour;
  const [x0, y0, x1, y1] = normRect(r);
  const ops: Op[] = [];
  // The border sits inside the box: its centre half a weight in, its inner edge a whole weight.
  if (s.width > 0) ops.push(...filled(box(x0, y0, x1, y1, s.width / 2), () => box(x0, y0, x1, y1, s.width), s));
  else if (s.fill) ops.push(path(box(x0, y0, x1, y1, 0), s, s.fill, null));
  const inset = TEXT_PAD + s.width;
  const face = faceOf(t);
  const lines = textLines(text, r, t, s.width);
  const inner = innerWidth(r, size, s.width);
  const widths = lines.map((l) => textWidth(l, size, face));
  const offsets = widths.map((w) => (t.align === "center" ? (inner - w) / 2 : t.align === "right" ? inner - w : 0));
  const origin: Pt = [x0 + inset, y0 + inset + size * ASCENT];
  const leading = size * t.spacing;
  const clip: Pt[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  ops.push({ t: "text", lines, origin, dir: [1, 0], size, leading, colour, clip, face, offsets });
  // Underline and strikethrough: a line under or through each line of text, a twentieth of the
  // size thick, the underline a tenth of the size below the baseline (as the fonts have it).
  if (t.underline || t.strike) {
    const segs: Seg[] = [];
    const thick = Math.max(0.3, size / 20);
    lines.forEach((l, i) => {
      if (!l.trim()) return;
      const y = origin[1] + i * leading;
      const xa = origin[0] + offsets[i], xb = xa + widths[i];
      if (t.underline) segs.push(["M", xa, y + size * 0.1], ["L", xb, y + size * 0.1]);
      if (t.strike) segs.push(["M", xa, y - size * 0.28], ["L", xb, y - size * 0.28]);
    });
    if (segs.length) ops.push({ t: "path", segs, stroke: colour, fill: null, width: thick, dash: null, strokeOpacity: 1, fillOpacity: 1, decoration: true });
  }
  return ops;
}

/**
 * A text box being resized to `r` by handle `h`, stopped where its text would no longer fit:
 * a top or bottom edge stops at the height the text needs (at the new width); a side edge stops
 * at the narrowest width whose wrapped text still fits the height.
 */
function holdText(m: TextBox, r: Rect, h: HandleId, old: Rect): Rect {
  const need = (w: number) => textHeight(textLines(m.text, [0, 0, w, 0], m.textStyle, m.style.width).length, m.textStyle, m.style.width);
  let [x0, y0, x1, y1] = r;
  if (h.includes("n") || h.includes("s")) {
    const n = need(x1 - x0);
    if (y1 - y0 < n) {
      if (h.includes("n")) y0 = y1 - n;
      else y1 = y0 + n;
    }
    return [x0, y0, x1, y1];
  }
  // A side: the height stays, so the width can't go below what fits in it.
  const height = y1 - y0;
  if (need(x1 - x0) <= height) return r;
  let lo = x1 - x0, hi = Math.max(lo, old[2] - old[0]);
  // (If even the old width didn't fit, it stays at the old width.)
  for (let i = 0; i < 24 && need(hi) <= height; i++) {
    const mid = (lo + hi) / 2;
    if (need(mid) <= height) hi = mid;
    else lo = mid;
  }
  return h.includes("w") ? [x1 - hi, y0, x1, y1] : [x0, y0, x0 + hi, y1];
}

/** The height a text box's text needs at its width. */
function textNeed(m: TextBox): number {
  const r = normRect(m.rect);
  return textHeight(textLines(m.text, r, m.textStyle, m.style.width).length, m.textStyle, m.style.width);
}

/**
 * Grow (never shrink) a text box, or any markup holding text in a box (a callout), so its
 * text fits its width. Anything else passes through.
 */
export function fitText<M extends MarkupBase & { kind: string }>(m: M): M {
  if (!("rect" in m && "text" in m && "textStyle" in m)) return m;
  return fitBox(m as unknown as TextBox) as unknown as M;
}

function fitBox<M extends TextBox>(t: M): M {
  const r = normRect(t.rect);
  const need = textNeed(t);
  return r[3] - r[1] >= need ? { ...t, rect: r } : { ...t, rect: [r[0], r[1], r[2], r[1] + need] as Rect };
}

/**
 * A text box after its text size or border weight changed: a box that fitted its text snugly
 * stays snug (shrinking with smaller text too); one made taller by hand only grows if it must.
 */
export function refitText<M extends TextBox>(before: TextBox, after: M): M {
  const r = normRect(before.rect);
  const snug = r[3] - r[1] <= textNeed(before) + 0.5;
  if (!snug) return fitBox(after);
  return { ...after, rect: [r[0], r[1], r[2], r[1] + textNeed(after)] };
}
