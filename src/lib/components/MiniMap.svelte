<script lang="ts">
  // Mini map (bottom-right of the canvas, 150 × 106): the current page's preview with the
  // viewport as an accent rectangle. Drag the rectangle (or anywhere) to pan; click to jump.
  // Drawn in the view's rotation so it matches what's on screen.
  import { onMount } from "svelte";
  import type { PageSize } from "../view/layout";
  import type { Rect } from "../view/viewMath";
  import { type Rotation, rotatedDrawTransform, rotatedSize, rotateRect, unrotatePoint } from "../view/rotation";

  interface Props {
    page: number;
    size: PageSize;
    rotation: Rotation;
    viewport: Rect | null;
    preview: (page: number) => { bitmap: ImageBitmap; rs: number } | null;
    onCentre: (page: number, x: number, y: number) => void;
  }
  let p: Props = $props();

  const IW = 136; // inner size (150 × 106 minus padding and border)
  const IH = 92;

  let canvas: HTMLCanvasElement;
  let hasPreview = false;
  let drag: { dx: number; dy: number } | null = null;

  /** Page (rotated) to canvas CSS px mapping. */
  function geom() {
    const rs = rotatedSize(p.size, p.rotation);
    const k = Math.min(IW / rs.w, IH / rs.h);
    return { k, ox: (IW - rs.w * k) / 2, oy: (IH - rs.h * k) / 2, rs };
  }

  function draw() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(IW * dpr);
    const H = Math.round(IH * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const { k, ox, oy, rs } = geom();
    const x0 = Math.round(ox * dpr);
    const y0 = Math.round(oy * dpr);
    const x1 = Math.round((ox + rs.w * k) * dpr);
    const y1 = Math.round((oy + rs.h * k) * dpr);
    g.fillStyle = "#ffffff";
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    const pv = p.preview(p.page);
    hasPreview = !!pv;
    if (pv) {
      g.imageSmoothingQuality = "high";
      const t = rotatedDrawTransform(x0, y0, x1, y1, p.rotation);
      g.setTransform(...t.m);
      g.drawImage(pv.bitmap, 0, 0, t.dw, t.dh);
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (p.viewport) {
      const v = rotateRect(p.viewport, p.size, p.rotation);
      // Clip the rectangle to the page so it stays readable when zoomed out past the page.
      const vx0 = Math.max(0, v.x);
      const vy0 = Math.max(0, v.y);
      const vx1 = Math.min(rs.w, v.x + v.w);
      const vy1 = Math.min(rs.h, v.y + v.h);
      if (vx1 > vx0 && vy1 > vy0 && !(vx0 <= 0 && vy0 <= 0 && vx1 >= rs.w && vy1 >= rs.h)) {
        const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#e5484d";
        g.strokeStyle = accent;
        g.lineWidth = 2 * dpr;
        g.strokeRect(
          (ox + vx0 * k) * dpr + dpr,
          (oy + vy0 * k) * dpr + dpr,
          Math.max(2 * dpr, (vx1 - vx0) * k * dpr - 2 * dpr),
          Math.max(2 * dpr, (vy1 - vy0) * k * dpr - 2 * dpr),
        );
      }
    }
  }

  $effect(() => {
    // Redraw whenever anything it shows changes.
    void [p.page, p.size, p.rotation, p.viewport];
    draw();
  });

  onMount(() => {
    // Previews arrive after the first render; check now and then until there is one.
    const t = setInterval(() => {
      if (!hasPreview) draw();
    }, 400);
    return () => clearInterval(t);
  });

  /** Canvas CSS px -> rotated page points. */
  function toPage(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    const { k, ox, oy } = geom();
    return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k];
  }

  function centreAt(X: number, Y: number) {
    const [x, y] = unrotatePoint(X, Y, p.size, p.rotation);
    p.onCentre(p.page, x, y);
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const [X, Y] = toPage(e);
    drag = { dx: 0, dy: 0 };
    if (p.viewport) {
      const v = rotateRect(p.viewport, p.size, p.rotation);
      if (X >= v.x && X <= v.x + v.w && Y >= v.y && Y <= v.y + v.h) {
        drag = { dx: v.x + v.w / 2 - X, dy: v.y + v.h / 2 - Y };
      }
    }
    canvas.setPointerCapture(e.pointerId);
    centreAt(X + drag.dx, Y + drag.dy);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const [X, Y] = toPage(e);
    centreAt(X + drag.dx, Y + drag.dy);
  }
</script>

<div class="map" aria-label="Mini map: drag to pan">
  <canvas
    bind:this={canvas}
    style:width="{IW}px"
    style:height="{IH}px"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
  ></canvas>
</div>

<style>
  .map {
    position: absolute;
    right: 16px;
    bottom: 16px;
    width: 150px;
    height: 106px;
    background: var(--app);
    border: 1px solid var(--bd-strong);
    border-radius: 6px;
    padding: 6px;
    z-index: 3;
    box-shadow: 0 4px 16px var(--shadow);
  }
  canvas {
    display: block;
    background: var(--map);
    border-radius: 2px;
    cursor: move;
    touch-action: none;
  }
</style>
