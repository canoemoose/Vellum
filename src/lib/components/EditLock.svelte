<script lang="ts">
  // The "Edit file" lock: a switch in a block of its own, with the document's controls at the
  // left of the toolbar (docs/editing-scope.md, "The edit lock"). It's the file's lock, not a
  // tool's: today it guards the annotations that came with the file, and page operations
  // (reorder, add, delete) will sit behind it too, so it's kept away from the markup tools,
  // where it read as switching them on. Per tab, locked on every open. Locked, annotations
  // that came with the file can't be changed (your own Vellum markups excepted); unlocked,
  // they can be moved, restyled and deleted.
  interface Props {
    unlocked: boolean;
    disabled: boolean;
    onToggle: () => void;
  }
  let p: Props = $props();
  const tip = $derived(
    p.disabled
      ? "Edit file"
      : p.unlocked
        ? "Edit file: unlocked. Annotations that came with the file can be moved, restyled and deleted. Click to lock."
        : "Edit file: locked. Click to unlock, to move, restyle or delete annotations that came with the file.",
  );
</script>

<div class="lock">
  <button type="button" class="sw" class:on={p.unlocked} role="switch" aria-checked={p.unlocked} aria-label="Edit file" title={tip} disabled={p.disabled} onclick={p.onToggle}>
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <!-- Open: the body to the left and the shackle swung out on its right leg, so it reads open. -->
      {#if p.unlocked}
        <rect x="1.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M8.5 7V4.5a2.5 2.5 0 0 1 5 0V6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        <path d="M6 9.6v1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      {:else}
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.3" />
        <path d="M8 9.6v1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
      {/if}
    </svg>
    <span class="lbl">Edit file</span>
    <span class="track" aria-hidden="true"><span class="knob"></span></span>
  </button>
</div>

<style>
  /* The same box as the groups beside it (30 px inside 2 px padding and a 1 px border). */
  .lock {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    padding: 2px;
    background: var(--ctl);
    border: 1px solid var(--bd-ctl);
    border-radius: 8px;
  }
  .sw {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--tx);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .sw:hover:not(:disabled) {
    background: var(--hover, rgba(127, 127, 127, 0.14));
  }
  .sw:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .sw.on {
    color: var(--accent-text);
  }
  .lbl {
    white-space: nowrap;
  }
  /* The switch itself: a bordered track (a filled control needs a visible edge) and a knob. */
  .track {
    position: relative;
    width: 26px;
    height: 14px;
    border-radius: 7px;
    border: 1px solid var(--bd-strong);
    background: transparent;
    flex: 0 0 auto;
    box-sizing: border-box;
  }
  .knob {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--tx);
    opacity: 0.7;
    transition: transform 0.12s ease;
  }
  .on .track {
    background: var(--accent);
    border-color: var(--accent-bd);
  }
  .on .knob {
    transform: translateX(12px);
    background: #fff;
    opacity: 1;
  }
</style>
