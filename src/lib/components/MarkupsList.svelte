<script lang="ts">
  // The sidebar's Markups tab: the tab's markups by page (markup/listing.ts). Each row is laid
  // out as lines, each one line that shortens with an ellipsis (docs/edit-lock-brief.md, 5):
  // the kind with a measurement's value; what it says (a text box's or note's words may take two
  // lines) or what qualifies the value; author and date, muted. A row does one thing: a click
  // jumps to the markup and selects it. Delete is the Delete key once it's selected, or the row's
  // right-click menu; there's no delete button on the row. Annotations that came with the file
  // are listed too, and picked the same way, locked or not. Selecting on the canvas highlights
  // the row and scrolls it into view. Rows are keyed by markup id and styled by what they are,
  // never by position (no striping): rows come and go as markups do.
  import { type MarkupPage, listDate } from "../markup/listing";

  interface Props {
    pages: MarkupPage[];
    selected: ReadonlySet<string>;
    /** Colour for each markup's icon, by id ("rgb(...)"). */
    colours: ReadonlyMap<string, string>;
    onPick: (id: string) => void;
    /** A right-click on a row, at screen (x, y). */
    onMenu: (id: string, x: number, y: number) => void;
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
        {@const when = listDate(r.modified, now)}
        <div class="row" class:on={p.selected.has(r.id)} data-id={r.id}>
          <button
            type="button"
            class="pick"
            title={r.tip + (r.locked ? " (in the file: switch on Edit file to change it)" : "")}
            aria-current={p.selected.has(r.id)}
            onclick={() => p.onPick(r.id)}
            oncontextmenu={(e) => {
              e.preventDefault();
              p.onMenu(r.id, e.clientX, e.clientY);
            }}
          >
            <svg class="icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style:color={p.colours.get(r.id)}>{@html r.icon}</svg>
            <span class="body">
              <span class="line top"><span class="label">{r.label}</span>{#if r.value}<span class="value num">{r.value}</span>{/if}</span>
              {#if r.text}<span class="text" class:one={!!r.value}>{r.text}</span>{/if}
              {#if r.author || when}<span class="line who">{[r.author, when].filter(Boolean).join(" · ")}</span>{/if}
            </span>
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
    border-radius: 5px;
    /* Paint only what's on screen, remembering each row's height once seen (about three lines). */
    content-visibility: auto;
    contain-intrinsic-size: auto 58px;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.on {
    background: var(--accent-soft);
  }
  .pick {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 5px 6px 5px 5px;
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
  /* Each line is one line, shortened with an ellipsis. */
  .line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .label {
    color: var(--tx);
  }
  /* Regular weight: the monospaced face ships one weight, and a synthesised bold read too heavy. */
  .value {
    margin-left: 6px;
    color: var(--tx);
  }
  .row.on .label,
  .row.on .value {
    color: var(--accent-text);
  }
  .who {
    color: var(--tx3);
    font-size: 11px;
  }
  /* What it says: up to two lines. A measurement's qualifier: one. */
  .text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .text.one {
    display: block;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
</style>
