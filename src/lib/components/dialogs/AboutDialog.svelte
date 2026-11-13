<script lang="ts">
  // Help > About: version, PDFium build, licences.
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import Dialog from "../Dialog.svelte";
  import { PDFIUM_BUILD } from "../../shell/shortcuts";
  import appIcon from "../../../../src-tauri/icons/source/vellum.svg";
  import { openNotices } from "../../platform";
  import { userMessage } from "../../shell/messages";

  let noticeError = $state<string | null>(null);

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let version = $state("");
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
  .warn {
    color: var(--danger);
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
