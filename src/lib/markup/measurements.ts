// Measurements as a whole: which markups are measurements, their two values as text (for the
// status bar and the markups list, so neither needs measuring code of its own), and re-valuing
// them when a page's scale or the number format changes. Pure. Not a kind and not a leaf: it
// imports the measuring kinds, as kinds/index.ts does. See docs/editing-phase4-scope.md.

import type { Markup, MarkupKind } from "./base";
import { type MeasureFormat, type PageMeasure, type UnitSystem, formatPaper, formatScale, isImperial, sameFormat } from "./measure";
import { type DimensionLook, pageMeasureOf } from "./dimension";
import { type MeasureLengthMarkup, lengthValues } from "./kinds/measureLength";
import { type MeasurePathMarkup, pathValues } from "./kinds/measurePath";
import { type MeasureAreaMarkup, areaValues } from "./kinds/measureArea";
import { type MeasureAngleMarkup, angleLabel } from "./kinds/measureAngle";
import { type MeasureCalibrateMarkup, calibratePaperMm } from "./kinds/measureCalibrate";

/** The kinds that measure (Calibrate draws like one but is never kept). */
export const MEASURE_KINDS: MarkupKind[] = ["measureLength", "measurePath", "measureArea", "measureAngle"];

export type Measurement = MeasureLengthMarkup | MeasurePathMarkup | MeasureAreaMarkup | MeasureAngleMarkup;

export const isMeasurement = (m: Markup): m is Measurement => MEASURE_KINDS.includes(m.kind);

/** The scale part of a readout: "at 1:100", or "no scale set". */
// Imperial (stage 5 [A9]): an imperial measurement reads its scale the imperial way (1/4" = 1'-0").
const atScale = (pm: PageMeasure, fmt: MeasureFormat) => (pm.ratio === null ? "no scale set" : `at ${formatScale(pm.ratio, isImperial(fmt) ? "imperial" : "metric")}`);

/**
 * A measurement as parts, for the Markups list's lines (docs/edit-lock-brief.md, 5):
 * - `value`: where the eye lands, real-world at its scale ("12.40 m", "100.00 m²", "45.0°"); with
 *   no scale, the value on paper.
 * - `qualifier`: what qualifies it ("at 1:100"; "Perimeter 40.00 m, at 1:100" for an area; "on
 *   paper, no scale set"), or "" when there's nothing to say (an angle).
 * - `paper`: the on-paper value ("124.0 mm on paper"), or null where it says nothing new: an
 *   angle, no scale (the value is already on paper), or 1:1 (real and paper are the same).
 * Null for anything that isn't a measurement.
 */
export interface MeasurementParts {
  value: string;
  qualifier: string;
  paper: string | null;
}

/** Real and on-paper are the same length at 1:1, so the paper value says nothing new (brief, 6). */
const oneToOne = (pm: PageMeasure) => pm.ratio === 1;

export function measurementParts(m: Markup): MeasurementParts | null {
  if (!isMeasurement(m)) return null;
  const pm = pageMeasureOf(m);
  const at = atScale(pm, m.fmt);
  switch (m.kind) {
    case "measureLength":
    case "measurePath": {
      const v = m.kind === "measureLength" ? lengthValues(m) : pathValues(m);
      if (v.real === null) return { value: v.paper, qualifier: "on paper, no scale set", paper: null };
      return { value: v.real, qualifier: at, paper: oneToOne(pm) ? null : `${v.paper} on paper` };
    }
    case "measureArea": {
      const v = areaValues(m);
      const crosses = v.crosses ? "; the outline crosses itself" : "";
      if (v.real === null) return { value: v.paper, qualifier: `Perimeter ${v.paperPerimeter}, on paper, no scale set${crosses}`, paper: null };
      return {
        value: v.real,
        qualifier: `Perimeter ${v.realPerimeter}, ${at}${crosses}`,
        paper: oneToOne(pm) ? null : `${v.paper}, perimeter ${v.paperPerimeter} on paper`,
      };
    }
    case "measureAngle":
      return { value: angleLabel(m), qualifier: "", paper: null };
  }
}

/**
 * A measurement's two values as text: real-world at its scale ("12.40 m at 1:100"; with no
 * scale, "No scale set") and on paper ("124.0 mm on paper"). An angle reads the same at any
 * scale, so it has one value and no paper one; nor has anything at 1:1, where the two are the
 * same (docs/edit-lock-brief.md, 6). Null for anything that isn't a measurement. For the
 * status bar and the Markups list's tooltip.
 */
export function measurementText(m: Markup): { real: string; paper: string | null } | null {
  if (!isMeasurement(m)) return null;
  const pm = pageMeasureOf(m);
  switch (m.kind) {
    case "measureLength":
    case "measurePath": {
      const v = m.kind === "measureLength" ? lengthValues(m) : pathValues(m);
      if (v.real === null) return { real: "No scale set", paper: `${v.paper} on paper` };
      return { real: `${v.real} ${atScale(pm, m.fmt)}`, paper: oneToOne(pm) ? null : `${v.paper} on paper` };
    }
    case "measureArea": {
      const v = areaValues(m);
      const crosses = v.crosses ? " (the outline crosses itself)" : "";
      if (v.real === null) return { real: "No scale set", paper: `${v.paper}, perimeter ${v.paperPerimeter} on paper${crosses}` };
      return {
        real: `${v.real}, perimeter ${v.realPerimeter} ${atScale(pm, m.fmt)}${crosses}`,
        paper: oneToOne(pm) ? null : `${v.paper}, perimeter ${v.paperPerimeter} on paper`,
      };
    }
    case "measureAngle":
      return { real: angleLabel(m), paper: null };
  }
}

/** The status bar's line for a measurement: "12.40 m at 1:100, 124.0 mm on paper". */
export function measurementLine(m: Markup): string | null {
  const t = measurementText(m);
  if (!t) return null;
  if (t.paper === null) return t.real;
  return t.real === "No scale set" ? `${t.paper} (no scale set)` : `${t.real}, ${t.paper}`;
}

/**
 * The status bar's line while one is being drawn: the measurement so far, and for a polyline
 * the segment under the pointer ("segment 2.10 m"); for Calibrate, the distance picked.
 */
export function drawingLine(m: Markup, segment: { from: [number, number]; to: [number, number] } | null): string | null {
  if (m.kind === "measureCalibrate") return `${formatPaper(calibratePaperMm(m as MeasureCalibrateMarkup))} on paper: click the other end`;
  const line = measurementLine(m);
  if (!line || m.kind !== "measurePath" || !segment) return line;
  const seg = lengthValues({ ...(m as MeasurePathMarkup), kind: "measureLength", from: segment.from, to: segment.to } as unknown as MeasureLengthMarkup);
  return `${line}; this segment ${seg.real ?? `${seg.paper} on paper`}`;
}

/**
 * The markups with every measurement on `pages` (all pages, if null) valued at that page's
 * measure from `pageOf`, and how many changed value. The same list when none did, so nothing
 * is recorded for no change.
 */
export function revalue(markups: Markup[], pages: Set<number> | null, pageOf: (page: number) => PageMeasure): { markups: Markup[]; changed: number } {
  let changed = 0;
  const out = markups.map((m) => {
    if (!isMeasurement(m) || (pages && !pages.has(m.page))) return m;
    const pm = pageOf(m.page);
    if (m.scale === pm.ratio && (m.userUnit ?? 1) === pm.userUnit) return m;
    // An angle doesn't change value with the scale, but it keeps its page's like the rest.
    if (m.kind !== "measureAngle") changed++;
    return { ...m, scale: pm.ratio, userUnit: pm.userUnit, meta: { ...m.meta, modified: new Date().toISOString() } };
  });
  return { markups: changed || out.some((m, i) => m !== markups[i]) ? out : markups, changed };
}

/**
 * The markups with every measurement (or with `ids`, only those) written in format `fmt`, and
 * how many changed. Units and decimals change the selection like any control (rule 7); every
 * measurement is the right-click menu's "Apply to all measurements".
 */
export function reformat(markups: Markup[], fmt: MeasureFormat, ids?: ReadonlySet<string>): { markups: Markup[]; changed: number } {
  let changed = 0;
  const out = markups.map((m) => {
    if (!isMeasurement(m) || (ids && !ids.has(m.id))) return m;
    // A format without the view's system keeps the measurement's (what its Auto is now).
    const next: MeasureFormat = { ...fmt, system: fmt.system ?? m.fmt.system };
    if (sameFormat(m.fmt, next)) return m;
    changed++;
    return { ...m, fmt: next, meta: { ...m.meta, modified: new Date().toISOString() } };
  });
  return { markups: changed ? out : markups, changed };
}

/**
 * Imperial (stage 5 [A9]): every measurement with its Auto resolved to View > Units, `system`.
 * The app calls it when View > Units changes (and whenever the markups do, as it re-values them
 * for a scale), so Auto follows the view while each measurement's text stays a pure function of
 * the markup. The same list when none changed.
 */
export function resolveAuto(markups: Markup[], system: UnitSystem): Markup[] {
  let any = false;
  const out = markups.map((m) => {
    if (!isMeasurement(m) || m.fmt.units !== "auto" || (m.fmt.system ?? "metric") === system) return m;
    any = true;
    return { ...m, fmt: { ...m.fmt, system } };
  });
  return any ? out : markups;
}

// Dimensions (stage 5)
/** The measurements that have ends to choose (a dimension line): length and polyline length. */
export const hasEnds = (m: { kind: MarkupKind }): boolean => m.kind === "measureLength" || m.kind === "measurePath";

/**
 * The markups with every selected measurement given the look `patch` sets: its ends (those with
 * a dimension line) and its value's font. The same list when nothing changes.
 */
export function relook(markups: Markup[], ids: ReadonlySet<string>, patch: Partial<DimensionLook>): Markup[] {
  let any = false;
  const out = markups.map((m) => {
    if (!ids.has(m.id) || !isMeasurement(m)) return m;
    const next: Partial<DimensionLook> = {};
    if (patch.font && (m.font ?? "helvetica") !== patch.font) next.font = patch.font;
    if (patch.ends && hasEnds(m) && (m.ends ?? "bar") !== patch.ends) next.ends = patch.ends;
    if (!Object.keys(next).length) return m;
    any = true;
    return { ...m, ...next, meta: { ...m.meta, modified: new Date().toISOString() } };
  });
  return any ? out : markups;
}

/** The markups with every selected measurement's label at `size` points. */
export function resizeLabels(markups: Markup[], ids: Set<string>, size: number): Markup[] {
  let any = false;
  const out = markups.map((m) => {
    if (!ids.has(m.id) || !isMeasurement(m) || m.labelSize === size) return m;
    any = true;
    return { ...m, labelSize: size, meta: { ...m.meta, modified: new Date().toISOString() } };
  });
  return any ? out : markups;
}
