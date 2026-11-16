<script module lang="ts">
export interface TabView {
  id: number;
  title: string;
  path: string;
  kind: "pdf" | "image";
  loading: boolean;
  error: boolean;
  note: string | null;
  /** "Page 3 of 12", or why the file didn't open; for the hover card. */
  detail: string | null;
  /** The view as it was left (background tabs only), for the hover card. Not owned here. */
  snapshot: ImageBitmap | null;
  /** Unsaved markups. */
  dirty?: boolean;
  /** The file's "Edit file" lock is off (docs/edit-lock-brief.md, 3): shown, not clickable. */
  unlocked?: boolean;
}
</script>

<script lang="ts">
  // Custom title bar (40 px): Vellum mark, document tabs, + (open), window controls. The window
  // has no native decorations; only empty title bar space carries data-tauri-drag-region (a
  // drag there moves the window, a double-click maximises), never the tabs or buttons.
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { dropIndex, truncateMiddle } from "../shell/tabs";
  import CloseButton from "./CloseButton.svelte";


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
  /** The maximise button, covered by a native overlay for Windows 11 snap layouts (snap.rs). */
  let maxBtn: HTMLButtonElement;
  /** The overlay reports hover, since the button underneath no longer sees the mouse. */
  let maxHover = $state(false);
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

  // ---------------------------------------------------------------- hover card
  // Like Chrome's tab previews: the full name, the folder, the page, and for a background tab a
  // picture of the view as it was left. It appears after a pause, then moves straight from tab
  // to tab while the pointer stays on the strip, and goes on a click, a drag or the wheel.

  const CARD_DELAY_MS = 500;
  const CARD_W = 260;
  let card = $state<{ id: number; left: number } | null>(null);
  let cardTimer: ReturnType<typeof setTimeout> | null = null;
  /** No card until the pointer leaves the tab (after a click or drag on it). */
  let cardHeld = false;
  const cardTab = $derived(card ? tabs.find((t) => t.id === card!.id) ?? null : null);

  function cardLeft(el: HTMLElement): number {
    const r = el.getBoundingClientRect();
    return Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8));
  }

  function clearCardTimer() {
    if (cardTimer !== null) clearTimeout(cardTimer);
    cardTimer = null;
  }

  function onTabEnter(e: PointerEvent, id: number) {
    if (e.pointerType === "touch" || drag) return;
    cardHeld = false;
    clearCardTimer();
    const el = e.currentTarget as HTMLElement;
    if (card) {
      card = { id, left: cardLeft(el) }; // already showing: follow at once
      return;
    }
    cardTimer = setTimeout(() => {
      cardTimer = null;
      if (!cardHeld && el.isConnected) card = { id, left: cardLeft(el) };
    }, CARD_DELAY_MS);
  }

  function onTabLeave() {
    clearCardTimer();
    cardHeld = false;
    // A short grace, so moving onto the next tab keeps the card up and it just follows.
    cardTimer = setTimeout(() => {
      cardTimer = null;
      card = null;
    }, 80);
  }

  function hideCard() {
    clearCardTimer();
    card = null;
    cardHeld = true;
  }

  /** Draw a bitmap into the card's canvas (the bitmap belongs to the tab; it isn't closed here). */
  function paint(node: HTMLCanvasElement, bmp: ImageBitmap) {
    const draw = (b: ImageBitmap) => {
      node.width = b.width;
      node.height = b.height;
      node.getContext("2d")?.drawImage(b, 0, 0);
    };
    draw(bmp);
    return { update: draw };
  }

  const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

  const win = getCurrentWindow();

  onMount(() => {
    let un: (() => void) | null = null;
    const sync = () => win.isMaximized().then((m) => (maximised = m)).catch(() => {});
    sync();
    win.onResized(sync).then((u) => (un = u)).catch(() => {});

    // Keep the snap overlay over the maximise button, in physical pixels.
    const place = () => {
      if (!maxBtn) return;
      const r = maxBtn.getBoundingClientRect();
      const k = window.devicePixelRatio || 1;
      invoke("snap_max_button", { x: r.left * k, y: r.top * k, w: r.width * k, h: r.height * k }).catch(() => {});
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(document.documentElement);
    ro.observe(maxBtn);
    window.addEventListener("resize", place);
    let unHover: (() => void) | null = null;
    listen<boolean>("snap://hover", (e) => (maxHover = e.payload)).then((u) => (unHover = u)).catch(() => {});

    return () => {
      un?.();
      unHover?.();
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  });

  function tabCentres(): number[] {
    return [...strip.querySelectorAll<HTMLElement>("[data-tab]")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
  }

  function onPointerDown(e: PointerEvent, id: number) {
    hideCard();
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
    <!-- The app icon's 16 px drawing (src-tauri/icons/source/vellum-16.svg), in its own colours. -->
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0" y="0" width="16" height="16" rx="3.5" fill="#0a4540" />
      <polygon points="11.7,2.5 13.4,2.5 9,13 8.4,13" fill="#14b8a6" />
      <polygon points="10,3.5 12,3.5 8.6,13 6,13" fill="#ffffff" />
      <polygon points="2,3 5,3 9,13 6,13" fill="#2dd4bf" />
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
        data-tab={t.id}
        onpointerenter={(e) => onTabEnter(e, t.id)}
        onpointerleave={onTabLeave}
        onwheel={hideCard}
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
        <!-- The file is unlocked: a status only, across every open file. The switch locks it. -->
        {#if t.unlocked}<span class="unl" title="File unlocked: annotations that came with it can be changed" role="img" aria-label="File unlocked"><svg class="ic unlocked" width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg></span>{/if}
        {#if t.dirty}<span class="dirty" title="Unsaved markups" aria-label="Unsaved markups"></span>{/if}
        <CloseButton size="small" label="Close tab" tabindex={-1} onclick={() => onClose(t.id)} />
      </div>
    {/each}
    <button type="button" class="new" aria-label="Open a file" title="Open (Ctrl+O)" onclick={onNew}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
    </button>
    <div class="fill" data-tauri-drag-region></div>
  </div>

  {#if card && cardTab}
    <div class="card" style:left="{card.left}px" style:width="{CARD_W}px" aria-hidden="true">
      <div class="name">{cardTab.title}</div>
      <div class="path">{folderOf(cardTab.path)}</div>
      {#if cardTab.detail}
        <div class="detail" class:err={cardTab.error}>{cardTab.detail}</div>
      {/if}
      {#if cardTab.note}
        <div class="detail">{cardTab.note}</div>
      {/if}
      {#if cardTab.snapshot && cardTab.id !== activeId}
        <canvas class="shot" use:paint={cardTab.snapshot}></canvas>
      {/if}
    </div>
  {/if}

  <div class="controls">
    <button type="button" aria-label="Minimise" title="Minimise" onclick={() => win.minimize()}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor" /></svg>
    </button>
    <button type="button" aria-label={maximised ? "Restore" : "Maximise"} title={maximised ? "Restore" : "Maximise"} class:hov={maxHover} bind:this={maxBtn} onclick={() => win.toggleMaximize()}>
      {#if maximised}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" /><path d="M2.5 2.5v-2h7v7h-2" fill="none" stroke="currentColor" /></svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
      {/if}
    </button>
    <button type="button" class="x" aria-label="Close" title="Close" onclick={() => win.close()}>
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
    background: var(--hover);
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
  .unl {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--accent-text);
  }
  .dirty {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }
  .title.loading {
    opacity: 0.6;
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
  .card {
    position: fixed;
    top: 42px;
    z-index: var(--z-menu);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 12px 12px;
    background: var(--ctl);
    border-color: var(--bd-strong);
    border: 1px solid var(--bd);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
  }
  .card .name {
    color: var(--tx);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .card .path {
    color: var(--tx3);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .card .detail {
    color: var(--tx2);
    font-size: 12px;
  }
  .card .detail.err {
    color: var(--danger);
  }
  .card .shot {
    display: block;
    width: 100%;
    height: auto;
    max-height: 200px;
    object-fit: contain;
    margin-top: 8px;
    border-radius: 4px;
    border: 1px solid var(--bd);
    background: var(--canvas);
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
  .controls button:hover,
  .controls button.hov {
    background: var(--hover);
    color: var(--tx);
  }
  .controls button.x:hover {
    background: var(--close-hover);
    color: #ffffff;
  }
</style>
