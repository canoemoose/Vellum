<script lang="ts">
  // Print > Pages > Marquee: drag a rectangle on a page of the active document. Resolves the
  // rectangle in that page's points (unrotated, y down), or null on Escape or right-click.
  import { onMount } from "svelte";
  import type { PageRect } from "../print/context";

  interface Props {
    /** Page point under a viewport point, or null off the pages. */
    pageAt: (sx: number, sy: number) => { page: number; x: number; y: number } | null;
    /** A viewport point in a given page's points, clamped to the page. */
    pointOn: (page: number, sx: number, sy: number) => { x: number; y: number };
    onDone: (r: PageRect | null) => void;
  }
  let { pageAt, pointOn, onDone }: Props = $props();

  let el: HTMLDivElement;
  let start = $state<{ sx: number; sy: number; page: number } | null>(null);
  let cur = $state({ sx: 0, sy: 0 });

  const local = (e: PointerEvent): [number, number] => {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  onMount(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDone(null);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  function down(e: PointerEvent) {
    if (e.button === 2) {
      onDone(null);
      return;
    }
    if (e.button !== 0) return;
    const [sx, sy] = local(e);
    const p = pageAt(sx, sy);
    if (!p) return;
    start = { sx, sy, page: p.page };
    cur = { sx, sy };
    el.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    if (!start) return;
    const [sx, sy] = local(e);
    cur = { sx, sy };
  }

  function up(e: PointerEvent) {
    if (!start || e.button !== 0) return;
    const s = start;
    start = null;
    const [sx, sy] = local(e);
    if (Math.abs(sx - s.sx) < 4 || Math.abs(sy - s.sy) < 4) return; // a click, not a drag
    const a = pointOn(s.page, s.sx, s.sy);
    const b = pointOn(s.page, sx, sy);
    onDone({ page: s.page, x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
  }
</script>

<div
  class="overlay"
  role="presentation"
  bind:this={el}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="hint">Drag a rectangle on the page to print. Esc to cancel.</div>
  {#if start}
    <div
      class="rect"
      style:left="{Math.min(start.sx, cur.sx)}px"
      style:top="{Math.min(start.sy, cur.sy)}px"
      style:width="{Math.abs(cur.sx - start.sx)}px"
      style:height="{Math.abs(cur.sy - start.sy)}px"
    ></div>
  {/if}
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 20;
    cursor: crosshair;
  }
  .hint {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 14px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--shadow);
    color: var(--tx-pop);
    pointer-events: none;
  }
  .rect {
    position: absolute;
    border: 2px solid var(--accent);
    background: var(--accent-soft);
    pointer-events: none;
  }
</style>
