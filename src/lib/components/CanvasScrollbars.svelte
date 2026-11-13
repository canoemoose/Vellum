<script lang="ts">
  // Scrollbars over the drawing's right and bottom edges, for Document navigation (CAD
  // navigation has none: it's zoom-and-pan). Each shows only when there's something to
  // scroll on its axis. Drag the thumb, or click the track to move a screenful that way.
  // Maths in view/scrollbar.ts.
  import type { Rect } from "../view/viewMath";
  import { canScroll, dragRatio, thumb } from "../view/scrollbar";

  interface Props {
    /** Visible world rect and the document's, in world units. */
    view: Rect;
    bounds: Rect;
    /** World units per CSS px (1 / view scale). */
    unitsPerPx: number;
    /** Pan the view by (dx, dy) screen px, as Viewer.panBy. */
    onPan: (dx: number, dy: number) => void;
  }
  let p: Props = $props();

  const T = 10; // bar thickness
  let vTrack = $state(0);
  let hTrack = $state(0);
  const showV = $derived(canScroll(p.view.y, p.view.h, p.bounds.y, p.bounds.h));
  const showH = $derived(canScroll(p.view.x, p.view.w, p.bounds.x, p.bounds.w));
  const vt = $derived(thumb(p.view.y, p.view.h, p.bounds.y, p.bounds.h, vTrack));
  const ht = $derived(thumb(p.view.x, p.view.w, p.bounds.x, p.bounds.w, hTrack));

  let drag: { axis: "x" | "y"; last: number; ratio: number } | null = $state(null);

  function down(axis: "x" | "y", e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const at = axis === "y" ? e.clientY - r.top : e.clientX - r.left;
    const t = axis === "y" ? vt : ht;
    if (at >= t.pos && at <= t.pos + t.len) {
      const ratio = axis === "y"
        ? dragRatio(p.view.y, p.view.h, p.bounds.y, p.bounds.h, vTrack)
        : dragRatio(p.view.x, p.view.w, p.bounds.x, p.bounds.w, hTrack);
      drag = { axis, last: axis === "y" ? e.clientY : e.clientX, ratio };
      el.setPointerCapture(e.pointerId);
    } else {
      // A screenful (less a little overlap) towards the click.
      const dir = at < t.pos ? 1 : -1;
      const px = (axis === "y" ? p.view.h : p.view.w) / p.unitsPerPx;
      if (axis === "y") p.onPan(0, dir * px * 0.9);
      else p.onPan(dir * px * 0.9, 0);
    }
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const now = drag.axis === "y" ? e.clientY : e.clientX;
    const d = now - drag.last;
    drag.last = now;
    // Thumb px -> world units -> screen px (the view moves the other way).
    const screen = -(d * drag.ratio) / p.unitsPerPx;
    if (drag.axis === "y") p.onPan(0, screen);
    else p.onPan(screen, 0);
  }

  function up() {
    drag = null;
  }
</script>

{#if showV}
  <div
    class="bar v"
    style:width="{T}px"
    style:bottom={showH ? `${T}px` : "0"}
    bind:clientHeight={vTrack}
    onpointerdown={(e) => down("y", e)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="scrollbar"
    aria-orientation="vertical"
    aria-controls="canvas"
    aria-valuenow={Math.round(vt.pos)}
    tabindex="-1"
  >
    <div class="thumb" class:on={drag?.axis === "y"} style:top="{vt.pos}px" style:height="{vt.len}px"></div>
  </div>
{/if}
{#if showH}
  <div
    class="bar h"
    style:height="{T}px"
    style:right={showV ? `${T}px` : "0"}
    bind:clientWidth={hTrack}
    onpointerdown={(e) => down("x", e)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    role="scrollbar"
    aria-orientation="horizontal"
    aria-controls="canvas"
    aria-valuenow={Math.round(ht.pos)}
    tabindex="-1"
  >
    <div class="thumb" class:on={drag?.axis === "x"} style:left="{ht.pos}px" style:width="{ht.len}px"></div>
  </div>
{/if}

<style>
  .bar {
    position: absolute;
    z-index: 2;
    touch-action: none;
    cursor: default; /* not Space's open hand from the drawing */
  }
  .bar.v {
    top: 0;
    right: 0;
  }
  .bar.h {
    left: 0;
    bottom: 0;
  }
  .thumb {
    position: absolute;
    border-radius: 999px;
    background: var(--bd-input);
    opacity: 0.8;
  }
  .bar.v .thumb {
    left: 2px;
    right: 2px;
  }
  .bar.h .thumb {
    top: 2px;
    bottom: 2px;
  }
  .bar:hover .thumb,
  .thumb.on {
    background: var(--tx3);
    opacity: 1;
  }
</style>
