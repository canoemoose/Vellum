// Test helpers for the viewer: DOM stand-ins, stub renderers and fake-timer setup. Used only
// by *.test.ts files (Node has no canvas, ImageBitmap or requestAnimationFrame).

import { vi } from "vitest";
import { Viewer } from "./viewer";
import type { BandBitmap, DocInfo, RegionRequest, Renderer } from "../render/types";

// ---------------------------------------------------------------- DOM stand-ins

export class StubBitmap {
  closed = false;
  constructor(public width: number, public height: number) {}
  close() {
    this.closed = true;
  }
}

/** A 2D context whose every method is a no-op. */
export function stubContext(): CanvasRenderingContext2D {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, k) => (k in t ? t[k as string] : () => {}),
    set: (t, k, v) => ((t[k as string] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

export function stubCanvas(): HTMLCanvasElement {
  return { width: 0, height: 0, style: {}, getContext: () => stubContext() } as unknown as HTMLCanvasElement;
}

class StubOffscreenCanvas {
  constructor(public width: number, public height: number) {}
  getContext() {
    return stubContext();
  }
  transferToImageBitmap() {
    return new StubBitmap(this.width, this.height);
  }
}

/** Install DOM stand-ins and fake timers (call in beforeEach; vi.useRealTimers() after). */
export function installFakes(): void {
  // Node has no requestAnimationFrame; define one so the fake timers have something to replace.
  const g = globalThis as Record<string, unknown>;
  g.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
  g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
  vi.useFakeTimers({
    toFake: [
      "setTimeout", "clearTimeout", "setInterval", "clearInterval",
      "requestAnimationFrame", "cancelAnimationFrame", "performance", "queueMicrotask",
    ],
  });
  g.document = { documentElement: {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "#2b2d31" });
  g.OffscreenCanvas = StubOffscreenCanvas;
}

// ---------------------------------------------------------------- stub renderers

export interface Call {
  docId: number;
  req: RegionRequest;
  signal: AbortSignal;
  done?: boolean;
  resolve: () => void;
  fail: (e: unknown) => void;
}

export class StubRenderer implements Renderer {
  readonly name = "pdfium" as const;
  concurrency = 2;
  calls: Call[] = [];
  closed: number[] = [];
  /** Resolve renders at once (true) or hold them until resolveAll() (false). */
  auto = false;
  constructor(public info: DocInfo) {}

  async open(): Promise<DocInfo> {
    return this.info;
  }
  renderRegion(docId: number, req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null> {
    return new Promise((res, rej) => {
      const call: Call = {
        docId, req, signal,
        resolve: () => res(signal.aborted ? null : (req.tiles.map((t) => new StubBitmap(t.w, t.h)) as unknown as ImageBitmap[])),
        fail: rej,
      };
      this.calls.push(call);
      if (this.auto) {
        call.done = true;
        call.resolve();
      }
    });
  }
  async close(docId: number): Promise<void> {
    this.closed.push(docId);
  }
  pending(): Call[] {
    return this.calls.filter((c) => !c.done);
  }
  /** Resolve every call made so far that is still open. */
  resolveAll(): void {
    for (const c of this.calls) {
      if (c.done) continue;
      c.done = true;
      c.resolve();
    }
  }
}

export interface Stream {
  req: RegionRequest;
  signal: AbortSignal;
  /** Deliver band k (0 = left half, 1 = right half of the region). */
  send: (k: number) => void;
  finish: () => void;
}

/** Streams each region as two bands (left and right halves), held until released. */
export class BandRenderer extends StubRenderer {
  streams: Stream[] = [];
  renderRegionProgressive(
    _docId: number,
    req: RegionRequest,
    onBand: (b: BandBitmap) => void,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise((res) => {
      const half = Math.ceil(req.w / 2);
      const parts = [
        { x: req.x, w: half },
        { x: req.x + half, w: req.w - half },
      ];
      const sent = new Set<number>();
      const delivered = new Set<number>();
      this.streams.push({
        req, signal,
        send: (k) => {
          if (sent.has(k) || signal.aborted || parts[k].w <= 0) return;
          sent.add(k);
          const p = parts[k];
          const inside = (t: { x: number; w: number }) =>
            sent.size === 2 || [...sent].some((s) => t.x >= parts[s].x && t.x + t.w <= parts[s].x + parts[s].w);
          const tiles = req.tiles
            .map((t, index) => ({ t, index }))
            .filter(({ t, index }) => inside(t) && !delivered.has(index))
            .map(({ t, index }) => {
              delivered.add(index);
              return { index, bitmap: new StubBitmap(t.w, t.h) as unknown as ImageBitmap };
            });
          onBand({ x: p.x, y: req.y, w: p.w, h: req.h, bitmap: new StubBitmap(p.w, req.h) as unknown as ImageBitmap, tiles });
        },
        finish: () => res(),
      });
    });
  }
}

export function doc(sizes: { w: number; h: number }[], docId = 7): DocInfo {
  return {
    docId, kind: "pdf", numPages: sizes.length, sizes, workers: 8,
    meta: { fileSize: 1, pdfVersion: "1.7", title: null, author: null, subject: null, producer: null, creator: null, note: null },
  };
}

// ---------------------------------------------------------------- time

/** Let promise callbacks and any due timers / frames run. */
export async function flush(ms = 0): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(ms / 5 || 0);
    await Promise.resolve();
  }
}

/** Advance one animation frame at a time until `cond` holds or `maxMs` passes. */
export async function until(cond: () => boolean, maxMs = 2000): Promise<void> {
  for (let t = 0; t < maxMs && !cond(); t += 16) await vi.advanceTimersByTimeAsync(16);
}

/** A viewer on an 800 x 600 viewport with a document open through a StubRenderer. */
export async function openViewer(sizes = [{ w: 1190, h: 842 }], auto = false) {
  const r = new StubRenderer(doc(sizes));
  r.auto = auto;
  const v = new Viewer(stubCanvas(), {}, r);
  v.resize(800, 600, 1);
  await v.open("C:/x/drawing.pdf", undefined, r);
  return { v, r };
}
