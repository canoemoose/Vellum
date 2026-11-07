<script lang="ts">
  import type { UiState, NavMode } from "../engine/viewer";
  import type { LayoutMode } from "../view/layout";

  interface Props {
    ui: UiState;
    onOpen: () => void;
    onFitPage: () => void;
    onFitWidth: () => void;
    onLayout: (m: LayoutMode) => void;
    onNav: (m: NavMode) => void;
  }
  let { ui, onOpen, onFitPage, onFitWidth, onLayout, onNav }: Props = $props();

  const zoomText = $derived(
    ui.zoom >= 10 ? `${Math.round(ui.zoom * 100)}%` : `${(ui.zoom * 100).toFixed(ui.zoom < 0.1 ? 1 : 0)}%`,
  );
</script>

<header class="bar">
  <button class="file" title="Open a PDF (Ctrl+O)" onclick={onOpen}>
    {ui.fileName || "Open a PDF…"}
  </button>

  {#if ui.numPages > 0}
    <span class="pages">Page <span class="num">{ui.page + 1}</span> of <span class="num">{ui.numPages}</span></span>
    <span class="zoom num" title="Zoom">{zoomText}</span>

    <div class="group">
      <button onclick={onFitPage} title="Fit page (Ctrl+0)">Fit page</button>
      <button onclick={onFitWidth} title="Fit width">Fit width</button>
    </div>

    <div class="spacer"></div>

    <div class="group" role="radiogroup" aria-label="Page layout">
      <button class:on={ui.layoutMode === "continuous"} onclick={() => onLayout("continuous")} title="Continuous scroll">Continuous</button>
      <button class:on={ui.layoutMode === "single"} onclick={() => onLayout("single")} title="One page at a time">Single</button>
    </div>
  {:else}
    <div class="spacer"></div>
  {/if}

  <div class="group" role="radiogroup" aria-label="Navigation mode">
    <button class:on={ui.navMode === "cad"} onclick={() => onNav("cad")} title="Wheel zooms at the cursor, middle-drag pans">CAD</button>
    <button class:on={ui.navMode === "document"} onclick={() => onNav("document")} title="Wheel scrolls, Ctrl+wheel zooms">Document</button>
  </div>
</header>

<style>
  .bar {
    height: var(--bar-h);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 10px;
    background: var(--chrome);
    border-bottom: 1px solid var(--bd);
    white-space: nowrap;
  }
  .file {
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 8px;
    font-weight: 600;
    color: var(--tx);
    max-width: 40vw;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .file:hover {
    border-color: var(--bd-strong);
    background: var(--ctl);
  }
  .pages {
    color: var(--tx3);
  }
  .pages .num {
    color: var(--tx2);
  }
  .zoom {
    min-width: 6ch;
    text-align: right;
    color: var(--tx2);
  }
  .spacer {
    flex: 1;
  }
  .group {
    display: flex;
    background: var(--ctl);
    border: 1px solid var(--bd);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  .group button {
    height: 24px;
    padding: 0 10px;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--tx2);
    cursor: pointer;
  }
  .group button:hover {
    color: var(--tx);
    background: var(--app);
  }
  .group button.on {
    color: var(--tx);
    background: var(--bd-strong);
    border-color: var(--bd-strong);
  }
</style>
