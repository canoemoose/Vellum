// Every kind of markup Vellum draws: one import and one entry per kind. To add a kind, write its
// file beside this one (see kind.ts and rect.ts for the shape of one), list it here, and give
// it a tool in ../tools.ts. Each later phase adds inside its own block, so parallel work never
// edits the same lines.

import type { Markup, MarkupKind, MarkupOf } from "../base";
import type { KindDef } from "./kind";
import { rect } from "./rect";
import { arrow } from "./arrow";
import { cloud } from "./cloud";
import { text } from "./text";
import { ink } from "./ink";
import { ellipse } from "./ellipse";
import { polyline } from "./polyline";
import { polygon } from "./polygon";
// Measuring
import { measureLength } from "./measureLength";
import { measurePath } from "./measurePath";
import { measureArea } from "./measureArea";
import { measureAngle } from "./measureAngle";
import { measureCalibrate } from "./measureCalibrate";

// Stamps
import { stamp } from "./stamp";

// Text markups
import { highlighter } from "./highlighter";
import { callout } from "./callout";
import { textmark } from "./textmark";
import { note } from "./note";

// Existing annotations
import { foreign } from "./foreign";

export const KINDS: { [K in MarkupKind]: KindDef<MarkupOf<K>> } = {
  rect,
  arrow,
  cloud,
  text,
  ink,
  ellipse,
  polyline,
  polygon,
  // Measuring
  measureLength,
  measurePath,
  measureArea,
  measureAngle,
  measureCalibrate,

  // Stamps
  stamp,

  // Text markups
  highlighter,
  callout,
  textmark,
  note,

  // Existing annotations
  foreign,
};

/** A kind's definition. */
export function kindOf<K extends MarkupKind>(kind: K): KindDef<MarkupOf<K>> {
  const def = KINDS[kind];
  if (!def) throw new Error(`unknown markup kind: ${String(kind)}`);
  return def;
}

/** A markup's kind's definition, typed for calling with that markup. */
export const defOf = (m: Markup): KindDef<Markup> => kindOf(m.kind) as unknown as KindDef<Markup>;

/** What a markup is called ("Rectangle"; an arrow with no ends is a "Line"). */
export function labelOf(m: Markup): string {
  const def = defOf(m);
  return def.labelOf ? def.labelOf(m) : def.label;
}
