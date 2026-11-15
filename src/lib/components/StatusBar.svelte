<script lang="ts">
  // Status bar (28 px): drawing scale (click to set), navigation hint, cursor position, page size.
  // A short notice (something that didn't work) takes the hint's place for a few seconds.
  interface Props {
    scaleText: string | null;
    hint: string;
    /** Shown instead of the hint while set. */
    notice?: string | null;
    cursor: string;
    pageSize: string;
    onScale: () => void;
    // Measuring
    /** A measurement's values (being drawn or selected): shown in the hint's place. */
    measure?: string | null;
    /** Set while a measuring tool is out and the page has no scale: offers Calibrate. */
    onCalibrate?: (() => void) | null;
  }
  let { scaleText, hint, notice = null, cursor, pageSize, onScale, measure = null, onCalibrate = null }: Props = $props();
</script>

<footer class="bar">
  <!-- A fixed slot, so the hint doesn't move as the scale appears or changes width. -->
  <span class="slot">
    {#if scaleText}
      <button type="button" class="scale" title="Set the drawing scale" onclick={onScale}>{scaleText}</button>
    {/if}
  </span>
  {#if notice}
    <span class="hint notice" role="status">{notice}</span>
  {:else if measure}
    <span class="hint measure num" title={measure}>{measure}</span>
  {:else}
    <span class="hint">{hint}</span>
  {/if}
  <span class="cursor num">{cursor}</span>
  <span class="size">{pageSize}</span>
  <!-- Measuring -->
  {#if onCalibrate}
    <span class="nosc">
      No scale: <button type="button" class="scale" title="Pick two points on a known dimension and type its length" onclick={onCalibrate}>Calibrate</button>
      or <button type="button" class="scale" title="Type the drawing's scale" onclick={onScale}>Set scale</button>
    </span>
  {/if}
</footer>

<style>
  .bar {
    min-height: 28px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 18px;
    padding: 0 14px;
    background: var(--chrome);
    border-top: 1px solid var(--bd);
    color: var(--tx3);
    font-size: 12px;
    flex-shrink: 0;
  }
  .scale {
    border: none;
    background: transparent;
    color: var(--tx3);
    padding: 2px 6px;
    margin: 0 -6px;
    border-radius: 4px;
    font-size: 12px;
  }
  .scale:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .scale:active {
    background: var(--press-soft);
  }
  .slot {
    min-width: 96px;
    display: flex;
  }
  .notice {
    color: var(--tx);
  }
  /* Measuring */
  .measure {
    color: var(--tx);
  }
  .nosc {
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .nosc .scale {
    margin: 0;
    color: var(--accent);
  }
  .hint {
    flex: 1 1 auto;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .cursor {
    white-space: pre;
    min-width: 19ch;
    text-align: right;
  }
  .size {
    white-space: nowrap;
  }
  @media (max-width: 760px) {
    .hint {
      display: none;
    }
    .cursor {
      margin-left: auto;
    }
  }
</style>
