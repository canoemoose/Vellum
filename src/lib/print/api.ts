// The Rust print commands (src-tauri/src/print/mod.rs), typed.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { Job } from "./model/job";
import { userMessage } from "../shell/messages";
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
  /** Black lines: how faint a line still prints, 0-100. */
  blackSensitivity: number;
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
/** How Save as PDF treats colour: Colour saves the composed (vector) PDF; Greyscale and Black
 * lines save a raster PDF at `dpi`, filtered as printing is. */
export interface SaveOptions {
  colour: ColourMode;
  blackSensitivity: number;
  dpi: number;
}

export const savePdf = (jobId: number, path: string, options?: SaveOptions) => invoke<void>("print_save_pdf", { jobId, path, options });
export const releaseJob = (jobId: number) => invoke<void>("print_release", { jobId }).catch(() => {});
export const cancelPrinting = () => invoke<void>("print_cancel").catch(() => {});

export function sendJob(jobId: number, options: SendOptions, onProgress: (done: number, total: number) => void): Promise<void> {
  const ch = new Channel<[number, number]>();
  ch.onmessage = ([d, t]) => onProgress(d, t);
  return invoke<void>("print_send", { jobId, options, onProgress: ch });
}

/** The message for an error while trying to `verb` (shell/messages.ts: by code, never wording). */
export function errorText(e: unknown, verb = "print"): string {
  return userMessage(e, verb);
}
