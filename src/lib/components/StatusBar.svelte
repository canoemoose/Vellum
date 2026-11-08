<script lang="ts">
  // Status bar (28 px): drawing scale (click to set), navigation hint, cursor position, page size.
  interface Props {
    scaleText: string | null;
    hint: string;
    cursor: string;
    pageSize: string;
    onScale: () => void;
  }
  let { scaleText, hint, cursor, pageSize, onScale }: Props = $props();
</script>

<footer class="bar">
  {#if scaleText}
    <button type="button" class="scale" title="Set the drawing scale" onclick={onScale}>{scaleText}</button>
  {/if}
  <span class="hint">{hint}</span>
  <span class="cursor num">{cursor}</span>
  <span class="size">{pageSize}</span>
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
