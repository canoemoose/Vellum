<script lang="ts">
  // "New signature…": the pad (draw, or import a photo and frame it) in a large modal dialog
  // that can be resized by its corner, since the framing view needs room. Saving adds it to the
  // library and hands it back to be placed.
  import { onMount } from "svelte";
  import CloseButton from "../CloseButton.svelte";
  import SignaturePad from "./SignaturePad.svelte";
  import type { SignatureItem } from "../../signature/api";

  interface Props {
    onSaved: (item: SignatureItem) => void;
    onClose: () => void;
  }
  let { onSaved, onClose }: Props = $props();

  let box: HTMLDivElement;

  onMount(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.focus();
    return () => prev?.focus?.();
  });

  function onKey(e: KeyboardEvent) {
    // The viewer's shortcuts don't apply behind a modal.
    e.stopPropagation();
    // The pad and the framing view handle their own Escape first (they stop it there).
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
</script>

<div class="backdrop" role="presentation" onkeydown={onKey} onkeyup={(e) => e.stopPropagation()}>
  <div class="box" role="dialog" aria-modal="true" aria-label="New signature" tabindex="-1" bind:this={box}>
    <header>
      <span>New signature</span>
      <CloseButton onclick={onClose} />
    </header>
    <div class="body">
      <SignaturePad onsaved={onSaved} />
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-dialog);
    display: grid;
    place-items: center;
    background: var(--scrim);
  }
  .box {
    width: min(920px, calc(100vw - 32px));
    height: min(720px, calc(100vh - 32px));
    min-width: min(560px, calc(100vw - 32px));
    min-height: min(440px, calc(100vh - 32px));
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--app);
    color: var(--tx);
    border: 1px solid var(--bd-strong);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: var(--shadow-modal);
    outline: none;
    /* Drag the bottom-right corner to make room for the framing view. */
    resize: both;
  }
  header {
    height: 48px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--bd);
    background: var(--chrome);
    font-size: 15px;
    font-weight: 600;
  }
  .body {
    flex: 1;
    min-height: 0;
    padding: 16px 20px;
    overflow: auto;
  }
</style>
