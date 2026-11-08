<script lang="ts">
  // Help > About: version, PDFium build, licences.
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import Dialog from "../Dialog.svelte";
  import { PDFIUM_BUILD } from "../../shell/shortcuts";

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
    <svg width="36" height="36" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="none" stroke="var(--accent)" stroke-width="1.2" />
      <path d="M5 5.5h6M5 8h6M5 10.5h3.5" stroke="var(--accent)" stroke-width="1.2" stroke-linecap="round" />
    </svg>
    <div>
      <div class="name">Vellum</div>
      <div class="muted">Version <span class="num selectable">{version}</span></div>
    </div>
  </div>
  <p>A fast PDF and image viewer for CAD drawings. Made by Event Engineering.</p>
  <h3>Components and licences</h3>
  <ul>
    <li>PDFium (<span class="num">{PDFIUM_BUILD}</span>), BSD 3-Clause, © The PDFium Authors. Prebuilt by bblanchon/pdfium-binaries.</li>
    <li>Tauri, Svelte, Vite: MIT or Apache 2.0.</li>
    <li>image, fast_image_resize, jpeg-decoder, pdfium-render: MIT or Apache 2.0.</li>
    <li>Inter and JetBrains Mono fonts: SIL Open Font Licence 1.1.</li>
  </ul>
  <p class="muted small">The PDFium licence is installed alongside Vellum in <span class="num">licenses\PDFIUM-LICENSE.txt</span>.</p>
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
