// The Markups tab (components/MarkupsList.svelte): markups grouped by page, each page's top to
// bottom as the page is shown, each with its type, its text, author and date. Pure.
//
// In phase 7a the list holds this session's markups; phase 7b adds the file's own annotations.

import type { Markup, MarkupKind } from "./base";
import { defOf, labelOf } from "./kinds";
import { shapeBounds } from "./geometry";
import { toolForMarkup } from "./tools";
import { MEASURE_KINDS, measurementLine } from "./measurements"; // Measuring

export interface MarkupRow {
  id: string;
  page: number;
  kind: MarkupKind;
  /** "Rectangle", "Highlight"... */
  label: string;
  /** What it says, or "" (a shape). */
  text: string;
  author: string;
  /** ISO time it was last changed. */
  modified: string;
  /** SVG elements for a 16 x 16 icon, in currentColor. */
  icon: string;
}

export interface MarkupPage {
  page: number;
  rows: MarkupRow[];
}

/**
 * A kind's own words for the list, where its text isn't simply what was typed: a measurement's
 * two values, say. Measuring (phase 4) exports a function that gives a measurement's values as
 * text; register it here by kind, one line per kind, and the list shows it:
 *
 *   // Measuring
 *   length: (m) => measurementText(m),
 */
export const LIST_TEXT: Partial<Record<MarkupKind, (m: Markup) => string>> = {
  // Measuring
  ...Object.fromEntries(MEASURE_KINDS.map((k) => [k, (m: Markup) => measurementLine(m) ?? ""])),
};

const MAX_TEXT = 160;

/** The text a markup shows in the list: its kind's own words (above), what it says, or nothing. */
export function listText(m: Markup): string {
  const own = LIST_TEXT[m.kind] ?? (defOf(m) as { listText?: (m: Markup) => string }).listText;
  if (own) return own(m);
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

export function rowFor(m: Markup): MarkupRow {
  return { id: m.id, page: m.page, kind: m.kind, label: labelOf(m), text: listText(m), author: m.meta.author, modified: m.meta.modified, icon: iconFor(m) };
}

/**
 * The markups by page (in page order), each page's top to bottom (then left to right) by
 * where they start on the page as it's shown (its /Rotate applied).
 */
export function markupPages(markups: Markup[]): MarkupPage[] {
  const by = new Map<number, { m: Markup; y: number; x: number }[]>();
  for (const m of markups) {
    const b = shapeBounds(m);
    let list = by.get(m.page);
    if (!list) by.set(m.page, (list = []));
    list.push({ m, y: b[1], x: b[0] });
  }
  return [...by.keys()]
    .sort((a, b) => a - b)
    .map((page) => ({ page, rows: by.get(page)!.sort((a, b) => a.y - b.y || a.x - b.x).map((e) => rowFor(e.m)) }));
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
