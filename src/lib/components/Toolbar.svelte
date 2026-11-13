<script lang="ts">
  // Toolbar (48 px, wraps when narrow), agreed layout (docs/mockups/toolbar-options.html, a
  // variant of B): sidebar toggle, pages and page layout on the left; the centre is kept for
  // the markup tools; navigation mode, zoom and (later) search on the right.
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
    navMode: "cad" | "document";
    /** True while the mode follows the page size rather than a choice. */
    navAuto: boolean;
    /** "auto" goes back to following the page size. */
    onNavMode: (m: "auto" | "cad" | "document") => void;
    layoutMode: "continuous" | "single" | "columns";
    /** Columns in the columns layout, for its tooltip. */
    columns: number;
    onLayout: (m: "continuous" | "single" | "columns") => void;
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
    aria-label="Show or hide the sidebar"
    aria-pressed={p.sidebarOpen}
    title="Sidebar (Ctrl+B)"
    onclick={p.onToggleSidebar}
  >
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M6.25 2.75v10.5" stroke="currentColor" stroke-width="1.5" /></svg>
  </button>

  <div class="group">
    <button type="button" class="icon-btn" aria-label="Previous page" title="Previous page (Page Up)" disabled={!p.hasDoc || p.page <= 0} onclick={p.onPrev}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 3.5L5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
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
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5L11 8l-4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  </div>

  <div class="group seg" role="radiogroup" aria-label="Page layout">
    {#each ["single", "continuous", "columns"] as const as m (m)}
      <button
        type="button"
        role="radio"
        aria-checked={p.layoutMode === m}
        aria-label={m === "single" ? "Single page" : m === "continuous" ? "Continuous" : "Columns"}
        class="icon-btn mode"
        class:on={p.layoutMode === m}
        disabled={!p.hasDoc}
        title={m === "single"
          ? "Single page: one page at a time"
          : m === "continuous"
            ? "Continuous: pages one after another"
            : `Columns: pages side by side, ${p.columns} across (View > Columns across)`}
        onclick={() => p.onLayout(m)}
      >
        <!-- Drawn on an 18 px grid, shown at 16 px: strokes of 1.7 come out at 1.5. -->
        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
          {#if m === "single"}
            <rect x="4.5" y="2.5" width="9" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
          {:else if m === "continuous"}
            <rect x="5" y="1" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
            <rect x="5" y="10" width="8" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
          {:else}
            <rect x="1.5" y="1" width="6.5" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
            <rect x="10" y="1" width="6.5" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
            <rect x="1.5" y="10" width="6.5" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
            <rect x="10" y="10" width="6.5" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.7" />
          {/if}
        </svg>
      </button>
    {/each}
  </div>
  <div class="centre"></div>
  <!-- Automatic, or a fixed choice. While automatic, the mode it picked has a hairline round
       it; clicking that fixes the choice, and Auto goes back. -->
  <div class="group seg" role="radiogroup" aria-label="Navigation">
    <button
      type="button"
      role="radio"
      aria-checked={p.navAuto}
      class="auto"
      class:on={p.navAuto}
      disabled={!p.hasDoc}
      title={`Automatic navigation: picked from the page size (${p.navMode === "cad" ? "CAD" : "Document"} navigation for this file)`}
      onclick={() => p.onNavMode("auto")}>Auto</button
    >
    {#each ["cad", "document"] as const as m (m)}
      <button
        type="button"
        role="radio"
        aria-checked={!p.navAuto && p.navMode === m}
        aria-label={m === "cad" ? "CAD navigation" : "Document navigation"}
        class="icon-btn mode"
        class:on={!p.navAuto && p.navMode === m}
        class:picked={p.navAuto && p.navMode === m}
        disabled={!p.hasDoc}
        title={m === "cad" ? "CAD navigation: the wheel zooms at the cursor" : "Document navigation: the wheel scrolls the pages"}
        onclick={() => p.onNavMode(m)}
      >
        <!-- Drawn on a 20 x 18 grid, shown at 18 x 16: strokes of 1.65 come out at 1.5. -->
        <svg width="18" height="16" viewBox="0 0 20 18" aria-hidden="true">
          <!-- a mouse with its wheel -->
          <rect x="2.5" y="2.5" width="8" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.65" />
          <path d="M6.5 5v2.4" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" />
          {#if m === "cad"}
            <!-- the wheel zooms: a magnifier -->
            <circle cx="14.6" cy="8.4" r="2.7" fill="none" stroke="currentColor" stroke-width="1.65" />
            <path d="M16.6 10.4l2 2" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" />
          {:else}
            <!-- the wheel scrolls: up and down -->
            <path d="M13 6l2.2-2.4L17.4 6M13 12l2.2 2.4L17.4 12M15.2 4v10" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
          {/if}
        </svg>
      </button>
    {/each}
  </div>
  <div class="group">
    <button type="button" class="icon-btn" aria-label="Zoom out" title="Zoom out (-)" disabled={!p.hasDoc} onclick={() => p.onZoomStep(-1)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
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
          <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(() => p.onFit("page"))}><i class="mk"></i>Fit page<span>Ctrl+0</span></button>
          <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(() => p.onFit("width"))}><i class="mk"></i>Fit width<span>Ctrl+2</span></button>
          <button type="button" role="option" aria-selected="false" onpointerdown={(e) => e.preventDefault()} onclick={() => pick(p.onActual)}><i class="mk"></i>Actual size<span>Ctrl+1</span></button>
          <span class="sep"></span>
          {#each presets as z (z)}
            <button
              type="button"
              role="option"
              aria-selected={Math.abs(z - p.zoom) < 1e-6}
              class="num"
              onpointerdown={(e) => e.preventDefault()}
              onclick={() => pick(() => p.onZoom(z))}
              ><i class="mk"
                >{#if Math.abs(z - p.zoom) < 1e-6}<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
                    ><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg
                  >{/if}</i
              >{formatZoom(z)}</button
            >
          {/each}
        </div>
      {/if}
    </div>
    <button type="button" class="icon-btn" aria-label="Zoom in" title="Zoom in (+)" disabled={!p.hasDoc} onclick={() => p.onZoomStep(1)}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8 3.5v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
  </div>
  <div class="group">
    <button type="button" class="icon-btn" aria-label="Fit page" title="Fit page (Ctrl+0)" disabled={!p.hasDoc} onclick={() => p.onFit("page")}>
      <!-- a page inside corner brackets -->
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.75 5V1.75H5M11 1.75h3.25V5M14.25 11v3.25H11M5 14.25H1.75V11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        <rect x="5" y="4.5" width="6" height="7" rx="0.75" fill="none" stroke="currentColor" stroke-width="1.5" />
      </svg>
    </button>
    <button type="button" class="icon-btn" aria-label="Fit width" title="Fit width (Ctrl+2)" disabled={!p.hasDoc} onclick={() => p.onFit("width")}>
      <!-- the width between two edges -->
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M1.75 3v10M14.25 3v10M4.5 8h7M6.5 6l-2 2 2 2M9.5 6l2 2-2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
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
  /* The same height as the groups beside it (30 px buttons in 2 px padding and a 1 px border). */
  .side {
    width: 36px;
    height: 36px;
  }
  .side.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  /* Kept for the markup tools; pushes the mode and zoom groups to the right. */
  .centre {
    flex: 1 1 0;
    min-width: 0;
  }
  /* Segments take the shared selected look (app.css .seg); icon buttons keep their own size. */
  .seg .mode {
    width: 34px;
    padding: 0;
  }
  .seg .auto {
    font-size: 12px;
    padding: 0 9px;
  }
  /* While automatic: the mode it picked, outlined. */
  .seg .mode.picked {
    box-shadow: inset 0 0 0 1px var(--bd-strong);
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
  /* The page and zoom boxes: a matched pair of compact boxed fields, mono numerals. */
  .pagebox,
  .zoom {
    height: 24px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    text-align: center;
    padding: 0;
    font-family: var(--font-num);
    font-size: 12px;
    user-select: text;
  }
  .pagebox:focus,
  .zoom:focus {
    cursor: text;
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
    width: 60px;
    margin: 0 2px;
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
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
  }
  /* A menu like the others: 30 px rows, a tick column, the current value ticked. */
  .presets button {
    height: 30px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px 0 6px;
    border: none;
    background: transparent;
    color: var(--tx);
    border-radius: 5px;
    text-align: left;
  }
  .presets .mk {
    width: 16px;
    flex-shrink: 0;
    display: flex;
    justify-content: center;
  }
  .presets span:not(.sep) {
    margin-left: auto;
  }
  .presets button.num {
    font-size: 12px;
  }
  .presets button:hover {
    background: var(--accent-soft);
  }
  .presets button[aria-selected="true"] {
    color: var(--accent-text);
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
</style>
