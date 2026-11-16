// Markups on the system clipboard (stage 9 of docs/editing-tool-consistency-brief.md): what
// Vellum puts there in its own format (src-tauri/src/clipboard.rs), and reading it back. One
// clipboard: whatever was copied last, anywhere, is what Ctrl+V pastes.
//
// Signatures are the exception: a signature's picture or strokes never go on the system
// clipboard. A copied signature travels as a reference ("held" below) that only the running app
// that copied it can resolve; pasted into another Vellum window it is skipped, with a message.
// Pure.

import type { Markup, MarkupKind, Pt, Rect } from "./base";
import { KINDS, defOf, kindOf } from "./kinds";
import { moveBy } from "./geometry";

export const CLIP_VERSION = 1;

/** One markup on the clipboard, or a signature by reference (its place, never its content). */
type Item = { markup: Markup } | { signature: string; page: number; bounds: Rect };

interface Payload {
  app: "Vellum";
  v: number;
  /** The running app that copied it (a random id per run): only it can resolve a signature. */
  session: string;
  items: Item[];
}

const isSignature = (m: Markup) => m.kind === "stamp" && (m as { signature?: boolean }).signature === true;

/**
 * The clipboard's JSON for `ms`, and the signatures held back for this run, by reference.
 * Nothing of a signature but its id, page and box goes into the JSON.
 */
export function toClip(ms: Markup[], session: string): { json: string; held: Map<string, Markup> } {
  const held = new Map<string, Markup>();
  const items: Item[] = ms.map((m) => {
    if (!isSignature(m)) return { markup: m };
    const ref = `${session}:${m.id}`;
    held.set(ref, m);
    return { signature: ref, page: m.page, bounds: defOf(m).bounds(m) };
  });
  const p: Payload = { app: "Vellum", v: CLIP_VERSION, session, items };
  return { json: JSON.stringify(p), held };
}

/** A markup read from the clipboard, if it can be trusted to draw (another app may have written the format). */
function trusted(raw: unknown): Markup | null {
  const m = raw as Partial<Markup> | null;
  if (!m || typeof m !== "object" || typeof m.kind !== "string" || !(m.kind in KINDS)) return null;
  const d = kindOf(m.kind as MarkupKind);
  if (d.fixed || d.ofText || isSignature(m as Markup)) return null;
  if (typeof m.page !== "number" || !m.style || typeof m.style !== "object" || !m.meta || typeof m.meta !== "object") return null;
  try {
    const b = d.bounds(m as never);
    if (!b.every(Number.isFinite)) return null;
  } catch {
    return null;
  }
  return m as Markup;
}

/**
 * The markups in the clipboard's JSON: signatures resolved from `held` when this run copied
 * them, else counted as skipped. Null when it isn't Vellum's (or can't be read).
 */
export function fromClip(json: string, session: string, held: ReadonlyMap<string, Markup>): { markups: Markup[]; skipped: number } | null {
  let p: Partial<Payload>;
  try {
    p = JSON.parse(json) as Partial<Payload>;
  } catch {
    return null;
  }
  if (p?.app !== "Vellum" || p.v !== CLIP_VERSION || !Array.isArray(p.items)) return null;
  const markups: Markup[] = [];
  let skipped = 0;
  for (const it of p.items as Item[]) {
    if (it && "signature" in it) {
      const m = p.session === session ? held.get(it.signature) : undefined;
      if (m) markups.push(m);
      else skipped++;
    } else {
      const m = trusted(it?.markup);
      if (m) markups.push(m);
      else skipped++;
    }
  }
  return { markups, skipped };
}

/** The box round several markups. */
export function boundsOf(ms: Markup[]): Rect {
  let b: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  for (const m of ms) {
    const r = defOf(m).bounds(m);
    b = [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])];
  }
  return b;
}

/** Copies moved so the middle of them all lands on `at` (rule: paste at the pointer, else the view's middle). */
export function centredOn(ms: Markup[], at: Pt): Markup[] {
  if (!ms.length) return ms;
  const b = boundsOf(ms);
  const dx = at[0] - (b[0] + b[2]) / 2, dy = at[1] - (b[1] + b[3]) / 2;
  return ms.map((m) => moveBy(m, dx, dy));
}

/**
 * Copies moved, all together, as little as it takes to lie on a page of size w by h (a markup
 * off its page is clipped or hidden by other apps). Bigger than the page, their top left goes
 * to its top left.
 */
export function keptOn(ms: Markup[], page: { w: number; h: number }): Markup[] {
  if (!ms.length) return ms;
  const b = boundsOf(ms);
  const fit = (lo: number, hi: number, size: number) => (hi - lo > size || lo < 0 ? -lo : hi > size ? size - hi : 0);
  const dx = fit(b[0], b[2], page.w), dy = fit(b[1], b[3], page.h);
  return dx || dy ? ms.map((m) => moveBy(m, dx, dy)) : ms;
}

/** A new id for each run of the app (what makes a held signature this run's alone). */
export function newSession(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join("");
}
