// Low-priority page thumbnails (sidebar Pages panel). Requests wait until the viewer is idle
// (nothing queued or rendering for the visible view, no recent input), run one at a time,
// newest request first (the pages the user just scrolled to), and are cached per document.
// A thumbnail already in the cache, or one the caller can build from a page preview, never
// touches the backend.

import type { Renderer } from "../render/types";

export interface ThumbnailOptions {
  /** True when visible rendering is finished and the user isn't interacting. */
  isIdle: () => boolean;
  /** A thumbnail made without the backend (e.g. from a cached page preview), or null. */
  fromPreview?: (docId: number, page: number, maxSide: number) => ImageBitmap | null;
  /** Cache ceiling in decoded bytes. */
  budgetBytes?: number;
  /** How often to re-check for idleness while requests wait, ms. */
  pollMs?: number;
}

interface Entry {
  bitmap: ImageBitmap;
  bytes: number;
}

interface Pending {
  key: string;
  renderer: Renderer;
  docId: number;
  page: number;
  maxSide: number;
  /** The document was closed while this was rendering. */
  cancelled?: boolean;
  waiters: { res: (b: ImageBitmap) => void; rej: (e: unknown) => void }[];
}

const keyOf = (docId: number, page: number, maxSide: number) => `${docId}|${page}|${maxSide}`;

/** createImageBitmap(bitmap) where available (a cheap GPU copy); the bitmap itself in tests. */
async function copyOf(b: ImageBitmap): Promise<ImageBitmap> {
  return typeof createImageBitmap === "function" ? createImageBitmap(b) : b;
}

export class ThumbnailQueue {
  private cache = new Map<string, Entry>();
  private bytes = 0;
  private queue: Pending[] = [];
  private busy = false;
  private inflight: Pending | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly budget: number;
  private readonly pollMs: number;

  constructor(private opts: ThumbnailOptions) {
    this.budget = opts.budgetBytes ?? 64 * 1024 * 1024;
    this.pollMs = opts.pollMs ?? 100;
  }

  /**
   * A thumbnail of `page` scaled so its longer side is `maxSide` device pixels. Resolves with
   * a bitmap the caller owns (close it when done). Rejects if the document is closed first
   * (cancelDoc) or the render fails.
   */
  request(renderer: Renderer, docId: number, page: number, maxSide: number): Promise<ImageBitmap> {
    maxSide = Math.max(1, Math.round(maxSide));
    const key = keyOf(docId, page, maxSide);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit); // LRU touch
      return copyOf(hit.bitmap);
    }
    return new Promise((res, rej) => {
      if (this.inflight?.key === key) {
        this.inflight.waiters.push({ res, rej });
        return;
      }
      const existing = this.queue.find((p) => p.key === key);
      if (existing) {
        existing.waiters.push({ res, rej });
        // Re-requested: move to the front.
        this.queue.splice(this.queue.indexOf(existing), 1);
        this.queue.push(existing);
      } else {
        this.queue.push({ key, renderer, docId, page, maxSide, waiters: [{ res, rej }] });
      }
      this.kick();
    });
  }

  /** Cached thumbnail without queueing anything (caller must not close it). */
  peek(docId: number, page: number, maxSide: number): ImageBitmap | undefined {
    return this.cache.get(keyOf(docId, page, Math.max(1, Math.round(maxSide))))?.bitmap;
  }

  /** Forget a document: reject its waiting requests and free its cached thumbnails. */
  cancelDoc(docId: number): void {
    const prefix = `${docId}|`;
    if (this.inflight?.docId === docId) this.inflight.cancelled = true;
    this.queue = this.queue.filter((p) => {
      if (p.docId !== docId) return true;
      p.waiters.forEach((w) => w.rej(new Error("document closed")));
      return false;
    });
    for (const [k, e] of [...this.cache]) {
      if (!k.startsWith(prefix)) continue;
      this.cache.delete(k);
      this.bytes -= e.bytes;
      e.bitmap.close();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get cachedBytes(): number {
    return this.bytes;
  }

  /** Try to run the next request now; called by the viewer when it goes idle. */
  kick(): void {
    if (this.busy || this.queue.length === 0) return;
    if (!this.opts.isIdle()) {
      this.timer ??= setTimeout(() => {
        this.timer = null;
        this.kick();
      }, this.pollMs);
      return;
    }
    const job = this.queue.pop()!; // newest first
    this.busy = true;
    this.inflight = job;
    void this.run(job).finally(() => {
      this.busy = false;
      this.inflight = null;
      this.kick();
    });
  }

  private async run(job: Pending): Promise<void> {
    try {
      let bmp = this.opts.fromPreview?.(job.docId, job.page, job.maxSide) ?? null;
      if (!bmp) {
        if (!job.renderer.thumbnail) throw new Error("renderer has no thumbnails");
        bmp = await job.renderer.thumbnail(job.docId, job.page, job.maxSide);
      }
      if (job.cancelled) {
        bmp.close();
        throw new Error("document closed");
      }
      this.put(job.key, bmp);
      for (const w of job.waiters) w.res(await copyOf(bmp));
    } catch (e) {
      job.waiters.forEach((w) => w.rej(e));
    }
  }

  private put(key: string, bitmap: ImageBitmap): void {
    const old = this.cache.get(key);
    if (old) {
      this.bytes -= old.bytes;
      old.bitmap.close();
    }
    const bytes = bitmap.width * bitmap.height * 4;
    this.cache.set(key, { bitmap, bytes });
    this.bytes += bytes;
    while (this.bytes > this.budget && this.cache.size > 1) {
      const [k, e] = this.cache.entries().next().value as [string, Entry];
      this.cache.delete(k);
      this.bytes -= e.bytes;
      e.bitmap.close();
    }
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const p of this.queue) p.waiters.forEach((w) => w.rej(new Error("disposed")));
    this.queue = [];
    for (const e of this.cache.values()) e.bitmap.close();
    this.cache.clear();
    this.bytes = 0;
  }
}
