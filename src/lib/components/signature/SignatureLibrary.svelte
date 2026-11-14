<script lang="ts">
  // The saved signatures: previews and names, pick one, rename, delete. Files that can't be
  // read (damaged, or saved by another Windows account) are counted and can be removed.
  // Standalone like SignaturePad; call `refresh()` after saving a new one.
  import { onMount } from "svelte";
  import {
    deleteSignature,
    listSignatures,
    pngUrl,
    renameSignature,
    signatureMessage,
    type SignatureItem,
  } from "../../signature/api";

  interface Props {
    /** Called when a signature is chosen (for placing, later). */
    onpick?: (item: SignatureItem) => void;
    selectedId?: string | null;
  }
  let { onpick, selectedId = null }: Props = $props();

  let items = $state<SignatureItem[]>([]);
  let unreadable = $state<string[]>([]);
  let urls = new Map<string, string>();
  let loaded = $state(false);
  let error = $state("");
  let renaming = $state<string | null>(null);
  let renameValue = $state("");
  let confirming = $state<string | null>(null);

  function thumbUrl(item: SignatureItem): string {
    let u = urls.get(item.id);
    if (!u) {
      u = pngUrl(item.thumb);
      urls.set(item.id, u);
    }
    return u;
  }

  export async function refresh() {
    try {
      const l = await listSignatures();
      const keep = new Set(l.items.map((i) => i.id));
      for (const [id, u] of urls) {
        if (!keep.has(id)) {
          URL.revokeObjectURL(u);
          urls.delete(id);
        }
      }
      items = l.items;
      unreadable = l.unreadable;
      error = "";
    } catch (e) {
      console.error("[signature] list failed:", e);
      error = signatureMessage(e, "read your signatures");
    } finally {
      loaded = true;
    }
  }

  onMount(() => {
    refresh();
    return () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    };
  });

  function startRename(item: SignatureItem) {
    confirming = null;
    renaming = item.id;
    renameValue = item.name;
  }

  async function commitRename(item: SignatureItem) {
    if (renaming !== item.id) return;
    renaming = null;
    const name = renameValue.trim();
    if (!name || name === item.name) return;
    try {
      const m = await renameSignature(item.id, name);
      items = items.map((i) => (i.id === m.id ? { ...i, name: m.name } : i));
    } catch (e) {
      console.error("[signature] rename failed:", e);
      error = signatureMessage(e, "rename the signature");
    }
  }

  async function remove(id: string) {
    confirming = null;
    try {
      await deleteSignature(id);
    } catch (e) {
      console.error("[signature] delete failed:", e);
      error = signatureMessage(e, "delete the signature");
    }
    await refresh();
  }

  async function removeUnreadable() {
    for (const id of unreadable) {
      try {
        await deleteSignature(id);
      } catch (e) {
        console.error("[signature] delete failed:", e);
      }
    }
    await refresh();
  }

  /** Focus and select a field as it appears. */
  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

<div class="library">
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if loaded && items.length === 0 && unreadable.length === 0}
    <p class="empty">No signatures yet. Draw or import one to keep it here.</p>
  {/if}

  <ul>
    {#each items as item (item.id)}
      <li class:selected={item.id === selectedId}>
        <button class="pick" onclick={() => onpick?.(item)} title="Use this signature" disabled={renaming === item.id}>
          <span class="thumb"><img src={thumbUrl(item)} alt="" /></span>
          {#if renaming !== item.id}
            <span class="text">
              <span class="name">{item.name}</span>
              <span class="kind">{item.kind === "drawn" ? "Drawn" : "Imported"}</span>
            </span>
          {/if}
        </button>
        {#if renaming === item.id}
          <input
            class="field rename"
            maxlength="80"
            aria-label="New name"
            bind:value={renameValue}
            use:focusSelect
            onkeydown={(e) => {
              if (e.key === "Enter") commitRename(item);
              if (e.key === "Escape") {
                e.stopPropagation();
                renaming = null;
              }
            }}
            onblur={() => commitRename(item)}
          />
        {:else if confirming === item.id}
          <span class="confirm">
            <span>Delete?</span>
            <button class="btn small danger" onclick={() => remove(item.id)}>Delete</button>
            <button class="btn small" onclick={() => (confirming = null)}>Keep</button>
          </span>
        {:else}
          <span class="actions">
            <button class="btn small ghost" onclick={() => startRename(item)}>Rename</button>
            <button class="btn small ghost" onclick={() => ((confirming = item.id), (renaming = null))}>Delete</button>
          </span>
        {/if}
      </li>
    {/each}
  </ul>

  {#if unreadable.length}
    <div class="unreadable">
      <p>
        {unreadable.length === 1 ? "One signature" : `${unreadable.length} signatures`} couldn't be read. They may have
        been saved by another Windows account.
      </p>
      <button class="btn small" onclick={removeUnreadable}>Remove {unreadable.length === 1 ? "it" : "them"}</button>
    </div>
  {/if}
</div>

<style>
  .library {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border: 1px solid var(--bd);
    border-radius: 8px;
    background: var(--ctl);
  }
  li.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pick:disabled {
    flex: 0 0 auto;
    cursor: default;
  }
  /* Previews sit on paper (ink is dark; on a dark theme it would vanish). */
  .thumb {
    flex: 0 0 auto;
    width: 120px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    border: 1px solid var(--bd-ctl);
    border-radius: 4px;
  }
  .thumb img {
    max-width: 112px;
    max-height: 34px;
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    color: var(--tx);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kind {
    color: var(--tx3);
    font-size: 12px;
  }
  .rename {
    flex: 1;
    min-width: 0;
  }
  .actions,
  .confirm {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
  }
  .confirm span {
    color: var(--tx2);
    margin-right: 4px;
  }
  .empty,
  .error,
  .unreadable p {
    margin: 0;
    font-size: 13px;
  }
  .empty {
    color: var(--tx3);
  }
  .error {
    color: var(--danger);
  }
  .unreadable {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--tx2);
  }
</style>
