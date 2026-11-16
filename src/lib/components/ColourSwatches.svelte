<script lang="ts">
  // A colour from the line palette (markup/palette.ts), or a custom one from the picker: the
  // context bar's swatches, for wherever else a colour is chosen (a text stamp's). `colours`
  // gives a list of its own (the signature pad's pen inks); `value` null marks none of them.
  import ColourPicker from "./ColourPicker.svelte";
  import type { Rgb } from "../markup/types";
  import { LINE_COLOURS } from "../markup/palette";
  import { sameColour } from "../markup/colour";

  interface Props {
    value: Rgb | null;
    onPick: (c: Rgb) => void;
    label?: string;
    colours?: readonly { name: string; c: Rgb }[];
  }
  let { value, onPick, label = "Colour", colours = LINE_COLOURS }: Props = $props();

  let anchor = $state<DOMRect | null>(null);
  const css = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;
  const isCustom = $derived(value !== null && !colours.some((q) => sameColour(q.c, value)));
</script>

<span class="swatches" role="radiogroup" aria-label={label}>
  {#each colours as col (col.name)}
    {@const on = sameColour(value, col.c)}
    <button type="button" class="sw" class:on role="radio" aria-checked={on} aria-label={col.name} title={col.name} style:--c={css(col.c)} onclick={() => onPick(col.c)}></button>
  {/each}
  <button
    type="button"
    class="sw custom"
    class:on={isCustom}
    aria-label="Custom colour"
    aria-haspopup="dialog"
    title="Custom colour, or pick one from the screen"
    style:--c={isCustom && value ? css(value) : ""}
    onclick={(e) => (anchor = anchor ? null : (e.currentTarget as HTMLElement).getBoundingClientRect())}
  ></button>
</span>

{#if anchor}
  <ColourPicker value={value ?? [0, 0, 0]} {anchor} onPick={(c) => onPick(c)} onClose={() => (anchor = null)} />
{/if}

<style>
  .swatches {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  /* As the context bar's. */
  .sw {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22);
    cursor: pointer;
    flex-shrink: 0;
  }
  .sw.on {
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22), 0 0 0 2px var(--app), 0 0 0 4px var(--accent);
  }
  .sw.custom {
    background: var(--c, conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00));
  }
  .sw.custom:not(.on) {
    background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
</style>
