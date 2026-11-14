<script lang="ts">
  // Frame a photo before its paper is knocked out: turn it a quarter at a time, then a crop
  // box round the signature, which can be turned to lie along a slanted one. Shown on an
  // upright preview (signature_preview); the framing is applied to the full-size photo in
  // Rust. Drag the box's corners or edges to resize it, drag inside it to move it, drag outside
  // it to draw a new one, and drag the round handle above it to turn it along a slanted
  // signature; on letting go the view turns with it, so the box is level and the photo tilts
  // (double-click the handle to level it). When the box is let go, the view settles
  // on it with room round it. Maths in src/lib/signature/frame.ts.
  import { onMount } from "svelte";
  import {
    between,
    boxBetween,
    angleByDrag,
    corners,
    dragBox,
    frameSize,
    FULL,
    handleCursor,
    hitBox,
    knobAt,
    KNOB_GAP,
    screenToFrameDelta,
    settleView,
    toBox,
    toCrop,
    toFrame,
    toScreen,
    turn,
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
  let view = $state<View>({ scale: 1, rot: 0, x: 0, y: 0 });
  let stage = { w: 1, h: 1 };
  let dpr = 1;
  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let straightening = $state(false);
  let cursor = $state("crosshair");
  let anim = 0;

  const PAD = 44; // room round the photo for the handles and the rotate handle above
  const HANDLE_TOL = 8;
  const MIN_PX = 24; // the box's shortest side, in preview pixels
  const FILL = 0.75; // how much of the stage a settled box fills
  const MAX_SCALE = 6; // screen pixels per preview pixel, at most, when settling
  const SETTLE_MS = 220;
  const KNOB_R = 7; // the rotate handle's radius, screen pixels

  const frame = $derived(frameSize(image.width, image.height, adj.turns));
  const box = $derived(toBox(adj.crop, frame));

  function setBox(b: Box) {
    adj.crop = toCrop(b, frame);
  }

  type Drag =
    | { kind: "box"; handle: Handle; from: Pt; box: Box; id: number }
    | { kind: "new"; from: Pt; id: number }
    | { kind: "rotate"; from: Pt; angle: number; id: number };
  let drag: Drag | null = null;

  function stopSettling() {
    cancelAnimationFrame(anim);
    anim = 0;
  }

  /** Move the view onto the box: smoothly, unless `now` or the user prefers less motion. */
  function settle(now = false) {
    stopSettling();
    const target = settleView(frame, box, adj.angle, stage, PAD, FILL, MAX_SCALE);
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
    void [adj.turns, adj.angle, adj.crop.x, adj.crop.y, adj.crop.w, adj.crop.h, view.scale, view.rot, view.x, view.y, straightening];
    draw();
  });

  function draw() {
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const f = frame;

    // The photo, turned its quarter turns about the frame's centre, in the view (which turns
    // too, once settled on a turned box).
    const vr = (view.rot * Math.PI) / 180;
    const vc = Math.cos(vr) * view.scale * dpr;
    const vs = Math.sin(vr) * view.scale * dpr;
    ctx.setTransform(vc, vs, -vs, vc, dpr * view.x, dpr * view.y);
    ctx.save();
    ctx.translate(f.w / 2, f.h / 2);
    ctx.rotate((adj.turns * Math.PI) / 2);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, -image.width / 2, -image.height / 2);
    ctx.restore();

    // Screen space from here: dim the photo outside the box.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const photo = corners({ cx: f.w / 2, cy: f.h / 2, w: f.w, h: f.h }, 0).map((p) => toScreen(view, p));
    const pts = corners(box, adj.angle).map((p) => toScreen(view, p));
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.beginPath();
    ctx.moveTo(photo[0].x, photo[0].y);
    for (const p of photo.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill("evenodd");

    // The box, its grid and handles, drawn level about its centre and then turned.
    const c = toScreen(view, { x: box.cx, y: box.cy });
    ctx.translate(c.x, c.y);
    ctx.rotate(((adj.angle + view.rot) * Math.PI) / 180);
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

    // The rotate handle: a stalk up from the top edge's middle to a round knob.
    const ky = r.y - KNOB_GAP;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, r.y);
    ctx.lineTo(0, ky + KNOB_R);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, ky, KNOB_R, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // While turning, the angle beside the knob, upright.
    if (straightening) {
      const k = knobAt(view, box, adj.angle);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const text = `${adj.angle.toFixed(1)}°`;
      ctx.font = "12px system-ui, sans-serif";
      const tw = ctx.measureText(text).width;
      const x = k.x + KNOB_R + 8;
      const y = k.y - 9;
      ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
      ctx.beginPath();
      ctx.roundRect(x, y, tw + 12, 18, 4);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.fillText(text, x + 6, y + 9);
    }
  }

  function onKnob(p: Pt): boolean {
    const k = knobAt(view, box, adj.angle);
    return Math.hypot(p.x - k.x, p.y - k.y) <= KNOB_R + 4;
  }

  function point(e: MouseEvent): Pt {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: PointerEvent) {
    if (drag || busy) return;
    const p = point(e);
    if (e.button !== 0) return;
    stopSettling();
    if (onKnob(p)) {
      drag = { kind: "rotate", from: p, angle: adj.angle, id: e.pointerId };
      straightening = true;
      cursor = "grabbing";
    } else {
      const handle = hitBox(view, box, adj.angle, p, HANDLE_TOL);
      drag = handle
        ? { kind: "box", handle, from: p, box: { ...box }, id: e.pointerId }
        : { kind: "new", from: toFrame(view, p), id: e.pointerId };
    }
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
  }

  function move(e: PointerEvent) {
    const p = point(e);
    if (!drag) {
      const h = hitBox(view, box, adj.angle, p, HANDLE_TOL);
      cursor = onKnob(p) ? "grab" : h ? handleCursor(h, adj.angle + view.rot) : "crosshair";
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.kind === "rotate") {
      adj.angle = angleByDrag(drag.angle, toScreen(view, { x: box.cx, y: box.cy }), drag.from, p);
    } else if (drag.kind === "box") {
      const d = screenToFrameDelta(view, { x: p.x - drag.from.x, y: p.y - drag.from.y });
      setBox(dragBox(drag.box, adj.angle, drag.handle, d, MIN_PX, frame));
    } else {
      setBox(boxBetween(drag.from, toFrame(view, p), adj.angle, MIN_PX, frame));
    }
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    straightening = false;
    cursor = onKnob(point(e)) ? "grab" : "crosshair";
    settle();
  }

  function dblclick(e: MouseEvent) {
    if (busy || !onKnob(point(e))) return;
    adj.angle = 0;
    settle();
  }

  function quarter(dir: 1 | -1) {
    adj = turn(adj, dir);
    settle(true);
  }

  function reset() {
    adj = { turns: 0, angle: 0, crop: { ...FULL } };
    settle();
  }

  function key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      oncancel();
    } else if (e.key === "Enter" && !busy) {
      e.preventDefault();
      onapply($state.snapshot(adj));
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
  >
    <canvas
      bind:this={canvas}
      style:cursor
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      ondblclick={dblclick}
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
  </div>

  <div class="row">
    <span class="hint">Drag a box round the signature. Turn it with the round handle to lie along the writing.</span>
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
  .hint {
    color: var(--tx3);
  }
  .hint {
    font-size: 12px;
  }
</style>
