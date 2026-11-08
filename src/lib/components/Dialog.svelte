<script lang="ts">
  // Modal dialog frame in the print mockup's style: chrome header with a close button, body,
  // footer. Escape and the close button call onClose; focus moves into the dialog on open and
  // Tab stays inside it.
  import { onMount, type Snippet } from "svelte";

  interface Props {
    title: string;
    width?: number;
    onClose: () => void;
    children: Snippet;
    footer?: Snippet;
  }
  let { title, width = 460, onClose, children, footer }: Props = $props();

  let box: HTMLDivElement;

  onMount(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.querySelector<HTMLElement>("[autofocus], input, select, textarea, .btn.primary, button");
    (first ?? box).focus();
    return () => prev?.focus?.();
  });

  function onKey(e: KeyboardEvent) {
    e.stopPropagation(); // the viewer's shortcuts don't apply behind a modal
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const f = [...box.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex='0']")].filter(
      (el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null,
    );
    if (!f.length) return;
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      f[f.length - 1].focus();
    } else if (!e.shiftKey && i === f.length - 1) {
      e.preventDefault();
      f[0].focus();
    }
  }
</script>

<div class="backdrop" role="presentation" onkeydown={onKey} onkeyup={(e) => e.stopPropagation()}>
  <div class="box" role="dialog" aria-modal="true" aria-label={title} tabindex="-1" style:width="{width}px" bind:this={box}>
    <header>
      <span>{title}</span>
      <button type="button" class="x" aria-label="Close" onclick={onClose}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
    </header>
    <div class="body">{@render children()}</div>
    {#if footer}
      <footer>{@render footer()}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.35);
  }
  .box {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    background: var(--app);
    color: var(--tx);
    border: 1px solid var(--bd-strong);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 20px 48px var(--shadow);
    outline: none;
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
  header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .x {
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--tx3);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .x:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .body {
    padding: 18px 20px;
    overflow: auto;
    min-height: 0;
  }
  footer {
    height: 60px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 0 20px;
    border-top: 1px solid var(--bd);
    background: var(--chrome);
  }
</style>
