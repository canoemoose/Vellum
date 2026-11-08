<script lang="ts">
  // The print dialog (docs/mockups/Print.png, project/Print.dc.html): options on the left,
  // a live preview of the sheets on the right. The layout is the pure model in
  // src/lib/print/model; printing and Save as PDF compose it in Rust (src-tauri/src/print).
  // Sizing > Manual switches to the manual layout screen (ManualLayout.svelte).
  import { onDestroy, tick, untrack } from "svelte";
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import type { PageRect, PrintContext } from "../../print/context";
  import {
    type Capabilities, type PrinterInfo, cancelPrinting, composeJob, errorText, listPrinters, printFeatures,
    printerCapabilities, printerMargins, printerProperties, releaseJob, savePdf, sendJob,
  } from "../../print/api";
  import { type AutoOptions, autoLayout, layoutSummary, sizingInfo } from "../../print/model/auto";
  import { type Margins, type Size, describeSize, fmtRatio, isoSize, mmToPt } from "../../print/model/geom";
  import { type Job, formatDate } from "../../print/model/job";
  import {
    type Preset, type PrintSettings, N_UP, SCALE_PRESETS, applyPreset, parseRatio, presetFrom,
  } from "../../print/model/settings";
  import { SheetPainter, applyColourPreview, asItem, drawLines, drawTexts } from "../../print/painter";
  import { activeDoc, pickSources, stem } from "../../print/sources";
  import {
    loadPresetName, loadPresets, loadSettings, savePresetName, savePresets, saveSettings,
  } from "../../print/store";
  import ManualLayout, { resetManualLayout } from "./ManualLayout.svelte";

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
  let sections = $state({ layout: true, paper: false, advanced: false });
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

  const options = $derived<AutoOptions>({
    sizing: settings.sizing === "manual" ? "fit" : settings.sizing,
    fitTo: settings.fitTo,
    scaleRatio: settings.scaleRatio,
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
  const sheetCount = $derived(result?.job.sheets.length ?? 0);
  const info = $derived(result ? sizingInfo(options, result.sheets[0]) : null);
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
      error = errorText(e);
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
      error = errorText(e);
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
      manual = true;
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

  function setScaleText(t: string) {
    customScale = t;
    const n = parseRatio(t);
    if (n) settings.scaleRatio = n;
  }

  const qualityLabel = (q: PrintSettings["quality"]) =>
    q === "vector" ? "Vector" : q === "image300" ? "Image 300 dpi" : "Image 600 dpi";

  const paperSummary = $derived(
    [
      paperObj?.name ?? "Paper",
      settings.trayBySize ? "by PDF page size" : null,
      settings.duplex === "none" ? "single-sided" : "two-sided",
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
        error = errorText(e);
        return null;
      });
      if (!p) return;
      path = p;
    } else if (!settings.printer) {
      error = "No printer is installed";
      return;
    }
    busy = { label: "Preparing…", done: 0, total: job.sheets.length };
    let jobId: number | null = null;
    try {
      const c = await composeJob(job);
      jobId = c.jobId;
      if (mode === "pdf" && path) {
        busy = { label: "Saving…", done: 0, total: c.sheets };
        await savePdf(c.jobId, path);
        notice = `Saved ${c.sheets} ${c.sheets === 1 ? "sheet" : "sheets"}`;
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
          quality: settings.quality,
          paper: settings.paperId,
          trayBySize: settings.trayBySize,
          reverse: settings.reverse,
          title: title ? `Vellum - ${title}` : "Vellum",
        },
        (done, total) => (busy = { label: "Printing", done, total }),
      );
      busy = null;
      onClose();
    } catch (e) {
      error = errorText(e);
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
    void result;
    void sheetIndex;
    void stageSize;
    void settings.colour;
    void open;
    void manual;
    tick().then(schedule);
  });

  const preview = $derived.by(() => {
    const sheet = result?.job.sheets[sheetIndex];
    if (!sheet) return null;
    const pad = 28;
    const k = Math.max(0.01, Math.min((stageSize.w - 2 * pad) / sheet.w, (stageSize.h - 2 * pad) / sheet.h));
    return { k, w: Math.round(sheet.w * k), h: Math.round(sheet.h * k) };
  });

  function paint() {
    const sheet = result?.job.sheets[sheetIndex];
    const meta = result?.sheets[sheetIndex];
    const pv = preview;
    if (!canvas || !sheet || !meta || !pv || !painter) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(pv.w * dpr));
    const H = Math.max(1, Math.round(pv.h * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const v = { k: (pv.w * dpr) / sheet.w, ox: 0, oy: 0 };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    const vis = { x0: 0, y0: 0, x1: sheet.w, y1: sheet.h };
    for (const it of sheet.items) {
      const mi = asItem(it);
      painter.want(mi, sheet.clip ?? vis, v.k);
      painter.drawItem(ctx, mi, v, sheet.clip);
    }
    drawLines(ctx, sheet.lines, v);
    drawTexts(ctx, sheet.texts, v);
    applyColourPreview(ctx, 0, 0, W, H, settings.colour);
    const a = meta.area;
    ctx.save();
    ctx.strokeStyle = "#e05555";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeRect(a.x0 * v.k + 0.5, a.y0 * v.k + 0.5, (a.x1 - a.x0) * v.k - 1, (a.y1 - a.y0) * v.k - 1);
    ctx.restore();
  }

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
  });

  const sheetLabel = $derived.by(() => {
    const m = result?.sheets[sheetIndex];
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
        onBack={() => { manual = false; error = null; notice = null; }}
        onClose={close}
        onRun={run}
      />
    {:else}
      <div class="dialog" role="dialog" aria-modal="true" aria-label="Print">
        <header>
          <span class="title">Print{title ? ` — ${title}` : ""}</span>
          <button type="button" class="icon close" aria-label="Close" onclick={close}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
          </button>
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
                {#if presetName}<button type="button" class="btn plain" onclick={deletePreset}>Delete "{presetName}"</button>{/if}
                <button type="button" class="btn plain" onclick={() => (presetEditor = null)}>Cancel</button>
              </div>
            {/if}

            <div class="main">
              <div class="printer-row">
                <label for="pr-printer">Printer</label>
                <select id="pr-printer" value={settings.printer ?? ""} onchange={(e) => choosePrinter(e.currentTarget.value)} disabled={!printers.length}>
                  {#if !printers.length}<option value="">No printers found</option>{/if}
                  {#each printers as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
                </select>
                <label for="pr-copies" class="right">Copies</label>
                <input
                  id="pr-copies"
                  class="num"
                  inputmode="numeric"
                  value={settings.copies}
                  onchange={(e) => (settings.copies = Math.min(999, Math.max(1, parseInt(e.currentTarget.value, 10) || 1)))}
                />
              </div>

              <div class="group">
                <span class="head">Pages</span>
                {@render seg(
                  [["all", pagesAll], ["current", "Current"], ["range", "Range"], ["view", "View"], ["marquee", "Marquee"]],
                  settings.pagesMode,
                  (v) => (v === "marquee" ? chooseMarquee() : (settings.pagesMode = v)),
                  "Pages",
                )}
                {#if settings.pagesMode === "range"}
                  <input class="wide" aria-label="Page range" placeholder="1-3, 7" bind:value={settings.range} />
                {/if}
                {#if settings.pagesMode === "marquee" && marquee}
                  <button type="button" class="link" onclick={chooseMarquee}>Drag a new rectangle</button>
                {/if}
                {#if picked && !picked.ok}<span class="warn">{picked.error}</span>{/if}
              </div>

              <div class="group">
                <span class="head">Sizing</span>
                {@render seg(
                  [["fit", "Fit"], ["actual", "Actual"], ["scale", "To scale"], ["tile", "Tile"], ["manual", "Manual"]],
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
                {#if info}
                  <div class="info">
                    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M8 7v4M8 4.8v0.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
                    <span>{info}</span>
                  </div>
                {/if}
              </div>

              <div class="group">
                <span class="head">Colour</span>
                {@render seg(
                  [["colour", "Colour"], ["greyscale", "Greyscale"], ["blackLines", "Black lines"]],
                  settings.colour,
                  (v) => (settings.colour = v),
                  "Colour",
                )}
              </div>
            </div>

            <div class="sections">
              <button type="button" class="sec" aria-expanded={sections.layout} onclick={() => (sections.layout = !sections.layout)}>
                {@render chevron(sections.layout)}<span class="name">Layout</span><span class="sum">{layoutSummary(options)}</span>
              </button>
              {#if sections.layout}
                <div class="grid">
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
                  <label for="pr-margins">Margins</label>
                  <div class="pair">
                    <select id="pr-margins" bind:value={settings.marginMode}>
                      <option value="printer">Printer minimum</option>
                      <option value="none">None</option>
                      <option value="custom">Custom</option>
                    </select>
                    {#if settings.marginMode === "custom"}
                      <input
                        class="num mono"
                        aria-label="Margin in millimetres"
                        value={settings.customMarginMm}
                        onchange={(e) => (settings.customMarginMm = Math.min(100, Math.max(0, parseFloat(e.currentTarget.value) || 0)))}
                      /><span class="muted">mm</span>
                    {/if}
                  </div>
                  <span class="lbl">Placement</span>
                  <div class="checks">
                    <label><input type="checkbox" bind:checked={settings.centre} /><span>Centre on sheet</span></label>
                    <label><input type="checkbox" bind:checked={settings.autoRotate} /><span>Auto-rotate each page</span></label>
                    <label><input type="checkbox" bind:checked={settings.borders} /><span>Page borders</span></label>
                  </div>
                  <label for="pr-special">Special</label>
                  <select
                    id="pr-special"
                    value={settings.sizing === "tile" ? "tile" : "none"}
                    onchange={(e) => (settings.sizing = e.currentTarget.value === "tile" ? "tile" : settings.sizing === "tile" ? "fit" : settings.sizing)}
                  >
                    <option value="none">None</option>
                    <option value="tile">Tile with overlap and cut marks</option>
                  </select>
                  <span class="lbl">Margin stamp</span>
                  <label class="check"><input type="checkbox" bind:checked={settings.stamp} /><span>File name, page, date</span></label>
                </div>
              {/if}

              <button type="button" class="sec" aria-expanded={sections.paper} onclick={() => (sections.paper = !sections.paper)}>
                {@render chevron(sections.paper)}<span class="name">Paper</span><span class="sum">{paperSummary}</span>
              </button>
              {#if sections.paper}
                <div class="grid">
                  <label for="pr-paper">Paper size</label>
                  <select id="pr-paper" value={String(settings.paperId ?? "")} onchange={(e) => choosePaper(Number(e.currentTarget.value))} disabled={!caps}>
                    {#if !caps}<option value="">A4</option>{/if}
                    {#each caps?.papers ?? [] as p (p.id + p.name)}
                      <option value={String(p.id)}>{p.name} ({Math.round(p.w)} × {Math.round(p.h)} mm)</option>
                    {/each}
                  </select>
                  <label for="pr-orient">Orientation</label>
                  <select
                    id="pr-orient"
                    value={settings.autoRotate ? "auto" : settings.landscape ? "landscape" : "portrait"}
                    onchange={(e) => {
                      const v = e.currentTarget.value;
                      settings.autoRotate = v === "auto";
                      if (v !== "auto") settings.landscape = v === "landscape";
                    }}
                  >
                    <option value="auto">Automatic (per page)</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                  <span class="lbl">Mixed sizes</span>
                  <div class="checks col">
                    <label><input type="checkbox" bind:checked={settings.trayBySize} /><span>Choose tray by PDF page size</span></label>
                    <label><input type="checkbox" bind:checked={settings.shrinkOversized} /><span>Shrink oversized pages only</span></label>
                  </div>
                  {#if caps?.duplex}
                    <label for="pr-duplex">Two-sided</label>
                    <select id="pr-duplex" bind:value={settings.duplex}>
                      <option value="none">Off</option>
                      <option value="longEdge">Flip on long edge</option>
                      <option value="shortEdge">Flip on short edge</option>
                    </select>
                  {/if}
                  <span class="lbl">Order</span>
                  <div class="checks">
                    <label><input type="checkbox" bind:checked={settings.collate} /><span>Collate</span></label>
                    <label><input type="checkbox" bind:checked={settings.reverse} /><span>Reverse order</span></label>
                  </div>
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
                  <span class="lbl">Driver</span>
                  <button
                    type="button"
                    class="btn small"
                    disabled={!settings.printer}
                    onclick={() => settings.printer && printerProperties(settings.printer).then(() => loadPrinter()).catch((e) => (error = errorText(e)))}
                  >Printer properties…</button>
                </div>
              {/if}
            </div>
          </div>

          <div class="preview">
            <div class="stage" bind:this={stage}>
              {#if preview}
                <canvas bind:this={canvas} style:width="{preview.w}px" style:height="{preview.h}px" aria-label="Print preview"></canvas>
              {:else}
                <p class="empty">{picked && !picked.ok ? picked.error : "Nothing to print"}</p>
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
          <button type="button" class="btn" disabled={!result || !!busy} onclick={() => result && run(result.job, "pdf")}>Save as PDF…</button>
          <button type="button" class="btn plain" onclick={() => (presetEditor = { name: presetName ?? "" })}>Save preset…</button>
          <div class="status" role="status">
            {#if busy}
              {busy.label}{busy.total && busy.label === "Printing" ? ` sheet ${Math.min(busy.done + 1, busy.total)} of ${busy.total}` : ""}
            {:else if error}<span class="err">{error}</span>
            {:else if notice}{notice}
            {:else if sheetCount}{sheetCount} {sheetCount === 1 ? "sheet" : "sheets"}{/if}
          </div>
          <button type="button" class="btn" onclick={close}>{busy ? "Stop" : "Cancel"}</button>
          <button type="button" class="btn primary" disabled={!result || !!busy || !settings.printer} onclick={() => result && run(result.job, "print")}>Print</button>
        </footer>
      </div>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.45);
  }
  .backdrop.hidden {
    display: none;
  }
  .dialog {
    width: 1080px;
    height: 780px;
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
    box-shadow: 0 12px 48px var(--shadow);
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
  .printer-row {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 54px 56px;
    align-items: center;
    gap: 8px;
  }
  .printer-row label {
    color: var(--tx2);
  }
  .right {
    text-align: right;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    font-weight: 600;
  }
  .row {
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr);
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
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--ctl);
    border: 1px solid var(--bd-ctl);
    border-radius: 8px;
  }
  .seg button {
    flex: 1 1 0;
    height: 30px;
    border: none;
    background: transparent;
    color: var(--tx2);
    border-radius: 6px;
    padding: 0 4px;
    white-space: nowrap;
  }
  .seg button:hover {
    background: var(--hover, rgba(127, 127, 127, 0.1));
  }
  .seg button.on {
    background: var(--accent-soft, #e5484d2e);
    color: var(--accent, #e5484d);
    font-weight: 600;
  }
  .info {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px 10px;
    background: var(--ctl);
    border: 1px solid var(--bd-ctl);
    border-radius: 6px;
    color: var(--tx2);
    line-height: 1.4;
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
    border: none;
    background: none;
    padding: 0;
    color: var(--accent, #e5484d);
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
  .sec .name {
    font-weight: 600;
    width: 72px;
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
    padding: 12px 20px 14px 42px;
    border-bottom: 1px solid var(--bd);
  }
  .grid > label,
  .lbl {
    color: var(--tx2);
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
    accent-color: var(--accent, #e5484d);
  }
  select,
  input:not([type="checkbox"]) {
    height: 32px;
    padding: 0 8px;
    background: var(--ctl);
    border: 1px solid var(--bd-input);
    border-radius: 6px;
    color: var(--tx);
    min-width: 0;
    box-sizing: border-box;
  }
  .grid select,
  .grid input:not([type="checkbox"]),
  .pair input {
    height: 30px;
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
    background: #fff;
    box-shadow: 0 6px 24px var(--shadow);
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
    border-top: 1.5px dashed #e05555;
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
    background: var(--hover, rgba(127, 127, 127, 0.1));
  }
  .icon.close {
    width: 32px;
    height: 32px;
    color: var(--tx3);
  }
  .icon.boxed {
    width: 32px;
    height: 32px;
    border: 1px solid var(--bd-input);
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
  .btn {
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--bd-strong);
    background: var(--ctl);
    color: var(--tx);
    border-radius: 6px;
    white-space: nowrap;
  }
  .btn.small {
    height: 30px;
    padding: 0 10px;
    justify-self: start;
    border-color: var(--bd-input);
  }
  .btn.plain {
    border-color: transparent;
    background: transparent;
    color: var(--tx2);
  }
  .btn.primary {
    padding: 0 20px;
    /* Filled buttons get a visible, darker border (house rule). */
    border-color: var(--accent-bd, rgba(0, 0, 0, 0.25));
    background: var(--accent, #e5484d);
    color: #ffffff;
    font-weight: 600;
  }
  .btn:hover:not(:disabled) {
    filter: brightness(1.08);
  }
</style>
