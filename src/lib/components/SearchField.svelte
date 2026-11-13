<script lang="ts">
  // The toolbar's search box: type to search the whole document (after a short pause),
  // Enter / Shift+Enter for the next and previous result, Esc to clear. Match case and whole
  // words toggle beside it. Ctrl+F (App.svelte) focuses it.
  interface Props {
    disabled: boolean;
    /** The active document's query, restored when the document changes (docKey). */
    query: string;
    docKey: number | null;
    /** "3 of 27" and the like; empty when there's no search. */
    label: string;
    matchCase: boolean;
    wholeWord: boolean;
    onSearch: (q: string) => void;
    onStep: (dir: 1 | -1) => void;
    onOption: (o: "matchCase" | "wholeWord") => void;
  }
  let p: Props = $props();

  let text = $state("");
  let input: HTMLInputElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The query last handed to onSearch. */
  let sent = "";

  $effect(() => {
    void p.docKey;
    text = p.query;
    sent = p.query;
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
      if (text) {
        text = "";
        run();
      } else input.blur();
    }
  }
</script>

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
  {#if p.label}
    <span class="count num" aria-live="polite">{p.label}</span>
  {/if}
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
  <button type="button" class="icon-btn" aria-label="Previous result" title="Previous result (Shift+F3)" disabled={p.disabled || !p.label} onclick={() => p.onStep(-1)}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10l4.5-4.5 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
  <button type="button" class="icon-btn" aria-label="Next result" title="Next result (F3)" disabled={p.disabled || !p.label} onclick={() => p.onStep(1)}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </button>
</div>

<style>
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
  .box {
    width: 170px;
    height: 24px;
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
  .count {
    min-width: 54px;
    padding: 0 6px;
    color: var(--tx3);
    font-family: var(--font-num);
    font-size: 11px;
    white-space: nowrap;
    text-align: center;
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
</style>
