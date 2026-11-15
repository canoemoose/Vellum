<script lang="ts">
  // The Signature tool's picker: the library (pick one to place it; rename and delete as the
  // library does) and "New signature…", which opens the pad in a dialog.
  import StampPanel from "./StampPanel.svelte";
  import SignatureLibrary from "./SignatureLibrary.svelte";
  import type { SignatureItem } from "../../signature/api";

  interface Props {
    onPick: (item: SignatureItem) => void;
    onNew: () => void;
    onClose: () => void;
  }
  let { onPick, onNew, onClose }: Props = $props();

  let library = $state<SignatureLibrary>();

  /** After the pad saves a new one. */
  export function refresh() {
    library?.refresh();
  }
</script>

<StampPanel title="Signature" width={400} {onClose}>
  <p class="hint">Pick a signature, then click on the page to place it or drag to size it.</p>
  <SignatureLibrary bind:this={library} onpick={onPick} />
  {#snippet footer()}
    <button class="btn" onclick={onNew}>New signature…</button>
  {/snippet}
</StampPanel>

<style>
  .hint {
    margin: 0 0 10px;
    font-size: 12px;
    color: var(--tx3);
  }
</style>
