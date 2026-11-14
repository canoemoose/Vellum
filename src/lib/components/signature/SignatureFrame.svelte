<script lang="ts">
  // Frame a photo before its paper is knocked out: turn it a quarter at a time, then a crop
  // box round the signature, which can be turned to lie along a slanted one. Shown on an
  // upright preview (signature_preview); the framing is applied to the full-size photo in
  // Rust. Drag the box's corners or edges to resize it, drag inside it to move it, drag outside
  // it to draw a new one. When the box is let go the view settles on it, with room round it.
  // (The wheel zooms and Space-drag or middle-drag pans, as quiet extras.) Maths in
  // src/lib/signature/frame.ts.
  import { onMount } from "svelte";
  import {
    between,
    bounds,
    boxBetween,
    clampAngle,
    corners,
    dragBox,
    fitView,
    frameSize,
    FULL,
    handleCursor,
    hitBox,
    MAX_ANGLE,
    settleView,
    toBox,
    toCrop,
    toFrame,
    toScreen,
    turn,
    zoomAt,
    type Adjust,
    type Box,
    type Handle,
    type Pt,
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
  let stage = { w: 1, h: 1 };
  let dpr = 1;
  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let straightening = $state(false);
  let spaceDown = false;
  let cursor = $state("crosshair");
  let anim = 0;

  const PAD = 24; // room round the photo for the handles
  const HANDLE_TOL = 8;
  const MIN_PX = 24; // the box's shortest side, in preview pixels
  const FILL = 0.75; // how much of the stage a settled box fills
  const MAX_SCALE = 6; // screen pixels per preview pixel, at most, when settling
  const SETTLE_MS = 220;

  const frame = $derived(frameSize(image.width, image.height, adj.turns));
  const box = $derived(toBox(adj.crop, frame));

  function setBox(b: Box) {
    adj.crop = toCrop(b, frame);
  }

  type Drag =
    | { kind: "box"; handle: Handle; from: Pt; box: Box; id: number }
    | { kind: "new"; from: Pt; id: number }
    | { kind: "pan"; from: Pt; view: View; id: number };
  let drag: Drag | null = null;

  function stopSettling() {
    cancelAnimationFrame(anim);
    anim = 0;
  }

  /** Move the view onto the box: smoothly, unless `now` or the user prefers less motion. */
  function settle(now = false) {
    stopSettling();
    const target = settleView(frame, bounds(corners(box, adj.angle)), stage, PAD, FILL, MAX_SCALE);
    if (now || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      view = target;
      return;
    }
    const from = { ...view };
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / SETTLE_MS);
      view = between(from, target, 1 - Math.pow(1 - k, 3), stage);
      anim = k < 1 ? requestAnimationFrame(step) : 0;
    };
    anim = requestAnimationFrame(step);
  }

  function resize() {
    const r = host.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    stage = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    canvas.width = Math.round(stage.w * dpr);
    canvas.height = Math.round(stage.h * dpr);
    settle(true);
    draw();
  }

  onMount(() => {
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    host.focus();
    return () => {
      ro.disconnect();
      stopSettling();
    };
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

    // The photo, turned its quarter turns about the frame's centre.
    ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
    ctx.save();
    ctx.translate(f.w / 2, f.h / 2);
    ctx.rotate((adj.turns * Math.PI) / 2);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();

    // Screen space from here: dim the photo outside the box.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p0 = toScreen(view, { x: 0, y: 0 });
    const pts = corners(box, adj.angle).map((p) => toScreen(view, p));
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.rect(p0.x, p0.y, f.w * view.scale, f.h * view.scale);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill("evenodd");

    // The box, its grid and handles, drawn level about its centre and then turned.
    const c = toScreen(view, { x: box.cx, y: box.cy });
    ctx.translate(c.x, c.y);
    ctx.rotate((adj.angle * Math.PI) / 180);
    const w = box.w * view.scale;
    const h = box.h * view.scale;
    const r = { x: -w / 2, y: -h / 2, w, h };

    // While turning the box, a fine grid to line the signature up with; otherwise thirds.
    const rows = straightening ? Math.max(4, Math.round(r.h / 24)) : 3;
    const cols = straightening ? Math.max(4, Math.round(r.w / 24)) : 3;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < rows; i++) {
      const y = r.y + (r.h * i) / rows;
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
    }
    for (let i = 1; i < cols; i++) {
      const x = r.x + (r.w * i) / cols;
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
    ctx.moveTo(-B, r.y);
    ctx.lineTo(B, r.y);
    ctx.moveTo(-B, r.y + r.h);
    ctx.lineTo(B, r.y + r.h);
    ctx.moveTo(r.x, -B);
    ctx.lineTo(r.x, B);
    ctx.moveTo(r.x + r.w, -B);
    ctx.lineTo(r.x + r.w, B);
    ctx.stroke();
  }

  function point(e: PointerEvent | WheelEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: PointerEvent) {
    if (drag || busy) return;
    const p = point(e);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      stopSettling();
      drag = { kind: "pan", from: p, view: { ...view }, id: e.pointerId };
      cursor = "grabbing";
    } else if (e.button === 0) {
      stopSettling();
      const handle = hitBox(view, box, adj.angle, p, HANDLE_TOL);
      drag = handle
        ? { kind: "box", handle, from: p, box: { ...box }, id: e.pointerId }
        : { kind: "new", from: toFrame(view, p), id: e.pointerId };
    } else return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    const p = point(e);
    if (!drag) {
      const h = spaceDown ? null : hitBox(view, box, adj.angle, p, HANDLE_TOL);
      cursor = spaceDown ? "grab" : h ? handleCursor(h, adj.angle) : "crosshair";
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.kind === "pan") {
      view = { scale: drag.view.scale, x: drag.view.x + p.x - drag.from.x, y: drag.view.y + p.y - drag.from.y };
    } else if (drag.kind === "box") {
      const d = { x: (p.x - drag.from.x) / view.scale, y: (p.y - drag.from.y) / view.scale };
      setBox(dragBox(drag.box, adj.angle, drag.handle, d, MIN_PX, frame));
    } else {
      setBox(boxBetween(drag.from, toFrame(view, p), adj.angle, MIN_PX, frame));
    }
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const placed = drag.kind !== "pan";
    drag = null;
    cursor = spaceDown ? "grab" : "crosshair";
    if (placed) settle();
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    stopSettling();
    const fitScale = fitView(frame, stage, PAD).scale;
    view = zoomAt(view, Math.exp(-e.deltaY * 0.0015), point(e), fitScale * 0.5, Math.max(fitScale, 8));
  }

  function quarter(dir: 1 | -1) {
    adj = turn(adj, dir);
    settle(true);
  }

  function setAngle(v: number) {
    adj.angle = clampAngle(Math.round(v * 10) / 10);
  }

  function endTurning() {
    if (!straightening) return;
    straightening = false;
    settle();
  }

  function reset() {
    adj = { turns: 0, angle: 0, crop: { ...FULL } };
    settle();
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
    <!-- A page with a curved arrow over it: turning the photo, not going back or forward. -->
    <button class="btn small icon" onclick={() => quarter(-1)} disabled={busy} title="Turn the photo left" aria-label="Turn the photo left">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <g transform="matrix(-1 0 0 1 16 0)">
          <rect x="2.5" y="7.5" width="7" height="6" rx="1" />
          <path d="M5 4.5h3.5a4 4 0 0 1 4 4v1.5" />
          <path d="M10.5 8.5l2 2 2-2" />
        </g>
      </svg>
    </button>
    <button class="btn small icon" onclick={() => quarter(1)} disabled={busy} title="Turn the photo right" aria-label="Turn the photo right">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="7.5" width="7" height="6" rx="1" />
        <path d="M5 4.5h3.5a4 4 0 0 1 4 4v1.5" />
        <path d="M10.5 8.5l2 2 2-2" />
      </svg>
    </button>
    <label class="straighten" title="Turn the box to lie along the signature (double-click to level it)">
      <span class="label">Straighten</span>
      <input
        type="range"
        min={-MAX_ANGLE}
        max={MAX_ANGLE}
        step="0.1"
        value={adj.angle}
        disabled={busy}
        oninput={(e) => {
          straightening = true;
          setAngle(+e.currentTarget.value);
        }}
        onchange={endTurning}
        onpointerup={endTurning}
        onblur={endTurning}
        ondblclick={() => {
          setAngle(0);
          settle();
        }}
      />
      <span class="angle">{adj.angle.toFixed(1)}°</span>
    </label>
  </div>

  <div class="row">
    <span class="hint">Drag a box round the signature, then turn it to lie along the writing.</span>
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
    width: 220px;
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
