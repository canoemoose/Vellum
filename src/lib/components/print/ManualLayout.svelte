<script lang="ts" module>
  // Kept between visits to this screen while the print dialog is open (Back, then Manual
  // again, keeps the sheets); PrintDialog resets it when it closes.
  import type { ManualLayout as Layout } from "../../print/model/manual";
  import type { PrintDoc } from "../../print/context";
  import { limiter } from "../../shell/limiter";

  let kept: { layout: Layout; marginMode: string; extra: PrintDoc[] } | null = null;

  /** Title-block reads for files opened here, two at a time (see limiter.ts). */
  const scaleReads = limiter(2);

  /** The layout made so far while the print dialog is open, or null. */
  export function keptManualLayout(): Layout | null {
    return kept?.layout ?? null;
  }

  /** Forget the manual layout; returns documents opened only for it (to close in the backend). */
  export function resetManualLayout(): PrintDoc[] {
    const extra = kept?.extra ?? [];
    kept = null;
    return extra;
  }
</script>

<script lang="ts">
  // The manual print layout (docs/mockups/PrintManual.png, project/PrintManual.dc.html).
  // Thin over the pure model in src/lib/print/model/manual.ts; pan and zoom use the engine's
  // view maths, items render through the shared renderer (painter.ts).
  import { onDestroy, onMount, untrack } from "svelte";
  import { PRINT_BOX, floating } from "../floating";
  import { invoke } from "@tauri-apps/api/core";
  import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
  import type { PrintContext } from "../../print/context";
  import { errorText } from "../../print/api";
  import { isTypingTarget } from "../../engine/keys";
  import { printMargin } from "../../print/marginColour";
  import CloseButton from "../CloseButton.svelte";
  import { align, autoArrange, distributeH } from "../../print/model/arrange";
  import type { Source } from "../../print/model/auto";
  import {
    type Box, type Margins, type Size, ZERO_MARGINS, boxH, boxW, describeSize, fmtMm, fmtPercent, fmtRatio, isLandscape,
    isoName, mmToPt, orient, ptToMm,
  } from "../../print/model/geom";
  import { type Job, formatDate } from "../../print/model/job";
  import {
    type Corner, type Edge, type ManualItem, addItem, addSheet, areaOfLayout, clearSheet, cropFromEdge, duplicateSheet,
    emptyLayout, findItem, itemBox, manualToJob, placedKeys, removeItem, removeSheet, resetCrop, scaleFromCorner,
    scaleLabel, showsName, setCrop, defaultScale, setPaper, setRatio, setRotation, setScale, sheetCount, sheetJob, sourceDescription, updateItem,
    withDrawingScales,
  } from "../../print/model/manual";
  import { layoutPaths, parseLayout, restore, serialise } from "../../print/model/serial";
  import { type PrintSettings, PERCENT_PRESETS, SCALE_PRESETS } from "../../print/model/settings";
  import { type Guide, snapMove, snapPoint } from "../../print/model/snap";
  import { SheetPainter, applyColourPreview, drawLines, drawTexts } from "../../print/painter";
  import { activeDoc, pageRef, stem } from "../../print/sources";
  import { groupPapers } from "../../print/paperOrder";
  import { forgetLayoutFor, loadLayoutFor, storeLayoutFor } from "../../print/layoutMemory";
  import { pathKey } from "../../shell/tabs";
  import { pickDetectedScale } from "../../shell/scale";
  import type { DocInfo } from "../../render/types";
  import { loadSnap, saveSnap } from "../../print/store";
  import { type View, fitRect, screenToWorld, wheelZoomFactor, zoomBy } from "../../view/viewMath";

  let {
    context,
    settings,
    paper,
    papers,
    margins,
    printerName,
    busy,
    error,
    notice,
    initialSources,
    onBack,
    onClose,
    onRun,
  }: {
    context: PrintContext;
    settings: PrintSettings;
    paper: Size;
    papers: { name: string; w: number; h: number }[];
    margins: { portrait: Margins; landscape: Margins };
    printerName: string | null;
    busy: { label: string; done: number; total: number } | null;
    error: string | null;
    notice: string | null;
    initialSources: Source[];
    onBack: () => void;
    onClose: () => void;
    onRun: (job: Job, mode: "print" | "pdf") => void;
  } = $props();

  /** "printer", "none", or a margin in millimetres ("5", "12.5"). */
  type MarginMode = string;
  const MARGIN_PRESETS = ["5", "10", "15"];
  let marginCustomOpen = $state(false);

  function marginsFor(mode: string, sheet: Size): Margins {
    if (mode === "none") return ZERO_MARGINS;
    if (mode === "printer") return isLandscape(sheet) ? margins.landscape : margins.portrait;
    const m = mmToPt(Number(mode) || 0);
    return { left: m, top: m, right: m, bottom: m };
  }

  /** A new layout: the pages picked in the print dialog, arranged on one sheet. */
  function fresh(): Layout {
    const sheet = orient(paper, true);
    let l = emptyLayout(sheet, marginsFor("printer", sheet));
    for (const s of initialSources.slice(0, 12)) l = addItem(l, 0, s.ref, { crop: s.crop }).layout;
    if (l.sheets[0].items.length > 1) l = autoArrange(l, 0);
    return l;
  }

  function initial(): { layout: Layout; marginMode: MarginMode; extra: PrintDoc[] } {
    if (kept) return kept as { layout: Layout; marginMode: MarginMode; extra: PrintDoc[] };
    return { layout: fresh(), marginMode: "printer", extra: [] };
  }

  /** Back from the print settings, with this dialog's layout kept: no restoring. */
  const resumed = kept !== null;
  const start = initial();
  let layout = $state.raw<Layout>(start.layout);
  let marginMode = $state<MarginMode>(start.marginMode);
  let extraDocs = $state.raw<PrintDoc[]>(start.extra);
  let sheetIdx = $state(0);
  let selected = $state<number[]>([]);
  let snap = $state(loadSnap());
  let guides = $state.raw<Guide[]>([]);
  let localError = $state<string | null>(null);
  let localNotice = $state<string | null>(null);
  let cropping = $state<number | null>(null);

  $effect(() => {
    kept = { layout, marginMode, extra: extraDocs };
  });

  // Placed pages follow their documents' drawing scales as title blocks are read, and a
  // remembered layout from before pages had their own scales is put right (withDrawingScales).
  // Not an edit: a layout that was only brought up to date isn't saved over the remembered one.
  $effect(() => {
    const docs = allDocs;
    const l = layout;
    const next = withDrawingScales(l, (docId, page) => docs.find((d) => d.docId === docId)?.scaleOf(page));
    if (next === l) return;
    untrack(() => {
      if (baseline === l) baseline = next;
      layout = next;
    });
  });

  // ---- Remembered per file ----
  // The layout is remembered with the file Print was opened from (print/layoutMemory.ts) and
  // comes back the next time. It's only written once you change it: a layout restored with
  // some of its files missing (a drive not connected) stays whole until you edit it.

  const memoryKey = (() => {
    const d = activeDoc(context);
    return d ? pathKey(d.path) : null;
  })();
  /** The layout as loaded (new, restored, or kept from earlier in this dialog): not saved. */
  let baseline: Layout | null = start.layout;
  let pendingSave: (() => void) | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function flushSave() {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = null;
    const f = pendingSave;
    pendingSave = null;
    f?.();
  }

  $effect(() => {
    const l = layout;
    const m = marginMode;
    if (!memoryKey || l === baseline) return;
    const key = memoryKey;
    pendingSave = () => {
      if (sheetCount(l) === 0) forgetLayoutFor(key);
      else storeLayoutFor(key, serialise(l), m);
    };
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 400);
  });
  onDestroy(flushSave);

  onMount(() => {
    if (resumed) return;
    const saved = memoryKey ? loadLayoutFor(memoryKey) : null;
    const okMargin = (m: string) => m === "printer" || m === "none" || (/^\d+(\.\d+)?$/.test(m) && Number(m) <= 100);
    if (saved) void loadText(saved.text, "restored", okMargin(saved.margin) ? saved.margin : "printer");
  });

  /** Start again from the pages picked in the print dialog, forgetting the remembered layout. */
  function startAgain() {
    flushSave();
    layout = fresh();
    marginMode = "printer";
    baseline = layout;
    sheetIdx = 0;
    selected = [];
    localError = null;
    localNotice = null;
    if (memoryKey) forgetLayoutFor(memoryKey);
  }
  $effect(() => saveSnap($state.snapshot(snap)));
  $effect(() => {
    if (sheetIdx >= layout.sheets.length) sheetIdx = layout.sheets.length - 1;
  });

  const sheet = $derived(layout.sheets[sheetIdx]);
  const area = $derived(areaOfLayout(layout));
  const sel = $derived(selected.length === 1 ? findItem(layout, sheetIdx, selected[0]) ?? null : null);
  const allDocs = $derived([...context.docs, ...extraDocs]);
  const placed = $derived(placedKeys(layout));
  const nSheets = $derived(sheetCount(layout));
  const date = formatDate(new Date());

  // ---- Sheet and margins ----

  /** Each printer paper both ways round; A sizes first (paperOrder.ts), the rest after. */
  const sheetOptions = $derived.by(() => {
    const list = papers.length ? papers : [{ name: "A4", w: 210, h: 297 }, { name: "A3", w: 297, h: 420 }];
    const g = groupPapers(list);
    const out: { key: string; label: string; size: Size; other: boolean }[] = [];
    for (const [ps, other] of [[g.a, false], [g.other, true]] as const) {
      for (const p of ps) {
        const s = { w: mmToPt(p.w), h: mmToPt(p.h) };
        for (const land of [true, false]) {
          const o = orient(s, land);
          const name = isoName(o) ?? p.name;
          out.push({ key: `${p.name}|${land}`, label: `${name} ${land ? "landscape" : "portrait"}`, size: o, other });
        }
      }
    }
    return out;
  });
  const sheetKey = $derived(
    sheetOptions.find((o) => Math.abs(o.size.w - layout.paper.w) < 1 && Math.abs(o.size.h - layout.paper.h) < 1)?.key ?? "",
  );
  const printerMinMm = $derived(ptToMm(Math.max(margins.portrait.left, margins.portrait.top)));

  function chooseSheet(key: string) {
    const o = sheetOptions.find((x) => x.key === key);
    if (o) layout = setPaper(layout, o.size, marginsFor(marginMode, o.size));
  }

  function chooseMarginOption(v: string) {
    marginCustomOpen = v === "custom";
    if (v === "custom") {
      if (marginMode === "printer" || marginMode === "none") chooseMargins("10");
    } else chooseMargins(v);
  }

  function chooseMargins(m: MarginMode) {
    marginMode = m;
    layout = setPaper(layout, layout.paper, marginsFor(m, layout.paper));
  }

  // ---- View: the engine's view maths (screen = world * scale + t), world = sheet points ----

  let host = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let size = $state({ w: 600, h: 400 });
  let view = $state<View>({ scale: 1, tx: 0, ty: 0 });
  let fitted = false;
  let painter: SheetPainter | null = null;
  let frame = 0;

  /** Still showing the whole sheet (not zoomed or panned since): a resize refits. */
  let atFit = false;

  function fit() {
    atFit = true;
    view = fitRect({ x: 0, y: 0, w: layout.paper.w, h: layout.paper.h }, size.w, size.h, 24, "page");
  }

  onMount(() => {
    painter = new SheetPainter(context.renderer, schedule);
  });
  onDestroy(() => {
    painter?.dispose();
    if (frame) cancelAnimationFrame(frame);
    unlistenDrop?.();
  });

  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => {
      if (!host) return;
      size = { w: host.clientWidth, h: host.clientHeight };
      if (!fitted && size.w > 50) {
        fitted = true;
        fit();
      } else if (atFit) fit();
    });
    ro.observe(host);
    return () => ro.disconnect();
  });

  // Refit when the sheet size changes, and only then. Through deriveds, which notify only when
  // the number changes: reading layout.paper directly would refit on every edit to the layout
  // (each drag), throwing the zoom away.
  const paperW = $derived(layout.paper.w);
  const paperH = $derived(layout.paper.h);
  $effect(() => {
    void paperW;
    void paperH;
    if (fitted) untrack(fit);
  });

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  $effect(() => {
    void layout;
    void sheetIdx;
    void view;
    void size;
    void selected;
    void guides;
    void settings.colour;
    void settings.blackSensitivity;
    schedule();
  });

  const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0d9488";

  function paint() {
    if (!canvas || !painter || !sheet) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.w * dpr);
    const H = Math.round(size.h * dpr);
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const v = { k: view.scale * dpr, ox: view.tx * dpr, oy: view.ty * dpr };
    const sx = v.ox;
    const sy = v.oy;
    const sw = layout.paper.w * v.k;
    const sh = layout.paper.h * v.k;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    // What's on screen of the sheet, in sheet points (renders only what's needed).
    const [wx0, wy0] = screenToWorld(view, 0, 0);
    const [wx1, wy1] = screenToWorld(view, size.w, size.h);
    const vis: Box = { x0: Math.max(0, wx0), y0: Math.max(0, wy0), x1: Math.min(layout.paper.w, wx1), y1: Math.min(layout.paper.h, wy1) };
    const sheetBox = { x0: 0, y0: 0, x1: layout.paper.w, y1: layout.paper.h };
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    for (const it of sheet.items) {
      painter.want(it, vis, v.k);
      painter.drawItem(ctx, it, v, sheetBox);
    }
    const js = sheetJob(layout, sheetIdx, { enabled: settings.stamp, date });
    drawLines(ctx, js.lines, v);
    drawTexts(ctx, js.texts, v);
    ctx.restore();
    const cx0 = Math.max(0, Math.floor(sx));
    const cy0 = Math.max(0, Math.floor(sy));
    applyColourPreview(ctx, cx0, cy0, Math.min(W, Math.ceil(sx + sw)) - cx0, Math.min(H, Math.ceil(sy + sh)) - cy0, settings.colour, settings.blackSensitivity, v.k,
      sheet.items.map((it) => {
        const b = itemBox(it);
        return { x0: sx + b.x0 * v.k, y0: sy + b.y0 * v.k, x1: sx + b.x1 * v.k, y1: sy + b.y1 * v.k };
      }));
    // Printable area.
    ctx.save();
    ctx.strokeStyle = printMargin();
    ctx.lineWidth = dpr;
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.strokeRect(sx + area.x0 * v.k, sy + area.y0 * v.k, boxW(area) * v.k, boxH(area) * v.k);
    ctx.restore();
    // Outlines of unselected items (so blank pages are findable), selection and handles.
    const acc = accent();
    for (const it of sheet.items) {
      const b = itemBox(it);
      const on = selected.includes(it.id);
      ctx.save();
      ctx.strokeStyle = on ? acc : "rgba(0,0,0,0.25)";
      ctx.lineWidth = on ? 1.5 * dpr : dpr;
      ctx.strokeRect(sx + b.x0 * v.k, sy + b.y0 * v.k, boxW(b) * v.k, boxH(b) * v.k);
      ctx.restore();
    }
    if (sel) {
      const b = itemBox(sel);
      ctx.save();
      for (const h of handles(b)) {
        const [hx, hy] = [sx + h.x * v.k, sy + h.y * v.k];
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = acc;
        ctx.lineWidth = 1.2 * dpr;
        const r = h.kind === "corner" ? [8, 8] : h.edge === "left" || h.edge === "right" ? [6, 14] : [14, 6];
        ctx.beginPath();
        ctx.rect(hx - (r[0] * dpr) / 2, hy - (r[1] * dpr) / 2, r[0] * dpr, r[1] * dpr);
        ctx.fill();
        ctx.stroke();
      }
      // Scale badge, bottom-right inside the item.
      const text = scaleLabel(sel); // the editing badge: always page and scale
      ctx.font = `${11 * dpr}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-num") || "monospace"}`;
      const tw = ctx.measureText(text).width + 12 * dpr;
      const th = 18 * dpr;
      // Only where it fits inside the item; a small item shows its numbers in the panel.
      const fits = tw + 12 * dpr <= (b.x1 - b.x0) * v.k && th + 12 * dpr <= (b.y1 - b.y0) * v.k;
      const bx = sx + b.x1 * v.k - tw - 6 * dpr;
      const by = sy + b.y1 * v.k - th - 6 * dpr;
      if (fits) {
        ctx.fillStyle = acc;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, th, 4 * dpr);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textBaseline = "middle";
        ctx.fillText(text, bx + 6 * dpr, by + th / 2 + dpr);
      }
      ctx.restore();
    }
    // Snap guides.
    if (guides.length) {
      ctx.save();
      ctx.strokeStyle = acc;
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      for (const g of guides) {
        ctx.beginPath();
        if (g.axis === "x") {
          ctx.moveTo(sx + g.at * v.k, sy);
          ctx.lineTo(sx + g.at * v.k, sy + sh);
        } else {
          ctx.moveTo(sx, sy + g.at * v.k);
          ctx.lineTo(sx + sw, sy + g.at * v.k);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---- Interaction ----

  type Handle = { kind: "corner"; corner: Corner; x: number; y: number } | { kind: "edge"; edge: Edge; x: number; y: number };

  function handles(b: Box): Handle[] {
    const mx = (b.x0 + b.x1) / 2;
    const my = (b.y0 + b.y1) / 2;
    return [
      { kind: "corner", corner: "nw", x: b.x0, y: b.y0 },
      { kind: "corner", corner: "ne", x: b.x1, y: b.y0 },
      { kind: "corner", corner: "sw", x: b.x0, y: b.y1 },
      { kind: "corner", corner: "se", x: b.x1, y: b.y1 },
      { kind: "edge", edge: "top", x: mx, y: b.y0 },
      { kind: "edge", edge: "bottom", x: mx, y: b.y1 },
      { kind: "edge", edge: "left", x: b.x0, y: my },
      { kind: "edge", edge: "right", x: b.x1, y: my },
    ];
  }

  type Drag =
    | { kind: "pan"; sx: number; sy: number; tx: number; ty: number }
    | { kind: "move"; id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; others: { id: number; x: number; y: number }[] }
    | { kind: "corner"; id: number; corner: Corner }
    | { kind: "edge"; id: number; edge: Edge };

  let drag: Drag | null = null;
  let spaceDown = false;
  let cursor = $state("default");

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvas!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toSheet = (e: { clientX: number; clientY: number }): [number, number] => {
    const [x, y] = local(e);
    return screenToWorld(view, x, y);
  };
  const tol = () => 6 / view.scale;

  function hitHandle(x: number, y: number): Handle | null {
    if (!sel) return null;
    const t = tol() * 1.4;
    return handles(itemBox(sel)).find((h) => Math.abs(h.x - x) <= t && Math.abs(h.y - y) <= t) ?? null;
  }

  function hitItem(x: number, y: number): ManualItem | null {
    for (let i = sheet.items.length - 1; i >= 0; i--) {
      const b = itemBox(sheet.items[i]);
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return sheet.items[i];
    }
    return null;
  }

  const others = (ids: number[]) => sheet.items.filter((it) => !ids.includes(it.id)).map(itemBox);

  function onPointerDown(e: PointerEvent) {
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      drag = { kind: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
      cursor = "grabbing";
      return;
    }
    if (e.button !== 0) return;
    const [x, y] = toSheet(e);
    const h = hitHandle(x, y);
    if (h && sel) {
      drag = h.kind === "corner" ? { kind: "corner", id: sel.id, corner: h.corner } : { kind: "edge", id: sel.id, edge: h.edge };
      return;
    }
    const it = hitItem(x, y);
    if (!it) {
      selected = [];
      return;
    }
    if (e.shiftKey || e.ctrlKey) {
      selected = selected.includes(it.id) ? selected.filter((i) => i !== it.id) : [...selected, it.id];
    } else if (!selected.includes(it.id)) {
      selected = [it.id];
    }
    const ids = selected.includes(it.id) ? selected : [it.id];
    drag = {
      kind: "move",
      id: it.id,
      sx: x,
      sy: y,
      ox: it.x,
      oy: it.y,
      moved: false,
      others: sheet.items.filter((o) => ids.includes(o.id) && o.id !== it.id).map((o) => ({ id: o.id, x: o.x, y: o.y })),
    };
  }

  function onPointerMove(e: PointerEvent) {
    if (!canvas) return;
    const [x, y] = toSheet(e);
    if (!drag) {
      const h = hitHandle(x, y);
      cursor = spaceDown
        ? "grab"
        : h
          ? h.kind === "corner"
            ? h.corner === "nw" || h.corner === "se" ? "nwse-resize" : "nesw-resize"
            : h.edge === "left" || h.edge === "right" ? "ew-resize" : "ns-resize"
          : hitItem(x, y) ? "move" : "default";
      return;
    }
    if (drag.kind === "pan") {
      view = { ...view, tx: drag.tx + (e.clientX - drag.sx), ty: drag.ty + (e.clientY - drag.sy) };
      atFit = false;
      return;
    }
    const d = drag;
    const it = findItem(layout, sheetIdx, d.id);
    if (!it) return;
    if (d.kind === "move") {
      let nx = d.ox + (x - d.sx);
      let ny = d.oy + (y - d.sy);
      if (!d.moved && Math.hypot(x - d.sx, y - d.sy) * view.scale < 3) return;
      d.moved = true;
      const b = itemBox({ ...it, x: nx, y: ny });
      const s = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapMove(b, others([d.id, ...d.others.map((o) => o.id)]), area, snap, tol());
      nx += s.dx;
      ny += s.dy;
      guides = s.guides;
      let l = updateItem(layout, sheetIdx, d.id, { x: nx, y: ny });
      for (const o of d.others) l = updateItem(l, sheetIdx, o.id, { x: o.x + (nx - d.ox), y: o.y + (ny - d.oy) });
      layout = l;
    } else if (d.kind === "corner") {
      const p = e.altKey ? { x, y, guides: [] } : snapPoint(x, y, others([d.id]), area, snap, tol());
      guides = p.guides;
      const n = scaleFromCorner(it, d.corner, p.x, p.y);
      layout = updateItem(layout, sheetIdx, d.id, { x: n.x, y: n.y, scale: n.scale });
    } else {
      const p = e.altKey ? { x, y, guides: [] } : snapPoint(x, y, others([d.id]), area, snap, tol());
      guides = p.guides.filter((g) => (d.edge === "left" || d.edge === "right" ? g.axis === "x" : g.axis === "y"));
      const v = d.edge === "left" || d.edge === "right" ? p.x : p.y;
      const n = cropFromEdge(it, d.edge, v);
      layout = updateItem(layout, sheetIdx, d.id, { crop: n.crop, x: n.x, y: n.y });
    }
  }

  function onPointerUp(e: PointerEvent) {
    canvas?.releasePointerCapture(e.pointerId);
    drag = null;
    guides = [];
    cursor = spaceDown ? "grab" : "default";
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = local(e);
    view = zoomBy(view, x, y, wheelZoomFactor(e.deltaY, e.deltaMode));
    atFit = false;
  }

  function onKey(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    if (e.key === " ") {
      spaceDown = e.type === "keydown";
      cursor = spaceDown ? "grab" : "default";
      e.preventDefault();
      return;
    }
    if (e.type !== "keydown") return;
    if (e.key === "Escape") {
      e.preventDefault();
      if (cropping !== null) cropping = null;
      else if (selected.length) selected = [];
      else onBack();
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected.length) {
      e.preventDefault();
      let l = layout;
      for (const id of selected) l = removeItem(l, sheetIdx, id);
      layout = l;
      selected = [];
      return;
    }
    const step = mmToPt(e.shiftKey ? 5 : 1);
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    if (d && selected.length) {
      e.preventDefault();
      let l = layout;
      for (const id of selected) {
        const it = findItem(l, sheetIdx, id);
        if (it) l = updateItem(l, sheetIdx, id, { x: it.x + d[0] * step, y: it.y + d[1] * step });
      }
      layout = l;
    }
    if (e.key === "0" && e.ctrlKey) {
      e.preventDefault();
      fit();
    }
  }

  // ---- Page strip ----

  interface StripPage {
    doc: PrintDoc;
    page: number;
  }
  const STRIP_LIMIT = 400;
  const strip = $derived.by(() => {
    const out: StripPage[] = [];
    for (const d of allDocs) {
      for (let p = 0; p < d.info.numPages && out.length < STRIP_LIMIT; p++) out.push({ doc: d, page: p });
    }
    return out;
  });

  const thumbs = new Map<string, ImageBitmap>();
  function thumb(node: HTMLCanvasElement, sp: StripPage) {
    const key = `${sp.doc.docId}:${sp.page}`;
    let done = false;
    const draw = (bmp: ImageBitmap) => {
      const s = Math.min(node.width / bmp.width, node.height / bmp.height);
      const w = bmp.width * s;
      const h = bmp.height * s;
      const ctx = node.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff"; // paper
      ctx.fillRect(0, 0, node.width, node.height);
      ctx.drawImage(bmp, (node.width - w) / 2, (node.height - h) / 2, w, h);
    };
    const load = () => {
      if (done) return;
      done = true;
      // Read the page's title block now, so its scale is known before it's placed.
      untrack(() => sp.doc.scaleOf(sp.page));
      const have = thumbs.get(key);
      if (have) return draw(have);
      context.renderer
        .thumbnail?.(sp.doc.docId, sp.page, 160)
        .then((b) => {
          thumbs.set(key, b);
          draw(b);
        })
        .catch(() => {});
    };
    const io = new IntersectionObserver((es) => {
      if (es.some((x) => x.isIntersecting)) {
        load();
        io.disconnect();
      }
    });
    io.observe(node);
    return { destroy: () => io.disconnect() };
  }
  onDestroy(() => {
    for (const b of thumbs.values()) b.close();
    thumbs.clear();
  });

  function addPage(sp: StripPage, at?: { x: number; y: number }) {
    const r = addItem(layout, sheetIdx, pageRef(sp.doc, sp.page), { at });
    layout = r.layout;
    selected = [r.id];
  }

  // Dragging from the strip to the sheet, with pointer events. Not HTML drag and drop: the
  // window takes file drops from Explorer (dragDropEnabled), and on Windows that leaves HTML
  // drag and drop inside the page refusing every drop.
  let stripDrag = $state<{ sp: StripPage; pointer: number; x0: number; y0: number; x: number; y: number; moving: boolean; over: boolean } | null>(null);

  function overSheet(e: { clientX: number; clientY: number }): boolean {
    const r = canvas?.getBoundingClientRect();
    return !!r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onStripPointerDown(e: PointerEvent, sp: StripPage) {
    if (e.button !== 0) return;
    stripDrag = { sp, pointer: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moving: false, over: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onStripPointerMove(e: PointerEvent) {
    const d = stripDrag;
    if (!d || e.pointerId !== d.pointer) return;
    const moving = d.moving || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) >= 5;
    stripDrag = { ...d, x: e.clientX, y: e.clientY, moving, over: moving && overSheet(e) };
  }

  function onStripPointerUp(e: PointerEvent) {
    const d = stripDrag;
    if (!d || e.pointerId !== d.pointer) return;
    stripDrag = null;
    if (e.type === "pointerup" && d.moving && overSheet(e)) {
      const [x, y] = toSheet(e);
      addPage(d.sp, { x, y });
    }
  }

  /** The dragged page's thumbnail under the pointer (if it has loaded). */
  /**
   * The drag preview's size, CSS px, centred on the pointer: over the sheet, the size the page
   * will be placed at (as addPage places it); elsewhere, a small thumbnail.
   */
  const ghostBox = $derived.by(() => {
    const d = stripDrag;
    if (!d?.moving) return null;
    const r = pageRef(d.sp.doc, d.sp.page);
    if (!(r.w > 0 && r.h > 0)) return null;
    if (d.over) {
      const k = defaultScale(r, null, areaOfLayout(layout)) * view.scale;
      return { w: r.w * k, h: r.h * k };
    }
    const k = Math.min(76 / r.w, 54 / r.h);
    return { w: r.w * k, h: r.h * k };
  });

  /** Draw the dragged page's thumbnail (if it has loaded) into the preview. */
  function ghost(node: HTMLCanvasElement, p: { key: string; w: number; h: number }) {
    const draw = (q: { key: string }) => {
      const g = node.getContext("2d");
      if (!g) return;
      g.fillStyle = "#ffffff"; // paper
      g.fillRect(0, 0, node.width, node.height);
      const b = thumbs.get(q.key);
      if (b) g.drawImage(b, 0, 0, node.width, node.height);
    };
    draw(p);
    return { update: draw };
  }

  const sameFile = (a: string, b: string) => a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
  const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;

  /**
   * Per-page drawing scales for a file opened here rather than from a tab, by the rule a tab
   * uses (resolvePageScale, with nothing set by hand): the page's own title block, else page
   * 1's. Each page's title block is read the first time it's asked for, two at a time; the
   * answer is reactive, so placed pages and the strip follow as reads come in.
   */
  function fileScales(info: DocInfo, first: number | null): (page: number) => number | null {
    let read = $state<Record<number, number | null>>({ 0: first });
    const asked = new Set<number>([0]);
    const find = context.renderer.findScale;
    return (page) => {
      if (info.kind !== "pdf" || !find) return null;
      if (!asked.has(page) && page < info.numPages) {
        asked.add(page);
        scaleReads(() =>
          find(info.docId, page)
            .catch((e) => {
              console.warn("scale detection failed on page", page + 1, String(e));
              return [];
            })
            .then((c) => {
              read = { ...read, [page]: pickDetectedScale(c, info.sizes[page].w, info.sizes[page].h) };
            }),
        );
      }
      const own = read[page];
      return typeof own === "number" ? own : (read[0] ?? null);
    };
  }

  /** Open a file for the strip (or find it already open). Returns null if it can't be opened. */
  async function openFile(path: string): Promise<PrintDoc | null> {
    const have = allDocs.find((d) => sameFile(d.path, path));
    if (have) return have;
    try {
      const info = await context.renderer.open(path);
      // Page 1's title block first, so a file dropped on the sheet lands at a standard ratio.
      let first: number | null = null;
      if (info.kind === "pdf" && context.renderer.findScale) {
        const c = await context.renderer.findScale(info.docId, 0).catch(() => []);
        first = pickDetectedScale(c, info.sizes[0].w, info.sizes[0].h);
      }
      const doc: PrintDoc = { docId: info.docId, path, title: fileName(path), info, scaleOf: fileScales(info, first) };
      extraDocs = [...extraDocs, doc];
      return doc;
    } catch (e) {
      localError = errorText(e, `open ${fileName(path)}`);
      return null;
    }
  }

  async function addFiles() {
    const r = await openDialog({
      multiple: true,
      filters: [{ name: "PDF or image", extensions: ["pdf", "jpg", "jpeg", "png", "webp", "tif", "tiff", "bmp", "gif"] }],
    }).catch(() => null);
    const paths = r === null ? [] : Array.isArray(r) ? r : [r];
    for (const p of paths) await openFile(p);
  }

  // Files dropped from Explorer: add to the strip; dropped on the sheet, also place them there.
  let unlistenDrop: (() => void) | null = null;
  onMount(() => {
    import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent(async (ev) => {
          if (ev.payload.type !== "drop") return;
          const dpr = window.devicePixelRatio || 1;
          const pos = { clientX: ev.payload.position.x / dpr, clientY: ev.payload.position.y / dpr };
          const r = canvas?.getBoundingClientRect();
          const onSheet = !!r && pos.clientX >= r.left && pos.clientX <= r.right && pos.clientY >= r.top && pos.clientY <= r.bottom;
          for (const p of ev.payload.paths) {
            const doc = await openFile(p);
            if (doc && onSheet) addPage({ doc, page: 0 }, (() => { const [x, y] = toSheet(pos); return { x, y }; })());
          }
        }),
      )
      .then((un) => (unlistenDrop = un))
      .catch(() => {});
  });

  // ---- Inspector ----

  const scaleChoices = $derived.by(() => {
    if (!sel) return [] as { value: string; label: string }[];
    const n = sel.ref.drawingScale;
    if (n) {
      return SCALE_PRESETS.filter((r) => r >= n / 4 && r <= n * 20).map((r) => ({ value: `r${r}`, label: `${fmtRatio(r)} (${fmtPercent(n / r)})` }));
    }
    return PERCENT_PRESETS.map((p) => ({ value: `p${p}`, label: `${p}%` }));
  });
  const scaleValue = $derived.by(() => {
    if (!sel) return "";
    const n = sel.ref.drawingScale;
    const hit = scaleChoices.find((c) => {
      const f = c.value.startsWith("r") ? (n ?? 1) / Number(c.value.slice(1)) : Number(c.value.slice(1)) / 100;
      return Math.abs(f - sel!.scale) / f < 0.002;
    });
    return hit?.value ?? "current";
  });

  function chooseScale(v: string) {
    if (!sel) return;
    if (v.startsWith("r")) layout = setRatio(layout, sheetIdx, sel.id, Number(v.slice(1)));
    else if (v.startsWith("p")) layout = setScale(layout, sheetIdx, sel.id, Number(v.slice(1)) / 100);
  }

  function setPercent(text: string) {
    const p = parseFloat(text);
    if (sel && p > 0) layout = setScale(layout, sheetIdx, sel.id, p / 100);
  }

  function setPos(axis: "x" | "y", text: string) {
    const mm = parseFloat(text);
    if (!sel || !isFinite(mm)) return;
    layout = updateItem(layout, sheetIdx, sel.id, { [axis]: mmToPt(mm) });
  }

  function patch(p: Partial<ManualItem>) {
    if (sel) layout = updateItem(layout, sheetIdx, sel.id, p);
  }

  // ---- Crop to a region (a picker over the whole page) ----

  let cropCanvas = $state<HTMLCanvasElement | null>(null);
  let cropRect = $state<Box | null>(null);
  let cropBmp: ImageBitmap | null = null;
  let cropDrag: { x: number; y: number } | null = null;
  const cropItem = $derived(cropping !== null ? findItem(layout, sheetIdx, cropping) ?? null : null);
  const CROP_W = 720;
  const CROP_H = 480;
  const cropK = $derived(cropItem ? Math.min(CROP_W / cropItem.ref.w, CROP_H / cropItem.ref.h) : 1);

  async function startCrop() {
    if (!sel) return;
    cropping = sel.id;
    cropRect = sel.crop;
    cropBmp?.close();
    cropBmp = null;
    const it = sel;
    const k = Math.min(CROP_W / it.ref.w, CROP_H / it.ref.h) * (window.devicePixelRatio || 1);
    try {
      cropBmp = (await context.renderer.thumbnail?.(it.ref.docId, it.ref.page, Math.ceil(Math.max(it.ref.w, it.ref.h) * k))) ?? null;
    } catch {
      cropBmp = null;
    }
    drawCrop();
  }

  function drawCrop() {
    const c = cropCanvas;
    const it = cropItem;
    if (!c || !it) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(it.ref.w * cropK);
    const h = Math.round(it.ref.h * cropK);
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    if (cropBmp) ctx.drawImage(cropBmp, 0, 0, w, h);
    if (cropRect) {
      const r = cropRect;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.rect(r.x0 * cropK, r.y0 * cropK, (r.x1 - r.x0) * cropK, (r.y1 - r.y0) * cropK);
      ctx.fill("evenodd");
      ctx.strokeStyle = accent();
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x0 * cropK, r.y0 * cropK, (r.x1 - r.x0) * cropK, (r.y1 - r.y0) * cropK);
    }
  }

  $effect(() => {
    void cropRect;
    void cropCanvas;
    drawCrop();
  });

  function cropPoint(e: PointerEvent): { x: number; y: number } {
    const r = cropCanvas!.getBoundingClientRect();
    const it = cropItem!;
    return {
      x: Math.min(it.ref.w, Math.max(0, (e.clientX - r.left) / cropK)),
      y: Math.min(it.ref.h, Math.max(0, (e.clientY - r.top) / cropK)),
    };
  }

  function applyCrop() {
    const it = cropItem;
    if (it) {
      const ok = cropRect && cropRect.x1 - cropRect.x0 > 2 && cropRect.y1 - cropRect.y0 > 2;
      layout = updateItem(layout, sheetIdx, it.id, setCrop(it, ok ? cropRect : null));
    }
    cropping = null;
  }

  // ---- Save and open layouts ----

  async function saveLayout() {
    localError = null;
    const path = await saveDialog({
      defaultPath: `${stem(context.docs[0]?.title ?? "Vellum")} layout.json`,
      filters: [{ name: "Vellum layout", extensions: ["json"] }],
    }).catch(() => null);
    if (!path) return;
    try {
      await invoke("write_text_file", { path, contents: serialise(layout) });
      localNotice = "Layout saved.";
    } catch (e) {
      localError = errorText(e, "save the layout");
    }
  }

  async function openLayout() {
    localError = null;
    const r = await openDialog({ multiple: false, filters: [{ name: "Vellum layout", extensions: ["json"] }] }).catch(() => null);
    const path = Array.isArray(r) ? r[0] : r;
    if (!path) return;
    try {
      const buf = await invoke<ArrayBuffer>("read_file", { path });
      await loadText(new TextDecoder().decode(buf), "opened", "printer");
    } catch (e) {
      localError = errorText(e, "open the layout");
    }
  }

  /**
   * Load a layout's text: opening its files (or finding them open) and leaving out the items
   * whose file can't be found, which are named. A restored layout isn't written back until it's
   * changed, so missing files aren't forgotten just by looking.
   */
  async function loadText(text: string, how: "opened" | "restored", margin: MarginMode) {
    localError = null;
    const parsed = parseLayout(text);
    if (!parsed.ok) {
      localError = how === "restored" ? null : parsed.error;
      return;
    }
    const docs = new Map<string, PrintDoc | null>();
    for (const p of layoutPaths(parsed.layout)) docs.set(p, await openFile(p));
    const res = restore(parsed.layout, (p) => {
      const d = docs.get(p);
      return d ? { docId: d.docId, numPages: d.info.numPages, sizes: d.info.sizes } : null;
    });
    if (how === "restored") baseline = res.layout;
    layout = res.layout;
    marginMode = margin;
    sheetIdx = 0;
    selected = [];
    localError = res.missing.length ? `Couldn't find ${res.missing.map(fileName).join(", ")}; ${res.missing.length === 1 ? "its" : "their"} items are left out.` : null;
    localNotice = res.missing.length ? null : how === "restored" ? "Your last layout for this file." : "Layout opened.";
  }

  const status = $derived(
    [
      `${nSheets} ${nSheets === 1 ? "sheet" : "sheets"}`,
      printerName ? `${printerName} (${isoName(layout.paper) ?? describeSize(layout.paper)})` : null,
      settings.colour === "blackLines" ? "black lines" : settings.colour === "greyscale" ? "greyscale" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  function job(): Job {
    return manualToJob(layout, { enabled: settings.stamp, date });
  }
</script>

<svelte:window onkeydown={onKey} onkeyup={onKey} />

<div class="dialog" role="dialog" aria-modal="true" aria-label="Print, manual layout" use:floating={PRINT_BOX}>
  <header>
    <button type="button" class="icon" aria-label="Back to print settings" onclick={onBack}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 3L4.5 7l4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <span class="title">Print: manual layout</span>
    <span class="sub">Arrange pages and images, crops and scales freely on each sheet</span>
    <div class="grow"></div>
    <CloseButton onclick={onClose} />
  </header>

  <div class="body">
    <div class="left">
      <div class="block">
        <span class="head">Paper</span>
        <select aria-label="Paper size" value={sheetKey} onchange={(e) => chooseSheet(e.currentTarget.value)}>
          {#if !sheetKey}<option value="">{describeSize(layout.paper)}</option>{/if}
          {#each sheetOptions.filter((o) => !o.other) as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
          {#if sheetOptions.some((o) => o.other)}
            <optgroup label="Other sizes">
              {#each sheetOptions.filter((o) => o.other) as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
            </optgroup>
          {/if}
        </select>
        <label for="ml-margin" class="lbl">Margins</label>
        <select id="ml-margin" value={marginCustomOpen || !["printer", "none", ...MARGIN_PRESETS].includes(marginMode) ? "custom" : marginMode} onchange={(e) => chooseMarginOption(e.currentTarget.value)}>
          <option value="printer">Printer minimum ({printerMinMm.toFixed(1)} mm)</option>
          <option value="none">None</option>
          {#each MARGIN_PRESETS as m (m)}<option value={m}>{m} mm</option>{/each}
          <option value="custom">Custom…</option>
        </select>
        {#if marginCustomOpen || !["printer", "none", ...MARGIN_PRESETS].includes(marginMode)}
          <div class="pair">
            <input class="mono pct" aria-label="Margin in millimetres" value={Number(marginMode) || 0} onchange={(e) => { const n = parseFloat(e.currentTarget.value); if (n >= 0 && n <= 100) chooseMargins(String(n)); }} /><span class="dim">mm</span>
          </div>
        {/if}
      </div>

      <div class="block">
        <span class="head">Snap</span>
        <label class="check"><input type="checkbox" bind:checked={snap.margins} /><span>To margins</span></label>
        <label class="check"><input type="checkbox" bind:checked={snap.pages} /><span>To other pages</span></label>
        <label class="check"><input type="checkbox" bind:checked={snap.grid} /><span>To 5 mm grid</span></label>
      </div>

      <div class="block">
        <span class="head">Align and distribute</span>
        <div class="aligns">
          <button type="button" aria-label="Align left" title="Align left" disabled={!selected.length} onclick={() => (layout = align(layout, sheetIdx, selected, "left"))}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2v12" stroke="currentColor" stroke-width="1.4" /><rect x="4.5" y="4" width="8" height="3" fill="none" stroke="currentColor" stroke-width="1.3" /><rect x="4.5" y="9" width="5" height="3" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
          </button>
          <button type="button" aria-label="Align centres" title="Align centres" disabled={!selected.length} onclick={() => (layout = align(layout, sheetIdx, selected, "centre"))}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12" stroke="currentColor" stroke-width="1.4" /><rect x="3.5" y="4" width="9" height="3" fill="none" stroke="currentColor" stroke-width="1.3" /><rect x="5" y="9" width="6" height="3" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
          </button>
          <button type="button" aria-label="Align tops" title="Align tops" disabled={!selected.length} onclick={() => (layout = align(layout, sheetIdx, selected, "top"))}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2.5h12" stroke="currentColor" stroke-width="1.4" /><rect x="4" y="4.5" width="3" height="8" fill="none" stroke="currentColor" stroke-width="1.3" /><rect x="9" y="4.5" width="3" height="5" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
          </button>
          <button type="button" aria-label="Distribute horizontally" title="Distribute horizontally" disabled={!selected.length} onclick={() => (layout = distributeH(layout, sheetIdx, selected))}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 2v12M14 2v12" stroke="currentColor" stroke-width="1.4" /><rect x="6.5" y="5" width="3" height="6" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
          </button>
        </div>
      </div>

      <div class="block tight">
        <button type="button" class="btn" disabled={!sheet?.items.length} onclick={() => (layout = autoArrange(layout, sheetIdx))}>Auto-arrange this sheet</button>
        <button type="button" class="btn" onclick={() => { layout = duplicateSheet(layout, sheetIdx); sheetIdx += 1; selected = []; }}>Duplicate sheet</button>
        <button type="button" class="btn ghost" disabled={!sheet?.items.length} onclick={() => { layout = clearSheet(layout, sheetIdx); selected = []; }}>Clear sheet</button>
      </div>

      <div class="block tight">
        <span class="head">Layout file</span>
        <div class="pair">
          <button type="button" class="btn" onclick={saveLayout}>Save layout…</button>
          <button type="button" class="btn" onclick={openLayout}>Open layout…</button>
        </div>
        <button type="button" class="btn ghost" onclick={startAgain}>Start again</button>
      </div>

      <div class="grow"></div>
      <p class="hint">Middle-drag pans and the wheel zooms here too. Drag an item's edge to crop; drag a corner to scale.</p>
    </div>

    <div class="centre">
      <div class="tabs">
        {#each layout.sheets as s, i (s.id)}
          <!-- A tab is a label button and, on the current sheet, the shared close button. -->
          <div class="tab" class:on={i === sheetIdx}>
            <button type="button" class="tab-label" onclick={() => { sheetIdx = i; selected = []; }}>Sheet {i + 1}</button>
            {#if layout.sheets.length > 1 && i === sheetIdx}
              <CloseButton size="small" label="Remove sheet {i + 1}" tabindex={-1} onclick={() => { layout = removeSheet(layout, i); selected = []; }} />
            {/if}
          </div>
        {/each}
        <button type="button" class="icon small" aria-label="Add sheet" onclick={() => { layout = addSheet(layout); sheetIdx = layout.sheets.length - 1; selected = []; }}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </button>
        <div class="grow"></div>
        <span class="mono dim">{fmtMm(layout.paper.w)} × {fmtMm(layout.paper.h)} mm · {sheet?.items.length ?? 0} {sheet?.items.length === 1 ? "item" : "items"}</span>
      </div>

      <div class="editor" bind:this={host}>
        <canvas
          bind:this={canvas}
          style:width="{size.w}px"
          style:height="{size.h}px"
          style:cursor={cursor}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onwheel={onWheel}
          onauxclick={(e) => e.preventDefault()}
          ondblclick={(e) => { if (e.button === 1) fit(); }}
          aria-label="Sheet editor"
        ></canvas>
        {#if !sheet?.items.length}
          <p class="placeholder">Drag pages or images here from the strip below</p>
        {/if}
      </div>
      {#if stripDrag?.moving && ghostBox}
        <canvas
          class="drag-ghost"
          class:over={stripDrag.over}
          width={Math.max(1, Math.round(ghostBox.w * (window.devicePixelRatio || 1)))}
          height={Math.max(1, Math.round(ghostBox.h * (window.devicePixelRatio || 1)))}
          style:width="{ghostBox.w}px"
          style:height="{ghostBox.h}px"
          style:left="{stripDrag.x - ghostBox.w / 2}px"
          style:top="{stripDrag.y - ghostBox.h / 2}px"
          use:ghost={{ key: `${stripDrag.sp.doc.docId}:${stripDrag.sp.page}`, w: ghostBox.w, h: ghostBox.h }}
        ></canvas>
      {/if}

      <div class="strip">
        <span class="dim small">Drag pages or images onto the sheet · placed items are marked · drop files from Explorer to add them</span>
        <div class="thumbs">
          <div class="thumb">
            <button type="button" class="add" onclick={addFiles}>
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
              PDF or image
            </button>
            <span class="dim small">Add</span>
          </div>
          {#each strip as sp (`${sp.doc.docId}:${sp.page}`)}
            {@const key = `${sp.doc.docId}:${sp.page}`}
            {@const isImg = sp.doc.info.kind === "image"}
            <div class="thumb" title={`${sp.doc.title}${isImg ? "" : `, page ${sp.page + 1}`}`}>
              <canvas
                width="152"
                height="108"
                class:placed={placed.has(key)}
                class:selected={sel?.ref.docId === sp.doc.docId && sel?.ref.page === sp.page}
                style:cursor={stripDrag?.moving && stripDrag.sp === sp ? (stripDrag.over ? "copy" : "no-drop") : null}
                onpointerdown={(e) => onStripPointerDown(e, sp)}
                onpointermove={onStripPointerMove}
                onpointerup={onStripPointerUp}
                onpointercancel={onStripPointerUp}
                ondblclick={() => addPage(sp)}
                use:thumb={sp}
              ></canvas>
              <span class="small" class:dim={!placed.has(key)}>
                {isImg ? sp.doc.title : allDocs.length > 1 && sp.page === 0 ? `${stem(sp.doc.title).length > 10 ? `${stem(sp.doc.title).slice(0, 9)}…` : stem(sp.doc.title)} 1` : sp.page + 1}{placed.has(key) ? " ●" : ""}
              </span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <div class="right">
      {#if sel}
        <div class="sel-head">
          <span class="head">Selected: {sel.ref.kind === "image" ? sel.ref.title : `page ${sel.ref.page + 1}`}</span>
          <span class="dim small">{sourceDescription(sel.ref)}</span>
        </div>
        <div class="props">
          <label for="ml-scale" class="lbl">Scale</label>
          <div class="pair">
            <select id="ml-scale" value={scaleValue} onchange={(e) => chooseScale(e.currentTarget.value)}>
              {#if scaleValue === "current"}
                <option value="current">{sel.ref.drawingScale ? `${fmtRatio(sel.ref.drawingScale / sel.scale)} (${Math.round(sel.scale * 1000) / 10}%)` : `${Math.round(sel.scale * 1000) / 10}%`}</option>
              {/if}
              {#each scaleChoices as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
            </select>
            {#if !sel.ref.drawingScale}
              <!-- No drawing scale: the scale is a percentage, typed here beside its presets. -->
              <input class="mono pct" aria-label="Scale, percent" value={(Math.round(sel.scale * 1000) / 10).toString()} onchange={(e) => setPercent(e.currentTarget.value)} /><span class="dim">%</span>
            {/if}
          </div>
          {#if sel.ref.drawingScale}
            <label for="ml-pct" class="lbl">Percent</label>
            <input id="ml-pct" class="mono" value={(Math.round(sel.scale * 1000) / 10).toString()} onchange={(e) => setPercent(e.currentTarget.value)} />
          {/if}
          <label for="ml-x" class="lbl">X / Y mm</label>
          <div class="pair">
            <input id="ml-x" class="mono" aria-label="X position, mm" value={fmtMm(sel.x)} onchange={(e) => setPos("x", e.currentTarget.value)} />
            <input aria-label="Y position, mm" class="mono" value={fmtMm(sel.y)} onchange={(e) => setPos("y", e.currentTarget.value)} />
          </div>
          <span class="lbl">Size</span>
          <span class="mono dim">{fmtMm(boxW(itemBox(sel)))} × {fmtMm(boxH(itemBox(sel)))} mm</span>
          <label for="ml-rot" class="lbl">Rotate</label>
          <select id="ml-rot" value={String(sel.rotation)} onchange={(e) => (layout = setRotation(layout, sheetIdx, sel!.id, Number(e.currentTarget.value)))}>
            <option value="0">0°</option>
            <option value="90">90°</option>
            <option value="180">180°</option>
            <option value="270">270°</option>
          </select>
        </div>
        <div class="block tight">
          <span class="head">Crop</span>
          <button type="button" class="btn" onclick={startCrop}>Crop to an area…</button>
          <button type="button" class="btn ghost" disabled={!sel.crop} onclick={() => patch(resetCrop(sel!))}>Reset crop</button>
        </div>
        <div class="block">
          <span class="head">This item</span>
          <label class="check"><input type="checkbox" checked={sel.border} onchange={(e) => patch({ border: e.currentTarget.checked })} /><span>Border</span></label>
          <span class="lbl">Label</span>
          <label class="check" title={sel.ref.kind === "image" ? undefined : "Ticked automatically when the layout uses more than one file"}>
            <input type="checkbox" checked={showsName(layout, sel)} onchange={(e) => patch({ showName: e.currentTarget.checked })} /><span>File name</span>
          </label>
          {#if sel.ref.kind !== "image"}
            <label class="check"><input type="checkbox" checked={sel.showPage} onchange={(e) => patch({ showPage: e.currentTarget.checked })} /><span>Page number</span></label>
          {/if}
          <label class="check"><input type="checkbox" checked={sel.showScale} onchange={(e) => patch({ showScale: e.currentTarget.checked })} /><span>Scale</span></label>
        </div>
        <div class="grow"></div>
        <button type="button" class="btn ghost danger" onclick={() => { layout = removeItem(layout, sheetIdx, sel!.id); selected = []; }}>Remove from sheet</button>
      {:else if selected.length > 1}
        <span class="head">{selected.length} items selected</span>
        <p class="dim small">Use Align and distribute on the left, or drag to move them together.</p>
        <div class="grow"></div>
        <button type="button" class="btn ghost danger" onclick={() => { let l = layout; for (const id of selected) l = removeItem(l, sheetIdx, id); layout = l; selected = []; }}>Remove from sheet</button>
      {:else}
        <span class="head">Nothing selected</span>
        <p class="dim small">Click an item on the sheet to adjust its scale, position, rotation and crop. Shift+click to select several.</p>
      {/if}
    </div>
  </div>

  <footer>
    <button type="button" class="btn" disabled={!nSheets || !!busy} onclick={() => onRun(job(), "pdf")}>Save as PDF…</button>
    <div class="grow"></div>
    <span class="status" role="status">
      {#if busy}{busy.label}{busy.label === "Printing" && busy.total ? ` sheet ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…` : ""}
      {:else if error || localError}<span class="err">{error ?? localError}</span>
      {:else if notice || localNotice}{notice ?? localNotice}
      {:else}{status}{/if}
    </span>
    <button type="button" class="btn" onclick={onClose}>{busy ? "Stop" : "Cancel"}</button>
    <button type="button" class="btn primary" disabled={!nSheets || !!busy || !printerName} onclick={() => onRun(job(), "print")}>
      Print
    </button>
  </footer>

  {#if cropItem}
    <div class="crop-backdrop" role="presentation">
      <div class="crop" role="dialog" aria-label="Crop to an area">
        <span class="head">Drag round the area of {cropItem.ref.kind === "image" ? cropItem.ref.title : `page ${cropItem.ref.page + 1}`} to print</span>
        <canvas
          bind:this={cropCanvas}
          onpointerdown={(e) => {
            cropCanvas?.setPointerCapture(e.pointerId);
            const p = cropPoint(e);
            cropDrag = p;
            cropRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
          }}
          onpointermove={(e) => {
            if (!cropDrag) return;
            const p = cropPoint(e);
            cropRect = { x0: Math.min(cropDrag.x, p.x), y0: Math.min(cropDrag.y, p.y), x1: Math.max(cropDrag.x, p.x), y1: Math.max(cropDrag.y, p.y) };
          }}
          onpointerup={() => (cropDrag = null)}
        ></canvas>
        <div class="pair end">
          <button type="button" class="btn ghost" onclick={() => (cropRect = null)}>Whole page</button>
          <button type="button" class="btn" onclick={() => (cropping = null)}>Cancel</button>
          <button type="button" class="btn primary" onclick={applyCrop}>Crop</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .dialog {
    position: relative;
    width: 1240px;
    height: 800px;
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    background: var(--app);
    color: var(--tx);
    font-family: var(--font-ui, Inter, system-ui, sans-serif);
    font-size: 13px;
    border: 1px solid var(--bd-strong);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--shadow-modal);
    user-select: none;
  }
  header {
    height: 48px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--bd);
    background: var(--chrome);
  }
  .title {
    font-size: 15px;
    font-weight: 600;
    white-space: nowrap;
  }
  .sub {
    color: var(--tx3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grow {
    flex: 1 1 auto;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .left,
  .right {
    width: 250px;
    flex-shrink: 0;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }
  .left {
    border-right: 1px solid var(--bd);
  }
  .right {
    border-left: 1px solid var(--bd);
    gap: 14px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex-shrink: 0; /* a short window scrolls the panel, never squashes its sections */
  }
  .block.tight {
    gap: 6px;
  }
  .head {
    font-weight: 600;
  }
  .lbl {
    color: var(--tx2);
  }
  .dim {
    color: var(--tx3);
  }
  .small {
    font-size: 12px;
  }
  .mono {
    font-family: var(--font-num, "JetBrains Mono", monospace);
    font-size: 12px;
  }
  .hint {
    margin: 0;
    color: var(--tx3);
    line-height: 1.45;
    font-size: 12px;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  input[type="checkbox"] {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: var(--accent);
  }
  /* Side-panel fields: compact, the page box's tighter size. */
  select,
  input:not([type="checkbox"]) {
    height: 24px;
    padding: 0 6px;
    background: var(--ctl);
    border: 1px solid var(--bd-input);
    border-radius: 4px;
    color: var(--tx);
    min-width: 0;
    box-sizing: border-box;
    user-select: text;
  }
  .pair {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  .pair > * {
    flex: 1 1 0;
    min-width: 0;
    width: 0;
  }
  .pair.end {
    justify-content: flex-end;
  }
  .pair.end > * {
    flex: 0 0 auto;
    width: auto;
  }
  .aligns {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
  }
  .aligns button {
    height: 28px;
    border: 1px solid var(--bd-ctl);
    background: var(--ctl);
    color: var(--tx2);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .aligns button:hover:not(:disabled) {
    background: var(--tab-on);
    color: var(--tx);
  }
  .aligns button:active:not(:disabled) {
    background: var(--press);
  }
  .centre {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
  }
  .tabs {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 14px;
    border-bottom: 1px solid var(--bd);
    background: var(--app);
  }
  .tab {
    height: 28px;
    padding: 0 12px;
    border: none;
    background: transparent;
    color: var(--tx3);
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tab:hover:not(.on) {
    background: var(--hover);
    color: var(--tx2);
  }
  .tab:active {
    background: var(--press-soft);
  }
  /* The shared selected look (app.css .seg). */
  .tab.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tab-label {
    border: none;
    background: none;
    color: inherit;
    padding: 0;
    height: 100%;
  }
  .editor {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
  .editor canvas {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
  .placeholder {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 12px;
    margin: 0;
    text-align: center;
    color: var(--tx3);
    pointer-events: none;
  }
  .strip {
    height: 132px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 14px 10px;
    border-top: 1px solid var(--bd);
    background: var(--app);
    box-sizing: border-box;
  }
  .thumbs {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1 1 auto;
  }
  .thumb {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  /* Pages are white paper; the arrow at rest, the closed hand only while dragging. */
  .thumb canvas {
    width: 76px;
    height: 54px;
    background: var(--paper);
    border: 1px solid var(--bd-input);
    border-radius: 2px;
    box-sizing: border-box;
    cursor: default;
  }
  .drag-ghost {
    position: fixed;
    z-index: 1;
    pointer-events: none;
    border: 1px solid var(--bd-strong);
    border-radius: 2px;
    box-shadow: var(--shadow-pop);
    opacity: 0.6;
  }
  .drag-ghost.over {
    border-color: var(--accent);
    opacity: 0.9;
  }
  .thumb canvas.placed {
    border: 2px solid var(--tx3);
  }
  .thumb canvas.selected {
    border: 2px solid var(--accent);
  }
  .thumb .add {
    width: 76px;
    height: 54px;
    border: 1px dashed var(--bd-input);
    background: transparent;
    color: var(--tx2);
    border-radius: 4px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    font-size: 11px;
  }
  .thumb .add:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .thumb .add:active {
    background: var(--press-soft);
  }
  .thumb span {
    max-width: 76px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
  .sel-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .sel-head > * {
    overflow-wrap: anywhere; /* long file names wrap instead of widening the column */
  }
  .pair .pct {
    flex: 0 0 auto;
    width: 52px;
  }
  .props {
    display: grid;
    grid-template-columns: 60px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  footer {
    height: 60px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 20px;
    border-top: 1px solid var(--bd);
    background: var(--chrome);
  }
  .status {
    color: var(--tx3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .err {
    color: var(--danger, #e5484d);
  }
  .icon {
    width: 30px;
    height: 30px;
    border: none;
    background: transparent;
    color: var(--tx2);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .icon.small {
    width: 28px;
    height: 28px;
    color: var(--tx3);
  }
  .icon:hover:not(:disabled) {
    background: var(--hover);
    color: var(--tx);
  }
  .icon:active:not(:disabled) {
    background: var(--press-soft);
  }
  /* Buttons use the shared .btn (app.css). */
  .crop-backdrop {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: var(--scrim);
    z-index: 5;
  }
  .crop {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    background: var(--app);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
  }
  .crop canvas {
    align-self: center;
    cursor: crosshair;
    touch-action: none;
    box-shadow: 0 2px 10px var(--shadow);
  }
</style>
