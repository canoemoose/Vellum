<script module lang="ts">
export interface TabView {
  id: number;
  title: string;
  path: string;
  kind: "pdf" | "image";
  loading: boolean;
  error: boolean;
  note: string | null;
}
</script>

<script lang="ts">
  // Custom title bar (40 px): Vellum mark, document tabs, + (open), window controls. The window
  // has no native decorations; only empty title bar space carries data-tauri-drag-region (a
  // drag there moves the window, a double-click maximises), never the tabs or buttons.
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { dropIndex, truncateMiddle } from "../shell/tabs";


  interface Props {
    tabs: TabView[];
    activeId: number | null;
    onSelect: (id: number) => void;
    onClose: (id: number) => void;
    onMove: (id: number, to: number) => void;
    onNew: () => void;
    onContext: (id: number, x: number, y: number) => void;
  }
  let { tabs, activeId, onSelect, onClose, onMove, onNew, onContext }: Props = $props();

  let maximised = $state(false);
  let stripWidth = $state(1000);

  /**
   * Characters each title gets, from the space each tab actually has (tabs shrink as more
   * open), so long names are shortened in the middle rather than cut off at the end.
   * About 7 px per character of Inter at 13 px; icons, padding and the close button ~60 px.
   */
  const titleChars = $derived.by(() => {
    const n = Math.max(1, tabs.length);
    const perTab = Math.min(280, (stripWidth - 40) / n - 2);
    return Math.max(6, Math.floor((perTab - 62) / 7));
  });
  let strip: HTMLDivElement;
  let drag: { id: number; pointer: number; x0: number; moved: boolean } | null = null;

  const win = getCurrentWindow();

  onMount(() => {
    let un: (() => void) | null = null;
    const sync = () => win.isMaximized().then((m) => (maximised = m)).catch(() => {});
    sync();
    win.onResized(sync).then((u) => (un = u)).catch(() => {});
    return () => un?.();
  });

  function tabCentres(): number[] {
    return [...strip.querySelectorAll<HTMLElement>("[data-tab]")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
  }

  function onPointerDown(e: PointerEvent, id: number) {
    if (e.button === 1) {
      e.preventDefault(); // no autoscroll; auxclick closes
      return;
    }
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    onSelect(id);
    drag = { id, pointer: e.pointerId, x0: e.clientX, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 5) return;
    drag.moved = true;
    const from = tabs.findIndex((t) => t.id === drag!.id);
    const to = dropIndex(tabCentres(), from, e.clientX);
    if (to !== from) onMove(drag.id, to);
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    drag = null;
  }
</script>

<header class="bar" data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="none" stroke="var(--accent)" stroke-width="1.5" />
      <path d="M5 5.5h6M5 8h6M5 10.5h3.5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <span>Vellum</span>
  </div>

  <div class="tabs" role="tablist" aria-label="Open documents" bind:this={strip} bind:clientWidth={stripWidth} data-tauri-drag-region>
    {#each tabs as t (t.id)}
      <div
        class="tab"
        class:on={t.id === activeId}
        role="tab"
        tabindex="0"
        aria-selected={t.id === activeId}
        title={t.note ? `${t.path}\n${t.note}` : t.path}
        data-tab={t.id}
        onpointerdown={(e) => onPointerDown(e, t.id)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointercancel={onPointerUp}
        onauxclick={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            onClose(t.id);
          }
        }}
        oncontextmenu={(e) => {
          e.preventDefault();
          onContext(t.id, e.clientX, e.clientY);
        }}
        onkeydown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(t.id);
          }
        }}
      >
        {#if t.error}
          <svg class="ic err" width="13" height="13" viewBox="0 0 14 14" aria-label="Couldn't open"><circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3" /><path d="M7 4v3.5M7 9.6v.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        {:else if t.kind === "image"}
          <svg class="ic" width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" /><path d="M2 10l3-3 2.5 2.5L9 8l3 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" /></svg>
        {/if}
        <span class="title" class:loading={t.loading}>{truncateMiddle(t.title, titleChars)}</span>
        <button type="button" class="close" aria-label="Close tab" tabindex="-1" onclick={() => onClose(t.id)}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
        </button>
      </div>
    {/each}
    <button type="button" class="new" aria-label="Open file" title="Open file (Ctrl+O)" onclick={onNew}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
    </button>
    <div class="fill" data-tauri-drag-region></div>
  </div>

  <div class="controls">
    <button type="button" aria-label="Minimise" title="Minimise" onclick={() => win.minimize()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" /></svg>
    </button>
    <button type="button" aria-label={maximised ? "Restore" : "Maximise"} title={maximised ? "Restore" : "Maximise"} onclick={() => win.toggleMaximize()}>
      {#if maximised}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" /><path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" /></svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
      {/if}
    </button>
    <button type="button" class="x" aria-label="Close window" title="Close" onclick={() => win.close()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
    </button>
  </div>
</header>

<style>
  .bar {
    height: 40px;
    display: flex;
    align-items: stretch;
    background: var(--chrome);
    border-bottom: 1px solid var(--bd);
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px 0 16px;
    flex-shrink: 0;
  }
  .brand > * {
    pointer-events: none;
  }
  .brand span {
    font-weight: 600;
    letter-spacing: 0.01em;
  }
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
  }
  .tab {
    height: 32px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px 0 14px;
    min-width: 72px;
    max-width: 280px;
    flex: 0 1 auto;
    color: var(--tx3);
    white-space: nowrap;
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    outline-offset: -2px;
  }
  .tab:hover:not(.on) {
    color: var(--tx2);
  }
  .tab.on {
    background: var(--app);
    border-color: var(--bd);
    color: var(--tx);
    /* Cover the title bar's bottom border so the tab joins the menu bar. */
    margin-bottom: -1px;
    height: 33px;
  }
  .ic {
    flex-shrink: 0;
  }
  .ic.err {
    color: var(--danger);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .title.loading {
    opacity: 0.6;
  }
  .close {
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    color: var(--tx3);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .close:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .new {
    width: 28px;
    height: 28px;
    margin-bottom: 2px;
    margin-left: 2px;
    border: none;
    background: transparent;
    color: var(--tx3);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .new:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .fill {
    flex: 1 1 auto;
    align-self: stretch;
    min-width: 24px;
  }
  .controls {
    display: flex;
    align-items: stretch;
    flex-shrink: 0;
  }
  .controls button {
    width: 46px;
    border: none;
    background: transparent;
    color: var(--tx3);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .controls button:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .controls button.x:hover {
    background: var(--close-hover);
    color: #ffffff;
  }
</style>
