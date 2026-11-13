<script lang="ts">
  // One level of the PDF bookmark tree (recursive). Top level starts expanded.
  import type { OutlineNode } from "../render/types";
  import OutlineTree from "./OutlineTree.svelte";

  interface Props {
    nodes: OutlineNode[];
    depth?: number;
    onGo: (page: number, y: number | null) => void;
  }
  let { nodes, depth = 0, onGo }: Props = $props();

  // svelte-ignore state_referenced_locally
  let open = $state<boolean[]>(nodes.map(() => depth === 0 && nodes.length < 40));
</script>

<ul role={depth === 0 ? "tree" : "group"}>
  {#each nodes as n, i (i)}
    <li role="treeitem" aria-expanded={n.children.length ? open[i] : undefined} aria-selected="false">
      <div class="row" style:padding-left="{4 + depth * 14}px">
        {#if n.children.length}
          <button type="button" class="tw" aria-label={open[i] ? "Collapse" : "Expand"} onclick={() => (open[i] = !open[i])}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class:open={open[i]}><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        {:else}
          <span class="tw"></span>
        {/if}
        <button
          type="button"
          class="label"
          disabled={n.page === null}
          title={n.page === null ? n.title : `${n.title} (page ${n.page + 1})`}
          onclick={() => n.page !== null && onGo(n.page, n.y)}>{n.title || "(untitled)"}</button
        >
      </div>
      {#if n.children.length && open[i]}
        <OutlineTree nodes={n.children} depth={depth + 1} {onGo} />
      {/if}
    </li>
  {/each}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .row {
    display: flex;
    align-items: center;
    min-height: 26px;
    padding-right: 6px;
    border-radius: 5px;
  }
  .row:hover {
    background: var(--hover);
  }
  .tw {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    padding: 0;
    color: var(--tx3);
    border-radius: 4px;
  }
  .tw:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .tw:active {
    background: var(--press-soft);
  }
  svg {
    transition: transform 0.1s;
  }
  svg.open {
    transform: rotate(90deg);
  }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    border: none;
    background: none;
    padding: 4px 2px;
    text-align: left;
    color: var(--tx2);
    font-size: 12px;
    line-height: 1.35;
  }
  .label:hover:not(:disabled) {
    color: var(--tx);
  }
</style>
