<script lang="ts">
  // The update notice: a small card in the top-right of the document area, never a dialog.
  // It announces a new version, shows the download, and answers a manual check. What it says
  // and when it appears is decided in shell/update.ts and updater.ts; this only draws it.
  import { progressPercent, stateText, type UpdateState } from "../shell/update";
  import CloseButton from "./CloseButton.svelte";

  interface Props {
    state: UpdateState;
    currentVersion: string;
    onInstall: () => void;
    onNotes: () => void;
    onLater: () => void;
    onDismiss: () => void;
  }
  let { state: s, currentVersion, onInstall, onNotes, onLater, onDismiss }: Props = $props();

  const text = $derived(stateText(s, currentVersion));
  const percent = $derived(s.kind === "downloading" ? progressPercent(s.received, s.total) : null);
  /** States that only report something: they close with the X, or by themselves. */
  const report = $derived(s.kind === "upToDate" || s.kind === "checkFailed");

  $effect(() => {
    if (s.kind !== "upToDate") return;
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  });
</script>

{#if text}
  <div class="notice" role="status" aria-live="polite">
    <div class="top">
      <p class:strong={s.kind === "available"}>{text}</p>
      {#if report}
        <CloseButton label="Close" size="small" onclick={onDismiss} />
      {/if}
    </div>
    {#if s.kind === "downloading" || s.kind === "installing"}
      <div class="track" class:busy={percent === null || s.kind === "installing"}>
        <div class="fill" style:width="{s.kind === 'installing' ? 100 : (percent ?? 100)}%"></div>
      </div>
    {/if}
    {#if s.kind === "available"}
      <div class="row">
        <button type="button" class="btn small primary" onclick={onInstall}>Install and restart</button>
        <button type="button" class="btn small" onclick={onNotes}>What's new</button>
        <button type="button" class="btn small ghost" onclick={onLater}>Later</button>
      </div>
    {:else if s.kind === "blocked" || s.kind === "failed"}
      <div class="row">
        <button type="button" class="btn small primary" onclick={onInstall}>Try again</button>
        <button type="button" class="btn small ghost" onclick={onLater}>Later</button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .notice {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 20;
    width: max-content;
    max-width: min(380px, calc(100% - 24px));
    padding: 12px 14px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    color: var(--tx2);
  }
  .top {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  p {
    margin: 0;
    flex: 1 1 auto;
    line-height: 1.45;
  }
  p.strong {
    color: var(--tx);
    font-weight: 600;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .track {
    height: 4px;
    margin-top: 10px;
    border-radius: 2px;
    background: var(--bd-strong);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.2s linear;
  }
  /* Size not known yet, or the installer is starting: a pulse instead of a length. */
  .track.busy .fill {
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .track.busy .fill {
      animation: none;
    }
    .fill {
      transition: none;
    }
  }
</style>
