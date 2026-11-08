<script lang="ts">
  // File > Document properties (Ctrl+D).
  import Dialog from "../Dialog.svelte";
  import type { DocInfo } from "../../render/types";
  import { formatBytes } from "../../shell/format";
  import { pageSizeText, type Units } from "../../shell/paper";
  import { scaleStatusText, type DocScale } from "../../shell/scale";

  interface Props {
    path: string;
    info: DocInfo;
    scale: DocScale | null;
    units: Units;
    onClose: () => void;
    onSetScale: () => void;
  }
  let { path, info, scale, units, onClose, onSetScale }: Props = $props();

  // Distinct page sizes with counts, in order of first appearance.
  const sizes = $derived.by(() => {
    const m = new Map<string, number>();
    for (const s of info.sizes) {
      const k = pageSizeText(s.w, s.h, units);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()];
  });

  const rows = $derived(
    [
      ["File", path],
      ["Size", formatBytes(info.meta.fileSize)],
      ["Type", info.kind === "pdf" ? `PDF${info.meta.pdfVersion ? ` ${info.meta.pdfVersion}` : ""}` : "Image"],
      ["Pages", String(info.numPages)],
      ["Title", info.meta.title],
      ["Author", info.meta.author],
      ["Subject", info.meta.subject],
      ["Creator", info.meta.creator],
      ["Producer", info.meta.producer],
      ["Note", info.meta.note],
    ].filter((r): r is [string, string] => !!r[1]),
  );
</script>

<Dialog title="Document properties" width={560} {onClose}>
  <dl>
    {#each rows as [k, v] (k)}
      <dt>{k}</dt>
      <dd class="selectable">{v}</dd>
    {/each}
    <dt>Page {sizes.length > 1 ? "sizes" : "size"}</dt>
    <dd>
      {#each sizes as [s, n] (s)}
        <div>{s}{sizes.length > 1 ? ` (${n} ${n === 1 ? "page" : "pages"})` : ""}</div>
      {/each}
    </dd>
    <dt>Drawing scale</dt>
    <dd>
      {scale ? scaleStatusText(scale).replace(/^Scale /, "") : "Not set"}
      <button type="button" class="link" onclick={onSetScale}>Change…</button>
    </dd>
  </dl>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={onClose}>Close</button>
  {/snippet}
</Dialog>

<style>
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 18px;
    margin: 0;
  }
  dt {
    color: var(--tx3);
  }
  dd {
    margin: 0;
    color: var(--tx);
    word-break: break-word;
  }
  .link {
    border: none;
    background: none;
    color: var(--accent);
    padding: 0 0 0 8px;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
