// Thin wrappers over Tauri commands and plugins, so components stay free of IPC detail.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

export interface LaunchArgs {
  file: string | null;
  bench: boolean;
  benchOut: string | null;
  renderer: string | null;
  debug: boolean;
  dpr: number | null;
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

export async function pickPdf(): Promise<string | null> {
  const r = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF documents", extensions: ["pdf"] }],
  });
  return typeof r === "string" ? r : null;
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
