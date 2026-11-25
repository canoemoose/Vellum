<script lang="ts">
  // Sidebar Pages panel. Each page gets a placeholder at its aspect ratio; a thumbnail is only
  // requested once its placeholder scrolls near view, and the viewer renders it at low
  // priority (never ahead of visible tiles) and caches it per document. So a 300-page
  // document opens no slower: nothing renders for pages nobody looks at.
  import { onMount } from "svelte";
  import type { PageSize } from "../view/layout";
  import type { PageMarks } from "../engine/pageMarks";

  interface Props {
    docId: number;
    /** The sidebar's width: thumbnails size from this, never from the list's measured width,
     * which moves when Windows 11 scrollbars widen on hover and would reflow the list. */
    width: number;
    sizes: PageSize[];
    current: number;
    /** Pages on screen: a lighter outline than the current page's. */
    visible: number[];
    thumbnail: (page: number, maxSide: number) => Promise<ImageBitmap>;
    /** Drop a waiting request whose page has scrolled out of view. */
    cancelThumbnail: (page: number, maxSide: number) => void;
    /** The markups PDFium doesn't draw (new, moved, changed): painted over each thumbnail. */
    marks?: PageMarks;
    onGoto: (page: number) => void;
  }
  let { docId, width, sizes, current, visible, thumbnail, cancelThumbnail, marks, onGoto }: Props = $props();
  const seen = $derived(new Set(visible));

  // Thumbnails fill the column, less a 32 px margin each side (132 px in the default 196 px
  // sidebar). Very tall pages may grow to twice that width in height before they narrow, and
  // landscape pages use nearly the whole sidebar (16 px a side, which still clears the
  // scrollbar gutters and the selection outline), so extreme shapes don't shrink to slivers.
  const MARGIN = 64;
  const WIDE_EXTRA = MARGIN - 32;
  const TALL = 2;
  const W = $derived(Math.max(60, width - MARGIN));
  /** The width thumbnails are rendered at: follows W once a resize has stopped for a moment,
   * so dragging the sidebar edge scales the drawn ones instead of re-rendering on every pixel. */
  let renderW = $state(0); // 0 until the list has been measured
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const w = W;
    clearTimeout(resizeTimer);
    if (renderW === 0) renderW = w; // first measurement: no wait
    else resizeTimer = setTimeout(() => (renderW = w), 250);
  });

  let list: HTMLDivElement;
  /** Pages asked for and not yet drawn, with the size they were asked at. */
  const requested = new Map<number, number>();
  /** Pages drawn at the current render width. */
  const drawn = new Set<number>();
  /** Placeholders in or near view. */
  const near = new Map<number, HTMLCanvasElement>();
  /** The page pictures drawn, kept while near view so the markups can be painted over them again. */
  const base = new Map<number, { bitmap: ImageBitmap; epoch: number }>();

  function dropBase(page: number) {
    base.get(page)?.bitmap.close();
    base.delete(page);
  }

  /** The page's picture with its markups over it. */
  function paint(page: number) {
    const canvas = near.get(page);
    const b = base.get(page);
    const g = canvas?.getContext("2d");
    if (!canvas || !b || !g) return;
    if (canvas.width !== b.bitmap.width || canvas.height !== b.bitmap.height) {
      canvas.width = b.bitmap.width;
      canvas.height = b.bitmap.height;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(b.bitmap, 0, 0);
    const k = b.bitmap.width / sizes[page].w;
    marks?.paint(g, page, [k, 0, 0, k, 0, 0]);
  }

  // A markup changed: paint the thumbnails near view again, once a frame at most.
  let repaint = 0;
  $effect(() => {
    void marks?.version;
    if (repaint) return;
    repaint = requestAnimationFrame(() => {
      repaint = 0;
      for (const page of base.keys()) paint(page);
    });
  });

  // A page's picture changed in PDFium (an annotation hidden, as it's now drawn here instead):
  // ask for it again. What's drawn stays until the new one arrives.
  $effect(() => {
    void marks?.epoch;
    for (const [page, c] of near) {
      const b = base.get(page);
      const now = marks?.epochOf(page) ?? 0;
      if (!b || b.epoch === now) continue;
      b.epoch = now; // asked for: a change to another page mustn't ask for this one again
      const side = requested.get(page);
      if (side !== undefined) cancelThumbnail(page, side);
      requested.delete(page);
      drawn.delete(page);
      load(page, c);
    }
  });

  function boxSize(s: PageSize, width: number): { w: number; h: number } {
    const maxH = width * TALL;
    const full = s.w > s.h ? width + WIDE_EXTRA : width;
    let w = full;
    let h = (full * s.h) / s.w;
    if (h > maxH) {
      w = (width * maxH) / h;
      h = maxH;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  const sideFor = (page: number) => {
    const box = boxSize(sizes[page], renderW);
    return Math.max(box.w, box.h) * (window.devicePixelRatio || 1);
  };

  // A new render width: ask again for every page in view; what's drawn stays, scaled, until
  // its sharper copy arrives.
  let lastRenderW = 0;
  $effect(() => {
    const w = renderW;
    if (w === lastRenderW) return;
    lastRenderW = w;
    for (const [page, side] of requested) cancelThumbnail(page, side);
    requested.clear();
    drawn.clear();
    for (const [page, c] of near) load(page, c);
  });

  function load(page: number, canvas: HTMLCanvasElement) {
    if (renderW === 0 || requested.has(page) || drawn.has(page)) return;
    const side = sideFor(page);
    requested.set(page, side);
    const id = docId;
    const atW = renderW;
    const epoch = marks?.epochOf(page) ?? 0;
    thumbnail(page, side)
      .then((bmp) => {
        if (requested.get(page) === side) requested.delete(page);
        if (atW !== renderW) {
          bmp.close(); // asked at an older width; the new size is on its way
          return;
        }
        if (id !== docId || !canvas.isConnected) {
          bmp.close();
          return;
        }
        if (!near.has(page)) {
          bmp.close(); // scrolled away meanwhile
          return;
        }
        drawn.add(page);
        dropBase(page);
        base.set(page, { bitmap: bmp, epoch });
        paint(page);
        canvas.classList.add("ready");
      })
      .catch(() => {
        // Cancelled, document closed or render failed: try again if it scrolls back into view.
        if (requested.get(page) === side) requested.delete(page);
      });
  }

  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const c = e.target as HTMLCanvasElement;
          const page = Number(c.dataset.page);
          if (e.isIntersecting) {
            near.set(page, c);
            load(page, c);
          } else {
            near.delete(page);
            // Drawn again (from the viewer's cache) if it scrolls back: its markups may have changed.
            dropBase(page);
            drawn.delete(page);
            const side = requested.get(page);
            if (side !== undefined) {
              requested.delete(page);
              cancelThumbnail(page, side);
            }
          }
        }
      },
      { root: list, rootMargin: "300px 0px" },
    );
    for (const c of list.querySelectorAll("canvas")) io.observe(c);
    return () => {
      io.disconnect();
      if (repaint) cancelAnimationFrame(repaint);
      for (const page of [...base.keys()]) dropBase(page);
    };
  });

  // Bring the current page's thumbnail into view when the current page changes, and only
  // then: anything else that re-runs this effect (Matt saw the list jump on hovering its
  // scrollbar) mustn't drag the list back to it.
  let shown = -1;
  $effect(() => {
    const c = current;
    if (c === shown) return;
    shown = c;
    list?.querySelector<HTMLElement>(`[data-item="${c}"]`)?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="list" bind:this={list}>
  {#each sizes as s, i (i)}
    {@const b = boxSize(s, W)}
    <button type="button" class="item" class:on={i === current} class:seen={i !== current && seen.has(i)} data-item={i} title="Page {i + 1}" onclick={() => onGoto(i)}>
      <canvas data-page={i} style:width="{b.w}px" style:height="{b.h}px" width="1" height="1"></canvas>
      <span>{i + 1}</span>
    </button>
  {/each}
</div>

<style>
  .list {
    flex: 1 1 auto;
    overflow-y: auto;
    scrollbar-gutter: stable both-edges; /* the scrollbar never changes the layout */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 10px 0 16px;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    padding: 0;
    color: var(--tx3);
    font-size: 12px;
    flex-shrink: 0;
  }
  canvas {
    display: block;
    background: var(--paper);
    border-radius: 2px;
    border: 1px solid var(--bd-input);
  }
  .item:hover canvas {
    border-color: var(--tx3);
  }
  .item.on canvas {
    border-color: transparent;
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .item.seen canvas {
    border-color: transparent;
    outline: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
    outline-offset: 3px;
  }
  .item.on span {
    color: var(--tx);
    font-weight: 600;
  }
</style>
