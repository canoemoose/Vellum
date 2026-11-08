// The Rust print commands (src-tauri/src/print/mod.rs), typed.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { Job } from "./model/job";
import type { ColourMode, Duplex, Quality } from "./model/settings";

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

/** Sizes in millimetres, portrait as the driver reports them. */
export interface Paper {
  id: number;
  name: string;
  w: number;
  h: number;
}

export interface Capabilities {
  papers: Paper[];
  bins: { id: number; name: string }[];
  duplex: boolean;
  collate: boolean;
  colour: boolean;
  maxCopies: number;
  defaultPaper: number | null;
  defaultLandscape: boolean;
}

/** Millimetres. */
export interface MarginsMm {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Composed {
  jobId: number;
  sheets: number;
  bytes: number;
}

export interface SendOptions {
  printer: string;
  copies: number;
  collate: boolean;
  duplex: Duplex;
  colour: ColourMode;
  quality: Quality;
  paper: number | null;
  trayBySize: boolean;
  reverse: boolean;
  title: string;
}

export const printFeatures = () => invoke<{ vector: boolean; gdi: boolean }>("print_features");
export const listPrinters = () => invoke<PrinterInfo[]>("print_printers");
export const printerCapabilities = (printer: string) => invoke<Capabilities>("print_capabilities", { printer });
export const printerMargins = (printer: string, paper: number | null, landscape: boolean) =>
  invoke<MarginsMm>("print_margins", { printer, paper, landscape });
export const printerProperties = (printer: string) => invoke<boolean>("print_properties", { printer });
export const composeJob = (job: Job) => invoke<Composed>("print_compose", { job });
export const savePdf = (jobId: number, path: string) => invoke<void>("print_save_pdf", { jobId, path });
export const releaseJob = (jobId: number) => invoke<void>("print_release", { jobId }).catch(() => {});
export const cancelPrinting = () => invoke<void>("print_cancel").catch(() => {});

export function sendJob(jobId: number, options: SendOptions, onProgress: (done: number, total: number) => void): Promise<void> {
  const ch = new Channel<[number, number]>();
  ch.onmessage = ([d, t]) => onProgress(d, t);
  return invoke<void>("print_send", { jobId, options, onProgress: ch });
}

/** Errors from invoke are strings meant for the user; anything else gets a generic line. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
