<script lang="ts">
  // Help > About: version, updates, PDFium build, licences.
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import Dialog from "../Dialog.svelte";
  import { PDFIUM_BUILD } from "../../shell/shortcuts";
  import appIcon from "../../../../src-tauri/icons/source/vellum.svg";
  import { openNotices } from "../../platform";
  import { userMessage } from "../../shell/messages";
  import { lastCheckedText, stateText } from "../../shell/update";
  import type { UpdaterView } from "../../updater";

  let noticeError = $state<string | null>(null);

  let version = $state("");

  interface Props {
    /** Where the updater is: the same state the notice shows. */
    update: UpdaterView;
    /** The "check automatically" setting. */
    autoCheck: boolean;
    onAutoCheck: (on: boolean) => void;
    onCheck: () => void;
    onInstall: () => void;
    /** The quiet Reset... link: settings, stored previews, signatures and stamps. */
    onReset: () => void;
    onClose: () => void;
  }
  let { update, autoCheck, onAutoCheck, onCheck, onInstall, onReset, onClose }: Props = $props();

  const us = $derived(update.state);
  /** One line on where updates stand: the state's own words, or when it last checked. */
  const updateLine = $derived(
    stateText(us, update.currentVersion || version) ?? lastCheckedText(update.lastCheck, Date.now()) ?? "Not checked yet",
  );
  const canInstall = $derived(us.kind === "available" || us.kind === "blocked" || us.kind === "failed");
  const working = $derived(us.kind === "checking" || us.kind === "downloading" || us.kind === "installing");

  onMount(() => {
    getVersion()
      .then((v) => (version = v))
      .catch(() => (version = "unknown"));
  });
</script>

<Dialog title="About Vellum" width={460} {onClose}>
  <div class="head">
    <img src={appIcon} width="36" height="36" alt="" />
    <div>
      <div class="name">Vellum</div>
      <div class="muted">Version <span class="num selectable">{version}</span></div>
    </div>
  </div>
  <p>A fast PDF and image viewer for CAD drawings. Made by Matt James.</p>
  <h3>Updates</h3>
  <div class="updates">
    <span class="grow" role="status">{updateLine}</span>
    {#if canInstall}
      <button type="button" class="btn small primary" onclick={onInstall}>{us.kind === "available" ? "Install and restart" : "Try again"}</button>
    {:else}
      <button type="button" class="btn small" disabled={working} onclick={onCheck}>Check for updates</button>
    {/if}
  </div>
  <label class="check">
    <input type="checkbox" checked={autoCheck} onchange={(e) => onAutoCheck(e.currentTarget.checked)} />
    <span>Check for updates automatically</span>
  </label>
  <p class="muted small">The check is one request to GitHub, at most once a day. It sends nothing about you or your files.</p>
  <h3>Components and licences</h3>
  <ul>
    <li>PDFium (<span class="num">{PDFIUM_BUILD}</span>), BSD 3-Clause, © The PDFium Authors. Prebuilt by bblanchon/pdfium-binaries.</li>
    <li>Tauri, Svelte, Vite: MIT or Apache 2.0.</li>
    <li>image, fast_image_resize, jpeg-decoder, pdfium-render: MIT or Apache 2.0.</li>
    <li>Inter and JetBrains Mono fonts: SIL Open Font License 1.1.</li>
  </ul>
  <p class="muted small">
    Vellum is open source under the MIT licence. Every component's notice and licence is in
    <button type="button" class="link" onclick={() => openNotices().then(() => (noticeError = null)).catch((e) => (noticeError = userMessage(e, "open the notices")))}>THIRD-PARTY-NOTICES.txt</button>,
    installed beside Vellum.
  </p>
  {#if noticeError}<p class="small warn">{noticeError}</p>{/if}
  {#snippet footer()}
    <button type="button" class="link reset" onclick={onReset}>Reset…</button>
    <button type="button" class="btn primary" onclick={onClose}>Close</button>
  {/snippet}
</Dialog>

<style>
  .head {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-bottom: 14px;
  }
  .name {
    font-size: 18px;
    font-weight: 600;
  }
  .muted {
    color: var(--tx3);
  }
  .updates {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
    color: var(--tx2);
    line-height: 1.45;
  }
  .grow {
    flex: 1 1 auto;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    color: var(--tx2);
  }
  .warn {
    color: var(--danger);
  }
  .reset {
    margin-right: auto;
    font-size: 12px;
    color: var(--tx3);
  }
  .small {
    font-size: 12px;
  }
  p {
    margin: 0 0 14px;
    line-height: 1.45;
    color: var(--tx2);
  }
  h3 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
  }
  ul {
    margin: 0 0 14px;
    padding-left: 18px;
    color: var(--tx2);
    line-height: 1.5;
  }
</style>
