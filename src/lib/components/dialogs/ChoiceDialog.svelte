<script lang="ts">
  // A question with a few answers: save before closing, confirm the first save into a file,
  // restore unsaved markups after a crash. The first primary choice is the default (Enter).
  import Dialog from "../Dialog.svelte";

  export interface Choice {
    label: string;
    primary?: boolean;
    action: () => void;
  }

  interface Props {
    title: string;
    message: string;
    /** Extra paragraphs, each shown as a warning. */
    warnings?: string[];
    /** A quieter note under the message. */
    note?: string | null;
    choices: Choice[];
    /** Escape and the close button. */
    onCancel: () => void;
  }
  let p: Props = $props();
</script>

<Dialog title={p.title} width={460} onClose={p.onCancel}>
  <p class="msg">{p.message}</p>
  {#each p.warnings ?? [] as w (w)}
    <p class="warn">{w}</p>
  {/each}
  {#if p.note}
    <p class="note">{p.note}</p>
  {/if}
  {#snippet footer()}
    {#each p.choices as c (c.label)}
      <button type="button" class="btn" class:primary={c.primary} onclick={c.action}>{c.label}</button>
    {/each}
  {/snippet}
</Dialog>

<style>
  .msg {
    margin: 0 0 10px;
    line-height: 1.45;
  }
  .warn {
    margin: 0 0 10px;
    padding: 8px 10px;
    border-left: 3px solid var(--warn, #d97706);
    background: var(--hover);
    border-radius: 4px;
    line-height: 1.45;
  }
  .note {
    margin: 0;
    color: var(--tx3);
    font-size: 12px;
    line-height: 1.45;
  }
</style>
