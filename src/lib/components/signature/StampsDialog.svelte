<script lang="ts">
  // Manage stamps (docs/stamp-library-dialogs-scope.md, option A of the mock-ups): one list,
  // edited in place. The default second line; the built-in stamps (their wording fixed, their
  // second line their own); your own text stamps, each its wording (fields allowed), colour and
  // second line, deleted or added; your image stamps, renamed, deleted or added. A stamp's own
  // second line, left empty, takes the default. Picking a stamp to place is the grid's job.
  import { onMount } from "svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import Dialog from "../Dialog.svelte";
  import StampLikeness from "./StampLikeness.svelte";
  import OwnTextAdder from "./OwnTextAdder.svelte";
  import ColourSwatches from "../ColourSwatches.svelte";
  import RowIcon from "./RowIcons.svelte";
  import FieldInput from "./FieldInput.svelte";
  import StampEditor from "./StampEditor.svelte";
  import { type OwnText, type StampLine, type StampPrefs, BUILT_IN, DEFAULT_LINE, cleanLabel, cleanLine, lineOf, sanitiseOwnTexts, withLine } from "../../markup/stamps";
  import { type StampItem, STAMP_EXTENSIONS, deleteStamp, listStamps, renameStamp } from "../../stamps/api";
  import { pngUrl } from "../../signature/api";
  import { userMessage } from "../../shell/messages";

  interface Props {
    /** The stamps' settings: your own text stamps, each stamp's second line, the default. */
    prefs: StampPrefs;
    onPrefs: (prefs: StampPrefs) => void;
    /** What a field would say now (a chip's tooltip). */
    fieldValue?: (field: string) => string;
    onClose: () => void;
  }
  let p: Props = $props();

  let images = $state<StampItem[]>([]);
  let error = $state("");
  let busy = $state(false);
  /** Which row is asking "delete?": a text stamp's wording or an image stamp's id. */
  let confirming = $state<string | null>(null);
  let urls = new Map<string, string>();
  /** The picture being made into a stamp (the editor shows in place of the list), or null. */
  let editing = $state<string | null>(null);
  let editor = $state<StampEditor>();
  let editorReady = $state(false);
  let editorFraming = $state(true);

  const text = (t: { label: string; colour: OwnText["colour"] }) => ({ type: "text" as const, label: t.label, sub: null, colour: t.colour });

  function thumb(i: StampItem): string {
    let u = urls.get(i.id);
    if (!u) urls.set(i.id, (u = pngUrl(i.thumb)));
    return u;
  }

  async function refresh() {
    try {
      images = await listStamps();
    } catch (e) {
      error = userMessage(e, "read your stamps");
    }
  }

  onMount(() => {
    void refresh();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  });

  // Every change kept at once. Your own text stamps tidied: none twice, none empty.
  const texts = $derived(p.prefs.texts);
  const setTexts = (next: OwnText[]) => p.onPrefs({ ...p.prefs, texts: sanitiseOwnTexts(next) });
  const setLine = (label: string, patch: StampLine) => p.onPrefs(withLine(p.prefs, label, patch));

  function rename(i: number, value: string) {
    const label = cleanLabel(value);
    if (!label || label === texts[i].label) return;
    setTexts(texts.map((t, k) => (k === i ? { ...t, label } : t)));
  }

  const addText = (label: string, colour: OwnText["colour"]) => setTexts([...texts, { label, colour }]);

  async function renameImage(i: StampItem, value: string) {
    const name = value.replace(/\s+/g, " ").trim();
    if (!name || name === i.name) return;
    try {
      await renameStamp(i.id, name);
      await refresh();
    } catch (e) {
      error = userMessage(e, "rename the stamp");
    }
  }

  /** Choose a picture, then frame it and remove its background in the editor. */
  async function addImage() {
    const path = await openDialog({ title: "Add an image stamp", multiple: false, filters: [{ name: "Pictures", extensions: STAMP_EXTENSIONS }] });
    if (typeof path !== "string") return;
    error = "";
    editorReady = false;
    editorFraming = true;
    editing = path;
  }

  /** The editor saved one: back to the list, with it in. */
  async function imageSaved() {
    editing = null;
    await refresh();
  }

  async function removeImage(id: string) {
    confirming = null;
    try {
      await deleteStamp(id);
      const u = urls.get(id);
      if (u) URL.revokeObjectURL(u);
      urls.delete(id);
      await refresh();
    } catch (e) {
      error = userMessage(e, "delete the stamp");
    }
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

<!-- A stamp's own second line, in its column: on or off, and its wording (empty: the default). -->
{#snippet secondLine(label: string)}
  {@const l = lineOf(p.prefs, label)}
  <span class="cell line">
    <input type="checkbox" checked={l.on} aria-label="{label}: second line on" title="Second line on or off" onchange={(e) => setLine(label, { sub: e.currentTarget.checked })} />
    <FieldInput label="{label}'s second line" placeholder="Default" maxlength={80} disabled={!l.on} value={l.own} preview={p.fieldValue} onCommit={(v) => v !== l.own && setLine(label, { line: cleanLine(v) })} />
  </span>
{/snippet}

<!-- Delete: a bin; the first click arms it (red, "Click again to delete") until something else is used. -->
{#snippet deleteButton(key: string, what: string, remove: () => void)}
  {@const armed = confirming === key}
  <span class="cell end">
    <button
      type="button"
      class="icon-btn bin"
      class:armed
      aria-label={armed ? `Click again to delete ${what}` : `Delete ${what}`}
      title={armed ? "Click again to delete" : "Delete"}
      onclick={() => (armed ? ((confirming = null), remove()) : (confirming = key))}
      onblur={() => armed && (confirming = null)}
    >
      <RowIcon icon="delete" />
    </button>
  </span>
{/snippet}

{#snippet footer()}
  {#if editing}
    <button type="button" class="btn back" onclick={() => editor?.backToFraming()}>Back to framing</button>
    <button type="button" class="btn" onclick={() => (editing = null)}>Cancel</button>
    <button type="button" class="btn primary" disabled={!editorReady} onclick={() => void editor?.save()}>Save</button>
  {:else}
    <button type="button" class="btn primary" onclick={p.onClose}>Done</button>
  {/if}
{/snippet}

<Dialog title={editing ? "New image stamp" : "Manage stamps"} width={880} onClose={p.onClose} footer={editing && editorFraming ? undefined : footer}>
  {#if editing}
    <StampEditor bind:this={editor} path={editing} bind:ready={editorReady} bind:framing={editorFraming} onSaved={() => void imageSaved()} onCancel={() => (editing = null)} />
  {:else}
  <div class="default">
    <span class="k">Default second line</span>
    <FieldInput
      label="The default second line"
      maxlength={80}
      value={p.prefs.line}
      preview={p.fieldValue}
      onCommit={(v) => {
        const line = cleanLine(v) || DEFAULT_LINE;
        if (line !== p.prefs.line) p.onPrefs({ ...p.prefs, line });
      }}
    />
  </div>

  <div class="table" role="table" aria-label="Text stamps">
    <span class="head" role="columnheader"></span>
    <span class="head" role="columnheader">Wording</span>
    <span class="head" role="columnheader">Second line</span>
    <span class="head" role="columnheader">Colour</span>
    <span class="head" role="columnheader"></span>

    <span class="group">Built in</span>
    {#each BUILT_IN as b (b.label)}
      <span class="cell like"><StampLikeness content={text(b)} size={10} sub={false} maxWidth={110} /></span>
      <span class="cell fixed" title="Built-in stamps keep their wording">{b.label}</span>
      {@render secondLine(b.label)}
      <span class="cell"></span>
      <span class="cell"></span>
    {/each}

    <span class="group">Your text stamps</span>
    {#each texts as t, i (t.label)}
      <span class="cell like"><StampLikeness content={text(t)} size={10} sub={false} maxWidth={110} /></span>
      <span class="cell"><FieldInput label="Wording" maxlength={60} caps value={t.label} preview={p.fieldValue} onCommit={(v) => rename(i, v)} /></span>
      {@render secondLine(t.label)}
      <span class="cell"><ColourSwatches value={t.colour} label="{t.label}'s colour" onPick={(c) => setTexts(texts.map((x, k) => (k === i ? { ...x, colour: c } : x)))} /></span>
      {@render deleteButton(t.label, t.label, () => setTexts(texts.filter((_, k) => k !== i)))}
    {/each}
    <OwnTextAdder cells fieldValue={p.fieldValue} onAdd={addText} />

    <span class="group">Image stamps</span>
    {#each images as i (i.id)}
      <span class="cell like"><img src={thumb(i)} alt="" /></span>
      <span class="cell"><input class="field grow" maxlength="80" aria-label="Name" value={i.name} onblur={(e) => renameImage(i, e.currentTarget.value)} onkeydown={(e) => fieldKeys(e, i.name)} /></span>
      <span class="cell"></span>
      <span class="cell"></span>
      {@render deleteButton(i.id, i.name, () => void removeImage(i.id))}
    {/each}
    <span class="cell like"><span class="new-frame" aria-hidden="true"></span></span>
    <span class="cell"><button type="button" class="field choose" disabled={busy} title="A PNG or JPEG" onclick={addImage}>Add a picture…</button></span>
    <span class="cell"></span>
    <span class="cell"></span>
    <span class="cell end"><button type="button" class="icon-btn" disabled={busy} aria-label="Add a picture" title="Add a picture" onclick={addImage}><RowIcon icon="add" /></button></span>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</Dialog>

<style>
  /* The editor's way back, on the footer's left, apart from Cancel and Save. */
  .back {
    margin-right: auto;
  }
  .default {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .k {
    flex: 0 0 auto;
    font-size: 12px;
    font-weight: 600;
    color: var(--tx2);
  }
  /* The new picture row: as the new text stamp's (OwnTextAdder): an empty frame, a field. */
  .new-frame {
    width: 72px;
    height: 24px;
    border: 1px dashed var(--bd-strong);
    border-radius: 3px;
  }
  .choose {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
    color: var(--tx3);
    cursor: pointer;
  }
  .choose:hover:not(:disabled) {
    border-color: var(--bd-strong);
  }
  /* One grid for every text stamp, so the columns line up across the groups. */
  /* One grid for every stamp, so the columns line up across the groups; no gaps between the
     columns (padding in the cells instead), so each row's line runs unbroken. */
  .table {
    display: grid;
    grid-template-columns: 124px minmax(0, 1.3fr) minmax(0, 1fr) auto 44px;
    align-items: stretch;
    margin-top: 14px;
    max-height: 460px;
    overflow-y: auto;
  }
  .head {
    padding: 0 6px 4px;
    font-size: 11px;
    color: var(--tx3);
    border-bottom: 1px solid var(--bd);
  }
  .group {
    grid-column: 1 / -1;
  }
  .group {
    padding: 12px 6px 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--tx2);
  }
  .cell {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 44px;
    padding: 0 6px;
    border-bottom: 1px solid var(--bd);
  }
  /* Delete, armed by the first click. */
  .bin.armed {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .like {
    justify-content: center;
  }
  .like img {
    max-height: 30px;
    max-width: 110px;
    background: var(--paper);
    border-radius: 2px;
  }
  .fixed {
    padding: 0 14px;
    font-size: 12px;
    color: var(--tx3);
  }
  .line {
    gap: 8px;
  }
  .end {
    justify-content: flex-end;
    gap: 4px;
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .error {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--danger);
  }
</style>
