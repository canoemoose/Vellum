<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import TopBar from "./lib/components/TopBar.svelte";
  import DebugOverlay from "./lib/components/DebugOverlay.svelte";
  import { Viewer, type UiState, type NavMode } from "./lib/engine/viewer";
  import { attachInput } from "./lib/engine/input";
  import { createRenderer } from "./lib/render/createRenderer";
  import { loadSettings, saveSettings } from "./lib/settings";
  import { appendPerfLog, jsHeapMb, launchArgs, memoryStats, pickPdf } from "./lib/platform";
  import { runBench } from "./lib/perf/bench";
  import type { LayoutMode } from "./lib/view/layout";

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let viewer = $state<Viewer | null>(null);
  let debug = $state(false);
  let dropping = $state(false);
  let ui = $state<UiState>({
    fileName: "",
    page: 0,
    numPages: 0,
    zoom: 1,
    layoutMode: "continuous",
    navMode: "cad",
    loading: false,
    error: null,
  });

  const settings = loadSettings();

  async function openPath(path: string) {
    if (!viewer) return;
    try {
      await viewer.open(path);
      getCurrentWindow().setTitle(`${viewer.fileName} - Vellum`).catch(() => {});
    } catch (e) {
      console.error("open failed", e);
    }
  }

  async function openDialog() {
    const p = await pickPdf();
    if (p) await openPath(p);
  }

  function setLayout(m: LayoutMode) {
    viewer?.setLayoutMode(m);
    settings.layoutMode = m;
    saveSettings(settings);
  }

  function setNav(m: NavMode) {
    viewer?.setNavMode(m);
    settings.navMode = m;
    saveSettings(settings);
  }

  onMount(() => {
    let detachInput = () => {};
    let unlistenDrop: (() => void) | null = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      const args = await launchArgs();
      const renderer = await createRenderer(args.renderer);
      const v = new Viewer(canvas, renderer);
      v.navMode = settings.navMode;
      v.layoutMode = settings.layoutMode;
      v.onUi = (s) => (ui = s);
      viewer = v;
      ui = v.uiState();
      debug = args.debug || args.bench;

      const measure = () => {
        const r = host.getBoundingClientRect();
        v.resize(r.width, r.height, args.dpr ?? (window.devicePixelRatio || 1));
      };
      ro = new ResizeObserver(measure);
      ro.observe(host);
      measure();
      detachInput = attachInput(host, v, { open: openDialog, toggleDebug: () => (debug = !debug) });

      // Log every settle-to-sharp event while the debug overlay is up.
      v.onSharp = (e) => {
        if (!debug || args.bench) return;
        const st = v.stats();
        memoryStats()
          .then((m) =>
            appendPerfLog(
              ["time", "source", "file", "renderer", "zoom_pct", "settle_to_sharp_ms", "complete", "fps_last_second", "tiles", "cache_mb", "js_heap_mb", "process_mb"],
              [[new Date().toISOString(), "interactive", v.fileName, st.renderer, st.zoom * 100, e.settleToSharpMs, String(e.complete), st.fps, st.tiles, st.cacheMB, jsHeapMb(), m.current.privateWsMb]],
            ),
          )
          .catch(() => {});
      };

      unlistenDrop = await getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "enter" || p.type === "over") dropping = true;
        else if (p.type === "leave") dropping = false;
        else if (p.type === "drop") {
          dropping = false;
          const pdf = p.paths.find((x) => x.toLowerCase().endsWith(".pdf")) ?? p.paths[0];
          if (pdf) openPath(pdf);
        }
      });

      // Show the window only once the shell has painted, so there's no white flash.
      await getCurrentWindow().show();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const shownEpochMs = performance.timeOrigin + performance.now();

      if (args.bench) {
        await runBench(v, args, shownEpochMs);
      } else if (args.file) {
        await openPath(args.file);
      }
    })().catch((e) => {
      console.error(e);
      ui = { ...ui, error: String(e) };
      getCurrentWindow().show().catch(() => {});
    });

    return () => {
      detachInput();
      unlistenDrop?.();
      ro?.disconnect();
    };
  });
</script>

<div class="shell">
  <TopBar
    {ui}
    onOpen={openDialog}
    onFitPage={() => viewer?.fit("page")}
    onFitWidth={() => viewer?.fit("width")}
    onLayout={setLayout}
    onNav={setNav}
  />
  <div class="stage" bind:this={host}>
    <canvas bind:this={canvas}></canvas>

    {#if ui.numPages === 0 && !ui.loading}
      <div class="empty">
        {#if ui.error}
          <p class="err">Couldn't open that file: {ui.error}</p>
        {/if}
        <button class="primary" onclick={openDialog}>Open a PDF</button>
        <p>or drop one here. <span class="hint">Ctrl+O</span></p>
      </div>
    {/if}
    {#if ui.loading}
      <div class="empty"><p>Opening {ui.fileName}…</p></div>
    {/if}
    {#if dropping}
      <div class="drop">Drop to open</div>
    {/if}
    {#if debug && viewer}
      <DebugOverlay {viewer} />
    {/if}
  </div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--canvas);
    touch-action: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--tx3);
  }
  .empty p {
    margin: 0;
  }
  .err {
    color: var(--tx);
    max-width: 60ch;
    text-align: center;
  }
  .hint {
    font-family: var(--font-num);
    color: var(--tx2);
    border: 1px solid var(--bd-strong);
    border-radius: 4px;
    padding: 0 4px;
  }
  .primary {
    height: 32px;
    padding: 0 16px;
    background: var(--accent);
    border: 1px solid var(--accent-bd);
    border-radius: 6px;
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:hover {
    filter: brightness(1.08);
  }
  .drop {
    position: absolute;
    inset: 12px;
    border: 2px dashed var(--accent);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    color: var(--tx);
    background: color-mix(in srgb, var(--canvas), transparent 20%);
    pointer-events: none;
  }
</style>
