<script lang="ts">
  // Help > About > Reset...: three separate resets, any mix. Settings are cleared at the next
  // start (shell/reset.ts), so Vellum closes; so it does for the libraries, whose pickers may
  // be holding what was just deleted. Previews alone need no restart.
  import Dialog from "../Dialog.svelte";
  import { exitApp, resetProfile } from "../../platform";
  import { markForReset } from "../../shell/reset";
  import { userMessage } from "../../shell/messages";

  interface Props {
    /** Files open with unsaved changes: closing would lose them, so nothing is offered. */
    unsaved: number;
    onClose: () => void;
  }
  let { unsaved, onClose }: Props = $props();

  let settings = $state(true);
  let previews = $state(false);
  let library = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let done = $state(false);

  const closes = $derived(settings || library);
  const blocked = $derived(closes && unsaved > 0);
  const none = $derived(!settings && !previews && !library);

  async function reset() {
    busy = true;
    error = null;
    try {
      if (previews || library) await resetProfile(previews, library);
      if (settings && !markForReset()) throw new Error("Settings couldn't be marked for reset.");
      if (closes) await exitApp(0);
      else done = true;
    } catch (e) {
      error = userMessage(e, "reset");
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title="Reset" width={440} {onClose}>
  <label class="check">
    <input type="checkbox" bind:checked={settings} disabled={busy} />
    <span>
      <b>Settings</b>
      <span class="muted">Theme, layout, window, recent files, what's remembered about each file, tool styles and print layouts.</span>
    </span>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={previews} disabled={busy} onchange={() => (done = false)} />
    <span>
      <b>Stored page previews</b>
      <span class="muted">Made again as files are opened.</span>
    </span>
  </label>
  <label class="check">
    <input type="checkbox" bind:checked={library} disabled={busy} />
    <span>
      <b>Signatures and stamps</b>
      <span class="muted">Every saved signature and every stamp of your own. This can't be undone.</span>
    </span>
  </label>
  <p class="note" role="status">
    {#if error}
      <span class="warn">{error}</span>
    {:else if blocked}
      <span class="warn">Save or close {unsaved === 1 ? "the file" : "the files"} with unsaved changes first: Vellum closes to reset.</span>
    {:else if done}
      Stored page previews cleared.
    {:else if closes}
      Vellum will close. Open it again to carry on.
    {/if}
  </p>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onClose}>{done ? "Close" : "Cancel"}</button>
    <button type="button" class="btn" class:danger={library} disabled={busy || none || blocked} onclick={() => void reset()}>
      {closes ? "Reset and close Vellum" : "Reset"}
    </button>
  {/snippet}
</Dialog>

<style>
  .check {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
    color: var(--tx2);
    line-height: 1.45;
  }
  .check input {
    margin-top: 3px;
  }
  .check b {
    display: block;
    font-weight: 600;
    color: var(--tx);
  }
  .muted {
    color: var(--tx3);
    font-size: 12px;
  }
  .note {
    min-height: 18px;
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--tx2);
  }
  .warn {
    color: var(--danger);
  }
</style>
