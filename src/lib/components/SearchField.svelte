<script lang="ts">
  // The toolbar's search box: type to search the whole document (after a short pause). While
  // there's a search, a card under the box shows the count, previous / next and the results;
  // it stays open while you work on the drawing until Esc in the box or its close button
  // clears the search. Enter / Shift+Enter step through results. Ctrl+F (App.svelte) focuses
  // the box. Match case and whole words toggle beside it.
  import SearchResults, { type SearchView } from "./SearchResults.svelte";
  import { countLabel } from "../text/searchModel";
  import { untrack } from "svelte";

  interface Props {
    disabled: boolean;
    /** The active document's search, or null. */
    view: SearchView | null;
    /** Changes when the active document does: the box shows that document's query. */
    docKey: number | null;
    matchCase: boolean;
    wholeWord: boolean;
    onSearch: (q: string) => void;
    onStep: (dir: 1 | -1) => void;
    onSelect: (i: number) => void;
    onOption: (o: "matchCase" | "wholeWord") => void;
  }
  let p: Props = $props();

  let text = $state("");
  let input: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The query last handed to onSearch. */
  let sent = "";

  // Show the document's query when the document changes, and only then: results arriving
  // while you type must never put the old query back.
  $effect(() => {
    void p.docKey;
    const q = untrack(() => p.view?.query ?? "");
    text = q;
    sent = q;
  });

  /** Focus and select the box (Ctrl+F). */
  export function focus() {
    input?.focus();
    input?.select();
  }

  function run() {
    clearTimeout(timer);
    if (text !== sent) {
      sent = text;
      p.onSearch(text);
    }
  }

  function clear() {
    text = "";
    run();
  }

  function onInput() {
    clearTimeout(timer);
    timer = setTimeout(run, 300);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (text !== sent) run();
      else p.onStep(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (text || p.view) clear();
      else input.blur();
    }
  }

  const label = $derived(p.view ? countLabel(p.view.current, p.view.hits.length, p.view.running, p.view.truncated) : "");
</script>

<div class="wrap">
  <div class="group search" class:off={p.disabled}>
    <svg class="glass" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path d="M10.4 10.4L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
    <input
      bind:this={input}
      bind:value={text}
      class="box"
      type="search"
      aria-label="Search the document"
      placeholder="Search"
      title="Search the document (Ctrl+F)"
      autocomplete="off"
      spellcheck="false"
      disabled={p.disabled}
      oninput={onInput}
      onkeydown={onKey}
    />
    <button
      type="button"
      class="icon-btn opt"
      class:on={p.matchCase}
      aria-pressed={p.matchCase}
      aria-label="Match case"
      title="Match case"
      disabled={p.disabled}
      onclick={() => p.onOption("matchCase")}>Aa</button
    >
    <button
      type="button"
      class="icon-btn opt"
      class:on={p.wholeWord}
      aria-pressed={p.wholeWord}
      aria-label="Whole words only"
      title="Whole words only"
      disabled={p.disabled}
      onclick={() => p.onOption("wholeWord")}
    >
      <svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true">
        <text x="9" y="10.5" text-anchor="middle" font-size="9" font-family="inherit" fill="currentColor">ab</text>
        <path d="M2.5 11.5v2h13v-2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </div>

  {#if p.view && !p.disabled}
    <div class="card" role="region" aria-label="Search results">
      <div class="head">
        <span class="count num" aria-live="polite">{label}</span>
        <button type="button" class="icon-btn" aria-label="Previous result" title="Previous result (Shift+F3)" disabled={!p.view.hits.length} onclick={() => p.onStep(-1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10l4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Next result" title="Next result (F3)" disabled={!p.view.hits.length} onclick={() => p.onStep(1)}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Close the search" title="Close the search (Esc in the search box)" onclick={clear}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
        </button>
      </div>
      <SearchResults view={p.view} onSelect={p.onSelect} />
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
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
  .search {
    position: relative;
  }
  .glass {
    position: absolute;
    left: 10px;
    color: var(--tx3);
    pointer-events: none;
  }
  /* Matches the zoom box: a type=search input gets Chromium's own search-field sizing unless
     its appearance is reset. */
  .box {
    appearance: none;
    box-sizing: border-box;
    width: 190px;
    height: 24px;
    margin: 0 2px;
    padding: 0 6px 0 24px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-size: 12px;
    user-select: text;
  }
  .box::-webkit-search-cancel-button {
    display: none;
  }
  .box:focus {
    cursor: text;
  }
  .opt {
    width: 28px;
    font-size: 12px;
    font-weight: 600;
    padding: 0;
  }
  .opt.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .off .glass {
    opacity: 0.5;
  }
  /* Under the box, right-aligned to it, over the drawing; the list scrolls inside. */
  .card {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 40;
    width: 360px;
    max-width: calc(100vw - 24px);
    max-height: min(60vh, 520px);
    display: flex;
    flex-direction: column;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    overflow: hidden;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 4px 12px;
    border-bottom: 1px solid var(--bd);
  }
  .count {
    flex: 1 1 auto;
    color: var(--tx2);
    font-family: var(--font-num);
    font-size: 12px;
    white-space: nowrap;
  }
</style>
