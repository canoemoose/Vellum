// Vellum's private copy of a markup, written into every annotation it saves (as /Vellum_Markup,
// beside the standard keys; src-tauri/src/annot/writer.rs) so a later Vellum can bring the
// markup back exactly as it was drawn. JSON: the format version, the /M date it was written
// with, and the markup's own model. If another app has changed the annotation since, its /M
// differs and the copy is ignored. Nothing reads it yet (phase 7b will). Pure.

import type { Markup } from "./base";
import { pdfDate } from "./annotation";
import { defOf } from "./kinds";

export const REEDIT_VERSION = 1;

export interface ReEdit {
  v: number;
  /** The annotation's /M when written ("D:20261115100000Z"). */
  m: string;
  /** The markup, as its kind keeps it (kinds/kind.ts, saved). */
  markup: unknown;
}

/** The entry for a markup. */
export function reeditEntry(m: Markup): string {
  const def = defOf(m);
  const e: ReEdit = { v: REEDIT_VERSION, m: pdfDate(m.meta.modified), markup: def.saved ? def.saved(m) : m };
  return JSON.stringify(e);
}

/**
 * An entry read back from an annotation whose /M is `annotM`: its markup model, or null if it
 * isn't one Vellum can trust (unreadable, a newer format, or the annotation changed since).
 * Turning the model back into a markup, kind by kind, is phase 7b's.
 */
export function readReedit(raw: string | null | undefined, annotM: string | null | undefined): unknown | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as Partial<ReEdit>;
    if (e.v !== REEDIT_VERSION || typeof e.m !== "string" || e.m !== annotM || !e.markup || typeof e.markup !== "object") return null;
    return e.markup;
  } catch {
    return null;
  }
}
