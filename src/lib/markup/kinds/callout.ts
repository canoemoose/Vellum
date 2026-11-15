// Callout: a text box with a leader to what it points at. Click the tip, then either click an
// elbow and then where the box goes, or double-click (or drag straight from the tip) where the
// box goes; then type. Saved as FreeText with intent FreeTextCallout and a callout line (/CL,
// ISO 32000-1 12.5.6.6): tip, elbow if there is one, and where the line meets the box. The
// leader's ends take the line end styles (the head is at the tip). Moving the callout moves
// the box and its elbow; the tip stays on what it points at. The tip and elbow have their own
// grips; with no elbow, the grip halfway along the leader makes one.
//
// The text box itself is drawn and saved exactly as a text box is (./text.ts, reused: the box
// is the same thing, with a leader added).

import { type MarkupBase, type Pt, type Rect, type TextStyle, LINE_STYLE, WHITE, arrowEnds, normRect } from "../base";
import { type Op, endedLine, textHeight } from "../draw";
import { boxHandles, distToPolyline, insidePolygon, movePt, pointsBounds, rectPts, snapAngle } from "../shape";
import { LE, boxInset, userPoints } from "../annotation";
import { rectToUser } from "../pdf";
import { defineKind } from "./kind";
import { type TextMarkup, fitText, refitText, text as textKind, textOps } from "./text";

export interface CalloutMarkup extends MarkupBase {
  kind: "callout";
  /** What it points at. */
  tip: Pt;
  /** The bend in the leader, if one was clicked or dragged out. */
  elbow: Pt | null;
  /** The text box. */
  rect: Rect;
  text: string;
  textStyle: TextStyle;
}

declare module "../base" {
  interface MarkupKinds {
    callout: CalloutMarkup;
  }
}

/** A new callout's box is this wide (points on paper). */
export const CALLOUT_WIDTH = 120;

/**
 * Where the leader meets the box: the middle of the side facing the point it comes from (the
 * elbow, or the tip). Null when that point is inside the box (no leader to draw).
 */
export function attachPoint(rect: Rect, from: Pt): Pt | null {
  const [x0, y0, x1, y1] = normRect(rect);
  const dx = from[0] < x0 ? x0 - from[0] : from[0] > x1 ? from[0] - x1 : 0;
  const dy = from[1] < y0 ? y0 - from[1] : from[1] > y1 ? from[1] - y1 : 0;
  if (dx === 0 && dy === 0) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return dx >= dy ? [from[0] < cx ? x0 : x1, cy] : [cx, from[1] < cy ? y0 : y1];
}

/** The leader from tip to box: [tip, elbow?, end], or just the tip when it's inside the box. */
export function leader(m: CalloutMarkup): Pt[] {
  const from = m.elbow ?? m.tip;
  const end = attachPoint(m.rect, from);
  const pts: Pt[] = [m.tip, ...(m.elbow ? [m.elbow] : [])];
  return end ? [...pts, end] : pts;
}

/** A callout as its text box (for the text box's own drawing, spec and grips). */
const asText = (m: CalloutMarkup): TextMarkup => ({ ...m, kind: "text" }) as unknown as TextMarkup;

/** The box for a callout whose box goes at `at`, coming from `from`: beside it, on the far side, centred on it. */
function boxAt(from: Pt, at: Pt, t: TextStyle): Rect {
  const h = textHeight(1, t, 1);
  const x0 = at[0] >= from[0] ? at[0] : at[0] - CALLOUT_WIDTH;
  return [x0, at[1] - h / 2, x0 + CALLOUT_WIDTH, at[1] + h / 2];
}

export const callout = defineKind<CalloutMarkup>({
  kind: "callout",
  label: "Callout",
  defaultStyle: () => ({ ...LINE_STYLE, width: 1, fill: WHITE, ends: ["none", "open"] }),
  controls: { fill: true, ends: true, text: true },
  draw: {
    gesture: "points",
    closed: false,
    min: 2,
    max: 3,
    drag: "line",
    make(pts, ctx) {
      const tip = pts[0];
      const elbow = pts.length >= 3 ? pts[1] : null;
      return { tip, elbow, rect: boxAt(pts[pts.length - 2], pts[pts.length - 1], ctx.textStyle), text: "", textStyle: ctx.textStyle };
    },
  },
  ops(m) {
    const ops: Op[] = [];
    const line = leader(m);
    // From the box to the tip: the head end is at the tip.
    if (line.length >= 2) ops.push(...endedLine([...line].reverse(), arrowEnds(m.style), m.style));
    ops.push(...textOps(m.rect, m.text, m.textStyle, m.style));
    return ops;
  },
  spec(m, f, spec) {
    // The text box's keys (FreeText, its text, /DA, /DS, /Q, background), then the callout's.
    textKind.spec(asText(m), f, spec);
    spec.intent = "FreeTextCallout";
    const line = leader(m);
    if (line.length >= 2) {
      spec.callout = userPoints(f, line);
      spec.lineEnds = [LE[arrowEnds(m.style)[1]]];
    }
    // /RD: where the box sits inside /Rect, which also holds the leader.
    spec.inset = boxInset(rectToUser(f, normRect(m.rect)), spec.rect);
  },
  bounds: (m) => pointsBounds([m.tip, ...(m.elbow ? [m.elbow] : []), ...rectPts(normRect(m.rect))]),
  hits(m, p, t) {
    const r = normRect(m.rect);
    return insidePolygon(p, rectPts(r)) || distToPolyline(p, rectPts(r), true) <= t || distToPolyline(p, leader(m), false) <= t;
  },
  handles(m) {
    const line = leader(m);
    const mid: Pt = line.length >= 2 ? [(line[0][0] + line[1][0]) / 2, (line[0][1] + line[1][1]) / 2] : m.tip;
    return [...boxHandles(normRect(m.rect)), { id: "from", at: m.tip }, { id: "to", at: m.elbow ?? mid }];
  },
  dragHandle(m, h, p, constrain, minSize) {
    if (h === "from") {
      const toward = m.elbow ?? attachPoint(m.rect, m.tip);
      return { ...m, tip: constrain && toward ? snapAngle(toward, p) : p };
    }
    if (h === "to") return { ...m, elbow: constrain ? snapAngle(m.tip, p) : p };
    // The box's grips resize it as a text box's do (never smaller than its text).
    return { ...m, rect: textKind.dragHandle(asText(m), h, p, constrain, minSize).rect };
  },
  // The tip stays on what it points at; the box and its elbow move.
  moveBy: (m, dx, dy) => ({ ...m, rect: [m.rect[0] + dx, m.rect[1] + dy, m.rect[2] + dx, m.rect[3] + dy], elbow: m.elbow ? movePt(m.elbow, dx, dy) : null }),
  finish: (m) => fitText(m),
  settle: (m) => fitText(m),
  restyled: (before, after) => ({ ...after, rect: refitText(asText(before), asText(after)).rect }),
  typed: true,
});
