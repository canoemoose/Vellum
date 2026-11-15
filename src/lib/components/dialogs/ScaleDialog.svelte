<script lang="ts">
  // Document > Drawing scale…: pick a detected candidate, a preset or type a ratio; or clear it.
  import Dialog from "../Dialog.svelte";
  import type { ScaleCandidate } from "../../render/types";
  import { formatRatio, parseScaleInput, SCALE_PRESETS, type DocScale } from "../../shell/scale";

  interface Props {
    fileName: string;
    current: DocScale | null;
    candidates: ScaleCandidate[] | null;
    onApply: (ratio: number | null) => void;
    onClose: () => void;
    // Measuring
    /** The page in view (1-based) and its own scale, offered as "This page only" when given. */
    page?: number | null;
    pageScale?: DocScale | null;
    onApplyPage?: ((ratio: number | null) => void) | null;
  }
  let { fileName, current, candidates, onApply, onClose, page = null, pageScale = null, onApplyPage = null }: Props = $props();
  // Measuring
  // svelte-ignore state_referenced_locally
  let pageOnly = $state(!!pageScale);

  // svelte-ignore state_referenced_locally
  let text = $state((pageScale ?? current) ? formatRatio((pageScale ?? current)!.ratio) : "");
  const parsed = $derived(parseScaleInput(text));
  const uniqueCands = $derived.by(() => {
    const seen = new Set<number>();
    return (candidates ?? []).filter((c) => !seen.has(c.ratio) && seen.add(c.ratio)).slice(0, 5);
  });

  function submit(e: Event) {
    e.preventDefault();
    if (parsed !== null) (pageOnly && onApplyPage ? onApplyPage : onApply)(parsed);
  }
</script>

<Dialog title="Drawing scale" width={440} {onClose}>
  <form id="scaleform" onsubmit={submit}>
    <p class="lead">
      The scale of <b class="selectable">{fileName}</b> as drawn, used for real-world coordinates in the status bar and for
      printing to scale.
    </p>

    {#if candidates === null}
      <p class="muted">Looking for a scale on the page…</p>
    {:else if uniqueCands.length}
      <div class="label">Found on the page</div>
      <div class="chips">
        {#each uniqueCands as c (c.ratio)}
          <button type="button" class="chip" class:on={parsed === c.ratio} title="Written as “{c.text}”" onclick={() => (text = formatRatio(c.ratio))}>
            {formatRatio(c.ratio)}
          </button>
        {/each}
      </div>
    {:else}
      <p class="muted">No scale was found in the page text.</p>
    {/if}

    <label class="label" for="scale-in">Scale</label>
    <div class="row">
      <input id="scale-in" class="field num" placeholder="1:100" autocomplete="off" bind:value={text} />
      <select class="field" aria-label="Common scales" onchange={(e) => (text = (e.currentTarget as HTMLSelectElement).value)}>
        <option value="" selected disabled>Common scales</option>
        {#each SCALE_PRESETS as r (r)}
          <option value={formatRatio(r)}>{formatRatio(r)}</option>
        {/each}
      </select>
    </div>
    {#if text && parsed === null}
      <p class="err">Type a ratio such as 1:100 (or just 100).</p>
    {/if}
    <!-- Measuring -->
    {#if onApplyPage && page !== null}
      <label class="pageonly"><input type="checkbox" bind:checked={pageOnly} /> This page only (page {page})</label>
    {/if}
  </form>
  {#snippet footer()}
    {#if pageOnly && onApplyPage && pageScale}
      <button type="button" class="btn ghost clear" onclick={() => onApplyPage(null)}>Clear this page's scale</button>
    {:else if current && !pageOnly}
      <button type="button" class="btn ghost clear" onclick={() => onApply(null)}>Clear scale</button>
    {/if}
    <button type="button" class="btn" onclick={onClose}>Cancel</button>
    <button type="submit" form="scaleform" class="btn primary" disabled={parsed === null}>Set scale</button>
  {/snippet}
</Dialog>

<style>
  .lead {
    margin: 0 0 16px;
    line-height: 1.45;
    color: var(--tx2);
  }
  .muted {
    color: var(--tx3);
    margin: 0 0 16px;
  }
  .label {
    display: block;
    color: var(--tx3);
    font-size: 12px;
    margin-bottom: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 16px;
  }
  .chip {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--bd-input);
    background: var(--ctl);
    border-radius: 14px;
    font-family: var(--font-num);
    font-size: 12px;
  }
  .chip:hover:not(.on) {
    background: var(--tab-on);
  }
  .chip:active {
    background: var(--press);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .row input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .err {
    color: var(--danger);
    margin: 8px 0 0;
  }
  .clear {
    margin-right: auto;
  }
  /* Measuring */
  .pageonly {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
    color: var(--tx2);
  }
</style>
