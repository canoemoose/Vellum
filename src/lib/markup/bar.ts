// Which controls the context bar (components/PropertiesStrip.svelte) shows, for a tool or for
// the selection. Rule 6 (docs/editing-tool-consistency-brief.md): only controls that do
// something; with several kinds selected, only the controls they all have. Pure.

import { type Markup, type MarkupKind, arrowEnds } from "./base";
import { defOf, kindOf } from "./kinds";
import type { ToolDef } from "./tools";

/** What the bar is for: a kind, and whether it's a plain line (an arrow kind with no ends). */
export interface Subject {
  kind: MarkupKind;
  line?: boolean;
  /** Stage 6: it has a number of sides to change (a regular polygon, or the tool that drags one). */
  sides?: boolean;
}

/**
 * The controls shown. `ends`: "none" (no ends control), "all" (any end at either end: a
 * polyline, a callout's leader), or "arrow" (an arrow keeps a head: "None" at both ends would
 * make it a line, which is the Line tool's, rule A1).
 */
export interface Bar {
  colour: boolean;
  weight: boolean;
  pattern: boolean;
  ends: "none" | "all" | "arrow";
  fill: boolean;
  text: boolean;
  /** Stage 6: Sides, for a regular polygon. */
  sides: boolean;
}

export const subjectOfTool = (t: ToolDef): Subject => {
  const d = kindOf(t.kind!).draw;
  return { kind: t.kind!, line: t.preset?.ends !== undefined, sides: d.gesture === "points" && d.drag === "regular" };
};

export const subjectOf = (m: Markup): Subject => ({ kind: m.kind, line: m.kind === "arrow" && arrowEnds(m.style).every((e) => e === "none"), sides: (defOf(m).sides?.(m) ?? null) !== null });

/** One subject's controls, or null when nothing in the bar does anything for it. */
function controlsOf(s: Subject): Bar | null {
  const d = kindOf(s.kind);
  if (d.fixed || d.noBar) return null;
  const c = d.controls;
  const lined = !d.lineless;
  return {
    colour: true,
    weight: lined,
    pattern: lined && c.pattern !== false,
    ends: !c.ends || s.line ? "none" : s.kind === "arrow" ? "arrow" : "all",
    fill: c.fill,
    text: c.text,
    sides: !!s.sides,
  };
}

/** The bar for a tool or a selection: the controls every subject has, or null for none. */
export function barFor(subjects: Subject[]): Bar | null {
  if (!subjects.length) return null;
  let bar: Bar | null = null;
  for (const s of subjects) {
    const b = controlsOf(s);
    if (!b) return null;
    bar = bar
      ? {
          colour: bar.colour && b.colour,
          weight: bar.weight && b.weight,
          pattern: bar.pattern && b.pattern,
          ends: bar.ends === "none" || b.ends === "none" ? "none" : bar.ends === "arrow" || b.ends === "arrow" ? "arrow" : "all",
          fill: bar.fill && b.fill,
          text: bar.text && b.text,
          sides: bar.sides && b.sides,
        }
      : b;
  }
  return bar;
}

/** The end styles one end may take, given the other: an arrow never has "none" at both. */
export function endChoices<E extends string>(all: E[], mode: Bar["ends"], other: E): E[] {
  return mode === "arrow" && other === "none" ? all.filter((e) => e !== "none") : all;
}
