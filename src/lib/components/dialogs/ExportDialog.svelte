<script module lang="ts">
export interface ExportRequest {
  format: "png" | "jpg";
  dpi: number;
  pages: number[];
}
</script>

<script lang="ts">
  // File > Export pages as images…: PNG or JPEG at a DPI, a page range, into a folder.
  import Dialog from "../Dialog.svelte";
  import { parsePageRange } from "../../shell/format";


  interface Props {
    fileName: string;
    numPages: number;
    currentPage: number;
    /** Progress of a running export, or null. */
    progress: { done: number; total: number } | null;
    result: string | null;
    onExport: (r: ExportRequest) => void;
    onCancel: () => void;
    onClose: () => void;
  }
  let { fileName, numPages, currentPage, progress, result, onExport, onCancel, onClose }: Props = $props();

  let format = $state<"png" | "jpg">("png");
  let dpi = $state(150);
  let which = $state<"all" | "current" | "range">("all");
  let range = $state("");

  const pages = $derived(
    which === "all"
      ? parsePageRange("", numPages)
      : which === "current"
        ? [currentPage]
        : parsePageRange(range, numPages),
  );
  const error = $derived(typeof pages === "string" ? pages : null);

  function go(e: Event) {
    e.preventDefault();
    if (typeof pages !== "string" && !progress) onExport({ format, dpi, pages });
  }
</script>

<Dialog title="Export pages as images" width={460} onClose={progress ? onCancel : onClose}>
  <form id="exportform" onsubmit={go}>
    <p class="lead">Each page of <b class="selectable">{fileName}</b> becomes one image file in a folder you choose.</p>
    <fieldset disabled={!!progress}>
      <div class="row">
        <span class="k">Format</span>
        <label><input type="radio" bind:group={format} value="png" /> PNG</label>
        <label><input type="radio" bind:group={format} value="jpg" /> JPEG</label>
      </div>
      <div class="row">
        <label class="k" for="ex-dpi">Resolution</label>
        <select id="ex-dpi" class="field" bind:value={dpi}>
          <option value={72}>72 dpi (screen)</option>
          <option value={150}>150 dpi</option>
          <option value={300}>300 dpi (print)</option>
          <option value={600}>600 dpi</option>
        </select>
      </div>
      <div class="row top">
        <span class="k">Pages</span>
        <div class="col">
          <label><input type="radio" bind:group={which} value="all" /> All {numPages}</label>
          <label><input type="radio" bind:group={which} value="current" /> Current (page {currentPage + 1})</label>
          <label class="inline">
            <input type="radio" bind:group={which} value="range" /> Range
            {#if which === "range"}
              <input class="field num" placeholder="1-3, 7" aria-label="Page range" bind:value={range} />
            {/if}
          </label>
        </div>
      </div>
    </fieldset>
    {#if error}
      <p class="err">{error}</p>
    {/if}
    {#if progress}
      <div class="progress"><span style:width="{(progress.done / Math.max(1, progress.total)) * 100}%"></span></div>
      <p class="muted">Exporting page {Math.min(progress.done + 1, progress.total)} of {progress.total}…</p>
    {:else if result}
      <p class="muted selectable">{result}</p>
    {:else}
      <p class="muted small">Very large pages are exported at a lower resolution if they'd exceed 120 megapixels. Files with the same names are replaced.</p>
    {/if}
  </form>
  {#snippet footer()}
    {#if progress}
      <button type="button" class="btn" onclick={onCancel}>Stop</button>
    {:else}
      <button type="button" class="btn" onclick={onClose}>{result ? "Close" : "Cancel"}</button>
      <button type="submit" form="exportform" class="btn primary" disabled={!!error}>Choose folder and export…</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .lead {
    margin: 0 0 16px;
    line-height: 1.45;
    color: var(--tx2);
  }
  fieldset {
    border: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 12px;
  }
  .row.top {
    align-items: flex-start;
  }
  .k {
    width: 84px;
    color: var(--tx3);
    flex-shrink: 0;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .inline input.field {
    width: 140px;
    height: 28px;
    margin-left: 6px;
  }
  .err {
    color: var(--danger);
    margin: 0 0 8px;
  }
  .muted {
    color: var(--tx3);
    margin: 8px 0 0;
    line-height: 1.4;
  }
  .small {
    font-size: 12px;
  }
  .progress {
    height: 6px;
    border-radius: 3px;
    background: var(--ctl);
    border: 1px solid var(--bd);
    overflow: hidden;
    margin-top: 6px;
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.2s;
  }
</style>
