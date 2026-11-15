<script module lang="ts">
  /** Which list the picker offers: the Stamp tool's, the Signature tool's or the Image tool's. */
  export type Family = "stamp" | "signature" | "image";
</script>

<script lang="ts">
  // Stage 8 (docs/editing-tool-consistency-brief.md, O3): the stamp tools' picker in the context
  // bar, in place of the panels that dropped over the drawing. "Stamp: APPROVED ▾" lists the text
  // stamps and your image stamps, each with a small preview; "Signature: (thumbnail) ▾" your
  // signatures, with "New signature…" at the bottom; "Image: name ▾" offers another picture. A
  // text stamp also gets its date line toggle here (colour and opacity are the bar's own).
  // The list opens away from the bar's edge, styled like the bar's other pop-outs (PopChoice).
  //
  // Signatures' thumbnails come from the encrypted library at run time, as in-memory object
  // URLs, revoked when the list is read again or the bar goes; nothing is written anywhere.
  import { onMount, tick } from "svelte";
  import { type Out, popoutPosition } from "../../shell/popout";
  import { type StampContent, type TextContent, BUILT_IN, cleanLabel, defaultSub } from "../../markup/stamps";
  import { type StampItem, listStamps, stampContent } from "../../stamps/api";
  import { type SignatureItem, listSignatures, pngUrl } from "../../signature/api";
  import { userMessage } from "../../shell/messages";


  interface Props {
    /** Which list: the Stamp tool's, the Signature tool's or the Image tool's (or a selected one's). */
    family: Family;
    /** What's armed, or what the selected stamp holds; null while nothing is chosen. */
    current: StampContent | null;
    /** The current signature's or image stamp's library id, where known (to mark it in the list). */
    currentId?: string | null;
    /** The Image tool's picture: its file name. */
    currentName?: string | null;
    /** A text stamp's date line, on or off; null for no toggle. */
    dateLine: boolean | null;
    /** The bar's thin column: a smaller opener, no words. */
    narrow: boolean;
    out: Out;
    author: string;
    /** The last wording of your own (remembered). */
    custom: string;
    /** A stamp picked from the list; `id` is an image stamp's library id. */
    onPick: (c: StampContent, id?: string) => void;
    /** A signature picked from the list (its content is read from the library then). */
    onPickSignature: (item: SignatureItem) => void;
    onDateLine: (on: boolean) => void;
    /** Your own wording was typed: remember it. */
    onCustom: (label: string) => void;
    onNewSignature: () => void;
    /** The full library (rename, delete, add a picture, edit the second line): the panel. */
    onManage: () => void;
    onChoosePicture: () => void;
  }
  let p: Props = $props();

  let open = $state(false);
  let btn = $state<HTMLButtonElement>();
  let pop = $state<HTMLDivElement>();
  let at = $state({ left: 0, top: 0 });
  let stamps = $state<StampItem[]>([]);
  let signatures = $state<SignatureItem[]>([]);
  let error = $state("");
  /** Typing your own wording, in place of the opener. */
  let typing = $state<string | null>(null);
  let urls = new Map<string, string>();

  const css = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(", ")})`;
  const title = $derived(p.family === "signature" ? "Signature" : p.family === "image" ? "Image" : "Stamp");
  const sub = () => (p.dateLine ? defaultSub(p.author, new Date()) : null);
  const text = (label: string, colour: TextContent["colour"]): TextContent => ({ type: "text", label, sub: sub(), colour });
  const builtIn = (l: string) => BUILT_IN.some((b) => b.label === l);

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
    refresh();
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open && !btn?.contains(t) && !pop?.contains(t)) open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (open && e.key === "Escape") {
        e.stopPropagation();
        open = false;
        btn?.focus();
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

  async function toggle() {
    if (p.family === "image") {
      p.onChoosePicture();
      return;
    }
    open = !open;
    if (!open) return;
    await refresh();
    await tick();
    if (!pop || !btn) return;
    at = popoutPosition(btn.getBoundingClientRect(), pop.offsetWidth, pop.offsetHeight, p.out, window.innerWidth, window.innerHeight);
    ((pop.querySelector(".on") ?? pop.querySelector("button")) as HTMLElement | null)?.focus();
  }

  function done() {
    open = false;
    btn?.focus();
  }

  function pick(c: StampContent, id?: string) {
    done();
    p.onPick(c, id);
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

  async function startTyping() {
    open = false;
    typing = p.custom;
    await tick();
    (document.querySelector(".stamp-bar .own") as HTMLInputElement | null)?.select();
  }

  function useTyped() {
    const label = cleanLabel(typing ?? "");
    typing = null;
    if (!label) return;
    p.onCustom(label);
    p.onPick(text(label, [0.85, 0.1, 0.1]));
  }

  function keys(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(pop?.querySelectorAll("button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const isOn = (c: StampContent | null, label: string) => c?.type === "text" && c.label === label;
</script>

<span class="stamp-bar" class:narrow={p.narrow}>
  {#if typing !== null}
    <input
      class="own"
      maxlength="60"
      placeholder="Your own wording"
      aria-label="Your own wording: Enter to use it, Esc to cancel"
      bind:value={typing}
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") useTyped();
        else if (e.key === "Escape") typing = null;
      }}
      onblur={() => (typing = null)}
    />
  {:else}
    <button
      bind:this={btn}
      type="button"
      class="box"
      class:open
      aria-haspopup={p.family === "image" ? "dialog" : "listbox"}
      aria-expanded={open}
      title={p.family === "image" ? "Choose another picture" : `Choose the ${title.toLowerCase()} to place`}
      onclick={toggle}
    >
      {#if !p.narrow}<span class="k">{title}:</span>{/if}
      {@render shown()}
      <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" class="chev"><path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  {/if}
  {#if p.dateLine !== null && !p.narrow}
    <label class="date" title="The second line: your name and today's date">
      <input type="checkbox" checked={p.dateLine} onchange={(e) => p.onDateLine(e.currentTarget.checked)} onkeydown={(e) => e.stopPropagation()} />
      Date line
    </label>
  {:else if p.dateLine !== null}
    <button type="button" class="tgl" class:on={p.dateLine} aria-pressed={p.dateLine} aria-label="Date line" title="Date line: your name and today's date" onclick={() => p.onDateLine(!p.dateLine)}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="1.5" y="2.5" width="11" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" /><path d="M1.5 5.5h11M4.5 1v3M9.5 1v3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" /></svg>
    </button>
  {/if}
</span>

<!-- What the opener shows: the current stamp's likeness, signature's thumbnail or picture's name. -->
{#snippet shown()}
  {@const c = p.current}
  {#if !c}
    <span class="none">Choose</span>
  {:else if c.type === "text"}
    {@render likeness(c, p.narrow ? 7 : 9)}
  {:else if p.family === "signature"}
    {@const s = signatures.find((x) => x.id === p.currentId)}
    {#if s}<img class="thumb" src={thumb(s.id, s.thumb)} alt={s.name} />{:else}<span class="none">Signature</span>{/if}
  {:else if p.family === "image"}
    <span class="name">{p.currentName ?? "Picture"}</span>
  {:else}
    {@const s = stamps.find((x) => x.id === p.currentId)}
    {#if s}<img class="thumb" src={thumb(s.id, s.thumb)} alt={s.name} />{:else}<span class="none">Picture</span>{/if}
  {/if}
{/snippet}

<!-- A small likeness of a text stamp (an HTML stand-in, as the panel's previews are). -->
{#snippet likeness(c: TextContent, size: number)}
  <span class="likeness" style:color={css(c.colour)} style:font-size="{size}px">
    <span class="main">{c.label.toUpperCase()}</span>
    {#if c.sub && size > 8}<span class="sub">{c.sub}</span>{/if}
  </span>
{/snippet}

{#if open}
  <div class="pop" bind:this={pop} role="listbox" tabindex="-1" aria-label={title} style:left="{at.left}px" style:top="{at.top}px" onkeydown={keys}>
    {#if p.family === "stamp"}
      {#each BUILT_IN as b (b.label)}
        {@const c = text(b.label, isOn(p.current, b.label) && p.current?.type === "text" ? p.current.colour : b.colour)}
        <button type="button" role="option" class="opt" class:on={isOn(p.current, b.label)} aria-selected={isOn(p.current, b.label)} title="Place {b.label}" onclick={() => pick(c)}>
          {@render likeness(c, 10)}
        </button>
      {/each}
      {#if p.custom && !builtIn(p.custom)}
        {@const c = text(p.custom, isOn(p.current, p.custom) && p.current?.type === "text" ? p.current.colour : [0.85, 0.1, 0.1])}
        <button type="button" role="option" class="opt" class:on={isOn(p.current, p.custom)} aria-selected={isOn(p.current, p.custom)} title="Place {p.custom}" onclick={() => pick(c)}>
          {@render likeness(c, 10)}
        </button>
      {/if}
      <button type="button" class="opt act" onclick={startTyping}>Your own wording…</button>
      {#if stamps.length}<hr />{/if}
      {#each stamps as s (s.id)}
        <button type="button" role="option" class="opt" class:on={p.currentId === s.id} aria-selected={p.currentId === s.id} title="Place {s.name}" onclick={() => pickImage(s)}>
          <img class="thumb big" src={thumb(s.id, s.thumb)} alt="" />
          <span class="name">{s.name}</span>
        </button>
      {/each}
      <hr />
      <button type="button" class="opt act" onclick={() => (done(), p.onManage())}>Add or delete image stamps…</button>
    {:else}
      {#each signatures as s (s.id)}
        <button type="button" role="option" class="opt" class:on={p.currentId === s.id} aria-selected={p.currentId === s.id} title="Place {s.name}" onclick={() => (done(), p.onPickSignature(s))}>
          <img class="thumb big" src={thumb(s.id, s.thumb)} alt="" />
          <span class="name">{s.name}</span>
        </button>
      {/each}
      {#if signatures.length}<hr />{/if}
      <button type="button" class="opt act" onclick={() => (done(), p.onNewSignature())}>New signature…</button>
      {#if signatures.length}
        <button type="button" class="opt act" onclick={() => (done(), p.onManage())}>Rename or delete signatures…</button>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  .stamp-bar {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .stamp-bar.narrow {
    flex-direction: column;
    gap: 7px;
  }
  .box {
    height: 26px;
    max-width: 260px;
    padding: 0 6px 0 6px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-size: 12px;
    cursor: default;
  }
  .narrow .box {
    max-width: 52px;
    padding: 0 3px;
    gap: 2px;
  }
  .box:hover {
    border-color: var(--bd-strong);
  }
  .box.open {
    border-color: var(--accent);
  }
  .k {
    font-weight: 600;
    white-space: nowrap;
  }
  .chev {
    flex-shrink: 0;
    color: var(--tx3);
  }
  .none,
  .name {
    color: var(--tx2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* On white, as on the page. */
  .likeness {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 1px 6px;
    border: 1.5px solid currentColor;
    border-radius: 3px;
    background: var(--paper);
    font-family: Helvetica, Arial, sans-serif;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    max-width: 100%;
  }
  .likeness .main {
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .likeness .sub {
    font-size: 0.7em;
  }
  .thumb {
    max-height: 18px;
    max-width: 90px;
    background: var(--paper);
    border-radius: 2px;
  }
  .narrow .thumb {
    max-width: 36px;
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
  .tgl {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--tx2);
  }
  .tgl.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .own {
    width: 180px;
    height: 24px;
    font-size: 12px;
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
  .opt.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  hr {
    width: 100%;
    margin: 3px 0;
    border: none;
    border-top: 1px solid var(--bd);
  }
  .error {
    margin: 4px 6px;
    max-width: 240px;
    font-size: 12px;
    color: var(--danger);
  }
</style>
