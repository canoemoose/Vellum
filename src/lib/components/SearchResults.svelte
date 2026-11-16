<script lang="ts" module>
  import type { SearchHit } from "../text/searchModel";

  /** What the search card shows of the active document's search (a snapshot, see App.svelte). */
  export interface SearchView {
    query: string;
    hits: SearchHit[];
    current: number;
    running: boolean;
    scanned: number;
    numPages: number;
    withText: number;
    truncated: boolean;
    error: string | null;
  }
</script>

<script lang="ts">
  // The search card's list: results by page, with a little context; click one to go there.
  interface Props {
    view: SearchView | null;
    onSelect: (i: number) => void;
  }
  let p: Props = $props();

  /** Rows rendered at most; the count above says how many there are. */
  const SHOWN = 1000;

  let list = $state<HTMLDivElement>();

  const status = $derived.by(() => {
    const v = p.view;
    if (!v) return "Type in the search box (Ctrl+F) to search the whole document.";
    const n = v.hits.length;
    const more = v.truncated ? "+" : "";
    if (v.running) return `Searching page ${Math.min(v.scanned + 1, v.numPages)} of ${v.numPages}… ${n ? `${n}${more} found` : ""}`;
    if (!n && v.withText === 0) return "This document has no searchable text. It may be a scan.";
    if (!n) return `No results for “${v.query}”.`;
    return `${n}${more} result${n === 1 ? "" : "s"} for “${v.query}”${v.truncated ? " (the search stopped there; try more words)" : ""}.`;
  });

  // Keep the current result in view as F3 moves through them.
  $effect(() => {
    const i = p.view?.current ?? -1;
    if (i < 0 || !list) return;
    list.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  });
</script>

<div class="results">
  <p class="status" role="status">{status}</p>
  {#if p.view?.error}
    <p class="status err">Some pages couldn't be searched: {p.view.error}</p>
  {/if}
  {#if p.view && p.view.hits.length}
    <div class="list" bind:this={list}>
      {#each p.view.hits.slice(0, SHOWN) as h, i (h.page * 1e7 + h.index)}
        {#if i === 0 || p.view.hits[i - 1].page !== h.page}
          <div class="page">Page {h.page + 1}</div>
        {/if}
        <button type="button" class="hit" class:on={i === p.view.current} data-i={i} onclick={() => p.onSelect(i)} title={`${h.before}${h.text}${h.after}`}>
          <span class="ctx">{h.before.slice(-24)}</span><mark>{h.text}</mark><span class="ctx">{h.after.slice(0, 40)}</span>
        </button>
      {/each}
      {#if p.view.hits.length > SHOWN}
        <p class="status">And {p.view.hits.length - SHOWN} more. Use F3 to step through them all, or narrow the search.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .results {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .status {
    margin: 4px 12px 8px;
    color: var(--tx3);
    font-size: 12px;
  }
  .err {
    color: var(--danger, var(--tx2));
  }
  .list {
    flex: 1 1 auto;
    overflow: auto;
    padding: 0 6px 12px;
  }
  .page {
    margin: 8px 6px 2px;
    color: var(--tx2);
    font-size: 11px;
    font-weight: 600;
  }
  .hit {
    display: block;
    width: 100%;
    padding: 4px 6px;
    border: none;
    background: transparent;
    color: var(--tx2);
    border-radius: 5px;
    text-align: left;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hit:hover {
    background: var(--hover);
  }
  .hit.on {
    background: var(--accent-soft);
    color: var(--tx);
  }
  mark {
    background: rgba(255, 214, 0, 0.55);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  .ctx {
    color: var(--tx3);
  }
</style>
