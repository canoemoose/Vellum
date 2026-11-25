<script lang="ts">
  // The print dialog (docs/mockups/Print.png, project/Print.dc.html): options on the left,
  // a live preview of the sheets on the right. The layout is the pure model in
  // src/lib/print/model; printing and Save as PDF compose it in Rust (src-tauri/src/print).
  // Layout: Manual uses a layout made in the manual layout editor (ManualLayout.svelte),
  // previewed and printed here with the same colour, output and advanced settings.
  import { onDestroy, tick, untrack } from "svelte";
  import { PRINT_BOX, floating } from "../floating";
  import { groupPapers } from "../../print/paperOrder";
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import type { PageRect, PrintContext } from "../../print/context";
  import {
    type Capabilities, type PrinterInfo, cancelPrinting, composeJob, errorText, listPrinters, printFeatures,
    printerCapabilities, printerMargins, printerProperties, releaseJob, savePdf, sendJob,
  } from "../../print/api";
  import { type AutoOptions, type AutoResult, autoLayout, sizingInfo } from "../../print/model/auto";
  import { type Margins, type Size, describeSize, fmtRatio, intersect, isoName, isoSize, mmToPt } from "../../print/model/geom";
  import { type Job, formatDate } from "../../print/model/job";
  import {
    type Preset, type PrintSettings, N_UP, PERCENT_PRESETS, SCALE_PRESETS, applyPreset, parseRatio, presetFrom,
  } from "../../print/model/settings";
  import { SheetPainter, applyColourPreview, asItem, drawLines, drawTexts } from "../../print/painter";
  import { type View, fitRect, panBy, screenToWorld, wheelZoomFactor, zoomAt, zoomBy } from "../../view/viewMath";
  import { activeDoc, pickSources, stem } from "../../print/sources";
  import {
    loadPresetName, loadPresets, loadSettings, savePresetName, savePresets, saveSettings,
  } from "../../print/store";
  import ManualLayout, { keptManualLayout, resetManualLayout } from "./ManualLayout.svelte";
  import { type ManualLayout as ManualLayoutModel, areaOfLayout, itemBox, manualToJob, sheetCount as manualSheetCount } from "../../print/model/manual";
  import { printMargin } from "../../print/marginColour";
  import { errorString, hasCode } from "../../shell/messages";
  import CloseButton from "../CloseButton.svelte";

  let { open, context, onClose }: { open: boolean; context: PrintContext | null; onClose: () => void } = $props();

  let settings = $state<PrintSettings>(loadSettings());
  let presets = $state<Preset[]>([]);
  let presetName = $state<string | null>(null);
  let printers = $state<PrinterInfo[]>([]);
  let caps = $state<Capabilities | null>(null);
  let margins = $state<{ portrait: Margins; landscape: Margins }>({
    portrait: { left: 12, top: 12, right: 12, bottom: 12 },
    landscape: { left: 12, top: 12, right: 12, bottom: 12 },
  });
  let vectorOk = $state(false);
  let marquee = $state<PageRect | null>(null);
  let hidden = $state(false);
  let manual = $state(false);
  let sheetIndex = $state(0);
  let busy = $state<{ label: string; done: number; total: number } | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let sections = $state({ arrangement: true, output: false, advanced: false });
  let presetEditor = $state<{ name: string } | null>(null);
  let customScale = $state("");
  let date = $state(formatDate(new Date()));
  let wasOpen = false;

  const doc = $derived(context ? activeDoc(context) : null);
  const title = $derived(doc?.title ?? "");
  const paperObj = $derived(caps?.papers.find((p) => p.id === settings.paperId) ?? null);
  const paper = $derived<Size>(
    paperObj ? { w: mmToPt(paperObj.w), h: mmToPt(paperObj.h) } : (isoSize("A4") as Size),
  );
  const papersPt = $derived(caps?.papers.map((p) => ({ w: mmToPt(p.w), h: mmToPt(p.h) })) ?? []);
  /** The printer's papers, A sizes first (paperOrder.ts). */
  const paperGroups = $derived(groupPapers(caps?.papers ?? []));

  // Margins: Printer minimum, None, 5, 10 or 15 mm, or Custom (any mm), as the manual layout
  // offers. The presets are stored as custom millimetres.
  const MARGIN_PRESETS = [5, 10, 15];
  let marginCustomOpen = $state(false);
  const marginChoice = $derived(
    settings.marginMode !== "custom"
      ? settings.marginMode
      : !marginCustomOpen && MARGIN_PRESETS.includes(settings.customMarginMm)
        ? String(settings.customMarginMm)
        : "custom",
  );

  function chooseMarginChoice(v: string) {
    marginCustomOpen = v === "custom";
    if (v === "printer" || v === "none") settings.marginMode = v;
    else {
      settings.marginMode = "custom";
      if (v !== "custom") settings.customMarginMm = Number(v);
    }
  }

  const options = $derived<AutoOptions>({
    sizing: settings.sizing === "manual" ? "fit" : settings.sizing,
    fitTo: settings.fitTo,
    scaleRatio: settings.scaleRatio,
    scalePercent: settings.scalePercent,
    nUp: settings.nUp,
    order: settings.order,
    marginMode: settings.marginMode,
    customMarginMm: settings.customMarginMm,
    centre: settings.centre,
    autoRotate: settings.autoRotate,
    borders: settings.borders,
    tileOverlapMm: settings.tileOverlapMm,
    landscape: settings.landscape,
    trayBySize: settings.trayBySize,
    shrinkOversized: settings.shrinkOversized,
    stamp: settings.stamp,
  });

  const picked = $derived(context ? pickSources(context, settings.pagesMode, settings.range, marquee) : null);
  const result = $derived(
    picked?.ok ? autoLayout({ sources: picked.sources, paper, printerMargins: margins, papers: papersPt, date, options }) : null,
  );
  // Layout: Manual. The layout is made in the manual layout editor (ManualLayout.svelte, which
  // keeps it while the dialog is open); back here it's previewed and printed like an automatic
  // one, with Colour, Output and Advanced applying to it.
  let manualMode = $state(false);
  let manualLayout = $state.raw<ManualLayoutModel | null>(null);
  const manualResult = $derived.by((): AutoResult | null => {
    const l = manualLayout;
    if (!l) return null;
    const job = manualToJob(l, { enabled: settings.stamp, date });
    const area = areaOfLayout(l);
    return { job, sheets: job.sheets.map(() => ({ size: l.paper, area, contentArea: area, placed: [], tile: null })) };
  });
  /** What the preview shows and Print prints: the manual layout in Manual, else the automatic one. */
  const shown = $derived(manualMode ? manualResult : result);
  const manualSummary = $derived.by(() => {
    const l = manualLayout;
    const n = l ? manualSheetCount(l) : 0;
    if (!l || n === 0) return "No pages arranged yet";
    return `${n} ${n === 1 ? "sheet" : "sheets"} · ${isoName(l.paper) ?? describeSize(l.paper)} ${l.paper.w > l.paper.h ? "landscape" : "portrait"}`;
  });

  function chooseLayoutMode(v: "auto" | "manual") {
    if (v === "auto") {
      manualMode = false;
      return;
    }
    manualMode = true;
    if (!manualLayout) setSizing("manual"); // nothing made yet: straight to the editor
  }

  const sheetCount = $derived(shown?.job.sheets.length ?? 0);
  /**
   * Pages to print whose title block is still being read (the shell reads them as Print asks,
   * two at a time). To scale sizes each page from its drawing scale, so printing waits for them:
   * until its own is read, a page has page 1's scale.
   */
  const scalesToRead = $derived.by(() => {
    if (manualMode || settings.sizing !== "scale" || !context || !picked?.ok) return 0;
    const docs = context.docs;
    return picked.sources.filter((s) => docs.find((d) => d.docId === s.ref.docId)?.scalePending?.(s.ref.page)).length;
  });
  // About the sheet in the preview: pages of a set can each be at their own size and scale.
  const info = $derived(
    scalesToRead
      ? { text: `Reading the drawing scale of ${scalesToRead === 1 ? "1 page" : `${scalesToRead} pages`}…`, warn: false }
      : result
        ? sizingInfo(options, result.sheets[manualMode ? 0 : sheetIndex] ?? result.sheets[0])
        : null,
  );
  const printerMarginMm = $derived(Math.max(margins.portrait.left, margins.portrait.top) / mmToPt(1));

  $effect(() => {
    const now = open;
    untrack(() => {
      if (now && !wasOpen) init();
      if (!now && wasOpen) forgetManual();
    });
    wasOpen = now;
  });

  /** Drop the manual layout and close files opened only for it. */
  function forgetManual() {
    manual = false;
    manualMode = false;
    manualLayout = null;
    const r = context?.renderer;
    const extra = resetManualLayout();
    for (const d of extra) {
      if (!context?.docs.some((x) => x.docId === d.docId)) r?.close(d.docId).catch(() => {});
    }
  }

  $effect(() => {
    // Remember everything between prints (store.ts drops range, copies and Marquee on load).
    saveSettings($state.snapshot(settings));
  });

  $effect(() => {
    if (sheetIndex >= sheetCount) sheetIndex = Math.max(0, sheetCount - 1);
  });

  async function init() {
    settings = loadSettings();
    presets = loadPresets();
    presetName = loadPresetName();
    if (presetName && !presets.some((p) => p.name === presetName)) presetName = null;
    marquee = null;
    manual = settings.sizing === "manual";
    manualMode = manual;
    if (manual) settings.sizing = "fit";
    sheetIndex = 0;
    error = null;
    notice = null;
    busy = null;
    date = formatDate(new Date());
    customScale = SCALE_PRESETS.includes(settings.scaleRatio) ? "" : String(settings.scaleRatio);
    printFeatures()
      .then((f) => {
        vectorOk = f.vector;
        if (!f.vector && settings.quality === "vector") settings.quality = "image600";
      })
      .catch(() => (vectorOk = false));
    try {
      printers = await listPrinters();
    } catch (e) {
      printers = [];
      error = errorText(e, "list the printers");
    }
    const want = settings.printer && printers.some((p) => p.name === settings.printer) ? settings.printer : null;
    settings.printer = want ?? printers.find((p) => p.isDefault)?.name ?? printers[0]?.name ?? null;
    await loadPrinter();
  }

  async function loadPrinter() {
    caps = null;
    const name = settings.printer;
    if (!name) return;
    try {
      const c = await printerCapabilities(name);
      if (settings.printer !== name) return;
      caps = c;
      // Keep the paper by id, else by name (ids differ between drivers), else the driver's.
      const byId = c.papers.find((p) => p.id === settings.paperId);
      const byName = c.papers.find((p) => p.name === settings.paperName);
      const chosen = byId ?? byName ?? c.papers.find((p) => p.id === c.defaultPaper) ?? c.papers[0] ?? null;
      settings.paperId = chosen?.id ?? null;
      settings.paperName = chosen?.name ?? null;
      if (!c.duplex) settings.duplex = "none";
      await loadMargins();
    } catch (e) {
      error = errorText(e, "read the printer's settings");
    }
  }

  async function loadMargins() {
    const name = settings.printer;
    if (!name) return;
    try {
      const [p, l] = await Promise.all([
        printerMargins(name, settings.paperId, false),
        printerMargins(name, settings.paperId, true),
      ]);
      const pt = (m: typeof p): Margins => ({ left: mmToPt(m.left), top: mmToPt(m.top), right: mmToPt(m.right), bottom: mmToPt(m.bottom) });
      if (settings.printer === name) margins = { portrait: pt(p), landscape: pt(l) };
    } catch {
      // Keep the previous margins; the driver will clip whatever it can't print.
    }
  }

  function choosePrinter(name: string) {
    settings.printer = name;
    loadPrinter();
  }

  function choosePaper(id: number) {
    settings.paperId = id;
    settings.paperName = caps?.papers.find((p) => p.id === id)?.name ?? null;
    loadMargins();
  }

  function choosePreset(name: string) {
    const p = presets.find((x) => x.name === name);
    presetName = p ? name : null;
    savePresetName(presetName);
    if (!p) return;
    const before = settings.printer;
    settings = applyPreset(settings, p);
    if (settings.printer && !printers.some((x) => x.name === settings.printer)) settings.printer = before;
    customScale = SCALE_PRESETS.includes(settings.scaleRatio) ? "" : String(settings.scaleRatio);
    if (settings.sizing === "manual") {
      settings.sizing = "fit";
      manualMode = true;
      if (!manualLayout) manual = true;
    }
    loadPrinter();
  }

  function storePreset() {
    const name = presetEditor?.name.trim();
    if (!name) return;
    const p = presetFrom(name, settings);
    presets = [...presets.filter((x) => x.name !== name), p].sort((a, b) => a.name.localeCompare(b.name));
    savePresets(presets);
    presetName = name;
    savePresetName(name);
    presetEditor = null;
  }

  function deletePreset() {
    if (!presetName) return;
    presets = presets.filter((x) => x.name !== presetName);
    savePresets(presets);
    presetName = null;
    savePresetName(null);
  }

  async function chooseMarquee() {
    if (!context) return;
    hidden = true;
    try {
      const r = await context.pickRegion();
      if (r) {
        marquee = r;
        settings.pagesMode = "marquee";
      }
    } finally {
      hidden = false;
    }
  }

  function setSizing(s: PrintSettings["sizing"]) {
    if (s === "manual") {
      manual = true;
      error = null;
      notice = null;
      return;
    }
    settings.sizing = s;
  }

  /** The driver's settings window is open, or still opening (some take several seconds). */
  let propsOpen = $state(false);

  function openPrinterProperties() {
    const p = settings.printer;
    if (!p || propsOpen) return;
    propsOpen = true;
    printerProperties(p)
      .then(() => loadPrinter())
      .catch((e) => (error = errorText(e, "open the printer's settings")))
      .finally(() => (propsOpen = false));
  }

  function setScaleText(t: string) {
    customScale = t;
    const n = parseRatio(t);
    if (n) settings.scaleRatio = n;
  }

  /** A page being printed has a drawing scale: To scale is a ratio, else a percentage. */
  const scaleKnown = $derived(!!(picked?.ok && picked.sources.some((s) => s.ref.drawingScale)));
  let customPercent = $state(false);

  function setPercentText(t: string) {
    const n = parseFloat(t);
    if (n > 0 && isFinite(n)) settings.scalePercent = Math.min(1000, Math.max(1, n));
  }

  const qualityLabel = (q: PrintSettings["quality"]) =>
    q === "vector" ? "Vector" : q === "image300" ? "Image 300 dpi" : "Image 600 dpi";

  const arrangementSummary = $derived(
    [
      `${settings.nUp} per sheet`,
      settings.centre ? "centred" : null,
      settings.borders ? "borders" : null,
      settings.stamp ? "stamp" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  const outputSummary = $derived(
    [
      settings.duplex === "none" ? "single-sided" : "two-sided",
      settings.reverse ? "reversed" : null,
      settings.trayBySize ? "tray by page size" : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  // ---- Printing and saving ----

  async function run(job: Job, mode: "print" | "pdf") {
    if (busy) return;
    error = null;
    notice = null;
    let path: string | null = null;
    if (mode === "pdf") {
      const p = await saveDialog({
        defaultPath: `${stem(title || "Vellum")} print.pdf`,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      }).catch((e) => {
        error = errorText(e, "choose where to save");
        return null;
      });
      if (!p) return;
      path = p;
    } else if (!settings.printer) {
      error = "No printers found.";
      return;
    }
    busy = { label: "Preparing…", done: 0, total: job.sheets.length };
    let jobId: number | null = null;
    try {
      const c = await composeJob(job);
      jobId = c.jobId;
      if (mode === "pdf" && path) {
        busy = { label: "Saving…", done: 0, total: c.sheets };
        await savePdf(c.jobId, path, { colour: settings.colour, blackSensitivity: settings.blackSensitivity, dpi: printDpi });
        notice = `Saved ${c.sheets} ${c.sheets === 1 ? "sheet" : "sheets"}.`;
        busy = null;
        return;
      }
      busy = { label: "Printing", done: 0, total: c.sheets };
      await sendJob(
        c.jobId,
        {
          printer: settings.printer!,
          copies: settings.copies,
          collate: settings.collate,
          duplex: settings.duplex,
          colour: settings.colour,
          blackSensitivity: settings.blackSensitivity,
          quality: settings.quality,
          paper: settings.paperId,
          trayBySize: settings.trayBySize,
          reverse: settings.reverse,
          title: title ? `${title} - Vellum` : "Vellum",
        },
        (done, total) => (busy = { label: "Printing", done, total }),
      );
      busy = null;
      onClose();
    } catch (e) {
      // Stopping isn't a failure: say so in the normal colour.
      if (hasCode(e, "cancelled")) notice = mode === "pdf" ? "Saving cancelled." : "Printing cancelled.";
      else {
        console.warn("print failed:", errorString(e));
        error = errorText(e, mode === "pdf" ? "save the PDF" : "print");
      }
      busy = null;
    } finally {
      if (jobId !== null) releaseJob(jobId);
    }
  }

  function close() {
    if (busy) {
      cancelPrinting();
      return;
    }
    manual = false;
    onClose();
  }

  function onKey(e: KeyboardEvent) {
    if (!open || hidden || manual) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  // ---- Preview ----

  let stage = $state<HTMLDivElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let stageSize = $state({ w: 600, h: 600 });
  let frame = 0;
  let painter: SheetPainter | null = null;

  $effect(() => {
    if (!stage) return;
    const ro = new ResizeObserver(() => {
      if (stage) stageSize = { w: stage.clientWidth, h: stage.clientHeight };
    });
    ro.observe(stage);
    return () => ro.disconnect();
  });

  $effect(() => {
    const r = context?.renderer;
    if (!r) return;
    painter = new SheetPainter(r, schedule);
    return () => {
      painter?.dispose();
      painter = null;
    };
  });

  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  $effect(() => {
    // Repaint when the layout, the sheet shown, the stage size or the colour mode change.
    void shown;
    void sheetIndex;
    void stageSize;
    void settings.colour;
    void settings.blackSensitivity;
    void zoomed;
    void open;
    void manual;
    tick().then(schedule);
  });

  // The preview fills the stage and shows the sheet fitted, or zoomed in: the wheel zooms at
  // the pointer, a drag moves it, a double-click fits it again. `zoomed` is the view in CSS px
  // per sheet point while zoomed, null while fitted; a new sheet or layout goes back to fit.
  let zoomed = $state<View | null>(null);
  let previewDrag: { pointer: number; x: number; y: number } | null = null;
  const fitView = $derived.by(() => {
    const sheet = shown?.job.sheets[sheetIndex];
    return sheet ? fitRect({ x: 0, y: 0, w: sheet.w, h: sheet.h }, stageSize.w, stageSize.h, 28, "page") : null;
  });
  const preview = $derived(fitView ? (zoomed ?? fitView) : null);
  /** Which sheet is shown, and its size: a change goes back to fit (a settings tweak doesn't). */
  const sheetKey = $derived.by(() => {
    const s = shown?.job.sheets[sheetIndex];
    return s ? `${sheetIndex}:${Math.round(s.w)}x${Math.round(s.h)}` : "";
  });
  $effect(() => {
    void sheetKey;
    zoomed = null;
  });

  /** The resolution the sheet is printed at (Black lines is never sent as vector). */
  const printDpi = $derived(settings.quality === "image300" ? 300 : 600);
  /** The zoom where one screen dot is one printed dot (CSS px per sheet point). */
  const printDotScale = () => printDpi / 72 / (window.devicePixelRatio || 1);

  function onPreviewWheel(e: WheelEvent) {
    const fit = fitView;
    if (!fit || !preview || !canvas) return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const v = zoomBy(preview, e.clientX - r.left, e.clientY - r.top, wheelZoomFactor(e.deltaY, e.deltaMode));
    // No smaller than fitted; up to twice print resolution (or 24 times fitted, if more).
    const max = Math.max(fit.scale * 24, printDotScale() * 2);
    zoomed = v.scale <= fit.scale * 1.001 ? null : v.scale > max ? preview : v;
  }

  /** Zoom the preview so one screen dot is one printed dot, about the middle of the view. */
  function zoomToPrintDots() {
    if (!preview) return;
    zoomed = zoomAt(preview, stageSize.w / 2, stageSize.h / 2, printDotScale());
  }

  function onPreviewDown(e: PointerEvent) {
    if (!zoomed || (e.button !== 0 && e.button !== 1)) return;
    e.preventDefault();
    previewDrag = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPreviewMove(e: PointerEvent) {
    const d = previewDrag;
    if (!d || e.pointerId !== d.pointer || !zoomed) return;
    zoomed = panBy(zoomed, e.clientX - d.x, e.clientY - d.y);
    previewDrag = { ...d, x: e.clientX, y: e.clientY };
  }

  function onPreviewUp(e: PointerEvent) {
    if (previewDrag?.pointer === e.pointerId) previewDrag = null;
  }

  function paint() {
    const sheet = shown?.job.sheets[sheetIndex];
    const meta = shown?.sheets[sheetIndex];
    const view = preview;
    if (!canvas || !sheet || !meta || !view || !painter) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(stageSize.w * dpr));
    const H = Math.max(1, Math.round(stageSize.h * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const v = { k: view.scale * dpr, ox: view.tx * dpr, oy: view.ty * dpr };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // The sheet, with a shadow, like paper on the desk.
    const sx = v.ox;
    const sy = v.oy;
    const sw = sheet.w * v.k;
    const sh = sheet.h * v.k;
    ctx.save();
    ctx.shadowColor = getComputedStyle(document.documentElement).getPropertyValue("--shadow").trim() || "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 24 * dpr;
    ctx.shadowOffsetY = 6 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(sx, sy, sw, sh);
    ctx.restore();
    // Only what's on screen is rendered, sharp for the zoom.
    const [wx0, wy0] = screenToWorld(view, 0, 0);
    const [wx1, wy1] = screenToWorld(view, stageSize.w, stageSize.h);
    const onScreen = { x0: Math.max(0, wx0), y0: Math.max(0, wy0), x1: Math.min(sheet.w, wx1), y1: Math.min(sheet.h, wy1) };
    const clip = sheet.clip
      ? { x0: Math.max(sheet.clip.x0, onScreen.x0), y0: Math.max(sheet.clip.y0, onScreen.y0), x1: Math.min(sheet.clip.x1, onScreen.x1), y1: Math.min(sheet.clip.y1, onScreen.y1) }
      : onScreen;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, sw, sh);
    ctx.clip();
    for (const it of sheet.items) {
      const mi = asItem(it);
      if (clip.x1 > clip.x0 && clip.y1 > clip.y0) painter.want(mi, clip, v.k);
      painter.drawItem(ctx, mi, v, sheet.clip);
    }
    drawLines(ctx, sheet.lines, v);
    drawTexts(ctx, sheet.texts, v);
    ctx.restore();
    const cx0 = Math.max(0, Math.floor(sx));
    const cy0 = Math.max(0, Math.floor(sy));
    const cx1 = Math.min(W, Math.ceil(sx + sw));
    const cy1 = Math.min(H, Math.ceil(sy + sh));
    // Each placed page, clipped as printed, in canvas px: Black lines works page by page.
    const pages = sheet.items.flatMap((it) => {
      const b0 = itemBox(asItem(it));
      const b = sheet.clip ? intersect(b0, sheet.clip) : b0;
      return b ? [{ x0: sx + b.x0 * v.k, y0: sy + b.y0 * v.k, x1: sx + b.x1 * v.k, y1: sy + b.y1 * v.k }] : [];
    });
    applyColourPreview(ctx, cx0, cy0, cx1 - cx0, cy1 - cy0, settings.colour, settings.blackSensitivity, v.k, pages);
    const a = meta.area;
    ctx.save();
    ctx.strokeStyle = printMargin();
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeRect(sx + a.x0 * v.k + 0.5, sy + a.y0 * v.k + 0.5, (a.x1 - a.x0) * v.k - 1, (a.y1 - a.y0) * v.k - 1);
    ctx.restore();
  }

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
  });

  const sheetLabel = $derived.by(() => {
    const m = shown?.sheets[sheetIndex];
    if (!m) return "";
    const tile = m.tile && sheetCount > 1 ? ` · tile ${m.tile}` : "";
    return `Sheet ${sheetIndex + 1} of ${sheetCount} · ${describeSize(m.size)}${tile}`;
  });

  const pagesAll = $derived(doc ? `All ${doc.info.numPages}` : "All");
  const fitLabel = $derived(
    settings.marginMode === "printer"
      ? `Printable area (driver: ${printerMarginMm.toFixed(1)} mm margins)`
      : "Printable area",
  );
</script>

<svelte:window onkeydown={onKey} />

{#snippet seg<T extends string>(items: [T, string][], value: T, set: (v: T) => void, label: string)}
  <div class="seg" role="group" aria-label={label}>
    {#each items as [v, text] (v)}
      <button type="button" aria-pressed={value === v} class:on={value === v} onclick={() => set(v)}>{text}</button>
    {/each}
  </div>
{/snippet}

{#snippet chevron(isOpen: boolean)}
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style:transform={isOpen ? "rotate(90deg)" : "none"}>
    <path d="M4 2.5L7.5 6 4 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
{/snippet}

{#if open && context}
  <div class="backdrop" class:hidden role="presentation">
    {#if manual}
      <ManualLayout
        {context}
        {settings}
        {paper}
        papers={caps?.papers ?? []}
        {margins}
        printerName={settings.printer}
        {busy}
        {error}
        {notice}
        initialSources={picked?.ok ? picked.sources : []}
        onBack={() => { manualLayout = keptManualLayout(); manualMode = true; manual = false; error = null; notice = null; }}
        onClose={close}
        onRun={run}
      />
    {:else}
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Print" use:floating={PRINT_BOX}>
        <header>
          <span class="title">Print{title ? `: ${title}` : ""}</span>
          <CloseButton onclick={close} />
        </header>

        <div class="body">
          <div class="options">
            <div class="preset">
              <label for="pr-preset">Preset</label>
              <select id="pr-preset" value={presetName ?? ""} onchange={(e) => choosePreset(e.currentTarget.value)}>
                <option value="">{presets.length ? "None" : "No presets saved"}</option>
                {#each presets as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
              </select>
              <button type="button" class="icon boxed" aria-label="Save as new preset" title="Save as new preset" onclick={() => (presetEditor = { name: presetName ?? "" })}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 2.5h7l2 2v7h-9z M4.5 2.5v3h4v-3 M4.5 11.5v-3h5v3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
              </button>
            </div>
            {#if presetEditor}
              <div class="preset-editor">
                <input
                  aria-label="Preset name"
                  placeholder="Preset name"
                  bind:value={presetEditor.name}
                  onkeydown={(e) => {
                    if (e.key === "Enter") storePreset();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      presetEditor = null;
                    }
                  }}
                />
                <button type="button" class="btn" disabled={!presetEditor.name.trim()} onclick={storePreset}>
                  {presets.some((p) => p.name === presetEditor?.name.trim()) ? "Replace" : "Save"}
                </button>
                {#if presetName}<button type="button" class="btn ghost" onclick={deletePreset}>Delete "{presetName}"</button>{/if}
                <button type="button" class="btn ghost" onclick={() => (presetEditor = null)}>Cancel</button>
              </div>
            {/if}

            <div class="main">
              <div class="row">
                <label for="pr-printer">Printer</label>
                <select id="pr-printer" value={settings.printer ?? ""} onchange={(e) => choosePrinter(e.currentTarget.value)} disabled={!printers.length}>
                  {#if !printers.length}<option value="">No printers found</option>{/if}
                  {#each printers as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
                </select>
              </div>

              <div class="row">
                <label for="pr-copies">Copies</label>
                <div class="pair">
                  <input
                    id="pr-copies"
                    class="num"
                    inputmode="numeric"
                    value={settings.copies}
                    onchange={(e) => (settings.copies = Math.min(999, Math.max(1, parseInt(e.currentTarget.value, 10) || 1)))}
                  />
                  <label class="check" title="Print each copy complete before the next"><input type="checkbox" bind:checked={settings.collate} disabled={settings.copies < 2} /><span>Collate</span></label>
                </div>
              </div>

              {#if !manualMode}
              <div class="row">
                <label for="pr-paper">Paper</label>
                <div class="pair">
                  <select id="pr-paper" value={String(settings.paperId ?? "")} onchange={(e) => choosePaper(Number(e.currentTarget.value))} disabled={!caps}>
                    {#if !caps}<option value="">A4</option>{/if}
                    {#each paperGroups.a as p (p.id + p.name)}
                      <option value={String(p.id)}>{p.name} ({Math.round(p.w)} × {Math.round(p.h)} mm)</option>
                    {/each}
                    {#if paperGroups.other.length}
                      <optgroup label="Other sizes">
                        {#each paperGroups.other as p (p.id + p.name)}
                          <option value={String(p.id)}>{p.name} ({Math.round(p.w)} × {Math.round(p.h)} mm)</option>
                        {/each}
                      </optgroup>
                    {/if}
                  </select>
                  <select
                    aria-label="Orientation"
                    class="orient"
                    value={settings.autoRotate ? "auto" : settings.landscape ? "landscape" : "portrait"}
                    onchange={(e) => {
                      const v = e.currentTarget.value;
                      settings.autoRotate = v === "auto";
                      if (v !== "auto") settings.landscape = v === "landscape";
                    }}
                  >
                    <option value="auto">Auto-rotate</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              </div>

              <div class="group">
                <span class="head">Pages</span>
                {@render seg(
                  [["all", pagesAll], ["current", "Current"], ["range", "Range"], ["view", "On screen"], ["marquee", "Area"]],
                  settings.pagesMode,
                  (v) => (v === "marquee" ? chooseMarquee() : (settings.pagesMode = v)),
                  "Pages",
                )}
                {#if settings.pagesMode === "range"}
                  <input class="wide" aria-label="Page range" placeholder="1-3, 7" bind:value={settings.range} />
                {/if}
                {#if settings.pagesMode === "marquee" && marquee}
                  <button type="button" class="link" onclick={chooseMarquee}>Drag a new area</button>
                {/if}
                {#if picked && !picked.ok}<span class="warn">{picked.error}</span>{/if}
              </div>

              {/if}

              <div class="group">
                <span class="head">Layout</span>
                {@render seg(
                  [["auto", "Automatic"], ["manual", "Manual"]],
                  manualMode ? "manual" : "auto",
                  chooseLayoutMode,
                  "Layout",
                )}
                {#if manualMode}
                  <div class="manual-sum">
                    <span>{manualSummary}</span>
                    <button type="button" class="btn small" onclick={() => (manual = true)}>Edit layout…</button>
                  </div>
                {/if}
              </div>

              {#if !manualMode}
              <div class="group">
                <span class="head">Sizing</span>
                {@render seg(
                  [["fit", "Fit"], ["actual", "Actual"], ["scale", "To scale"], ["tile", "Tile"]],
                  settings.sizing,
                  setSizing,
                  "Sizing",
                )}
                {#if settings.sizing === "fit"}
                  <div class="row">
                    <label for="pr-fitto">Fit to</label>
                    <select id="pr-fitto" bind:value={settings.fitTo}>
                      <option value="printable">{fitLabel}</option>
                      <option value="paper">Full paper</option>
                    </select>
                  </div>
                {:else if settings.sizing === "scale" && !scaleKnown}
                  <div class="row">
                    <label for="pr-scale">Scale</label>
                    <div class="pair">
                      <select
                        id="pr-scale"
                        value={customPercent || !PERCENT_PRESETS.includes(settings.scalePercent) ? "custom" : String(settings.scalePercent)}
                        onchange={(e) => {
                          const v = e.currentTarget.value;
                          customPercent = v === "custom";
                          if (v !== "custom") settings.scalePercent = Number(v);
                        }}
                      >
                        {#each PERCENT_PRESETS as n (n)}<option value={String(n)}>{n}%</option>{/each}
                        <option value="custom">Custom…</option>
                      </select>
                      {#if customPercent || !PERCENT_PRESETS.includes(settings.scalePercent)}
                        <input class="num mono" aria-label="Custom percentage" value={settings.scalePercent} onchange={(e) => setPercentText(e.currentTarget.value)} /><span class="muted">%</span>
                      {/if}
                    </div>
                  </div>
                {:else if settings.sizing === "scale"}
                  <div class="row">
                    <label for="pr-scale">Scale</label>
                    <div class="pair">
                      <select
                        id="pr-scale"
                        value={customScale ? "custom" : String(settings.scaleRatio)}
                        onchange={(e) => {
                          const v = e.currentTarget.value;
                          if (v === "custom") customScale = String(settings.scaleRatio);
                          else {
                            customScale = "";
                            settings.scaleRatio = Number(v);
                          }
                        }}
                      >
                        {#each SCALE_PRESETS as n (n)}<option value={String(n)}>{fmtRatio(n)}</option>{/each}
                        <option value="custom">Custom…</option>
                      </select>
                      {#if customScale}
                        <input class="num mono" aria-label="Custom scale" value={`1:${customScale}`} onchange={(e) => setScaleText(e.currentTarget.value)} />
                      {/if}
                    </div>
                  </div>
                {:else if settings.sizing === "tile"}
                  <div class="row">
                    <label for="pr-overlap">Overlap</label>
                    <div class="pair">
                      <input
                        id="pr-overlap"
                        class="num mono"
                        value={settings.tileOverlapMm}
                        onchange={(e) => (settings.tileOverlapMm = Math.min(100, Math.max(0, parseFloat(e.currentTarget.value) || 0)))}
                      />
                      <span class="muted">mm, with cut marks. Tiles print at 100%.</span>
                    </div>
                  </div>
                {/if}
                <div class="row">
                  <label for="pr-margins">Margins</label>
                  <div class="pair">
                    <select id="pr-margins" value={marginChoice} onchange={(e) => chooseMarginChoice(e.currentTarget.value)}>
                      <option value="printer">Printer minimum</option>
                      <option value="none">None</option>
                      {#each MARGIN_PRESETS as m (m)}<option value={String(m)}>{m} mm</option>{/each}
                      <option value="custom">Custom…</option>
                    </select>
                    {#if marginChoice === "custom"}
                      <input
                        class="num mono"
                        aria-label="Margin in millimetres"
                        value={settings.customMarginMm}
                        onchange={(e) => (settings.customMarginMm = Math.min(100, Math.max(0, parseFloat(e.currentTarget.value) || 0)))}
                      /><span class="muted">mm</span>
                    {/if}
                  </div>
                </div>
                {#if settings.sizing === "fit"}
                  <!-- Fit only: in Actual and To scale, shrinking a page would undo the point of them. -->
                  <div class="row">
                    <span></span>
                    <label class="check" title="Pages already small enough print at 100%; only bigger ones are fitted">
                      <input type="checkbox" bind:checked={settings.shrinkOversized} /><span>Never enlarge small pages</span>
                    </label>
                  </div>
                {/if}
                {#if info}
                  <div class="info" class:warn={info.warn}>
                    {#if info.warn}
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="Warning"><path d="M8 2L14.5 13.5H1.5Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /><path d="M8 6.5v3.2M8 11.6v0.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                    {:else}
                      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M8 7v4M8 4.8v0.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                    {/if}
                    <span>{info.text}</span>
                  </div>
                {/if}
              </div>

              {/if}

              <div class="group">
                <span class="head">Colour</span>
                {@render seg(
                  [["colour", "Colour"], ["greyscale", "Greyscale"], ["blackLines", "Black lines"]],
                  settings.colour,
                  (v) => (settings.colour = v),
                  "Colour",
                )}
                {#if settings.colour === "blackLines"}
                  <div class="threshold">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      bind:value={settings.blackSensitivity}
                      aria-label="How faint a line still prints"
                      title="Lines print black and the paper white, each judged against the paper around it. Left keeps only bold lines; right picks up faint ones (and more grain)."
                    />
                    <div class="ends"><span>Bold lines only</span><span>Faint lines too</span></div>
                    <div class="exact">
                      <span>Preview is exact only at 1:1</span>
                      <button
                        type="button"
                        class="btn small"
                        disabled={!preview}
                        title="Zoom the preview to one screen pixel per printed dot"
                        onclick={zoomToPrintDots}
                      >View 1:1 at {printDpi} dpi</button>
                    </div>
                  </div>
                {/if}
              </div>
            </div>

            <div class="sections">
              <button type="button" class="sec" aria-expanded={sections.arrangement} onclick={() => (sections.arrangement = !sections.arrangement)}>
                {@render chevron(sections.arrangement)}<span class="name">Arrangement</span><span class="sum">{arrangementSummary}</span>
              </button>
              {#if sections.arrangement}
                <div class="grid">
                  {#if !manualMode}
                  <label for="pr-nup">Pages per sheet</label>
                  <div class="pair">
                    <select id="pr-nup" value={String(settings.nUp)} onchange={(e) => (settings.nUp = Number(e.currentTarget.value) as PrintSettings["nUp"])} disabled={settings.sizing === "tile"}>
                      {#each N_UP as n (n)}<option value={String(n)}>{n}</option>{/each}
                    </select>
                    <select aria-label="Page order" bind:value={settings.order} disabled={settings.nUp === 1 || settings.sizing === "tile"}>
                      <option value="across">Across, then down</option>
                      <option value="down">Down, then across</option>
                    </select>
                  </div>
                  <span class="lbl">Placement</span>
                  <label class="check"><input type="checkbox" bind:checked={settings.centre} /><span>Centre on sheet</span></label>
                  {/if}
                  <span class="lbl top">Marks</span>
                  <div class="checks col">
                    {#if !manualMode}
                      <label><input type="checkbox" bind:checked={settings.borders} /><span>Page borders</span></label>
                    {/if}
                    <label title="File name, page and date, printed small in the margin"><input type="checkbox" bind:checked={settings.stamp} /><span>Margin stamp</span></label>
                  </div>
                </div>
              {/if}

              <button type="button" class="sec" aria-expanded={sections.output} onclick={() => (sections.output = !sections.output)}>
                {@render chevron(sections.output)}<span class="name">Output</span><span class="sum">{outputSummary}</span>
              </button>
              {#if sections.output}
                <div class="grid">
                  {#if caps?.duplex}
                    <label for="pr-duplex">Two-sided</label>
                    <select id="pr-duplex" bind:value={settings.duplex}>
                      <option value="none">Off</option>
                      <option value="longEdge">Flip on long edge</option>
                      <option value="shortEdge">Flip on short edge</option>
                    </select>
                  {/if}
                  <span class="lbl">Order</span>
                  <label class="check"><input type="checkbox" bind:checked={settings.reverse} /><span>Reverse order</span></label>
                  <span class="lbl">Paper tray</span>
                  <label class="check"><input type="checkbox" bind:checked={settings.trayBySize} /><span>Choose by PDF page size</span></label>
                </div>
              {/if}

              <button type="button" class="sec" aria-expanded={sections.advanced} onclick={() => (sections.advanced = !sections.advanced)}>
                {@render chevron(sections.advanced)}<span class="name">Advanced</span><span class="sum">{qualityLabel(settings.quality)}</span>
              </button>
              {#if sections.advanced}
                <div class="grid">
                  <label for="pr-mode">Send as</label>
                  <select id="pr-mode" bind:value={settings.quality}>
                    {#if vectorOk}<option value="vector">Vector (smallest job)</option>{/if}
                    <option value="image600">Image, 600 dpi</option>
                    <option value="image300">Image, 300 dpi (driver workaround)</option>
                  </select>
                  {#if settings.quality === "vector" && settings.colour === "blackLines"}
                    <span></span><span class="note">Black lines always prints as an image, at 600 dpi.</span>
                  {/if}
                  <span class="lbl">Driver</span>
                  <button
                    type="button"
                    class="btn small"
                    disabled={!settings.printer || propsOpen}
                    title={propsOpen ? "Waiting for the printer's own settings window (some drivers take a while to open it)" : undefined}
                    onclick={openPrinterProperties}
                  >{propsOpen ? "Opening printer settings…" : "Printer properties…"}</button>
                </div>
              {/if}
            </div>
          </div>

          <div class="preview">
            <div class="stage" bind:this={stage}>
              {#if preview}
                <canvas
                  bind:this={canvas}
                  class:zoomed={!!zoomed}
                  style:width="{stageSize.w}px"
                  style:height="{stageSize.h}px"
                  aria-label="Print preview"
                  title={zoomed ? "Drag to move; double-click to fit" : "Wheel to zoom in"}
                  onwheel={onPreviewWheel}
                  onpointerdown={onPreviewDown}
                  onpointermove={onPreviewMove}
                  onpointerup={onPreviewUp}
                  onpointercancel={onPreviewUp}
                  onauxclick={(e) => e.preventDefault()}
                  ondblclick={() => (zoomed = null)}
                ></canvas>
              {:else}
                <p class="empty">{manualMode ? "No pages arranged yet: Edit layout… to add some" : picked && !picked.ok ? picked.error : "Nothing to print"}</p>
              {/if}
            </div>
            <div class="nav">
              <button type="button" class="icon" aria-label="Previous sheet" disabled={sheetIndex <= 0} onclick={() => (sheetIndex = Math.max(0, sheetIndex - 1))}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 3L4.5 7l4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <span>{sheetLabel || "No sheets"}</span>
              <button type="button" class="icon" aria-label="Next sheet" disabled={sheetIndex >= sheetCount - 1} onclick={() => (sheetIndex = Math.min(sheetCount - 1, sheetIndex + 1))}>
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5.5 3l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </button>
              <span class="sep"></span>
              <span class="legend"><span class="dash"></span>Printable area</span>
            </div>
          </div>
        </div>

        <footer>
          <button type="button" class="btn" disabled={!shown?.job.sheets.length || !!busy || scalesToRead > 0} onclick={() => shown && run(shown.job, "pdf")}>Save as PDF…</button>
          <button type="button" class="btn ghost" onclick={() => (presetEditor = { name: presetName ?? "" })}>Save preset…</button>
          <div class="status" role="status">
            {#if busy}
              {busy.label}{busy.total && busy.label === "Printing" ? ` sheet ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…` : ""}
            {:else if error}<span class="err">{error}</span>
            {:else if notice}{notice}
            {:else if sheetCount}{sheetCount} {sheetCount === 1 ? "sheet" : "sheets"}{/if}
          </div>
          <button type="button" class="btn" onclick={close}>{busy ? "Stop" : "Cancel"}</button>
          <button type="button" class="btn primary" disabled={!shown?.job.sheets.length || !!busy || !settings.printer || scalesToRead > 0} onclick={() => shown && run(shown.job, "print")}>Print</button>
        </footer>
      </div>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-print);
    display: grid;
    place-items: center;
    background: var(--scrim);
  }
  .backdrop.hidden {
    display: none;
  }
  .dialog {
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
    justify-content: space-between;
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--bd);
    background: var(--chrome);
  }
  .title {
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
  }
  .options {
    width: 430px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--bd);
    overflow-y: auto;
  }
  .options > * {
    flex-shrink: 0; /* a short window scrolls the panel, never squashes its sections */
  }
  .preset {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--bd);
    background: var(--chrome);
  }
  .preset label {
    color: var(--tx2);
    width: 70px;
    flex-shrink: 0;
  }
  .preset select {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
  }
  .preset-editor {
    display: flex;
    gap: 6px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--bd);
    background: var(--chrome);
    flex-wrap: wrap;
  }
  .preset-editor input {
    flex: 1 1 140px;
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px 20px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .threshold {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
  }
  .threshold input[type="range"] {
    width: 100%;
    margin: 0;
    padding: 0;
    accent-color: var(--accent);
  }
  .threshold .ends {
    display: flex;
    justify-content: space-between;
  }
  .threshold .exact {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    color: var(--tx3);
    font-size: 12px;
  }
  .threshold .ends,
  .note {
    color: var(--tx3);
    font-size: 12px;
  }
  .head {
    font-weight: 600;
  }
  /* One label column for the whole panel: these rows and the sections' grids line up. */
  .row {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
  }
  .row label {
    color: var(--tx2);
  }
  .pair {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }
  .pair select {
    flex: 1 1 auto;
    min-width: 0;
  }
  /* Segments use the shared look (app.css .seg); here they share the width evenly and are
     the compact fields' height (24 px), so every control in the panel lines up. */
  .seg {
    padding: 1px;
    border-radius: 5px;
  }
  .seg > button {
    flex: 1 1 0;
    height: 20px;
    padding: 0 4px;
    border-radius: 4px;
  }
  .pair select.orient {
    flex: 0 0 auto;
    width: 120px;
  }
  .info {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    color: var(--tx3);
    font-size: 12px;
    line-height: 16px;
  }
  .info.warn {
    color: var(--danger);
  }
  .manual-sum {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--tx2);
  }
  /* Small buttons in the settings panel are the compact fields' height too. */
  .main .btn.small,
  .grid .btn.small {
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
  }
  .info svg {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .warn {
    color: var(--danger, #e5484d);
  }
  .link {
    align-self: flex-start;
  }
  .sections {
    display: flex;
    flex-direction: column;
    border-top: 1px solid var(--bd);
  }
  .sec {
    height: 42px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 20px;
    border: none;
    border-bottom: 1px solid var(--bd);
    background: transparent;
    text-align: left;
    color: var(--tx);
  }
  .sec:hover {
    background: var(--hover);
  }
  .sec:active {
    background: var(--press-soft);
  }
  .sec .name {
    font-weight: 600;
    flex-shrink: 0;
    margin-right: 4px;
  }
  .sec .sum {
    color: var(--tx3);
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grid {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 12px 20px 14px;
    border-bottom: 1px solid var(--bd);
  }
  .grid > label,
  .lbl {
    color: var(--tx2);
  }
  /* A label for a column of checkboxes sits level with the first, not the middle. */
  .lbl.top {
    align-self: start;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
  }
  .checks.col {
    flex-direction: column;
  }
  .checks label,
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
  /* Every field here is in the side panel: compact, the page box's tighter size. */
  select,
  input:not([type="checkbox"]):not([type="range"]) {
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
  input.num {
    width: 56px;
  }
  input.wide {
    width: 100%;
  }
  .mono {
    font-family: var(--font-num, "JetBrains Mono", monospace);
    font-size: 12px;
  }
  input.num.mono {
    width: 76px;
  }
  .muted {
    color: var(--tx3);
  }
  .preview {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--canvas);
  }
  .stage {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .stage canvas {
    display: block;
  }
  .stage canvas.zoomed {
    cursor: grab;
  }
  .stage canvas.zoomed:active {
    cursor: grabbing;
  }
  .empty {
    color: var(--tx3);
  }
  .nav {
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--tx2);
    border-top: 1px solid var(--bd);
  }
  .sep {
    width: 1px;
    height: 16px;
    background: var(--bd-strong);
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--tx3);
  }
  .dash {
    width: 14px;
    border-top: 1.5px dashed var(--print-margin);
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
  .icon:hover:not(:disabled) {
    background: var(--hover);
    color: var(--tx);
  }
  .icon:active:not(:disabled) {
    background: var(--press-soft);
  }
  .icon.boxed {
    width: 28px;
    height: 24px;
    border: 1px solid var(--bd-input);
    border-radius: 4px;
    background: var(--ctl);
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
    flex: 1 1 auto;
    text-align: right;
    color: var(--tx3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .err {
    color: var(--danger, #e5484d);
  }
  /* Buttons use the shared .btn (app.css); only the small one's placement is local. */
  .btn.small {
    justify-self: start;
  }
</style>
