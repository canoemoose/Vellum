// Thin wrappers over Tauri commands and plugins, so components stay free of IPC detail.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { IMAGE_EXTENSIONS } from "./render/imageRenderer";

export interface LaunchArgs {
  file: string | null;
  bench: boolean;
  benchOut: string | null;
  debug: boolean;
  dpr: number | null;
  /** Benchmark this page (zero-based) instead of the first. */
  benchPage?: number | null;
  processStartEpochMs: number;
}

export interface MemSample {
  privateWsMb: number;
  workingSetMb: number;
  commitMb: number;
  processes: number;
}

export interface MemStats {
  current: MemSample;
  peak: MemSample;
}

export const launchArgs = () => invoke<LaunchArgs>("launch_args");
export const memoryStats = () => invoke<MemStats>("memory_stats");
export const resetMemoryPeak = () => invoke<void>("reset_memory_peak");
export const writeTextFile = (path: string, contents: string) =>
  invoke<void>("write_text_file", { path, contents });
export const writeBinaryFile = (path: string, bytes: Uint8Array) =>
  invoke<void>("write_binary_file", bytes, { headers: { path } });
export const exitApp = (code = 0) => invoke<void>("exit_app", { code });
export const revealInExplorer = (path: string) => invoke<void>("reveal_in_explorer", { path });

/** Every extension Vellum opens (PDF plus the image types). */
export const OPEN_EXTENSIONS = ["pdf", ...IMAGE_EXTENSIONS];

export function isOpenablePath(path: string): boolean {
  const ext = /\.([^.\\/]+)$/.exec(path)?.[1]?.toLowerCase();
  return !!ext && OPEN_EXTENSIONS.includes(ext);
}

/** File > Open: any number of PDFs and images. */
export async function pickFiles(): Promise<string[]> {
  const r = await openDialog({
    multiple: true,
    directory: false,
    filters: [
      { name: "PDFs and images", extensions: OPEN_EXTENSIONS },
      { name: "PDF documents", extensions: ["pdf"] },
      { name: "Images", extensions: IMAGE_EXTENSIONS },
    ],
  });
  if (!r) return [];
  return Array.isArray(r) ? r : [r];
}

export async function pickFolder(title: string): Promise<string | null> {
  const r = await openDialog({ directory: true, multiple: false, title });
  return typeof r === "string" ? r : null;
}

/**
 * Files forwarded by later launches (single instance). Listens first, then collects anything
 * that arrived before the listener existed, so nothing is lost at start-up.
 */
export async function onForwardedFiles(cb: (paths: string[]) => void): Promise<UnlistenFn> {
  const un = await listen<string[]>("vellum://open-files", (e) => cb(e.payload));
  try {
    const pending = await invoke<string[]>("shell_take_pending");
    if (pending.length) cb(pending);
  } catch (e) {
    console.warn("shell_take_pending failed", String(e));
  }
  return un;
}

/** Append rows to %LOCALAPPDATA%\Vellum\perf-log.csv. Returns the file path. */
export function appendPerfLog(header: string[], rows: (string | number | null)[][]): Promise<string> {
  const csv = (v: string | number | null) => {
    const s = v === null ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "") : v;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return invoke<string>("append_perf_log", {
    header: header.join(","),
    rows: rows.map((r) => r.map(csv).join(",")),
  });
}

/** Chromium-only JS heap figure; undefined elsewhere. */
export function jsHeapMb(): number | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize / 1048576 : null;
}
