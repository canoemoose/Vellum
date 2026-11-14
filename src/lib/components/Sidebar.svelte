<script lang="ts">
  // Sidebar (196 px by default, resizable, collapsible): Pages and Bookmarks (the PDF's
  // outline; the setting keeps its old name, "outline"). Search results show in a card under
  // the toolbar's search box instead. The mockup's
  // Markups tab comes with the markup tools.
  import type { OutlineNode } from "../render/types";
  import type { PageSize } from "../view/layout";
  import type { SidebarTab } from "../settings";
  import { SIDEBAR_MAX, SIDEBAR_MIN } from "../settings";
  import Thumbnails from "./Thumbnails.svelte";
  import OutlineTree from "./OutlineTree.svelte";
  import { userMessage } from "../shell/messages";

  interface Props {
    width: number;
    tab: SidebarTab;
    docId: number | null;
    sizes: PageSize[];
    current: number;
    visible: number[];
    thumbnail: (page: number, maxSide: number) => Promise<ImageBitmap>;
    cancelThumbnail: (page: number, maxSide: number) => void;
    outline: ((docId: number) => Promise<OutlineNode[]>) | null;
    onTab: (t: SidebarTab) => void;
    onWidth: (w: number, done: boolean) => void;
    onGoto: (page: number) => void;
    onGotoPoint: (page: number, y: number | null) => void;
  }
  let p: Props = $props();

  // Outlines are cached per document id (ids are never reused within a process).
  const outlines = new Map<number, Promise<OutlineNode[]>>();
  const outlineFor = (id: number) => {
    let o = outlines.get(id);
    if (!o) {
      o = p.outline ? p.outline(id) : Promise.resolve([]);
      outlines.set(id, o);
    }
    return o;
  };

  let resizing: { x0: number; w0: number } | null = null;
</script>

<aside class="side" style:width="{p.width}px">
  <div class="tabs" role="tablist" aria-label="Sidebar">
    <button type="button" role="tab" aria-selected={p.tab === "pages"} class:on={p.tab === "pages"} onclick={() => p.onTab("pages")}>Pages</button>
    <button type="button" role="tab" aria-selected={p.tab === "outline"} class:on={p.tab === "outline"} onclick={() => p.onTab("outline")}>Bookmarks</button>
  </div>

  {#if p.docId === null}
    <p class="empty">No document open.</p>
  {:else if p.tab === "pages"}
    {#key p.docId}
      <Thumbnails docId={p.docId} width={p.width} sizes={p.sizes} current={p.current} visible={p.visible} thumbnail={p.thumbnail} cancelThumbnail={p.cancelThumbnail} onGoto={p.onGoto} />
    {/key}
  {:else}
    <div class="outline">
      {#await outlineFor(p.docId)}
        <p class="empty">Loading bookmarks…</p>
      {:then nodes}
        {#if nodes.length}
          <OutlineTree {nodes} onGo={p.onGotoPoint} />
        {:else}
          <p class="empty">This document has no bookmarks.</p>
        {/if}
      {:catch e}
        <p class="empty">{userMessage(e, "read the bookmarks")}</p>
      {/await}
    </div>
  {/if}

  <div
    class="grip"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    aria-valuemin={SIDEBAR_MIN}
    aria-valuemax={SIDEBAR_MAX}
    aria-valuenow={p.width}
    tabindex="-1"
    onpointerdown={(e) => {
      if (e.button !== 0) return;
      resizing = { x0: e.clientX, w0: p.width };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }}
    onpointermove={(e) => {
      if (!resizing) return;
      p.onWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizing.w0 + e.clientX - resizing.x0)), false);
    }}
    onpointerup={() => {
      if (resizing) p.onWidth(p.width, true);
      resizing = null;
    }}
    onlostpointercapture={() => {
      // A release outside the window, or anything else that ends the capture: stop resizing,
      // or a later hover over the divider would carry on resizing.
      if (resizing) p.onWidth(p.width, true);
      resizing = null;
    }}
    ondblclick={() => p.onWidth(196, true)}
  ></div>
</aside>

<style>
  .side {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--app);
    border-right: 1px solid var(--bd);
    min-height: 0;
  }
  .tabs {
    display: flex;
    gap: 2px;
    padding: 8px 8px 6px;
  }
  .tabs button {
    flex: 1 1 0;
    height: 28px;
    border: none;
    background: transparent;
    color: var(--tx3);
    border-radius: 6px;
    font-size: 12px;
  }
  .tabs button:hover:not(.on) {
    color: var(--tx2);
    background: var(--hover);
  }
  .tabs button:active {
    background: var(--press-soft);
  }
  /* The shared selected look (app.css .seg). */
  .tabs button.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .outline {
    flex: 1 1 auto;
    overflow: auto;
    padding: 4px 6px 12px;
  }
  .empty {
    margin: 16px 12px;
    color: var(--tx3);
    font-size: 12px;
    text-align: center;
  }
  .grip {
    position: absolute;
    top: 0;
    right: -3px;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
  }
  .grip:hover {
    background: var(--accent-soft);
  }
</style>
