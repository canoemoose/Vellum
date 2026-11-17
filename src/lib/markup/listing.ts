// The Markups tab (components/MarkupsList.svelte): markups grouped by page, each page's top to
// bottom as the page is shown, each with its type, its text, author and date. Pure.
//
// A row is laid out as lines, each a single line that shortens with an ellipsis
// (docs/edit-lock-brief.md, 5): the kind and, for a measurement, its value ("Length 12.40 m");
// what it says or what qualifies it ("at 1:100"); author and date. The on-paper values stay out
// of the row, in its tooltip.
//
// It holds this session's markups and, from phase 7b, the file's own annotations.

import type { Markup, MarkupKind } from "./base";
import { defOf, labelOf } from "./kinds";
import { shapeBounds } from "./geometry";
import { toolForMarkup } from "./tools";
import { MEASURE_KINDS, measurementLine, measurementParts } from "./measurements"; // Measuring

export interface MarkupRow {
  id: string;
  page: number;
  kind: MarkupKind;
  /** "Rectangle", "Highlight"... */
  label: string;
  /** Beside the label, where the eye lands: a measurement's value ("12.40 m"), or "". */
  value: string;
  /** The second line: what it says, or what qualifies the value ("at 1:100"), or "" (a shape). */
  text: string;
  /** The row's tooltip: everything, the on-paper values included. */
  tip: string;
  author: string;
  /** ISO time it was last changed. */
  modified: string;
  /** SVG elements for a 16 x 16 icon, in currentColor. */
  icon: string;
  /** It came with the file and the document is locked: it can be found, not changed (phase 7b). */
  locked: boolean;
}

export interface MarkupPage {
  page: number;
  rows: MarkupRow[];
}

/** A kind's own words for its row: a value beside the label, the second line, and the tooltip's text. */
export interface ListWords {
  value?: string;
  text: string;
  /** The tooltip's words after the label, where they're more than `value` and `text`. */
  tip?: string;
}

/**
 * A kind's own words for the list, where its text isn't simply what was typed: a measurement's
 * value and what qualifies it, say. Register by kind, one line per kind, and the list shows it.
 */
export const LIST_TEXT: Partial<Record<MarkupKind, (m: Markup) => ListWords>> = {
  // Measuring: the value beside the kind, its scale (an area's perimeter too) under it, and
  // both values, on paper as well, in the tooltip.
  ...Object.fromEntries(
    MEASURE_KINDS.map((k) => [k, (m: Markup): ListWords => {
      const parts = measurementParts(m);
      return { value: parts?.value ?? "", text: parts?.qualifier ?? "", tip: measurementLine(m) ?? undefined };
    }]),
  ),
};

const MAX_TEXT = 160;

/** A markup's words in the list: its kind's own (above), or what it says, or nothing. */
export function listWords(m: Markup): ListWords {
  const own = LIST_TEXT[m.kind];
  if (own) return own(m);
  const def = (defOf(m) as { listText?: (m: Markup) => string }).listText;
  return { text: def ? def(m) : saysText(m) };
}

/** A row's second line: what it says or what qualifies it, or nothing (a shape). */
export const listText = (m: Markup): string => listWords(m).text;

/** What a markup says, on one line and cut short. */
function saysText(m: Markup): string {
  const t = "text" in m && typeof m.text === "string" ? m.text.replace(/\s+/g, " ").trim() : "";
  const cut = t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1).trimEnd()}…` : t;
  // A text markup's text is the page's, not the author's words: quoted.
  return m.kind === "textmark" && cut ? `“${cut}”` : cut;
}

/** Icons for the kinds no tool draws (text markups), by variant. */
const TEXT_MARK_ICONS: Record<string, string> = {
  highlight: `<rect x="2" y="4" width="12" height="8" rx="1" fill="currentColor" opacity="0.35" /><path d="M5.5 10.5l2.5-5.5 2.5 5.5M6.4 8.6h3.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />`,
  underline: `<path d="M5 2.5v5a3 3 0 0 0 6 0v-5M3.5 13.5h9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />`,
  strike: `<path d="M11 4.2c-.6-.9-1.7-1.4-3-1.4-1.7 0-3 .9-3 2.3 0 2.8 6 1.8 6 5 0 1.4-1.3 2.4-3 2.4-1.4 0-2.6-.6-3.2-1.6M2.5 8h11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />`,
};
const PLAIN_ICON = `<rect x="3" y="3" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />`;

export function iconFor(m: Markup): string {
  if (m.kind === "textmark") return TEXT_MARK_ICONS[m.variant] ?? PLAIN_ICON;
  return toolForMarkup(m)?.icon ?? PLAIN_ICON;
}

export function rowFor(m: Markup, locked = false): MarkupRow {
  const label = labelOf(m);
  const w = listWords(m);
  const value = w.value ?? "";
  const words = w.tip ?? [value, w.text].filter(Boolean).join(", ");
  const tip = words ? `${label}: ${words}` : label;
  return { id: m.id, page: m.page, kind: m.kind, label, value, text: w.text, tip, author: m.meta.author, modified: m.meta.modified, icon: iconFor(m), locked };
}

/**
 * The markups by page (in page order), each page's top to bottom (then left to right) by
 * where they start on the page as it's shown (its /Rotate applied).
 */
export function markupPages(markups: Markup[], locked?: (m: Markup) => boolean): MarkupPage[] {
  const by = new Map<number, { m: Markup; y: number; x: number }[]>();
  for (const m of markups) {
    const b = shapeBounds(m);
    let list = by.get(m.page);
    if (!list) by.set(m.page, (list = []));
    list.push({ m, y: b[1], x: b[0] });
  }
  return [...by.keys()]
    .sort((a, b) => a - b)
    .map((page) => ({ page, rows: by.get(page)!.sort((a, b) => a.y - b.y || a.x - b.x).map((e) => rowFor(e.m, locked?.(e.m) ?? false)) }));
}

/** When it was last changed, short: the time today, else the day and month (and year if not this one). */
export function listDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (v: number) => String(v).padStart(2, "0");
  if (d.toDateString() === now.toDateString()) return `${p(d.getHours())}:${p(d.getMinutes())}`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dm = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? dm : `${dm} ${d.getFullYear()}`;
}
