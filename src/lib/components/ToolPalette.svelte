<script lang="ts">
  // The markup tools in the toolbar's centre: Select, then the first five tools. A tool stays
  // active after drawing; Esc or V goes back to Select.
  import type { Tool } from "../engine/markupTool";

  interface Props {
    tool: Tool;
    disabled: boolean;
    /** Why the tools are off, for their tooltips (e.g. an image). */
    disabledReason?: string;
    onTool: (t: Tool) => void;
  }
  let p: Props = $props();

  const TOOLS: { id: Tool; label: string; tip: string }[] = [
    { id: "select", label: "Select", tip: "Select (V, Esc): click a markup to select it, drag to move, drag on empty drawing to select several" },
    { id: "arrow", label: "Arrow", tip: "Arrow: drag from tail to head; Shift snaps to 15°" },
    { id: "rect", label: "Rectangle", tip: "Rectangle: drag; Shift makes a square" },
    { id: "cloud", label: "Revision cloud", tip: "Revision cloud: click the corners and double-click to finish, or drag a box" },
    { id: "text", label: "Text box", tip: "Text box: drag a box or click, then type; Esc finishes" },
    { id: "ink", label: "Pen", tip: "Pen: draw freehand" },
  ];
</script>

<div class="group" role="radiogroup" aria-label="Markup tools">
  {#each TOOLS as t (t.id)}
    <button
      type="button"
      role="radio"
      aria-checked={p.tool === t.id}
      aria-label={t.label}
      class="icon-btn"
      class:on={p.tool === t.id}
      disabled={p.disabled}
      title={p.disabled && p.disabledReason ? p.disabledReason : t.tip}
      onclick={() => p.onTool(t.id)}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        {#if t.id === "select"}
          <path d="M3.5 2.5l9 5.2-4 1.1 2.3 4.2-1.6.9-2.3-4.2-3.4 2.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
        {:else if t.id === "arrow"}
          <path d="M3 13L12.5 3.5M7.5 3.5h5v5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        {:else if t.id === "rect"}
          <rect x="2.75" y="3.75" width="10.5" height="8.5" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.5" />
        {:else if t.id === "cloud"}
          <path d="M4.2 12.2a2 2 0 0 1-1.6-3.1 2 2 0 0 1 1.4-3.2 2.3 2.3 0 0 1 3.9-1.6 2.3 2.3 0 0 1 4 .9 2 2 0 0 1 1.6 3 2 2 0 0 1-1.7 3.2 2.2 2.2 0 0 1-3.8 1 2.2 2.2 0 0 1-3.8-.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
        {:else if t.id === "text"}
          <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M5 5.5h6M8 5.5v5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        {:else}
          <path d="M2.5 12.5c2-4 3.5-6 5-6s.8 3.5 2.3 3.5S12 6 13.5 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        {/if}
      </svg>
    </button>
  {/each}
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
  .icon-btn.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
