// Text markups: highlight, underline and strike through over a run of the page's own text, made
// from a text selection (the selection bar, the Edit menu or a shortcut), not drawn with a tool.
// One annotation per page covering every selected line, each line a quad from its characters'
// boxes (text/quads.ts) that follows the text's direction. Saved as Highlight, Underline or
// StrikeOut with /QuadPoints. They select, restyle and delete like any markup but never move
// or resize: they belong to the text. A highlight multiplies, as the highlighter does.

import { type MarkupBase, type Pt, type Rgb, type Style, LINE_STYLE, newId } from "../base";
import { type Op, type Seg, add, mul, sub } from "../draw";
import { distToPolyline, insidePolygon, pointsBounds } from "../shape";
import { userPoints } from "../annotation";
import { defineKind } from "./kind";

export type TextMarkVariant = "highlight" | "underline" | "strike";
export const TEXT_MARK_VARIANTS: TextMarkVariant[] = ["highlight", "underline", "strike"];

/** One line's quad: top left, top right, bottom left, bottom right, along the text. */
export type MarkQuad = [Pt, Pt, Pt, Pt];

export interface TextMarkMarkup extends MarkupBase {
  kind: "textmark";
  variant: TextMarkVariant;
  quads: MarkQuad[];
  /** The text it marks (for the markups list). */
  text: string;
}

declare module "../base" {
  interface MarkupKinds {
    textmark: TextMarkMarkup;
  }
}

const SUBTYPE: Record<TextMarkVariant, string> = { highlight: "Highlight", underline: "Underline", strike: "StrikeOut" };
export const VARIANT_LABEL: Record<TextMarkVariant, string> = { highlight: "Highlight", underline: "Underline", strike: "Strike through" };

/** Each variant's starting colour: the properties bar's yellow, blue and red. */
const COLOUR: Record<TextMarkVariant, Rgb> = { highlight: [0.95, 0.78, 0.0], underline: [0.05, 0.35, 0.8], strike: [0.85, 0.1, 0.1] };

/** A variant's starting style. */
export function textMarkStyle(v: TextMarkVariant): Style {
  return { ...LINE_STYLE, stroke: COLOUR[v], width: 1, opacity: v === "highlight" ? 0.6 : 1 };
}

/**
 * Where a line runs across a quad, as a share of its height from the top: the underline just
 * under the baseline, the strike through the middle of the lower-case letters. Character boxes
 * run from the font's ascent to its descent, so the baseline sits about four fifths down.
 */
const ACROSS: Record<"underline" | "strike", number> = { underline: 0.88, strike: 0.58 };

/** The line's thickness for a quad of height h: a fourteenth of it, at least half a point. */
export const markThickness = (h: number) => Math.max(0.5, h / 14);

const quadHeight = (q: MarkQuad) => Math.hypot(q[2][0] - q[0][0], q[2][1] - q[0][1]);

/** A quad's outline as a closed path (top left, top right, bottom right, bottom left). */
const outline = (q: MarkQuad): Pt[] => [q[0], q[1], q[3], q[2]];

export function textMarkOps(m: TextMarkMarkup): Op[] {
  const s = m.style;
  if (m.variant === "highlight") {
    const segs: Seg[] = m.quads.flatMap((q) => {
      const o = outline(q);
      return [["M", o[0][0], o[0][1]] as Seg, ...o.slice(1).map((p) => ["L", p[0], p[1]] as Seg), ["Z"] as Seg];
    });
    return [{ t: "path", segs, stroke: null, fill: s.stroke, width: 0, dash: null, strokeOpacity: s.opacity, fillOpacity: s.opacity, blend: "multiply" }];
  }
  // Underline and strike through: a line across each quad, its thickness from the quad's height.
  const at = ACROSS[m.variant];
  return m.quads.map((q) => {
    const h = quadHeight(q);
    const a = add(q[0], mul(sub(q[2], q[0]), at));
    const b = add(q[1], mul(sub(q[3], q[1]), at));
    return { t: "path" as const, segs: [["M", a[0], a[1]], ["L", b[0], b[1]]] as Seg[], stroke: s.stroke, fill: null, width: markThickness(h), dash: null, strokeOpacity: s.opacity, fillOpacity: s.opacity, decoration: true };
  });
}

export const textmark = defineKind<TextMarkMarkup>({
  kind: "textmark",
  label: "Text markup",
  labelOf: (m) => VARIANT_LABEL[m.variant],
  defaultStyle: () => textMarkStyle("highlight"),
  controls: { fill: false, ends: false, text: false },
  // Never drawn with a tool (ofText); the gesture is only what the registry needs.
  draw: { gesture: "freehand", make: () => ({ variant: "highlight", quads: [], text: "" }) },
  ops: textMarkOps,
  spec(m, f, spec) {
    spec.subtype = SUBTYPE[m.variant];
    spec.quadPoints = m.quads.flatMap((q) => userPoints(f, q));
    if (m.variant === "highlight") spec.blend = "Multiply";
    // No border: a text markup is drawn from its quads and colour.
    delete spec.borderWidth;
    delete spec.dash;
    delete spec.interior;
  },
  bounds: (m) => pointsBounds(m.quads.flat()),
  hits: (m, p, t) => m.quads.some((q) => insidePolygon(p, outline(q)) || distToPolyline(p, outline(q), true) <= t),
  handles: () => [],
  dragHandle: (m) => m,
  moveBy: (m) => m,
  ofText: true,
  lineless: true,
});

/** Text markups of one variant for a selection's lines, one per page. */
export function textMarksFrom(
  lines: { page: number; quads: MarkQuad[]; text: string }[],
  variant: TextMarkVariant,
  style: Style,
  author: string,
  now = new Date().toISOString(),
): TextMarkMarkup[] {
  return lines
    .filter((l) => l.quads.length)
    .map((l) => ({ id: newId(), page: l.page, kind: "textmark", variant, quads: l.quads, text: l.text, style: { ...style }, meta: { author, created: now, modified: now } }));
}

/** Each variant's remembered colour and opacity (settings), checked; anything odd is left out. */
export function sanitiseTextMarks(raw: unknown): Partial<Record<TextMarkVariant, Style>> {
  const out: Partial<Record<TextMarkVariant, Style>> = {};
  if (!raw || typeof raw !== "object") return out;
  const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  for (const v of TEXT_MARK_VARIANTS) {
    const s = (raw as Record<string, unknown>)[v] as Record<string, unknown> | undefined;
    if (!s || typeof s !== "object") continue;
    const c = s.stroke;
    if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => num(x, 0, 1)) || !num(s.opacity, 0.05, 1)) continue;
    out[v] = { ...textMarkStyle(v), stroke: [c[0], c[1], c[2]], opacity: s.opacity as number };
  }
  return out;
}
