// Fixtures for the print model tests.

import { type Margins, mmToPt } from "./geom";
import type { PageRef } from "./job";
import { type AutoInput, type AutoOptions, type Source } from "./auto";

export const A4 = { w: mmToPt(210), h: mmToPt(297) };
export const A3 = { w: mmToPt(297), h: mmToPt(420) };
export const A1 = { w: mmToPt(594), h: mmToPt(841) };
export const A0 = { w: mmToPt(841), h: mmToPt(1189) };

export function ref(w: number, h: number, extra: Partial<PageRef> = {}): PageRef {
  return { docId: 1, page: 0, path: "C:/plans/plan.pdf", kind: "pdf", title: "plan.pdf", w, h, drawingScale: null, ...extra };
}

export const src = (r: PageRef, crop: Source["crop"] = null): Source => ({ ref: r, crop });

export const uniform = (mm: number): Margins => {
  const m = mmToPt(mm);
  return { left: m, top: m, right: m, bottom: m };
};

export const OPTS: AutoOptions = {
  sizing: "fit",
  fitTo: "printable",
  scaleRatio: 100,
  nUp: 1,
  order: "across",
  marginMode: "printer",
  customMarginMm: 10,
  centre: true,
  autoRotate: true,
  borders: false,
  tileOverlapMm: 10,
  landscape: false,
  trayBySize: false,
  shrinkOversized: false,
  stamp: false,
};

export function input(sources: Source[], options: Partial<AutoOptions> = {}, rest: Partial<AutoInput> = {}): AutoInput {
  return {
    sources,
    paper: A3,
    printerMargins: { portrait: uniform(5), landscape: uniform(5) },
    date: "08/11/2026 19:12",
    options: { ...OPTS, ...options },
    ...rest,
  };
}

export const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
