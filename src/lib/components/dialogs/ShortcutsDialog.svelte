<script lang="ts">
  // Help > Keyboard shortcuts: every binding, searchable.
  import Dialog from "../Dialog.svelte";
  import { filterShortcuts, SHORTCUTS } from "../../shell/shortcuts";

  interface Props {
    navMode: "cad" | "document";
    onClose: () => void;
  }
  let { navMode, onClose }: Props = $props();

  let q = $state("");
  const groups = $derived(filterShortcuts(SHORTCUTS, q));
  const current = $derived(navMode === "cad" ? "CAD" : "Document");
</script>

<Dialog title="Keyboard shortcuts" width={560} {onClose}>
  <input class="field search" type="search" placeholder="Search shortcuts" aria-label="Search shortcuts" bind:value={q} />
  <div class="groups">
    {#each groups as g (g.title)}
      <h3>{g.title}</h3>
      <table>
        <tbody>
          {#each g.items as s, i (i)}
            <tr class:dim={s.mode && s.mode !== current}>
              <td class="keys">{s.keys}</td>
              <td>{s.action}{#if s.mode}<span class="mode">{s.mode} mode</span>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else}
      <p class="none">No shortcut matches “{q}”.</p>
    {/each}
  </div>
  {#snippet footer()}
    <button type="button" class="btn primary" onclick={onClose}>Close</button>
  {/snippet}
</Dialog>

<style>
  .search {
    width: 100%;
    margin-bottom: 8px;
  }
  .groups {
    height: min(52vh, 460px);
    overflow-y: auto;
  }
  h3 {
    margin: 14px 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--tx3);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    padding: 5px 0;
    border-bottom: 1px solid var(--bd);
    vertical-align: top;
    color: var(--tx2);
  }
  .keys {
    width: 45%;
    font-family: var(--font-num);
    font-size: 12px;
    color: var(--tx);
    padding-right: 12px;
  }
  .mode {
    margin-left: 8px;
    font-size: 11px;
    color: var(--tx3);
  }
  tr.dim td {
    opacity: 0.55;
  }
  .none {
    color: var(--tx3);
  }
</style>
