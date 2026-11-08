<script lang="ts">
  // Placeholder so the shell can wire File > Print... before WP-Print lands.
  // WP-Print replaces this file; keep the props.
  import type { PrintContext } from "../../print/context";

  let { open, context, onClose }: { open: boolean; context: PrintContext | null; onClose: () => void } =
    $props();
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={onClose}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Print">
      <p>Printing isn't built yet ({context?.docs.length ?? 0} documents open).</p>
      <button type="button" onclick={onClose}>Close</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.4);
  }
  .dialog {
    padding: 24px;
    background: var(--app, #1b1c1f);
    color: var(--tx, #e6e6e6);
    border-radius: 8px;
  }
</style>
