<script lang="ts">
  // Sidebar Pages panel. Each page gets a placeholder at its aspect ratio; a thumbnail is only
  // requested once its placeholder scrolls near view, and the viewer renders it at low
  // priority (never ahead of visible tiles) and caches it per document. So a 300-page
  // document opens no slower: nothing renders for pages nobody looks at.
  import { onMount } from "svelte";
  import type { PageSize } from "../view/layout";

  interface Props {
    docId: number;
    sizes: PageSize[];
    current: number;
    thumbnail: (page: number, maxSide: number) => Promise<ImageBitmap>;
    /** Drop a waiting request whose page has scrolled out of view. */
    cancelThumbnail: (page: number, maxSide: number) => void;
    onGoto: (page: number) => void;
  }
  let { docId, sizes, current, thumbnail, cancelThumbnail, onGoto }: Props = $props();

  const W = 132;
  const MAX_H = 187;

  let list: HTMLDivElement;
  /** Pages asked for and not yet drawn. */
  const requested = new Set<number>();
  /** Pages already drawn. */
  const drawn = new Set<number>();

  const sideFor = (page: number) => {
    const box = boxSize(sizes[page]);
    return Math.max(box.w, box.h) * (window.devicePixelRatio || 1);
  };

  function boxSize(s: PageSize): { w: number; h: number } {
    let w = W;
    let h = (W * s.h) / s.w;
    if (h > MAX_H) {
      w = (W * MAX_H) / h;
      h = MAX_H;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }

  function load(page: number, canvas: HTMLCanvasElement) {
    if (requested.has(page) || drawn.has(page)) return;
    requested.add(page);
    const id = docId;
    thumbnail(page, sideFor(page))
      .then((bmp) => {
        requested.delete(page);
        if (id !== docId || !canvas.isConnected) {
          bmp.close();
          return;
        }
        drawn.add(page);
        canvas.width = bmp.width;
        canvas.height = bmp.height;
        canvas.getContext("2d")?.drawImage(bmp, 0, 0);
        canvas.classList.add("ready");
        bmp.close();
      })
      .catch(() => {
        // Cancelled, document closed or render failed: try again if it scrolls back into view.
        requested.delete(page);
      });
  }

  onMount(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const c = e.target as HTMLCanvasElement;
          const page = Number(c.dataset.page);
          if (e.isIntersecting) load(page, c);
          else if (requested.has(page)) cancelThumbnail(page, sideFor(page));
        }
      },
      { root: list, rootMargin: "300px 0px" },
    );
    for (const c of list.querySelectorAll("canvas")) io.observe(c);
    return () => io.disconnect();
  });

  $effect(() => {
    const el = list?.querySelector<HTMLElement>(`[data-item="${current}"]`);
    el?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="list" bind:this={list}>
  {#each sizes as s, i (i)}
    {@const b = boxSize(s)}
    <button type="button" class="item" class:on={i === current} data-item={i} title="Page {i + 1}" onclick={() => onGoto(i)}>
      <canvas data-page={i} style:width="{b.w}px" style:height="{b.h}px" width="1" height="1"></canvas>
      <span>{i + 1}</span>
    </button>
  {/each}
</div>

<style>
  .list {
    flex: 1 1 auto;
    overflow-y: auto;
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
    background: #ffffff;
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
  .item.on span {
    color: var(--tx);
    font-weight: 600;
  }
</style>
