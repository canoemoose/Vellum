// The markup tools in the toolbar: one line per tool, in palette order, each in a group. The
// groups set the order, the dividers in the flat row and the flyouts when the row collapses
// (components/ToolPalette.svelte), and the letter shortcuts. A tool draws a kind (kinds/) with
// an optional preset: style settings fixed for that tool (Line is the arrow kind with no ends).
// To add a tool, add its line inside your phase's block. Pure.

import type { MarkupKind, Style } from "./base";
import type { Markup } from "./base";
import { arrowEnds } from "./base";
import { kindOf } from "./kinds";

export type GroupId = "select" | "lines" | "shapes" | "text" | "pen" | "measure" | "stamp";

export interface ToolGroup {
  id: GroupId;
  label: string;
}

/** The groups, in palette order. A group with no tools yet isn't shown. */
export const GROUPS: ToolGroup[] = [
  { id: "select", label: "Select" },
  { id: "lines", label: "Lines" },
  { id: "shapes", label: "Shapes" },
  { id: "text", label: "Text" },
  { id: "pen", label: "Pen" },
  { id: "measure", label: "Measure" },
  { id: "stamp", label: "Stamp" },
];

export interface ToolDef {
  /** Unique. For a tool that draws a kind with no preset, the kind's name. */
  id: string;
  group: GroupId;
  label: string;
  /** The tooltip after the label and shortcut: how to use it. */
  tip: string;
  /** The icon: SVG elements for a 16 x 16 view box, drawn in currentColor. */
  icon: string;
  /**
   * Its letter (lower case). Tools in one group may share a letter: pressing it again steps
   * to the next of them. Never shared across groups.
   */
  key: string;
  /** The kind it draws (none for Select). */
  kind?: MarkupKind;
  /** Style settings fixed for this tool, over whatever it remembers; their controls are hidden. */
  preset?: Partial<Style>;
}

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';

export const TOOLS: ToolDef[] = [
  { id: "select", group: "select", label: "Select", key: "v", tip: "click a markup to select it, drag to move, drag on empty drawing to select several; Esc also returns here", icon: `<path d="M3.5 2.5l9 5.2-4 1.1 2.3 4.2-1.6.9-2.3-4.2-3.4 2.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />` },
  { id: "arrow", group: "lines", label: "Arrow", key: "a", kind: "arrow", tip: "drag from tail to head; Shift snaps to 15°", icon: `<path d="M3 13L12.5 3.5M7.5 3.5h5v5" ${STROKE} />` },
  { id: "line", group: "lines", label: "Line", key: "l", kind: "arrow", preset: { ends: ["none", "none"] }, tip: "drag from end to end; Shift snaps to 15°", icon: `<path d="M3 13L13 3" ${STROKE} />` },
  { id: "polyline", group: "lines", label: "Polyline", key: "l", kind: "polyline", tip: "click each point, double-click or Enter to finish; Shift snaps to 15°", icon: `<path d="M2.5 12.5l4-7 4 5 3-7" ${STROKE} />` },
  { id: "rect", group: "shapes", label: "Rectangle", key: "b", kind: "rect", tip: "drag; Shift makes a square", icon: `<rect x="2.75" y="3.75" width="10.5" height="8.5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5" />` },
  { id: "ellipse", group: "shapes", label: "Ellipse", key: "e", kind: "ellipse", tip: "drag; Shift makes a circle", icon: `<ellipse cx="8" cy="8" rx="5.75" ry="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />` },
  { id: "polygon", group: "shapes", label: "Polygon", key: "p", kind: "polygon", tip: "click each corner, then click the first again, double-click or press Enter; or drag a box", icon: `<path d="M8 2.5l5.5 4-2 6.5h-7l-2-6.5z" ${STROKE} />` },
  { id: "cloud", group: "shapes", label: "Revision cloud", key: "c", kind: "cloud", tip: "click the corners and double-click to finish, or drag a box", icon: `<path d="M4.2 12.2a2 2 0 0 1-1.6-3.1 2 2 0 0 1 1.4-3.2 2.3 2.3 0 0 1 3.9-1.6 2.3 2.3 0 0 1 4 .9 2 2 0 0 1 1.6 3 2 2 0 0 1-1.7 3.2 2.2 2.2 0 0 1-3.8 1 2.2 2.2 0 0 1-3.8-.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />` },
  { id: "text", group: "text", label: "Text box", key: "t", kind: "text", tip: "drag a box or click, then type; Esc finishes", icon: `<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M5 5.5h6M8 5.5v5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />` },
  // Text markups (beside their groups, which set the palette order): callout and note
  { id: "callout", group: "text", label: "Callout", key: "t", kind: "callout", tip: "click what it points at, then click an elbow and where the box goes (or double-click where the box goes, or drag there), then type", icon: `<rect x="7.25" y="2.75" width="7" height="5.5" rx="0.8" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M2.5 13.5L5.5 8.5h1.75" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /><path d="M2.5 13.5l.4-2M2.5 13.5l1.9-.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />` },
  { id: "note", group: "text", label: "Note", key: "t", kind: "note", tip: "click to place a note, then type; double-click a note to edit it, rest the pointer on it to read it", icon: `<path d="M3 2.75h7.25l2.75 2.75v7.75H3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /><path d="M10.25 2.75V5.5H13M5.5 8h5M5.5 10.5h3.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />` },
  { id: "ink", group: "pen", label: "Pen", key: "d", kind: "ink", tip: "draw freehand", icon: `<path d="M2.5 12.5c2-4 3.5-6 5-6s.8 3.5 2.3 3.5S12 6 13.5 4" ${STROKE} />` },
  // Text markups: highlighter
  { id: "highlighter", group: "pen", label: "Highlighter", key: "h", kind: "highlighter", tip: "draw freehand over the drawing; Shift draws a straight stroke", icon: `<path d="M3 13.5h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /><path d="M4.5 11.5l1.8-3.6 6-5.4 1.8 1.8-5.4 6-3.6 1.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />` },
  // Measuring
  { id: "measureLength", group: "measure", label: "Length", key: "m", kind: "measureLength", tip: "click each end, or drag; Shift snaps to 15°", icon: `<path d="M2.5 11.5l11-7M1.6 10.1l1.8 2.8M12.6 3.1l1.8 2.8" ${STROKE} />` },
  { id: "measurePath", group: "measure", label: "Polyline length", key: "m", kind: "measurePath", tip: "click each point, double-click or Enter to finish; Shift snaps to 15°", icon: `<path d="M2.5 12.5l4-6 3.5 3 3.5-6.5M1.5 11.5l2 2" ${STROKE} />` },
  { id: "measureArea", group: "measure", label: "Area", key: "m", kind: "measureArea", tip: "click each corner, then click the first again, double-click or press Enter; or drag a box", icon: `<path d="M2.5 3.5h11v9h-11z" ${STROKE} /><path d="M5.5 9.5l5-4M7.5 10.5l3-2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />` },
  { id: "measureAngle", group: "measure", label: "Angle", key: "m", kind: "measureAngle", tip: "click one arm's end, the corner, then the other arm's end; Shift snaps to 15°", icon: `<path d="M13.5 3.5L3 13h10.5" ${STROKE} /><path d="M8.5 13a5.5 5.5 0 0 0-1.6-3.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />` },
  { id: "measureCalibrate", group: "measure", label: "Calibrate", key: "m", kind: "measureCalibrate", tip: "click each end of a dimension you know, then type its real length to set the scale", icon: `<path d="M1.5 10.5h13v3h-13z" ${STROKE} /><path d="M4.5 10.5v1.5M7.5 10.5v2M10.5 10.5v1.5M8 2.5v5M6 5.5l2 2 2-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />` },

  // Stamps
  { id: "stamp", group: "stamp", label: "Stamp", key: "s", kind: "stamp", tip: "pick a stamp, then click to place it or drag to size it", icon: `<rect x="1.75" y="4.25" width="12.5" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M4.5 8h7" ${STROKE} />` },
  { id: "signature", group: "stamp", label: "Signature", key: "s", kind: "stamp", tip: "pick a signature, then click to place it or drag to size it", icon: `<path d="M2 11.5c1.5-3 2.5-6.5 3.6-6.5 1.3 0-.6 5.5.8 5.5 1.1 0 1.6-2.6 2.6-2.6.8 0 .6 1.8 1.5 1.8.7 0 1.3-.8 2-1.3M2 13.5h12" ${STROKE} />` },

  // Text markups (their tools sit beside their groups, above)
];

/** A tool by id. */
export const toolById = (id: string): ToolDef | undefined => TOOLS.find((t) => t.id === id);

/** A group's tools, in order. */
export const toolsIn = (g: GroupId): ToolDef[] => TOOLS.filter((t) => t.group === g);

/** The groups that have tools, each with its tools. */
export function paletteGroups(): { group: ToolGroup; tools: ToolDef[] }[] {
  return GROUPS.map((group) => ({ group, tools: toolsIn(group.id) })).filter((g) => g.tools.length > 0);
}

/** The style a tool starts with, before one is remembered: its kind's, with its preset. */
export function toolDefaults(t: ToolDef): Style {
  if (!t.kind) throw new Error(`tool ${t.id} draws nothing`);
  return { ...kindOf(t.kind).defaultStyle(), ...t.preset };
}

/** A remembered style with the tool's preset applied over it. */
export const withPreset = (t: ToolDef, s: Style): Style => (t.preset ? { ...s, ...t.preset } : s);

/**
 * The tool a markup belongs to: the one for its kind whose preset it matches (an arrow with no
 * ends is the Line tool's), else the kind's plain tool.
 */
export function toolForMarkup(m: Markup): ToolDef | undefined {
  const of = TOOLS.filter((t) => t.kind === m.kind);
  const matches = (t: ToolDef) =>
    Object.entries(t.preset ?? {}).every(([k, v]) => (k === "ends" ? JSON.stringify(arrowEnds(m.style)) === JSON.stringify(v) : JSON.stringify(m.style[k as keyof Style]) === JSON.stringify(v)));
  return of.find((t) => t.preset && matches(t)) ?? of.find((t) => !t.preset) ?? of[0];
}

/**
 * The tool a letter picks: the first tool with that letter, or, when the current tool has it,
 * the next tool with it (round to the first). Null when no tool has it.
 */
export function toolForKey(key: string, current: string): string | null {
  const k = key.toLowerCase();
  const with_ = TOOLS.filter((t) => t.key === k);
  if (!with_.length) return null;
  const i = with_.findIndex((t) => t.id === current);
  return with_[(i + 1) % with_.length].id;
}

/** The tooltip: "Line (L): drag from end to end; ...", with "L again" for a shared letter. */
export function toolTip(t: ToolDef): string {
  return `${t.label} (${keyLabel(t)}): ${t.tip}`;
}

/** How a tool's shortcut reads: "L", or "L twice" for the second tool sharing L ("M 3 times"...). */
export function keyLabel(t: ToolDef): string {
  const n = TOOLS.filter((x) => x.key === t.key).indexOf(t);
  const K = t.key.toUpperCase();
  return n <= 0 ? K : n === 1 ? `${K} twice` : `${K} ${n + 1} times`;
}

/**
 * Flat or grouped: flat when the whole row (every tool, with its dividers) fits the width the
 * toolbar leaves for it, grouped otherwise. All or nothing, and decided by width alone, never
 * by the active tool, so the palette doesn't change while you work.
 */
export function paletteLayout(fullWidth: number, available: number): "flat" | "grouped" {
  return fullWidth > 0 && fullWidth <= available ? "flat" : "grouped";
}

/** Which tool a collapsed group shows: the one last used in it, else its first. */
export function groupFace(g: GroupId, last: Partial<Record<string, string>>): ToolDef {
  const tools = toolsIn(g);
  return tools.find((t) => t.id === last[g]) ?? tools[0];
}
