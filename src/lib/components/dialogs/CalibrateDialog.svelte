<script lang="ts">
  // Calibrate: after two points are picked on a dimension whose real length is known, type that
  // length ("4.2 m", "4200", "4200mm"); the scale is the real length over the picked distance on
  // paper. Applies to this page or every page, and replaces a detected scale.
  import Dialog from "../Dialog.svelte";
  import { calibrate, formatPaper, formatScale, parseDistance } from "../../markup/measure";

  interface Props {
    /** The picked distance on paper, mm. */
    paperMm: number;
    /** 1-based, for the "This page only" choice. */
    page: number;
    numPages: number;
    /** The scale in force on that page, if any (shown for comparison). */
    current: number | null;
    onApply: (ratio: number, pageOnly: boolean) => void;
    onClose: () => void;
  }
  let { paperMm, page, numPages, current, onApply, onClose }: Props = $props();

  let text = $state("");
  let pageOnly = $state(false);
  const real = $derived(parseDistance(text));
  const ratio = $derived(real === null ? null : calibrate(real, paperMm));

  function submit(e: Event) {
    e.preventDefault();
    if (ratio !== null) onApply(ratio, pageOnly);
  }
</script>

<Dialog title="Calibrate" width={420} {onClose}>
  <form id="calform" onsubmit={submit}>
    <p class="lead">
      You picked <b class="num">{formatPaper(paperMm)}</b> on paper. How long is it in reality?
    </p>
    <label class="label" for="cal-in">Real length</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="cal-in" class="field num" placeholder="4.2 m, or 4200 (mm)" autocomplete="off" autofocus bind:value={text} />
    {#if text && real === null}
      <p class="err">Type a length such as 4.2 m, 420 cm or 4200 (millimetres).</p>
    {:else if real !== null && ratio === null}
      <p class="err">That gives a scale out of range. Pick the points further apart, or check the length.</p>
    {:else}
      <p class="result num">
        {#if ratio !== null}Scale {formatScale(ratio)}{#if current !== null}<span class="was"> (was {formatScale(current)})</span>{/if}{:else}&nbsp;{/if}
      </p>
    {/if}
    {#if numPages > 1}
      <fieldset class="apply">
        <legend class="label">Apply to</legend>
        <label><input type="radio" name="cal-to" value={false} bind:group={pageOnly} /> Every page</label>
        <label><input type="radio" name="cal-to" value={true} bind:group={pageOnly} /> This page only (page {page})</label>
      </fieldset>
    {/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onClose}>Cancel</button>
    <button type="submit" form="calform" class="btn primary" disabled={ratio === null}>Set scale</button>
  {/snippet}
</Dialog>

<style>
  .lead {
    margin: 0 0 16px;
    line-height: 1.45;
    color: var(--tx2);
  }
  .label {
    display: block;
    color: var(--tx3);
    font-size: 12px;
    margin-bottom: 6px;
  }
  #cal-in {
    width: 100%;
    box-sizing: border-box;
  }
  .result {
    margin: 8px 0 0;
    color: var(--tx2);
    min-height: 1.3em;
  }
  .was {
    color: var(--tx3);
  }
  .err {
    color: var(--danger);
    margin: 8px 0 0;
  }
  .apply {
    border: none;
    padding: 0;
    margin: 16px 0 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .apply label {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
