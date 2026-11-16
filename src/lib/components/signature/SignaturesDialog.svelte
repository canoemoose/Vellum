<script module lang="ts">
  /** The dialog's two views: the library, and the pad (draw, or import and frame). */
  export type SignaturesView = "list" | "pad";
</script>

<script lang="ts">
  // Signatures (docs/stamp-library-dialogs-scope.md, step 4): one dialog for looking after them
  // and for making new ones. The list (rename in place, delete, the tidy-up for files that can't
  // be read) and the pad (SignaturePad: draw, or import a photo and frame it). "Manage
  // signatures..." opens it on the list, the grid's "+ New" on the pad; saving goes back to the
  // list with the new one armed. Picking one to place is the grid's job.
  //
  // Thumbnails come from the encrypted library as in-memory object URLs, revoked when the list
  // is read again or the dialog goes; nothing is written anywhere. Logs name ids only.
  import { onMount } from "svelte";
  import Dialog from "../Dialog.svelte";
  import RowIcon from "./RowIcons.svelte";
  import SignaturePad from "./SignaturePad.svelte";
  import { type SignatureItem, deleteSignature, listSignatures, pngUrl, renameSignature, signatureMessage } from "../../signature/api";

  interface Props {
    /** Which view it opens on. */
    start: SignaturesView;
    /** The signature the Signature tool has armed (marked in the list). */
    armedId?: string | null;
    /** A new one was saved: arm it. */
    onSaved: (item: SignatureItem) => void;
    /** One was deleted (so it isn't left armed). */
    onDeleted?: (id: string) => void;
    onClose: () => void;
  }
  let p: Props = $props();

  // svelte-ignore state_referenced_locally
  let view = $state<SignaturesView>(p.start);
  let items = $state<SignatureItem[]>([]);
  let unreadable = $state<string[]>([]);
  let loaded = $state(false);
  let error = $state("");
  /** Which row is asking "delete?" (its id). */
  let confirming = $state<string | null>(null);
  let urls = new Map<string, string>();
  let pad = $state<SignaturePad>();
  /** The pad has something to save; a photo is being framed (its own buttons, so no footer). */
  let padReady = $state(false);
  let padFramed = $state(false);

  /** Cancel on the pad: back to the list it came from, or, opened on the pad ("+ New"), closed. */
  const cancelPad = () => (p.start === "list" ? (view = "list") : p.onClose());

  function thumb(i: SignatureItem): string {
    let u = urls.get(i.id);
    if (!u) urls.set(i.id, (u = pngUrl(i.thumb)));
    return u;
  }

  async function refresh() {
    try {
      const l = await listSignatures();
      const keep = new Set(l.items.map((i) => i.id));
      for (const [id, u] of urls)
        if (!keep.has(id)) {
          URL.revokeObjectURL(u);
          urls.delete(id);
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
    void refresh();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  });

  async function rename(i: SignatureItem, value: string) {
    const name = value.replace(/\s+/g, " ").trim();
    if (!name || name === i.name) return;
    try {
      const m = await renameSignature(i.id, name);
      items = items.map((x) => (x.id === m.id ? { ...x, name: m.name } : x));
      error = "";
    } catch (e) {
      console.error(`[signature] rename of ${i.id} failed`);
      error = signatureMessage(e, "rename the signature");
    }
  }

  async function remove(id: string) {
    confirming = null;
    try {
      await deleteSignature(id);
      p.onDeleted?.(id);
    } catch (e) {
      console.error(`[signature] delete of ${id} failed`);
      error = signatureMessage(e, "delete the signature");
    }
    await refresh();
  }

  async function removeUnreadable() {
    for (const id of unreadable) {
      try {
        await deleteSignature(id);
      } catch {
        console.error(`[signature] delete of unreadable ${id} failed`);
      }
    }
    await refresh();
  }

  /** The pad saved one: back to the list, with it armed. */
  async function saved(item: SignatureItem) {
    view = "list";
    p.onSaved(item);
    await refresh();
  }

  /** Enter keeps what's typed (by leaving the field); Esc puts it back. */
  function fieldKeys(e: KeyboardEvent, was: string) {
    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
    else if (e.key === "Escape") {
      e.stopPropagation();
      (e.currentTarget as HTMLInputElement).value = was;
      (e.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

{#snippet footer()}
  {#if view === "pad"}
    <button type="button" class="btn" onclick={cancelPad}>Cancel</button>
    <button type="button" class="btn primary" disabled={!padReady} onclick={() => void pad?.save()}>Save</button>
  {:else}
    <button type="button" class="btn primary" onclick={p.onClose}>Done</button>
  {/if}
{/snippet}

<Dialog title={view === "pad" ? "New signature" : "Signatures"} width={880} onClose={p.onClose} footer={view === "pad" && padFramed ? undefined : footer}>
  {#if view === "pad"}
    <SignaturePad bind:this={pad} saveButton={false} bind:ready={padReady} bind:framed={padFramed} onsaved={(item) => void saved(item)} />
  {:else}
    {#if loaded && items.length === 0 && unreadable.length === 0}
      <p class="empty">No signatures yet. Draw one, or import a photo or scan of one.</p>
    {/if}

    <div class="table" role="table" aria-label="Signatures">
      <span class="head" role="columnheader"></span>
      <span class="head" role="columnheader">Name</span>
      <span class="head" role="columnheader">Made by</span>
      <span class="head" role="columnheader"></span>

      {#each items as i (i.id)}
        {@const armed = confirming === i.id}
        <span class="cell like" class:current={i.id === p.armedId}><span class="paper"><img src={thumb(i)} alt="" /></span></span>
        <span class="cell"><input class="field grow" maxlength="80" aria-label="Name" value={i.name} onblur={(e) => rename(i, e.currentTarget.value)} onkeydown={(e) => fieldKeys(e, i.name)} /></span>
        <span class="cell kind">
          {i.kind === "drawn" ? "Drawing" : "Import"}{#if i.id === p.armedId}<span class="next" title="The Signature tool places this one next">Placing next</span>{/if}
        </span>
        <span class="cell end">
          <button
            type="button"
            class="icon-btn bin"
            class:armed
            aria-label={armed ? `Click again to delete ${i.name}` : `Delete ${i.name}`}
            title={armed ? "Click again to delete" : "Delete"}
            onclick={() => (armed ? void remove(i.id) : (confirming = i.id))}
            onblur={() => armed && (confirming = null)}
          >
            <RowIcon icon="delete" />
          </button>
        </span>
      {/each}

      <span class="cell like"><span class="new-frame" aria-hidden="true"></span></span>
      <span class="cell"><button type="button" class="field choose" onclick={() => (view = "pad")}>Draw or import a new one…</button></span>
      <span class="cell"></span>
      <span class="cell end"><button type="button" class="icon-btn" aria-label="New signature" title="New signature" onclick={() => (view = "pad")}><RowIcon icon="add" /></button></span>
    </div>

    {#if unreadable.length}
      <div class="unreadable">
        <p>
          {unreadable.length === 1 ? "One signature" : `${unreadable.length} signatures`} couldn't be read. They may have been
          saved by another Windows account.
        </p>
        <button type="button" class="btn small" onclick={removeUnreadable}>Remove {unreadable.length === 1 ? "it" : "them"}</button>
      </div>
    {/if}
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}

</Dialog>

<style>
  /* As Manage stamps: one grid, no gaps between the columns, so each row's line runs unbroken. */
  .table {
    display: grid;
    grid-template-columns: 148px minmax(0, 1fr) auto 44px;
    align-items: stretch;
  }
  .head {
    padding: 0 6px 4px;
    font-size: 11px;
    color: var(--tx3);
    border-bottom: 1px solid var(--bd);
  }
  .cell {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 52px;
    padding: 0 6px;
    border-bottom: 1px solid var(--bd);
  }
  .like {
    justify-content: center;
  }
  /* Previews sit on paper (ink is dark; on a dark theme it would vanish). */
  .paper {
    width: 132px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--paper);
    border: 1px solid var(--bd-ctl);
    border-radius: 4px;
  }
  .like.current .paper {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .paper img {
    max-width: 124px;
    max-height: 34px;
  }
  /* The new signature row: as Manage stamps' add rows, an empty frame and a field. */
  .new-frame {
    width: 132px;
    height: 40px;
    border: 1px dashed var(--bd-strong);
    border-radius: 4px;
  }
  .choose {
    flex: 1 1 auto;
    min-width: 0;
    text-align: left;
    color: var(--tx3);
    cursor: pointer;
  }
  .choose:hover {
    border-color: var(--bd-strong);
  }
  .kind {
    gap: 10px;
    padding: 0 12px;
    font-size: 12px;
    color: var(--tx3);
    white-space: nowrap;
  }
  .next {
    color: var(--accent);
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .end {
    justify-content: flex-end;
  }
  /* Delete, armed by the first click. */
  .bin.armed {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .empty,
  .error,
  .unreadable p {
    margin: 0;
    font-size: 13px;
  }
  .empty {
    margin-bottom: 10px;
    color: var(--tx3);
  }
  .error {
    margin-top: 8px;
    color: var(--danger);
  }
  .unreadable {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    color: var(--tx2);
  }
</style>
