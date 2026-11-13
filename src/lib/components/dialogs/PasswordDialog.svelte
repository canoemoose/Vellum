<script lang="ts">
  // Password prompt for a protected PDF. The shell retries the open with what's typed; on
  // a wrong password it reopens this with the message (a full sentence).
  import Dialog from "../Dialog.svelte";

  interface Props {
    fileName: string;
    error: string | null;
    busy: boolean;
    onSubmit: (password: string) => void;
    onCancel: () => void;
  }
  let { fileName, error, busy, onSubmit, onCancel }: Props = $props();

  let pw = $state("");
  let input: HTMLInputElement;

  $effect(() => {
    // A wrong password: select it so the next attempt replaces it.
    if (error && input) input.select();
  });

  function submit(e: Event) {
    e.preventDefault();
    if (pw && !busy) onSubmit(pw);
  }
</script>

<Dialog title="Password required" width={420} onClose={onCancel}>
  <form id="pwform" onsubmit={submit}>
    <p><b class="selectable">{fileName}</b> is protected. Enter its password to open it.</p>
    <label for="pw">Password</label>
    <input id="pw" class="field" type="password" autocomplete="off" bind:value={pw} bind:this={input} disabled={busy} />
    {#if error}
      <p class="err" role="alert">{error} Try again.</p>
    {/if}
  </form>
  {#snippet footer()}
    <button type="button" class="btn" onclick={onCancel}>Cancel</button>
    <button type="submit" form="pwform" class="btn primary" disabled={!pw || busy}>{busy ? "Opening…" : "Open"}</button>
  {/snippet}
</Dialog>

<style>
  p {
    margin: 0 0 14px;
    line-height: 1.45;
    color: var(--tx2);
  }
  label {
    display: block;
    margin-bottom: 6px;
    color: var(--tx3);
    font-size: 12px;
  }
  input {
    width: 100%;
  }
  .err {
    margin: 10px 0 0;
    color: var(--danger);
  }
</style>
