<script lang="ts">
  // Modal dialog frame in the print mockup's style: chrome header with a close button, body,
  // footer. Escape and the close button call onClose; focus moves into the dialog on open and
  // Tab stays inside it.
  import { onMount, type Snippet } from "svelte";
  import CloseButton from "./CloseButton.svelte";

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
    // In priority order, not document order: a selector list would match the header's close X
    // first. Then a field in the body, the primary button, any other button; never the X.
    const body = box.querySelector<HTMLElement>(".body");
    const foot = box.querySelector<HTMLElement>("footer");
    const usable = ":not(:disabled):not([type='hidden'])";
    const first =
      box.querySelector<HTMLElement>("[autofocus]") ??
      body?.querySelector<HTMLElement>(`input${usable}:not([type='radio']:not(:checked)), select${usable}, textarea${usable}`) ??
      foot?.querySelector<HTMLElement>(`.btn.primary${usable}`) ??
      body?.querySelector<HTMLElement>(`button${usable}`) ??
      foot?.querySelector<HTMLElement>(`button${usable}`);
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
      <CloseButton onclick={onClose} />
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
    z-index: var(--z-dialog);
    display: grid;
    place-items: center;
    background: var(--scrim);
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
    box-shadow: var(--shadow-modal);
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
