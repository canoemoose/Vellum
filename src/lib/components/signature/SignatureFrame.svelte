<script lang="ts">
  // Frame a photo before its paper is knocked out: turn it, straighten it, crop to the
  // signature. Shown on an upright preview (signature_preview); the framing is applied to the
  // full-size photo in Rust. Drag the box's corners or edges to crop, drag inside it to move it,
  // drag outside it to draw a new one. The wheel zooms at the pointer; middle-drag, or Space
  // and drag, pans. Maths in src/lib/signature/frame.ts.
  import { onMount } from "svelte";
  import {
    clampAngle,
    cropBetween,
    cropOnScreen,
    dragCrop,
    fitView,
    frameSize,
    FULL,
    hitCrop,
    MAX_ANGLE,
    screenToFrame,
    turn,
    zoomAt,
    type Adjust,
    type Crop,
    type Handle,
    type View,
  } from "../../signature/frame";

  interface Props {
    image: ImageBitmap;
    /** Where to start (the last framing, when coming back to adjust it). */
    adjust: Adjust;
    busy?: boolean;
    onapply: (adjust: Adjust) => void;
    oncancel: () => void;
  }
  let { image, adjust: start, busy = false, onapply, oncancel }: Props = $props();

  // svelte-ignore state_referenced_locally
  let adj = $state<Adjust>({ ...start, crop: { ...start.crop } });
  let view = $state<View>({ scale: 1, x: 0, y: 0 });
  /** True once the user has zoomed or panned; until then the view follows the box's size. */
  let placed = false;
  let box = { w: 1, h: 1 };
  let dpr = 1;
  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let straightening = $state(false);
  let spaceDown = false;
  let cursor = $state("crosshair");

  const PAD = 24; // room round the frame for the handles
  const HANDLE_TOL = 8;
  const MIN_PX = 24; // the smallest crop, in preview pixels

  const frame = $derived(frameSize(image.width, image.height, adj.turns));
  const minCrop = $derived({ w: Math.min(1, MIN_PX / frame.w), h: Math.min(1, MIN_PX / frame.h) });

  type Drag =
    | { kind: "crop"; handle: Handle; from: { x: number; y: number }; crop: Crop; id: number }
    | { kind: "new"; from: { x: number; y: number }; id: number }
    | { kind: "pan"; from: { x: number; y: number }; view: View; id: number };
  let drag: Drag | null = null;

  function fit() {
    view = fitView(frame, box, PAD);
    placed = false;
  }

  function resize() {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    box = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    canvas.width = Math.round(box.w * dpr);
    canvas.height = Math.round(box.h * dpr);
    if (!placed) fit();
    draw();
  }

  onMount(() => {
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.focus();
    return () => ro.disconnect();
  });

  // Redraw whenever the framing or the view changes.
  $effect(() => {
    void [adj.turns, adj.angle, adj.crop.x, adj.crop.y, adj.crop.w, adj.crop.h, view.scale, view.x, view.y, straightening];
    draw();
  });

  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = frame;

    // The photo, turned and straightened about the frame's centre, clipped to the frame.
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, f.w, f.h);
    ctx.clip();
    ctx.translate(f.w / 2, f.h / 2);
    ctx.rotate(((adj.turns * 90 + adj.angle) * Math.PI) / 180);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();

    // Screen space from here: dim what's cropped away, then the box, its grid and handles.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fr = cropOnScreen(view, f, FULL);
    const r = cropOnScreen(view, f, adj.crop);
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.rect(fr.x, fr.y, fr.w, fr.h);
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.fill("evenodd");

    // While straightening, a fine grid to line the signature up with; otherwise thirds.
    const lines = straightening ? Math.max(4, Math.round(r.h / 24)) : 3;
    const cols = straightening ? Math.max(4, Math.round(r.w / 24)) : 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < lines; i++) {
      const y = Math.round(r.y + (r.h * i) / lines) + 0.5;
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    for (let i = 1; i < cols; i++) {
      const x = Math.round(r.x + (r.w * i) / cols) + 0.5;
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
    }
    ctx.stroke();

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    // Handles: L-shaped corners and short bars on the edges.
    ctx.lineWidth = 4;
    ctx.lineCap = "square";
    const L = Math.min(16, r.w / 3, r.h / 3);
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of [
      [r.x, r.y, 1, 1],
      [r.x + r.w, r.y, -1, 1],
      [r.x, r.y + r.h, 1, -1],
      [r.x + r.w, r.y + r.h, -1, -1],
    ]) {
      ctx.moveTo(cx, cy + sy * L);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * L, cy);
    }
    const B = Math.min(10, r.w / 6, r.h / 6);
    ctx.moveTo(r.x + r.w / 2 - B, r.y);
    ctx.lineTo(r.x + r.w / 2 + B, r.y);
    ctx.moveTo(r.x + r.w / 2 - B, r.y + r.h);
    ctx.lineTo(r.x + r.w / 2 + B, r.y + r.h);
    ctx.moveTo(r.x, r.y + r.h / 2 - B);
    ctx.lineTo(r.x, r.y + r.h / 2 + B);
    ctx.moveTo(r.x + r.w, r.y + r.h / 2 - B);
    ctx.lineTo(r.x + r.w, r.y + r.h / 2 + B);
    ctx.stroke();
  }

  function point(e: PointerEvent | WheelEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  const CURSORS: Record<Handle, string> = {
    nw: "nwse-resize",
    se: "nwse-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    move: "move",
  };

  function down(e: PointerEvent) {
    if (drag || busy) return;
    const p = point(e);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      drag = { kind: "pan", from: p, view: { ...view }, id: e.pointerId };
      cursor = "grabbing";
    } else if (e.button === 0) {
      const handle = hitCrop(cropOnScreen(view, frame, adj.crop), p, HANDLE_TOL);
      drag = handle
        ? { kind: "crop", handle, from: p, crop: { ...adj.crop }, id: e.pointerId }
        : { kind: "new", from: screenToFrame(view, frame, p), id: e.pointerId };
    } else return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    const p = point(e);
    if (!drag) {
      const h = spaceDown ? null : hitCrop(cropOnScreen(view, frame, adj.crop), p, HANDLE_TOL);
      cursor = spaceDown ? "grab" : h ? CURSORS[h] : "crosshair";
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.kind === "pan") {
      view = { scale: drag.view.scale, x: drag.view.x + p.x - drag.from.x, y: drag.view.y + p.y - drag.from.y };
      placed = true;
    } else if (drag.kind === "crop") {
      const dx = (p.x - drag.from.x) / view.scale / frame.w;
      const dy = (p.y - drag.from.y) / view.scale / frame.h;
      adj.crop = dragCrop(drag.crop, drag.handle, dx, dy, minCrop);
    } else {
      adj.crop = cropBetween(drag.from, screenToFrame(view, frame, p), minCrop);
    }
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    cursor = spaceDown ? "grab" : "crosshair";
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const fitScale = fitView(frame, box, PAD).scale;
    // Up to 8 screen pixels per preview pixel: enough to see a biro line's edge.
    view = zoomAt(view, Math.exp(-e.deltaY * 0.0015), point(e), fitScale * 0.5, Math.max(fitScale, 8));
    placed = true;
  }

  function zoomBy(factor: number) {
    const fitScale = fitView(frame, box, PAD).scale;
    view = zoomAt(view, factor, { x: box.w / 2, y: box.h / 2 }, fitScale * 0.5, Math.max(fitScale, 8));
    placed = true;
  }

  function quarter(dir: 1 | -1) {
    adj = turn(adj, dir);
    fit();
  }

  function setAngle(v: number) {
    adj.angle = clampAngle(Math.round(v * 10) / 10);
  }

  function reset() {
    adj = { turns: 0, angle: 0, crop: { ...FULL } };
    fit();
  }

  function key(e: KeyboardEvent) {
    if (e.key === " " && !e.repeat) {
      spaceDown = true;
      cursor = "grab";
      e.preventDefault();
    } else if (e.key === "Escape") {
      e.preventDefault();
      oncancel();
    } else if (e.key === "Enter" && !busy) {
      e.preventDefault();
      onapply($state.snapshot(adj));
    }
  }

  function keyUp(e: KeyboardEvent) {
    if (e.key === " ") {
      spaceDown = false;
      if (!drag) cursor = "crosshair";
    }
  }
</script>

<div class="framer">
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="stage"
    bind:this={host}
    tabindex="0"
    role="application"
    aria-label="Crop the photo to the signature"
    onkeydown={key}
    onkeyup={keyUp}
    onblur={() => (spaceDown = false)}
  >
    <canvas
      bind:this={canvas}
      style:cursor
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onwheel={wheel}
      onauxclick={(e) => e.preventDefault()}
    ></canvas>
    {#if busy}<div class="working" role="status">Removing the paper…</div>{/if}
  </div>

  <div class="row">
    <button class="btn small icon" onclick={() => quarter(-1)} disabled={busy} title="Turn left" aria-label="Turn left">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5H9a4 4 0 0 1 4 4v0a4 4 0 0 1-4 4H6" /><path d="M7.5 1.5l-2 2 2 2" /></svg>
    </button>
    <button class="btn small icon" onclick={() => quarter(1)} disabled={busy} title="Turn right" aria-label="Turn right">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3.5H7a4 4 0 0 0-4 4v0a4 4 0 0 0 4 4h3" /><path d="M8.5 1.5l2 2-2 2" /></svg>
    </button>
    <label class="straighten" title="Straighten (double-click to reset)">
      <span class="label">Straighten</span>
      <input
        type="range"
        min={-MAX_ANGLE}
        max={MAX_ANGLE}
        step="0.1"
        value={adj.angle}
        disabled={busy}
        oninput={(e) => setAngle(+e.currentTarget.value)}
        onpointerdown={() => (straightening = true)}
        onpointerup={() => (straightening = false)}
        onblur={() => (straightening = false)}
        ondblclick={() => setAngle(0)}
      />
      <span class="angle">{adj.angle.toFixed(1)}°</span>
    </label>
    <span class="spacer"></span>
    <button class="btn small icon" onclick={() => zoomBy(1 / 1.4)} disabled={busy} title="Zoom out" aria-label="Zoom out">−</button>
    <button class="btn small" onclick={fit} disabled={busy} title="Fit the photo in view">Fit</button>
    <button class="btn small icon" onclick={() => zoomBy(1.4)} disabled={busy} title="Zoom in" aria-label="Zoom in">+</button>
  </div>

  <div class="row">
    <span class="hint">Drag a box round the signature. Wheel to zoom, Space and drag to pan.</span>
    <span class="spacer"></span>
    <button class="btn small" onclick={reset} disabled={busy}>Reset</button>
    <button class="btn" onclick={oncancel} disabled={busy}>Cancel</button>
    <button class="btn primary" onclick={() => onapply($state.snapshot(adj))} disabled={busy}>Remove the paper</button>
  </div>
</div>

<style>
  .framer {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .stage {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 2;
    min-height: 240px;
    max-height: 70vh;
    background: #1b1c1f;
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    overflow: hidden;
    outline: none;
  }
  .stage:focus-visible {
    box-shadow: 0 0 0 2px var(--accent);
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  .working {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.45);
    color: #fff;
    font-size: 13px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .icon {
    min-width: 28px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .straighten {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 8px;
  }
  .straighten input {
    width: 180px;
    margin: 0;
    accent-color: var(--accent);
  }
  .label,
  .hint {
    color: var(--tx3);
  }
  .hint {
    font-size: 12px;
  }
  .angle {
    width: 44px;
    text-align: right;
    color: var(--tx2);
    font-variant-numeric: tabular-nums;
  }
</style>
