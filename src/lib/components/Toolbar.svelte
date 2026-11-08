<script lang="ts">
  // Toolbar (48 px, wraps when narrow): sidebar toggle; page group; zoom group. The mockup's
  // markup tools, Search and Save are v0.2, so the right-hand side stays empty.
  import { ZOOM_PRESETS } from "../view/viewMath";
  import { formatZoom, parseZoom } from "../shell/format";

  interface Props {
    page: number;
    numPages: number;
    zoom: number;
    hasDoc: boolean;
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    onGotoPage: (i: number) => void;
    onPrev: () => void;
    onNext: () => void;
    onZoomStep: (dir: 1 | -1) => void;
    onZoom: (z: number) => void;
    onFit: (mode: "page" | "width") => void;
    onActual: () => void;
  }
  let p: Props = $props();

  let pageText = $state("");
  let pageEditing = $state(false);
  let zoomText = $state("");
  let zoomEditing = $state(false);
  let zoomInput: HTMLInputElement;

  $effect(() => {
    if (!pageEditing) pageText = p.numPages ? String(p.page + 1) : "";
  });
  $effect(() => {
    if (!zoomEditing) zoomText = p.hasDoc ? formatZoom(p.zoom) : "–";
  });

  function commitPage() {
    const n = parseInt(pageText, 10);
    if (Number.isFinite(n)) p.onGotoPage(Math.max(1, Math.min(p.numPages, n)) - 1);
    pageEditing = false;
  }

  function commitZoom() {
    const z = parseZoom(zoomText);
    if (z !== null) p.onZoom(z);
    zoomEditing = false;
    zoomInput.blur();
  }

  function pick(fn: () => void) {
    fn();
    zoomEditing = false;
    zoomInput.blur();
  }

  const presets = [...ZOOM_PRESETS].filter((z) => z >= 0.1 && z <= 16);
</script>

<div class="bar">
  <button
    type="button"
    class="icon-btn side"
    class:on={p.sidebarOpen}
    aria-label="Toggle sidebar"
    aria-pressed={p.sidebarOpen}
    title="Sidebar (Ctrl+B)"
    onclick={p.onToggleSidebar}
  >
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="2" y="3" width="14" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M7 3v12" stroke="currentColor" stroke-width="1.4" /></svg>
  </button>

  <div class="group">
    <button type="button" class="icon-btn" aria-label="Previous page" title="Previous page (Page Up)" disabled={!p.hasDoc || p.page <= 0} onclick={p.onPrev}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 3L4.5 7l4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
    <label for="pagebox" class="sr">Page</label>
    <input
      id="pagebox"
      class="pagebox"
      inputmode="numeric"
      autocomplete="off"
      disabled={!p.hasDoc}
      style:width="{Math.max(30, 14 + String(p.numPages).length * 8)}px"
      bind:value={pageText}
      onfocus={(e) => {
        pageEditing = true;
        (e.currentTarget as HTMLInputElement).select();
      }}
      onblur={() => (pageEditing = false)}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          commitPage();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          pageEditing = false;
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
    <span class="of">of {p.numPages || "–"}</span>
    <button type="button" class="icon-btn" aria-label="Next page" title="Next page (Page Down)" disabled={!p.hasDoc || p.page >= p.numPages - 1} onclick={p.onNext}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M5.5 3l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  </div>

  <div class="group">
    <button type="button" class="icon-btn" aria-label="Zoom out" title="Zoom out (-)" disabled={!p.hasDoc} onclick={() => p.onZoomStep(-1)}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
    <div class="zoomwrap">
      <input
        class="zoom num"
        aria-label="Zoom"
        title="Zoom: type a percentage or pick a preset"
        autocomplete="off"
        disabled={!p.hasDoc}
        bind:this={zoomInput}
        bind:value={zoomText}
        onfocus={(e) => {
          zoomEditing = true;
          zoomText = formatZoom(p.zoom);
          (e.currentTarget as HTMLInputElement).select();
        }}
        onblur={() => (zoomEditing = false)}
        onkeydown={(e) => {
          if (e.key === "Enter") commitZoom();
          else if (e.key === "Escape") {
            zoomEditing = false;
            zoomInput.blur();
          }
        }}
      />
      {#if zoomEditing}
        <div class="presets" role="listbox" aria-label="Zoom presets">
          <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(() => p.onFit("page"))}>Fit page<span>Ctrl+0</span></button>
          <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(() => p.onFit("width"))}>Fit width</button>
          <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(p.onActual)}>Actual size<span>Ctrl+1</span></button>
          <span class="sep"></span>
          {#each presets as z (z)}
            <button
              type="button"
              role="option"
              aria-selected={Math.abs(z - p.zoom) < 1e-6}
              class="num"
              onpointerdown={(e) => e.preventDefault()}
              onclick={() => pick(() => p.onZoom(z))}>{formatZoom(z)}</button
            >
          {/each}
        </div>
      {/if}
    </div>
    <button type="button" class="icon-btn" aria-label="Zoom in" title="Zoom in (+)" disabled={!p.hasDoc} onclick={() => p.onZoomStep(1)}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8M7 3v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
    <span class="div"></span>
    <button type="button" class="text-btn" title="Fit page (Ctrl+0)" disabled={!p.hasDoc} onclick={() => p.onFit("page")}>Fit page</button>
    <button type="button" class="text-btn" title="Fit width" disabled={!p.hasDoc} onclick={() => p.onFit("width")}>Fit width</button>
  </div>
</div>

<style>
  .bar {
    min-height: 48px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 6px 12px;
    background: var(--app);
    border-bottom: 1px solid var(--bd);
    flex-shrink: 0;
  }
  .side {
    width: 34px;
    height: 34px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--ctl);
    border: 1px solid var(--bd-ctl);
    border-radius: 8px;
  }
  .sr {
    position: absolute;
    left: -9999px;
  }
  .pagebox {
    height: 24px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    text-align: center;
    padding: 0;
    user-select: text;
  }
  .of {
    color: var(--tx3);
    padding: 0 6px 0 4px;
    white-space: nowrap;
  }
  .zoomwrap {
    position: relative;
  }
  .zoom {
    width: 64px;
    height: 30px;
    padding: 0 4px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--tx);
    border-radius: 6px;
    font-size: 12px;
    text-align: center;
    cursor: pointer;
  }
  .zoom:hover:not(:disabled) {
    background: var(--hover);
  }
  .zoom:focus {
    cursor: text;
    border-color: var(--bd-input);
    background: var(--app);
    outline: none;
    user-select: text;
  }
  .presets {
    position: absolute;
    top: 36px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    width: 180px;
    padding: 6px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: 0 12px 32px var(--shadow);
    display: flex;
    flex-direction: column;
  }
  .presets button {
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--tx);
    border-radius: 5px;
    text-align: left;
  }
  .presets button.num {
    font-size: 12px;
  }
  .presets button:hover {
    background: var(--accent-soft);
  }
  .presets button[aria-selected="true"] {
    color: var(--accent);
  }
  .presets span:not(.sep) {
    color: var(--tx3);
    font-size: 12px;
  }
  .presets .sep {
    height: 1px;
    background: var(--bd);
    margin: 5px 4px;
  }
  .div {
    width: 1px;
    height: 18px;
    background: var(--bd-strong);
    margin: 0 2px;
  }
  .text-btn {
    height: 30px;
    padding: 0 9px;
    border: none;
    background: transparent;
    color: var(--tx2);
    border-radius: 6px;
    white-space: nowrap;
  }
  .text-btn:hover:not(:disabled) {
    background: var(--hover);
    color: var(--tx);
  }
</style>
