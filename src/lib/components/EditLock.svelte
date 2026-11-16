<script lang="ts">
  // The "Edit document" padlock beside the markup tools (docs/editing-scope.md, "The edit lock").
  // Per tab, locked on every open. Locked, annotations that came with the file can't be picked
  // (your own Vellum markups excepted); unlocked, they can be moved, restyled and deleted.
  interface Props {
    unlocked: boolean;
    disabled: boolean;
    onToggle: () => void;
  }
  let p: Props = $props();
  const tip = $derived(
    p.disabled
      ? "Edit document"
      : p.unlocked
        ? "Edit document: unlocked. Annotations that came with the file can be moved, restyled and deleted. Click to lock."
        : "Edit document: locked. Click to unlock, to move, restyle or delete annotations that came with the file.",
  );
</script>

<div class="lock">
  <button type="button" class="icon-btn" class:on={p.unlocked} aria-pressed={p.unlocked} aria-label="Edit document" title={tip} disabled={p.disabled} onclick={p.onToggle}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" />
      {#if p.unlocked}
        <path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      {:else}
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.3" />
      {/if}
      <path d="M8 9.6v1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
    </svg>
  </button>
</div>

<style>
  .lock {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    margin-left: 6px;
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
