<script module lang="ts">
  /** Which list the grid offers: the Stamp tool's or the Signature tool's. */
  export type Family = "stamp" | "signature";
</script>

<script lang="ts">
  // The stamp tools' grid (Matt's review of stage 8): picking the Stamp or Signature tool opens
  // it beside the tool's button, with what the tool last placed already armed. A tile arms another
  // and closes the grid; a click on the drawing closes it and places what's armed there (the
  // press goes on through); Esc closes it with the tool still out. The Stamp grid shows each stamp
  // as it will be placed, your own wording, your image stamps, and the second line's wording with
  // its fields; the Signature grid your signatures and "+ New". From a placed one's right-click
  // ("Replace…") it opens at the pointer and a tile swaps what that one holds.
  //
  // Signatures' thumbnails come from the encrypted library at run time, as in-memory object
  // URLs, revoked when the list is read again or the grid goes; nothing is written anywhere.
  import { onMount, tick } from "svelte";
  import { type Out, popoutPosition } from "../../shell/popout";
  import { BUTTON_SELECTOR } from "../toolButtons";
  import StampLikeness from "./StampLikeness.svelte";
  import { type OwnText, type StampContent, type TextContent, BUILT_IN } from "../../markup/stamps";
  import OwnTextAdder from "./OwnTextAdder.svelte";
  import FieldChips from "./FieldChips.svelte";
  import FieldInput from "./FieldInput.svelte";
  import { type StampItem, listStamps, stampContent } from "../../stamps/api";
  import { type SignatureItem, listSignatures, pngUrl } from "../../signature/api";
  import { userMessage } from "../../shell/messages";


  interface Props {
    /** Which list: the Stamp tool's or the Signature tool's. */
    family: Family;
    /** What's armed, or what the stamp being replaced holds; null while nothing is chosen. */
    current: StampContent | null;
    /** The current signature's or image stamp's library id, where known (to mark it in the list). */
    currentId?: string | null;
    /** Where it opens from: a screen point (a right-click), else beside the tool's button. */
    at?: { x: number; y: number } | null;
    /** Or from this (the context bar's replace button), opening `out` from it. */
    from?: { left: number; top: number; right: number; bottom: number } | null;
    /**
     * The text stamp the second-line section is for (the highlighted one; its wording as kept,
     * fields and all), or null for none (signatures, an image stamp).
     */
    lineLabel: string | null;
    /** A text stamp's own second line (Matt's review: per stamp): on or off, its own wording, what it says. */
    lineOf: (label: string) => { on: boolean; own: string; wording: string };
    /** One stamp's second line changed: on or off, or its wording ("" for the default). */
    onLine: (label: string, patch: { sub?: boolean; line?: string }) => void;
    /** The default second line (what an empty one takes). */
    defaultLine: string;
    /** What a field would say placed here now (a chip's tooltip). */
    fieldValue?: (field: string) => string;
    /** A text stamp as it would read placed here now (its fields filled in), for the previews. */
    preview: (c: TextContent) => TextContent;
    /** Which way it opens from the tool's button: away from the toolbar. */
    out: Out;
    /** Your own text stamps (remembered). */
    texts: OwnText[];
    /** A stamp picked from the list; `id` is an image stamp's library id. */
    onPick: (c: StampContent, id?: string) => void;
    /** A signature picked from the list (its content is read from the library then). */
    onPickSignature: (item: SignatureItem) => void;
    /** Your own wording was added: keep it with your own text stamps. */
    onAddText: (label: string, colour: OwnText["colour"]) => void;
    onNewSignature: () => void;
    /** The full library (rename, delete, add a picture). */
    onManage: () => void;
    /** Closed without picking (Esc, a click elsewhere). */
    onClose: () => void;
  }
  let p: Props = $props();

  let pop = $state<HTMLDivElement>();
  let at = $state({ left: -9999, top: 0 });
  let stamps = $state<StampItem[]>([]);
  let signatures = $state<SignatureItem[]>([]);
  let error = $state("");
  /** Typing your own wording, in the grid. */
  let typing = $state(false);
  let urls = new Map<string, string>();

  const title = $derived(p.family === "signature" ? "Signatures" : "Stamps");
  /** A text stamp as it will be placed: its own second line, if it has one on. */
  const text = (label: string, colour: TextContent["colour"]): TextContent => {
    const l = p.lineOf(label);
    return { type: "text", label, sub: l.on ? l.wording : null, colour };
  };

  function thumb(id: string, bytes: number[]): string {
    let u = urls.get(id);
    if (!u) urls.set(id, (u = pngUrl(bytes)));
    return u;
  }

  function forget() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = new Map();
  }

  /** Read the list again (it may have changed in the panel, or a signature been added). */
  async function refresh() {
    error = "";
    try {
      if (p.family === "stamp") {
        const s = await listStamps();
        forget();
        stamps = s;
      } else if (p.family === "signature") {
        const s = await listSignatures();
        forget();
        signatures = s.items;
      }
    } catch (e) {
      error = userMessage(e, p.family === "signature" ? "read your signatures" : "read your stamps");
    }
  }

  onMount(() => {
    void refresh().then(place);
    const outside = (e: PointerEvent) => {
      if (!pop?.contains(e.target as Node)) p.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        p.onClose();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
      forget();
    };
  });

  /** Beside the tool's button (or at the right-click), inside the window. */
  async function place() {
    await tick();
    if (!pop) return;
    const W = window.innerWidth, H = window.innerHeight;
    const btn = document.querySelector<HTMLElement>(BUTTON_SELECTOR(p.family));
    const a = p.from ?? (p.at ? { left: p.at.x, right: p.at.x, top: p.at.y, bottom: p.at.y } : btn?.getBoundingClientRect());
    at = a ? popoutPosition(a, pop.offsetWidth, pop.offsetHeight, p.at && !p.from ? "down" : p.out, W, H) : { left: 8, top: 48 };
    ((pop.querySelector(".on") ?? pop.querySelector("button")) as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function done() {
    p.onClose();
  }

  /** Report the pick first, then close: closing first would lose what the grid was open for (Replace…). */
  function pick(c: StampContent, id?: string) {
    p.onPick(c, id);
    done();
  }

  async function pickImage(i: StampItem) {
    try {
      const c = await stampContent(i);
      if (c) pick(c, i.id);
      else error = "That stamp's picture couldn't be read.";
    } catch (e) {
      error = userMessage(e, "use the stamp");
    }
  }

  function startTyping() {
    typing = true;
  }

  /** One of your own added (OwnTextAdder, as in Manage stamps): kept, and armed to place. */
  function added(label: string, colour: OwnText["colour"]) {
    typing = false;
    p.onAddText(label, colour);
    pick(text(label, colour));
  }

  /** The second line's wording (its fields as chips). */
  let lineInput = $state<FieldInput>();

  /** The arrows move between the tiles; other keys reach the app (S again steps to Signature). */
  function keys(e: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 }[e.key];
    if (e.key === "Enter" || e.key === " ") e.stopPropagation();
    if (!step) return;
    e.stopPropagation();
    e.preventDefault();
    const items = [...(pop?.querySelectorAll<HTMLButtonElement>(".tile") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[Math.max(0, Math.min(items.length - 1, i + step))]?.focus();
  }

  const isOn = (c: StampContent | null, label: string) => c?.type === "text" && c.label === label;
</script>

<!-- Option B of the mock-ups (Matt's review): a grid of the stamps as they'll look, the
     second line's wording under it, and the library's management at the foot. -->
<div class="pop" bind:this={pop} role="listbox" tabindex="-1" aria-label={title} style:left="{at.left}px" style:top="{at.top}px" onkeydown={keys}>
  {#if p.family === "stamp"}
    <div class="grid">
      {#each BUILT_IN as b (b.label)}
        {@const c = text(b.label, isOn(p.current, b.label) && p.current?.type === "text" ? p.current.colour : b.colour)}
        <button type="button" role="option" class="tile" class:on={isOn(p.current, b.label)} aria-selected={isOn(p.current, b.label)} title="Place {b.label}" onclick={() => pick(c)}>
          <StampLikeness content={p.preview(c)} size={12} maxWidth={192} />
        </button>
      {/each}
      {#each p.texts as t (t.label)}
        {@const c = text(t.label, t.colour)}
        <button type="button" role="option" class="tile" class:on={isOn(p.current, t.label)} aria-selected={isOn(p.current, t.label)} title="Place {t.label}" onclick={() => pick(c)}>
          <StampLikeness content={p.preview(c)} size={12} maxWidth={192} />
        </button>
      {/each}
      {#each stamps as s (s.id)}
        <button type="button" role="option" class="tile" class:on={p.currentId === s.id} aria-selected={p.currentId === s.id} title="Place {s.name}" onclick={() => pickImage(s)}>
          <img class="thumb big" src={thumb(s.id, s.thumb)} alt={s.name} />
        </button>
      {/each}
      {#if !typing}
        <button type="button" class="tile add" title="Your own wording (fields work here too)" onclick={startTyping}>+ Your wording</button>
      {/if}
    </div>
    {#if typing}
      <div class="own"><OwnTextAdder autofocus fieldValue={p.fieldValue} onAdd={added} onCancel={() => (typing = false)} /></div>
    {/if}
    {#if p.lineLabel}
      {@const label = p.lineLabel}
      {@const l = p.lineOf(label)}
      <div class="line">
        <label class="date">
          <input type="checkbox" checked={l.on} onchange={(e) => p.onLine(label, { sub: e.currentTarget.checked })} onkeydown={(e) => e.stopPropagation()} />
          Second line for {label}
        </label>
        {#key label}
          <FieldInput
            bind:this={lineInput}
            label="{label}'s second line"
            placeholder="Default: {p.defaultLine}"
            maxlength={80}
            disabled={!l.on}
            value={l.own}
            preview={p.fieldValue}
            onCommit={(v) => v !== l.own && p.onLine(label, { line: v })}
          />
        {/key}
        <FieldChips disabled={!l.on} onField={(f) => lineInput?.insert(f)} />
      </div>
    {/if}
    <hr />
    <button type="button" class="opt act" onclick={() => (p.onManage(), done())}>Manage stamps…</button>
  {:else}
    <div class="grid">
      {#each signatures as s (s.id)}
        <button type="button" role="option" class="tile" class:on={p.currentId === s.id} aria-selected={p.currentId === s.id} title="Place {s.name}" onclick={() => (p.onPickSignature(s), done())}>
          <img class="thumb big" src={thumb(s.id, s.thumb)} alt={s.name} />
        </button>
      {/each}
      <button type="button" class="tile add" onclick={() => (p.onNewSignature(), done())}>+ New</button>
    </div>
    {#if signatures.length}
      <hr />
      <button type="button" class="opt act" onclick={() => (p.onManage(), done())}>Manage signatures…</button>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .thumb {
    max-height: 18px;
    max-width: 90px;
    background: var(--paper);
    border-radius: 2px;
  }
  .thumb.big {
    max-height: 30px;
    max-width: 120px;
  }
  .date {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--tx2);
    white-space: nowrap;
  }
  /* The list: as the bar's other pop-outs (PopChoice). */
  .pop {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 180px;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 5px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 3px 10px 3px 6px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--tx);
    font-size: 12px;
    text-align: left;
    cursor: default;
  }
  .opt.act {
    min-height: 28px;
    padding-left: 10px;
    color: var(--tx2);
  }
  .opt:hover,
  .opt:focus-visible {
    background: var(--hover);
    outline: none;
  }
  hr {
    width: 100%;
    margin: 3px 0;
    border: none;
    border-top: 1px solid var(--bd);
  }
  /* The grid of stamps (option B). */
  .grid {
    display: grid;
    grid-template-columns: repeat(2, 200px);
    gap: 5px;
  }
  .tile {
    height: 54px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    overflow: hidden;
    border: 1px solid var(--bd);
    border-radius: 6px;
    background: var(--app);
    color: var(--tx);
    font-size: 12px;
    cursor: default;
  }
  .tile:hover,
  .tile:focus-visible {
    border-color: var(--bd-strong);
    background: var(--hover);
    outline: none;
  }
  .tile.on {
    border: 1.5px solid var(--accent);
    background: var(--accent-soft);
  }
  .tile.add {
    color: var(--tx2);
    border-style: dashed;
  }
  .tile .thumb.big {
    max-height: 44px;
    max-width: 188px;
  }
  .line {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 6px;
    padding: 6px 2px 0;
    border-top: 1px solid var(--bd);
  }
  .own {
    margin-top: 6px;
  }
  .error {
    margin: 4px 6px;
    max-width: 240px;
    font-size: 12px;
    color: var(--danger);
  }
</style>
