<script lang="ts">
  // The one close button (UI review group E): an X that brightens on hover and darkens when
  // pressed. "large" (32 px) for dialog headers, "small" (20 px) inside tabs. The tooltip and
  // the accessible name are the same text.
  interface Props {
    /** What it closes, as the tooltip and accessible name: "Close", "Close tab", "Close sheet". */
    label?: string;
    size?: "large" | "small";
    /** -1 keeps it out of the Tab order (tabs close with Ctrl+W). */
    tabindex?: number;
    onclick: (e: MouseEvent) => void;
  }
  let { label = "Close", size = "large", tabindex, onclick }: Props = $props();
</script>

<button type="button" class="x {size}" aria-label={label} title={label} {tabindex} {onclick}>
  {#if size === "large"}
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
  {:else}
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
  {/if}
</button>

<style>
  .x {
    border: none;
    background: transparent;
    color: var(--tx3);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
  }
  .large {
    width: 32px;
    height: 32px;
    border-radius: 6px;
  }
  .small {
    width: 20px;
    height: 20px;
    border-radius: 4px;
  }
  .x:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .x:active {
    background: var(--press-soft);
  }
</style>
