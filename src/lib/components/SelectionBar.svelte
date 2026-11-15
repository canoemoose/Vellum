<script lang="ts">
  // A small bar beside selected text (App.svelte places it just past the selection's last
  // line): Highlight, Underline, Strike through, and Copy. Hidden while the left button is held
  // on the drawing, so it doesn't chase a selection being dragged out.
  import { onMount } from "svelte";
  import type { TextMarkVariant } from "../markup/kinds/textmark";

  interface Props {
    /** Where the bar's top-left corner goes, CSS px in the stage; clamped to fit. */
    x: number;
    y: number;
    areaW: number;
    areaH: number;
    onMark: (v: TextMarkVariant) => void;
    onCopy: () => void;
  }
  let p: Props = $props();
  let w = $state(0);
  let h = $state(0);
  let pressed = $state(false);

  const left = $derived(Math.max(6, Math.min(p.x, p.areaW - w - 6)));
  const top = $derived(Math.max(6, Math.min(p.y, p.areaH - h - 6)));

  onMount(() => {
    // Only presses on the drawing (the canvas) hide it; its own buttons don't.
    const down = (e: PointerEvent) => {
      if (e.button === 0 && e.target instanceof HTMLCanvasElement) pressed = true;
    };
    const up = () => (pressed = false);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  });

  const BUTTONS: { v: TextMarkVariant; label: string; keys: string }[] = [
    { v: "highlight", label: "Highlight", keys: "Ctrl+H" },
    { v: "underline", label: "Underline", keys: "Ctrl+U" },
    { v: "strike", label: "Strike through", keys: "Ctrl+Shift+X" },
  ];
</script>

{#if !pressed}
  <div class="selbar" role="toolbar" aria-label="Selected text" style:left="{left}px" style:top="{top}px" bind:clientWidth={w} bind:clientHeight={h}>
    {#each BUTTONS as b (b.v)}
      <button type="button" title="{b.label} ({b.keys})" aria-label={b.label} onclick={() => p.onMark(b.v)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          {#if b.v === "highlight"}
            <rect x="2" y="3" width="12" height="10" rx="1" fill="currentColor" opacity="0.3" />
            <path d="M5.5 11l2.5-6.5 2.5 6.5M6.4 8.8h3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
          {:else if b.v === "underline"}
            <path d="M5 2.5v5a3 3 0 0 0 6 0v-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            <path d="M3.5 13.5h9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          {:else}
            <path d="M11 4.2c-.6-.9-1.7-1.4-3-1.4-1.7 0-3 .9-3 2.3 0 2.8 6 1.8 6 5 0 1.4-1.3 2.4-3 2.4-1.4 0-2.6-.6-3.2-1.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            <path d="M2.5 8h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          {/if}
        </svg>
      </button>
    {/each}
    <span class="sep" aria-hidden="true"></span>
    <button type="button" title="Copy (Ctrl+C)" aria-label="Copy" onclick={() => p.onCopy()}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="5.25" y="5.25" width="8" height="8.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M3.25 10.5v-7.25a1 1 0 0 1 1-1h6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      </svg>
    </button>
  </div>
{/if}

<style>
  .selbar {
    position: absolute;
    z-index: 6;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--app);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
  }
  button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--tx2);
  }
  button:hover {
    background: var(--hover);
    color: var(--tx);
  }
  button:active {
    background: var(--press-soft);
  }
  .sep {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: var(--bd-strong);
  }
</style>
