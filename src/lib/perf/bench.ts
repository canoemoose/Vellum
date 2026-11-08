// Scripted benchmark, run when the app is launched with --bench. Drives the viewer
// programmatically, writes a JSON result to --bench-out, appends to the perf CSV, exits.
// tools/bench.mjs launches the release build repeatedly and aggregates the JSON.

import { invoke } from "@tauri-apps/api/core";
import type { Viewer } from "../engine/viewer";
import { fitRect } from "../view/viewMath";
import {
  type LaunchArgs,
  appendPerfLog,
  exitApp,
  jsHeapMb,
  memoryStats,
  resetMemoryPeak,
  writeBinaryFile,
  writeTextFile,
} from "../platform";

const ZOOMS: { label: string; zoom: number | "fit" }[] = [
  { label: "fit", zoom: "fit" },
  { label: "400", zoom: 4 },
  { label: "1600", zoom: 16 },
];
const REPS = 3;
const PAN_MS = 2000;
const PAN_RADIUS = 400; // CSS px; one lap per PAN_MS, about 1250 px/s
const TIMEOUT = 120000;

interface PanResult {
  fps: number;
  intervalP95Ms: number;
  maxIntervalMs: number;
  dropped: number;
  frames: number;
  drawP95Ms: number;
  drawMaxMs: number;
}

interface ZoomResult {
  label: string;
  zoomPct: number;
  settleToSharpMs: (number | null)[];
  settleToFirstBandMs: (number | null)[];
  complete: boolean[];
  regions: number[];
  pan: PanResult[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

function timeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, sleep(ms).then(() => null)]);
}

async function measureRefresh(): Promise<number> {
  const ts: number[] = [];
  for (let i = 0; i < 61; i++) ts.push(await frame());
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  return 1000 / d[Math.floor(d.length / 2)];
}

function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

async function pan(v: Viewer, refreshHz: number): Promise<PanResult> {
  let start = 0;
  let last = { x: PAN_RADIUS, y: 0 };
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  v.driver = (t) => {
    if (!start) start = t;
    const a = (((t - start) / PAN_MS) * Math.PI * 2) % (Math.PI * 2);
    const p = { x: PAN_RADIUS * Math.cos(a), y: PAN_RADIUS * Math.sin(a) };
    v.panBy(p.x - last.x, p.y - last.y);
    last = p;
    if (t - start >= PAN_MS) {
      v.driver = null;
      done();
    }
  };
  v.requestFrame();
  await finished;
  const fr = v.frames.filter((f) => f.t >= start && f.t <= start + PAN_MS);
  const iv = fr.slice(1).map((f, i) => f.t - fr[i].t);
  const span = fr.length > 1 ? fr[fr.length - 1].t - fr[0].t : 1;
  const budget = 1000 / refreshHz;
  return {
    fps: ((fr.length - 1) * 1000) / span,
    intervalP95Ms: pct(iv, 0.95),
    maxIntervalMs: Math.max(0, ...iv),
    dropped: iv.filter((d) => d > budget * 1.5).length,
    frames: fr.length,
    drawP95Ms: pct(fr.map((f) => f.drawMs), 0.95),
    drawMaxMs: Math.max(0, ...fr.map((f) => f.drawMs)),
  };
}

export async function runBench(v: Viewer, args: LaunchArgs, shownEpochMs: number): Promise<void> {
  const out: Record<string, unknown> = {
    file: args.file,
    renderer: v.renderer.name,
    processStartEpochMs: args.processStartEpochMs,
    shownEpochMs,
    dpr: v.dpr,
    viewport: { w: v.vw, h: v.vh },
    userAgent: navigator.userAgent,
  };
  let code = 0;
  let heapPeak = 0;
  const sampleHeap = () => (heapPeak = Math.max(heapPeak, jsHeapMb() ?? 0));
  try {
    if (!args.file) throw new Error("--bench needs a file");
    // Every run renders from cold, as in RESULTS.md: no previews from earlier runs.
    v.diskPreviews = false;
    out.refreshHz = await measureRefresh();
    await resetMemoryPeak();

    // Open to first page sharp.
    const t0 = performance.now();
    const firstSharp = v.whenSharp();
    let firstBandAt: number | null = null;
    void v.whenFirstBand().then(() => (firstBandAt = performance.now()));
    await v.open(args.file);
    out.openParsedMs = performance.now() - t0;
    const fs = await timeout(firstSharp, TIMEOUT);
    out.firstPageMs = fs ? performance.now() - t0 : null;
    // Progressive paint: open to the first band of the page on screen.
    out.firstBandMs = firstBandAt !== null ? (firstBandAt as number) - t0 : null;
    out.numPages = v.doc?.numPages;
    out.pageSize = v.doc?.sizes[0];
    out.docKind = v.doc?.kind;
    out.docMeta = v.doc?.meta;
    // Smoke-check the text commands (cheap, after first paint so they don't skew it).
    if (v.doc && v.renderer.findScale) {
      const id = v.doc.docId;
      const t1 = performance.now();
      out.scale = (await v.renderer.findScale(id, 0)).slice(0, 3);
      out.findScaleMs = performance.now() - t1;
      out.textChars = (await v.renderer.pageText?.(id, 0))?.length ?? null;
      out.outlineTopLevel = (await v.renderer.outline?.(id))?.length ?? null;
    }
    await v.whenIdle(TIMEOUT);
    sampleHeap();
    out.memAfterOpenMb = (await memoryStats()).current.privateWsMb;

    const rect = v.layout.rects[0]!;
    const fitScale = fitRect(rect, v.vw, v.vh, 16, "page").scale;
    const results: ZoomResult[] = [];
    const snapDir = args.benchOut ? args.benchOut.replace(/\.json$/i, "") : null;

    for (const z of ZOOMS) {
      const targetScale = z.zoom === "fit" ? fitScale : z.zoom * (96 / 72);
      const r: ZoomResult = {
        label: z.label,
        zoomPct: (targetScale / (96 / 72)) * 100,
        settleToSharpMs: [],
        settleToFirstBandMs: [],
        complete: [],
        regions: [],
        pan: [],
      };
      for (let rep = 0; rep < REPS; rep++) {
        // Start 1.25x out from the target, centred on the page centre, and let it go sharp.
        v.fit("page");
        const ax = v.vw / 2;
        const ay = v.vh / 2;
        v.setView(
          { scale: targetScale / 1.25, tx: ax - (rect.x + rect.w / 2) * (targetScale / 1.25), ty: ay - (rect.y + rect.h / 2) * (targetScale / 1.25) },
          "jump",
        );
        await v.whenIdle(TIMEOUT);
        // Earlier reps cached the target scale; drop tiles so every rep renders from cold
        // (previews stay, as they would in real use).
        v.dropTiles();
        await frame();
        // One animated zoom step to the target (like a couple of wheel notches), then
        // measure settle -> all visible tiles sharp.
        const sharp = v.whenSharp();
        v.zoomAt(ax, ay, 1.25, true);
        const ev = await timeout(sharp, TIMEOUT);
        r.settleToSharpMs.push(ev ? ev.settleToSharpMs : null);
        r.settleToFirstBandMs.push(ev ? ev.settleToFirstBandMs : null);
        r.complete.push(ev ? ev.complete : false);
        r.regions.push(ev ? ev.regions : 0);
        await v.whenIdle(TIMEOUT);
        sampleHeap();
      }
      if (snapDir) {
        const blob = await new Promise<Blob | null>((res) =>
          (document.querySelector(".stage canvas") as HTMLCanvasElement).toBlob(res, "image/png"),
        );
        if (blob) await writeBinaryFile(`${snapDir}.${z.label}.png`, new Uint8Array(await blob.arrayBuffer()));
      }
      for (let rep = 0; rep < REPS; rep++) {
        await v.whenIdle(TIMEOUT);
        await sleep(100);
        r.pan.push(await pan(v, out.refreshHz as number));
        sampleHeap();
      }
      await v.whenIdle(TIMEOUT);
      results.push(r);
    }
    out.zooms = results;
    const mem = await memoryStats();
    out.memPeak = mem.peak;
    out.memEnd = mem.current;
    out.jsHeapPeakMb = heapPeak || null;
    const st = v.stats();
    out.cache = { tiles: st.tiles, mb: st.cacheMB, evictions: st.evictions, previews: st.previews, previewMb: st.previewMB };
    out.renderErrors = st.renderErrors;
    out.bandsDrawn = st.bandsDrawn;
    if (v.renderer.name === "pdfium") {
      out.pdfiumWorkers = (v.renderer as unknown as { workers: number }).workers;
      out.pdfiumTrims = await invoke<number>("pdfium_trims");
    }
  } catch (e) {
    out.error = String((e as Error)?.stack ?? e);
    code = 1;
  }

  try {
    if (args.benchOut) await writeTextFile(args.benchOut, JSON.stringify(out, null, 2));
    const zs = (out.zooms as ZoomResult[] | undefined) ?? [];
    const med = (a: (number | null)[]) => {
      const s = a.filter((x): x is number => x !== null).sort((x, y) => x - y);
      return s.length ? s[Math.floor(s.length / 2)] : null;
    };
    await appendPerfLog(
      ["time", "source", "file", "renderer", "zoom_pct", "settle_to_sharp_ms", "complete", "fps_last_second", "tiles", "cache_mb", "js_heap_mb", "process_mb"],
      zs.map((z) => [
        new Date().toISOString(), "bench", String(out.file), String(out.renderer), z.zoomPct,
        med(z.settleToSharpMs), String(z.complete.every(Boolean)), med(z.pan.map((p) => p.fps)),
        null, null, (out.jsHeapPeakMb as number) ?? null, (out.memPeak as { privateWsMb: number } | undefined)?.privateWsMb ?? null,
      ]),
    );
  } finally {
    await exitApp(code);
  }
}
