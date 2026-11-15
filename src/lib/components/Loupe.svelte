<script lang="ts">
  // The measuring loupe: a magnified inset by the pointer while a measuring tool picks points,
  // copied from the canvas as drawn (so it helps placement but adds no detail; zooming in adds
  // detail). A crosshair marks the pointer. Follows the pointer over the stage; hidden off it.
  // Sits beside the pointer, flipping to the other side near the stage's edges.
  import { onMount } from "svelte";

  interface Props {
    /** Magnification. */
    zoom?: number;
    /** CSS px across. */
    size?: number;
  }
  let { zoom = 4, size = 132 }: Props = $props();

  // Placed inside the stage: it reads the pointer there and copies the stage's canvas.
  let anchor = $state<HTMLSpanElement>();
  let stage: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;

  let out = $state<HTMLCanvasElement>();
  let at = $state<{ x: number; y: number } | null>(null);
  let frame = 0;
  const GAP = 24;

  function paint() {
    frame = 0;
    const c = out, p = at;
    if (!c || !p || !canvas) return;
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const px = Math.round(size * devicePixelRatio);
    if (c.width !== px) c.width = c.height = px;
    const g = c.getContext("2d", { alpha: false });
    if (!g) return;
    const src = (size / zoom) * dpr;
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#808080";
    g.fillRect(0, 0, px, px);
    g.drawImage(canvas, p.x * dpr - src / 2, p.y * dpr - src / 2, src, src, 0, 0, px, px);
    // The crosshair: a dark line with a light edge, readable on any drawing.
    const m = px / 2;
    for (const [col, w] of [["rgba(255,255,255,0.9)", 3], ["rgba(13,148,136,1)", 1]] as const) {
      g.strokeStyle = col;
      g.lineWidth = w * devicePixelRatio;
      g.beginPath();
      g.moveTo(m, m - px * 0.18);
      g.lineTo(m, m - px * 0.05);
      g.moveTo(m, m + px * 0.05);
      g.lineTo(m, m + px * 0.18);
      g.moveTo(m - px * 0.18, m);
      g.lineTo(m - px * 0.05, m);
      g.moveTo(m + px * 0.05, m);
      g.lineTo(m + px * 0.18, m);
      g.stroke();
    }
  }

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paint);
  };

  onMount(() => {
    stage = anchor?.parentElement ?? null;
    canvas = stage?.querySelector("canvas") ?? null;
    if (!stage) return;
    const st = stage;
    const move = (e: PointerEvent) => {
      const r = st.getBoundingClientRect();
      at = { x: e.clientX - r.left, y: e.clientY - r.top };
      // After the viewer's own frame, so the copy shows the rubber band where the pointer is.
      requestAnimationFrame(schedule);
    };
    const leave = () => (at = null);
    // Wheel zoom repaints the canvas under a still pointer.
    const wheel = () => requestAnimationFrame(schedule);
    st.addEventListener("pointermove", move);
    st.addEventListener("pointerleave", leave);
    st.addEventListener("wheel", wheel, { passive: true });
    return () => {
      st.removeEventListener("pointermove", move);
      st.removeEventListener("pointerleave", leave);
      st.removeEventListener("wheel", wheel);
      if (frame) cancelAnimationFrame(frame);
    };
  });

  const pos = $derived.by(() => {
    if (!at || !stage) return null;
    const w = stage.clientWidth;
    const x = at.x + GAP + size > w ? at.x - GAP - size : at.x + GAP;
    const y = at.y - GAP - size < 0 ? at.y + GAP : at.y - GAP - size;
    return { x, y };
  });
</script>

<span bind:this={anchor} hidden></span>
{#if pos}
  <canvas class="loupe" bind:this={out} style:left="{pos.x}px" style:top="{pos.y}px" style:width="{size}px" style:height="{size}px" aria-hidden="true"></canvas>
{/if}

<style>
  .loupe {
    position: absolute;
    pointer-events: none;
    border-radius: 50%;
    border: 2px solid var(--accent, #0d9488);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
    z-index: 5;
  }
</style>
