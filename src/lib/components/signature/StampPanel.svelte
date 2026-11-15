<script lang="ts">
  // The frame the Signature and Stamp tools' pickers sit in: a panel dropped from the top of
  // the drawing area, with a title, a close button and a layer behind it that catches clicks,
  // so nothing is placed until something is picked. Esc or a click outside closes it.
  import type { Snippet } from "svelte";
  import CloseButton from "../CloseButton.svelte";

  interface Props {
    title: string;
    width?: number;
    onClose: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { title, width = 380, onClose, children, footer }: Props = $props();

  function onKey(e: KeyboardEvent) {
    // The viewer's shortcuts don't apply while picking.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function focusFirst(el: HTMLElement) {
    (el.querySelector<HTMLElement>("[autofocus], button.pick, button") ?? el).focus();
  }
</script>

<div class="catch" role="presentation" onpointerdown={onClose}></div>
<div class="panel" role="dialog" aria-label={title} tabindex="-1" style:width="{width}px" onkeydown={onKey} use:focusFirst>
  <header>
    <span>{title}</span>
    <CloseButton onclick={onClose} />
  </header>
  <div class="body">{@render children()}</div>
  {#if footer}
    <footer>{@render footer()}</footer>
  {/if}
</div>

<style>
  .catch {
    position: absolute;
    inset: 0;
    z-index: calc(var(--z-menu) - 1);
  }
  .panel {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: var(--z-menu);
    max-width: calc(100% - 24px);
    max-height: calc(100% - 24px);
    display: flex;
    flex-direction: column;
    background: var(--app);
    color: var(--tx);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    outline: none;
    overflow: hidden;
  }
  header {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--bd);
    font-size: 13px;
    font-weight: 600;
  }
  .body {
    padding: 10px 12px;
    overflow: auto;
    min-height: 0;
  }
  footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid var(--bd);
  }
</style>
