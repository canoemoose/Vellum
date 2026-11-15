<script lang="ts">
  // The sidebar's Markups tab: the tab's markups by page (markup/listing.ts), each with an icon
  // for its type, its text, author and date. Click a row to jump there and select it; its
  // delete button (or Delete, once it's selected) removes it. Selecting on the canvas
  // highlights the row and scrolls it into view. Rows are keyed by markup id and styled by
  // what they are, never by position (no striping): rows come and go as markups do.
  import { type MarkupPage, listDate } from "../markup/listing";

  interface Props {
    pages: MarkupPage[];
    selected: ReadonlySet<string>;
    /** Colour for each markup's icon, by id ("rgb(...)"). */
    colours: ReadonlyMap<string, string>;
    onPick: (id: string) => void;
    onDelete: (id: string) => void;
  }
  let p: Props = $props();
  let list = $state<HTMLDivElement>();

  // A single markup picked out on the canvas: bring its row into view.
  $effect(() => {
    if (p.selected.size !== 1 || !list) return;
    const [id] = p.selected;
    const row = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  });

  const now = new Date();
</script>

<div class="markups" bind:this={list}>
  {#each p.pages as g (g.page)}
    <section aria-label="Page {g.page + 1}">
      <h3>Page {g.page + 1} <span class="n">{g.rows.length}</span></h3>
      {#each g.rows as r (r.id)}
        <div class="row" class:on={p.selected.has(r.id)} data-id={r.id}>
          <button type="button" class="pick" title={r.text ? `${r.label}: ${r.text}` : r.label} aria-current={p.selected.has(r.id)} onclick={() => p.onPick(r.id)}>
            <svg class="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style:color={p.colours.get(r.id)}>{@html r.icon}</svg>
            <span class="body">
              <span class="top"><span class="label">{r.label}</span><span class="date">{listDate(r.modified, now)}</span></span>
              {#if r.text}<span class="text">{r.text}</span>{/if}
              {#if r.author}<span class="who">{r.author}</span>{/if}
            </span>
          </button>
          <button type="button" class="del" title="Delete" aria-label="Delete {r.label}" onclick={() => p.onDelete(r.id)}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>
          </button>
        </div>
      {/each}
    </section>
  {/each}
</div>

<style>
  .markups {
    flex: 1 1 auto;
    overflow: auto;
    padding: 2px 6px 12px;
  }
  h3 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 10px 4px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--tx3);
  }
  section:first-child h3 {
    margin-top: 4px;
  }
  .n {
    font-weight: normal;
  }
  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    border-radius: 5px;
    /* Paint only what's on screen, remembering each row's height once seen. */
    content-visibility: auto;
    contain-intrinsic-size: auto 46px;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.on {
    background: var(--accent-soft);
  }
  .pick {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 5px 4px 5px 5px;
    border: none;
    background: none;
    text-align: left;
    color: var(--tx2);
    font-size: 12px;
    line-height: 1.35;
  }
  .icon {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .top {
    display: flex;
    gap: 6px;
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--tx);
  }
  .row.on .label {
    color: var(--accent-text);
  }
  .date,
  .who {
    color: var(--tx3);
    font-size: 11px;
  }
  .date {
    flex-shrink: 0;
  }
  .who {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .del {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    margin: 4px 3px 0 0;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--tx3);
    opacity: 0;
  }
  .row:hover .del,
  .row.on .del,
  .del:focus-visible {
    opacity: 1;
  }
  .del:hover {
    background: var(--hover);
    color: var(--danger);
  }
  .del:active {
    background: var(--press-soft);
  }
</style>
