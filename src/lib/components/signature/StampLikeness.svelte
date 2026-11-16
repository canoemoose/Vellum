<script lang="ts">
  // A small likeness of a stamp: the one preview for the stamp grid's tiles and the context bar's
  // replace button (Matt's review). A text stamp as an HTML stand-in (its second line too, when
  // `sub` and there's room), a picture or an imported signature from its PNG, a drawn signature
  // as its strokes. All in memory, from content already loaded; nothing is written anywhere.
  import { type StampContent, strokesBox } from "../../markup/stamps";
  import { textWidth } from "../../markup/fonts";

  let { content, size = 9, sub = true, maxWidth = 120 }: { content: StampContent; size?: number; sub?: boolean; maxWidth?: number } = $props();

  const css = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;
  const box = $derived(content.type === "strokes" ? strokesBox(content) : null);
  /** A picture or signature's height: about two lines of a text stamp's lettering. */
  const h = $derived(Math.round(size * 2.2));
  /**
   * A text stamp's lettering, shrunk to fit `maxWidth` (a long wording isn't cut off): measured
   * with the metrics the stamp itself is drawn with, less its padding and border.
   */
  const fit = $derived.by(() => {
    if (content.type !== "text") return size;
    const room = maxWidth - 16;
    const main = textWidth(content.label.toUpperCase(), size, { family: "helvetica", bold: true, italic: false }) * 1.02;
    const second = sub && content.sub ? textWidth(content.sub, size * 0.7, { family: "helvetica", bold: false, italic: false }) : 0;
    const w = Math.max(main, second);
    return w > room ? Math.max(5, (size * room) / w) : size;
  });
</script>

{#if content.type === "text"}
  <span class="text" style:color={css(content.colour)} style:font-size="{fit}px" style:max-width="{maxWidth}px">
    <span class="main">{content.label.toUpperCase()}</span>
    {#if sub && content.sub}<span class="sub">{content.sub}</span>{/if}
  </span>
{:else if content.type === "image"}
  <img src="data:image/png;base64,{content.png}" alt="" style:max-height="{h}px" style:max-width="{maxWidth}px" />
{:else if box}
  <svg viewBox="{box[0]} {box[1]} {box[2] - box[0]} {box[3] - box[1]}" style:height="{h}px" style:max-width="{maxWidth}px" aria-hidden="true">
    {#each content.strokes as s, i (i)}
      <polyline points={s.join(" ")} fill="none" stroke={css(content.colour)} stroke-width={content.pen} stroke-linecap="round" stroke-linejoin="round" />
    {/each}
  </svg>
{/if}

<style>
  /* On white, as on the page. */
  .text {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 1px 6px;
    overflow: hidden;
    white-space: nowrap;
    border: 1.5px solid currentColor;
    border-radius: 3px;
    background: var(--paper);
    font-family: Helvetica, Arial, sans-serif;
    line-height: 1.15;
  }
  .main {
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .sub {
    font-size: 0.7em;
  }
  img,
  svg {
    display: block;
    background: var(--paper);
    border-radius: 2px;
  }
</style>
