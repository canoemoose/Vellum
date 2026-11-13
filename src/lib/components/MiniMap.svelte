<script lang="ts">
  // Mini map (bottom-right of the canvas, its shape following what it shows, within 1:6 to
  // 6:1, at a constant width; never more than 60% of the drawing area at default size, and
  // never closer than the gutter to its edges however big it's made): the pages the view
  // touches, drawn from
  // their previews, with the view as an accent rectangle. Usually that's one page; across a
  // page break (continuous) or a row (columns) it's the two to four pages the view spans,
  // so the rectangle shows where you are across them. When that set changes, the map eases
  // to the new framing rather than jumping. Drag the rectangle (or anywhere) to pan; click
  // to jump. A page longer than 1:6 (the aerial drawing) gets a window onto it around the
  // view, which follows as you move. Everything is in world coordinates (the layout's, already in the view's
  // rotation). The shell shows it only while the current page is bigger than the view;
  // zoomed far in, where the rectangle would be a speck, a small box and crosshair lines
  // across the map mark the spot instead.
  import { onMount } from "svelte";
  import { MAP_SIZE_MAX, MAP_SIZE_MIN, type Rect, easeOutCubic, lerpRect, mapBox, mapFraming, mapGuardSize, mapLimits, unionRect } from "../view/viewMath";
  import { type Rotation, rotatedDrawTransform } from "../view/rotation";
  import { mapRenderSide, needsSharper } from "../view/mapRender";

  interface Props {
    /** The pages to show and their world rects (the pages the view touches). */
    pages: { page: number; rect: Rect }[];
    rotation: Rotation;
    /** The visible world rect. */
    view: Rect;
    preview: (page: number) => { bitmap: ImageBitmap; rs: number } | null;
    /** The open document, so sharper renders from one tab are never drawn in another. */
    docId: number;
    /** A proper render of a page, longer side `maxSide` device px (low priority, cached). The
     * map asks for one when it's drawn bigger than the preview; the caller owns the bitmap. */
    thumbnail: (page: number, maxSide: number) => Promise<ImageBitmap>;
    /** Centre the view on a world point. */
    onCentre: (x: number, y: number) => void;
    /** Size as a multiple of the default; the top-left grip changes it. When the drag ends
     * (`done`), `keep` is the size to remember: no more than the guards (mapGuardSize). */
    size: number;
    onSize: (size: number, done: boolean, keep: number) => void;
    /** The pointer is over the map, or dragging in it: the shell mustn't hide it then. */
    onHold: (held: boolean) => void;
    /** The drawing area's size, CSS px (the map's limits come from it: mapLimits). */
    stageW: number;
    stageH: number;
  }
  let p: Props = $props();

  const EASE_MS = 220;
  /** The drawing area, in CSS px: follows the shape of what's shown (mapBox). */
  let iw = $state(136);
  let ih = $state(92);

  let canvas: HTMLCanvasElement;
  let mapEl: HTMLDivElement;
  let hasPreviews = false;
  let drag: { dx: number; dy: number } | null = $state(null);

  /** The world rect the map shows now (eased towards `target`). */
  let shown: Rect | null = null;
  let ease: { from: Rect; to: Rect; t0: number } | null = null;
  let raf = 0;

  // Sharper renders. The previews are made once at a low resolution; when the map is drawn
  // bigger than that (a bigger map or window), ask for renders at the drawn size once resizing
  // has stopped for a moment, and stretch what's there until they arrive.
  const SETTLE_MS = 250;
  /** Renders held, by page, for `sharpDoc`. */
  let sharp = new Map<number, { bitmap: ImageBitmap; side: number }>();
  let sharpDoc = -1;
  /** Pages asked for and not back yet, with the size asked. */
  const asked = new Map<number, number>();
  /** Pages the last draw found too soft, with the size they need. */
  const wanted = new Map<number, number>();
  let settle: ReturnType<typeof setTimeout> | undefined;

  function dropSharp() {
    for (const s of sharp.values()) s.bitmap.close();
    sharp = new Map();
    asked.clear();
    wanted.clear();
  }

  function askSharper() {
    const doc = sharpDoc;
    for (const [page, side] of wanted) {
      if ((asked.get(page) ?? 0) >= side) continue;
      asked.set(page, side);
      p.thumbnail(page, side).then(
        (bitmap) => {
          if (asked.get(page) === side) asked.delete(page);
          if (doc !== sharpDoc || (sharp.get(page)?.side ?? 0) >= side) {
            bitmap.close(); // another document now, or something sharper already arrived
            return;
          }
          sharp.get(page)?.bitmap.close();
          sharp.set(page, { bitmap, side });
          if (!raf) draw();
        },
        () => {
          if (asked.get(page) === side) asked.delete(page);
        },
      );
    }
    wanted.clear();
  }

  /** A quarter turn round: the map turns with the page (mapBox) rather than keeping its width. */
  const turned = () => p.rotation % 180 !== 0;

  /** World to canvas CSS px for the framing `f` in a drawing area `w` x `h`. */
  function geom(f: Rect, w = iw, h = ih) {
    const k = Math.min(w / f.w, h / f.h);
    return { k, ox: (w - f.w * k) / 2 - f.x * k, oy: (h - f.h * k) / 2 - f.y * k };
  }

  function draw() {
    if (!canvas || !shown) return;
    const lim = mapLimits(p.stageW, p.stageH, p.size, shown.w / shown.h, turned());
    const box = mapBox(shown.w / shown.h, p.size, lim.maxW, lim.maxH, turned());
    if (box.w !== iw || box.h !== ih) {
      iw = box.w;
      ih = box.h;
    }
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(iw * dpr);
    const H = Math.round(ih * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    const { k, ox, oy } = geom(shown, box.w, box.h);
    if (p.docId !== sharpDoc) {
      dropSharp();
      sharpDoc = p.docId;
    }
    let all = true;
    for (const { page, rect } of p.pages) {
      const x0 = Math.round((ox + rect.x * k) * dpr);
      const y0 = Math.round((oy + rect.y * k) * dpr);
      const x1 = Math.round((ox + (rect.x + rect.w) * k) * dpr);
      const y1 = Math.round((oy + (rect.y + rect.h) * k) * dpr);
      g.fillStyle = "#ffffff";
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
      const pv = p.preview(page);
      const best = sharp.get(page);
      const img = best?.bitmap ?? pv?.bitmap;
      if (img) {
        g.imageSmoothingQuality = "high";
        const t = rotatedDrawTransform(x0, y0, x1, y1, p.rotation);
        g.setTransform(...t.m);
        g.drawImage(img, 0, 0, t.dw, t.dh);
        g.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        all = false;
      }
      // Drawn bigger than the image held: ask for a sharper one once things settle.
      const want = mapRenderSide(x1 - x0, y1 - y0);
      const have = best?.side ?? (pv ? Math.max(pv.bitmap.width, pv.bitmap.height) : 0);
      if (pv && needsSharper(have, want)) wanted.set(page, want);    }
    hasPreviews = all;
    // Let go of pages no longer on the map, so a long document doesn't pile them up.
    if (sharp.size) {
      const onMap = new Set(p.pages.map((x) => x.page));
      for (const [page, s] of sharp) {
        if (!onMap.has(page)) {
          s.bitmap.close();
          sharp.delete(page);
        }
      }
    }
    if (wanted.size) {
      clearTimeout(settle);
      settle = setTimeout(askSharper, SETTLE_MS);
    }

    // The view, clipped to what the map shows.
    const v = p.view;
    const vx0 = Math.max(shown.x, v.x);
    const vy0 = Math.max(shown.y, v.y);
    const vx1 = Math.min(shown.x + shown.w, v.x + v.w);
    const vy1 = Math.min(shown.y + shown.h, v.y + v.h);
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const accent = getComputedStyle(canvas).getPropertyValue("--accent").trim() || "#0d9488";
    g.strokeStyle = accent;
    const rw = (vx1 - vx0) * k;
    const rh = (vy1 - vy0) * k;
    const MIN = 8; // CSS px: smaller than this reads as a speck
    if (rw < MIN || rh < MIN) {
      const cx = (ox + ((vx0 + vx1) / 2) * k) * dpr;
      const cy = (oy + ((vy0 + vy1) / 2) * k) * dpr;
      g.globalAlpha = 0.55;
      g.lineWidth = dpr;
      g.beginPath();
      g.moveTo(Math.round(cx) + 0.5, 0);
      g.lineTo(Math.round(cx) + 0.5, H);
      g.moveTo(0, Math.round(cy) + 0.5);
      g.lineTo(W, Math.round(cy) + 0.5);
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = 2 * dpr;
      const bw = Math.max(rw, MIN) * dpr;
      const bh = Math.max(rh, MIN) * dpr;
      g.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
    } else {
      g.lineWidth = 2 * dpr;
      g.strokeRect((ox + vx0 * k) * dpr + dpr, (oy + vy0 * k) * dpr + dpr, Math.max(2 * dpr, rw * dpr - 2 * dpr), Math.max(2 * dpr, rh * dpr - 2 * dpr));
    }
  }

  function step() {
    raf = 0;
    if (!ease) return draw();
    const e = easeOutCubic((performance.now() - ease.t0) / EASE_MS);
    shown = lerpRect(ease.from, ease.to, e);
    if (e >= 1) {
      shown = ease.to;
      ease = null;
    } else {
      raf = requestAnimationFrame(step);
    }
    draw();
  }

  $effect(() => {
    // Re-frame when the set of pages changes; redraw when anything shown changes.
    void [p.rotation, p.view, p.size, p.stageW, p.stageH];
    const pages = unionRect(p.pages.map((x) => x.rect));
    if (!pages) return;
    const target = mapFraming(pages, p.view);
    const goal = ease ? ease.to : shown;
    const same = (a: Rect, b: Rect, e = 0.01) => Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e && Math.abs(a.w - b.w) < e && Math.abs(a.h - b.h) < e;
    if (!shown || !goal) {
      shown = target;
    } else if (!same(goal, target)) {
      if (!ease && Math.abs(goal.w - target.w) < 0.01 && Math.abs(goal.h - target.h) < 0.01) {
        // Only the window moved (following the view down a long page): keep up, don't ease.
        shown = target;
      } else {
        ease = { from: shown, to: target, t0: performance.now() };
        if (!raf) raf = requestAnimationFrame(step);
        return;
      }
    }
    if (!raf) draw();
  });

  onMount(() => {
    // Previews arrive after the first render; check now and then until there are some.
    const t = setInterval(() => {
      if (!hasPreviews) draw();
    }, 400);
    return () => {
      clearInterval(t);
      clearTimeout(settle);
      if (raf) cancelAnimationFrame(raf);
      sharpDoc = -2; // renders still on their way are closed when they land
      dropSharp();
    };
  });

  /** Canvas CSS px -> world. */
  function toWorld(e: PointerEvent): [number, number] {
    const r = canvas.getBoundingClientRect();
    const f = (ease ? ease.to : shown)!;
    const { k, ox, oy } = geom(f);
    return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k];
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !shown) return;
    e.preventDefault();
    const [X, Y] = toWorld(e);
    const v = p.view;
    drag = { dx: 0, dy: 0 };
    if (X >= v.x && X <= v.x + v.w && Y >= v.y && Y <= v.y + v.h) {
      drag = { dx: v.x + v.w / 2 - X, dy: v.y + v.h / 2 - Y };
    }
    canvas.setPointerCapture(e.pointerId);
    p.onCentre(X + drag.dx, Y + drag.dy);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const [X, Y] = toWorld(e);
    p.onCentre(X + drag.dx, Y + drag.dy);
  }

  // Resizing from the top-left corner (the map is anchored bottom-right): dragging up and
  // left grows it. The size scales both sides, keeping the map's shape.
  let sizing: { x: number; y: number; w: number; h: number; size: number } | null = null;

  function gripDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    sizing = { x: e.clientX, y: e.clientY, w: iw, h: ih, size: p.size };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function gripMove(e: PointerEvent) {
    if (!sizing) return;
    const fw = (sizing.w + sizing.x - e.clientX) / sizing.w;
    const fh = (sizing.h + sizing.y - e.clientY) / sizing.h;
    const a = shown ? shown.w / shown.h : 1;
    const top = Math.min(MAP_SIZE_MAX, mapLimits(p.stageW, p.stageH, MAP_SIZE_MAX, a, turned()).maxSize);
    const s = Math.min(top, Math.max(MAP_SIZE_MIN, sizing.size * ((fw + fh) / 2)));
    p.onSize(s, false, s);
  }

  function keepOf(size: number): number {
    const a = shown ? shown.w / shown.h : 1;
    return Math.min(size, mapGuardSize(p.stageW, p.stageH, a, turned()));
  }

  function gripUp() {
    if (sizing) p.onSize(p.size, true, keepOf(p.size));
    sizing = null;
    if (mapEl && !mapEl.matches(":hover")) p.onHold(false);
  }
</script>

<div
  bind:this={mapEl}
  class="map"
  role="navigation"
  aria-label="Mini map: drag to pan"
  style:width="{iw + 14}px"
  style:height="{ih + 14}px"
  onpointerenter={() => p.onHold(true)}
  onpointerleave={() => {
    if (!drag && !sizing) p.onHold(false);
  }}
>
  <canvas
    bind:this={canvas}
    class:dragging={drag !== null}
    style:width="{iw}px"
    style:height="{ih}px"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => {
      drag = null;
      if (!mapEl.matches(":hover")) p.onHold(false);
    }}
    onpointercancel={() => {
      drag = null;
      p.onHold(false);
    }}
  ></canvas>
  <div
    class="grip"
    role="separator"
    aria-label="Resize mini map (double-click to reset)"
    title="Drag to resize; double-click to reset"
    tabindex="-1"
    onpointerdown={gripDown}
    onpointermove={gripMove}
    onpointerup={gripUp}
    onpointercancel={gripUp}
    onlostpointercapture={gripUp}
    ondblclick={() => p.onSize(1, true, 1)}
  ></div>
</div>

<style>
  .map {
    position: absolute;
    right: 16px;
    bottom: 16px;
    box-sizing: border-box;
    background: var(--app);
    border: 1px solid var(--bd-strong);
    border-radius: 6px;
    padding: 6px;
    z-index: 3;
    box-shadow: 0 4px 16px var(--shadow);
    /* Its own cursor: Space's open hand on the drawing mustn't reach the map. */
    cursor: default;
    animation: map-in 150ms ease-out;
  }
  @keyframes map-in {
    from {
      opacity: 0;
    }
  }
  canvas {
    display: block;
    background: var(--map);
    border-radius: 2px;
    touch-action: none;
  }
  canvas.dragging {
    cursor: grabbing;
  }
  /* Top-left corner grip, shown on hover: two short diagonal ticks. */
  .grip {
    position: absolute;
    left: 0;
    top: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    touch-action: none;
    border-top-left-radius: 6px;
    opacity: 0;
    transition: opacity 120ms;
    background:
      linear-gradient(135deg, transparent 0 4px, var(--tx3) 4px 5px, transparent 5px 7px, var(--tx3) 7px 8px, transparent 8px);
  }
  .map:hover .grip {
    opacity: 0.8;
  }
</style>
