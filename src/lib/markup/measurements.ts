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
 * A measurement's two values as text: real-world at its scale ("12.40 m at 1:100"; with no
 * scale, "No scale set") and on paper ("124.0 mm on paper"). An angle reads the same at any
 * scale, so it has one value and no paper one. Null for anything that isn't a measurement.
 * For the markups list (phase 7) and the status bar.
 */
export function measurementText(m: Markup): { real: string; paper: string | null } | null {
  if (!isMeasurement(m)) return null;
  const pm = pageMeasureOf(m);
  switch (m.kind) {
    case "measureLength":
    case "measurePath": {
      const v = m.kind === "measureLength" ? lengthValues(m) : pathValues(m);
      return { real: v.real === null ? "No scale set" : `${v.real} ${atScale(pm, m.fmt)}`, paper: `${v.paper} on paper` };
    }
    case "measureArea": {
      const v = areaValues(m);
      const crosses = v.crosses ? " (the outline crosses itself)" : "";
      return {
        real: v.real === null ? "No scale set" : `${v.real}, perimeter ${v.realPerimeter} ${atScale(pm, m.fmt)}${crosses}`,
        paper: `${v.paper}, perimeter ${v.paperPerimeter} on paper${v.real === null ? crosses : ""}`,
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
