<script lang="ts">
  // The Stamp tool's picker: the built-in text stamps (APPROVED, FOR COMMENT, SUPERSEDED), your
  // own wording, the second line (name and date, editable) and a colour; then your image stamps,
  // with "Add an image…". Picking one arms it; the page is clicked or dragged to place it.
  import { onMount } from "svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import StampPanel from "./StampPanel.svelte";
  import { type Rgb } from "../../markup/types";
  import { type StampContent, type StampPrefs, BUILT_IN, OWN_TEXT_COLOUR, STAMP_COLOURS, cleanLabel, defaultSub, sanitiseOwnTexts } from "../../markup/stamps";
  import { type StampItem, STAMP_EXTENSIONS, addStamp, deleteStamp, listStamps, stampContent } from "../../stamps/api";
  import { pngUrl } from "../../signature/api";
  import { userMessage } from "../../shell/messages";
  import { sameColour } from "../../markup/colour";

  interface Props {
    author: string;
    prefs: StampPrefs;
    onPrefs: (p: StampPrefs) => void;
    /** `id`: an image stamp's library id (stage 8 remembers it, by id only). */
    onPick: (c: StampContent, id?: string) => void;
    onClose: () => void;
  }
  let { author, prefs, onPrefs, onPick, onClose }: Props = $props();

  // svelte-ignore state_referenced_locally
  let sub = $state(defaultSub(author, new Date()));
  // svelte-ignore state_referenced_locally
  let custom = $state("");
  let items = $state<StampItem[]>([]);
  let urls = new Map<string, string>();
  let confirming = $state<string | null>(null);
  let error = $state("");
  let busy = $state(false);

  const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;
  const colourOf = (own: Rgb) => prefs.colour ?? own;
  const subLine = () => (prefs.sub && sub.trim() ? sub.trim().slice(0, 80) : null);

  function thumb(i: StampItem): string {
    let u = urls.get(i.id);
    if (!u) urls.set(i.id, (u = pngUrl(i.thumb)));
    return u;
  }

  async function refresh() {
    try {
      items = await listStamps();
    } catch (e) {
      error = userMessage(e, "read your stamps");
    }
  }

  onMount(() => {
    refresh();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  });

  function pickText(label: string, own: Rgb) {
    onPick({ type: "text", label, sub: subLine(), colour: colourOf(own) });
  }

  function pickCustom() {
    const label = cleanLabel(custom);
    if (!label) return;
    onPrefs({ ...prefs, texts: sanitiseOwnTexts([...prefs.texts, { label, colour: OWN_TEXT_COLOUR }]) });
    pickText(label, [0.85, 0.1, 0.1]);
  }

  async function pickImage(i: StampItem) {
    busy = true;
    try {
      const c = await stampContent(i);
      if (c) onPick(c, i.id);
      else error = "That stamp's picture couldn't be read.";
    } catch (e) {
      error = userMessage(e, "use the stamp");
    } finally {
      busy = false;
    }
  }

  async function addImage() {
    const path = await openDialog({ title: "Add an image stamp", multiple: false, filters: [{ name: "Pictures", extensions: STAMP_EXTENSIONS }] });
    if (typeof path !== "string") return;
    busy = true;
    try {
      await addStamp(path);
      error = "";
      await refresh();
    } catch (e) {
      error = userMessage(e, "add the picture");
    } finally {
      busy = false;
    }
  }

  async function remove(id: string) {
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
</script>

<StampPanel title="Stamp" width={420} {onClose}>
  <section>
    <div class="row">
      <label class="check"><input type="checkbox" checked={prefs.sub} onchange={(e) => onPrefs({ ...prefs, sub: e.currentTarget.checked })} /> Second line</label>
      <input class="field grow" maxlength="80" aria-label="Second line" bind:value={sub} disabled={!prefs.sub} />
    </div>
    <div class="row colours" role="radiogroup" aria-label="Colour">
      <span class="label">Colour</span>
      <button class="chip" class:on={prefs.colour === null} role="radio" aria-checked={prefs.colour === null} onclick={() => onPrefs({ ...prefs, colour: null })}>Own</button>
      {#each STAMP_COLOURS as c (c.name)}
        {@const on = !!prefs.colour && sameColour(prefs.colour, c.c)}
        <button class="swatch" class:on role="radio" aria-checked={on} aria-label={c.name} title={c.name} style:background={css(c.c)} onclick={() => onPrefs({ ...prefs, colour: c.c })}></button>
      {/each}
    </div>
    <ul class="texts">
      {#each BUILT_IN as b (b.label)}
        <li>
          <button class="pick" onclick={() => pickText(b.label, b.colour)} title="Place {b.label}">
            <span class="preview" style:color={css(colourOf(b.colour))}>
              <span class="main">{b.label}</span>
              {#if subLine()}<span class="sub">{subLine()}</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="row">
      <input
        class="field grow"
        maxlength="60"
        placeholder="Your own wording"
        aria-label="Your own wording"
        bind:value={custom}
        onkeydown={(e) => {
          if (e.key === "Enter") pickCustom();
        }}
      />
      <button class="btn" onclick={pickCustom} disabled={!cleanLabel(custom)}>Use</button>
    </div>
  </section>

  <section>
    <h3>Your stamps</h3>
    {#if items.length === 0}
      <p class="empty">Add a picture (PNG or JPEG) to keep it here. Transparent parts stay clear.</p>
    {/if}
    <ul class="images">
      {#each items as i (i.id)}
        <li>
          <button class="pick image" onclick={() => pickImage(i)} disabled={busy} title="Place {i.name}">
            <img src={thumb(i)} alt="" />
            <span class="name">{i.name}</span>
          </button>
          {#if confirming === i.id}
            <span class="confirm">
              <button class="btn small danger" onclick={() => remove(i.id)}>Delete</button>
              <button class="btn small" onclick={() => (confirming = null)}>Keep</button>
            </span>
          {:else}
            <button class="btn small ghost" onclick={() => (confirming = i.id)}>Delete</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </section>

  {#snippet footer()}
    <button class="btn" onclick={addImage} disabled={busy}>Add an image…</button>
  {/snippet}
</StampPanel>

<style>
  section + section {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--bd);
  }
  h3 {
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--tx2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    white-space: nowrap;
  }
  .label {
    font-size: 12px;
    color: var(--tx3);
    margin-right: 2px;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.25);
    padding: 0;
    cursor: pointer;
  }
  .swatch.on,
  .chip.on {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chip {
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    border: 1px solid var(--bd-input);
    background: var(--ctl);
    color: var(--tx);
    font-size: 12px;
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pick {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border: 1px solid var(--bd);
    border-radius: 6px;
    background: var(--ctl);
    color: var(--tx);
    cursor: pointer;
    text-align: left;
  }
  .pick:hover {
    background: var(--hover);
  }
  /* A small likeness of the stamp on paper. */
  .preview {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 3px 10px;
    border: 2px solid currentColor;
    border-radius: 5px;
    background: var(--paper);
    font-family: Helvetica, Arial, sans-serif;
  }
  .preview .main {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: 0.02em;
  }
  .preview .sub {
    font-size: 10px;
  }
  .images li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .image img {
    max-width: 120px;
    max-height: 40px;
    background: var(--paper);
    border-radius: 3px;
  }
  .name {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .confirm {
    display: flex;
    gap: 4px;
  }
  .empty {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--tx3);
  }
  .error {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--danger);
  }
</style>
