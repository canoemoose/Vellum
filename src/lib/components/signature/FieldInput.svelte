<script module lang="ts">
  import { STAMP_FIELDS } from "../../markup/stamps";

  /** A field's name as its chip shows it ("Author"). */
  export const fieldName = (f: string): string => f.charAt(0).toUpperCase() + f.slice(1);

  const isField = (f: string) => (STAMP_FIELDS as readonly string[]).includes(f.toLowerCase());

  /** Wording as runs of text and fields (\{ and \} stay as typed: text). */
  export function segments(value: string): ({ text: string } | { field: string })[] {
    const out: ({ text: string } | { field: string })[] = [];
    const re = /\\[{}]|\{(\w+)\}/g;
    let at = 0;
    let m: RegExpExecArray | null;
    const text = (t: string) => {
      if (!t) return;
      const last = out[out.length - 1];
      if (last && "text" in last) last.text += t;
      else out.push({ text: t });
    };
    while ((m = re.exec(value))) {
      text(value.slice(at, m.index));
      if (m[1] && isField(m[1])) out.push({ field: m[1].toLowerCase() });
      else text(m[0]);
      at = m.index + m[0].length;
    }
    text(value.slice(at));
    return out;
  }
</script>

<script lang="ts">
  // A wording field with its fields as chips (Matt's review): "CHECKED BY [Author]". Typing "{"
  // offers the fields; a chip is one unit (Backspace takes it whole, the arrows step over it);
  // hovering one shows what it will say. Underneath it's still plain text, {author} and all, so
  // nothing else changes: this is only how it's shown and typed. One line; Enter commits.
  //
  // The browser's own editing does the typing, so undo works; chips go in with insertHTML for
  // the same reason. Pasted text comes in plain, its fields as chips; copied text goes out as the
  // wording ({author}), not the chips' names.
  import { tick } from "svelte";

  interface Props {
    value: string;
    /** Every change, as wording. */
    onInput?: (value: string) => void;
    /** Enter, or leaving the field. */
    onCommit?: (value: string) => void;
    /** Esc (the value is put back first). */
    onCancel?: () => void;
    placeholder?: string;
    label: string;
    disabled?: boolean;
    /** Characters of wording at most (a field counts as its {name}). */
    maxlength?: number;
    /** What a field will say now, for its chip's tooltip. */
    preview?: (field: string) => string;
    /** Capitals, as a text stamp's main line is shown. */
    caps?: boolean;
    autofocus?: boolean;
  }
  let p: Props = $props();

  let box = $state<HTMLDivElement>();
  /** The wording as last shown or typed (so an outside change is told from our own). */
  let shown: string | null = null;
  let menu = $state<{ query: string; at: number; x: number; y: number } | null>(null);
  let empty = $state(true);

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const chip = (f: string) => `<span class="chip" contenteditable="false" data-field="${f}" title="${esc(p.preview ? `${fieldName(f)}: ${p.preview(f) || "(empty now)"}` : fieldName(f))}">${fieldName(f)}</span>`;
  const html = (value: string) => segments(value).map((s) => ("field" in s ? chip(s.field) : esc(s.text))).join("");

  /** The wording the box holds now. */
  function read(node: Node | null = box ?? null): string {
    if (!node) return "";
    let s = "";
    for (const n of node.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) s += (n.nodeValue ?? "").replace(/ /g, " ").replace(/​/g, "");
      else if (n instanceof HTMLElement && n.dataset.field) s += `{${n.dataset.field}}`;
      else if (n instanceof HTMLElement && n.tagName !== "BR") s += read(n);
    }
    return s;
  }

  // Shown again only when the value changes from outside (typing keeps its own caret).
  $effect(() => {
    const v = p.value;
    if (!box || v === shown) return;
    box.innerHTML = html(v);
    shown = v;
    empty = !v;
  });

  $effect(() => {
    if (p.autofocus && box) void tick().then(() => box?.focus());
  });

  function changed() {
    let v = read();
    if (p.maxlength && v.length > p.maxlength) {
      document.execCommand("undo");
      v = read();
    }
    shown = v;
    empty = !v;
    // The placeholder goes at once (it would otherwise still be there when the caret is measured).
    box?.classList.toggle("empty", !v);
    p.onInput?.(v);
    void tick().then(lookForBrace);
  }

  /** Put HTML in where the caret is, as the browser's own edit (so undo takes it back). */
  function put(markup: string) {
    box?.focus();
    document.execCommand("insertHTML", false, markup);
  }

  /** A field put in where the caret is (the field buttons). */
  export function insert(field: string) {
    if (p.disabled) return;
    put(chip(field) + "​");
    tidy();
    changed();
  }

  /** Zero-width spaces put after chips (so the caret has somewhere to sit) don't stay in the wording. */
  function tidy() {
    if (!box) return;
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n as Text;
      if (t.nodeValue?.includes("​") && t.nodeValue !== "​") t.nodeValue = t.nodeValue.replace(/​/g, "");
    }
  }

  /** The text just before the caret in its text node, and the caret's place on screen. */
  function beforeCaret(): { text: string; node: Text; offset: number; rect: DOMRect } | null {
    const sel = window.getSelection();
    if (!sel?.rangeCount || !box) return null;
    const r = sel.getRangeAt(0);
    if (!r.collapsed || r.startContainer.nodeType !== Node.TEXT_NODE || !box.contains(r.startContainer)) return null;
    const node = r.startContainer as Text;
    let rect = r.getBoundingClientRect();
    // A collapsed range can measure as nothing: the character before the caret, its right edge.
    if (!rect.width && !rect.height && r.startOffset > 0) {
      const c = document.createRange();
      c.setStart(node, r.startOffset - 1);
      c.setEnd(node, r.startOffset);
      const b = c.getBoundingClientRect();
      rect = new DOMRect(b.right, b.top, 0, b.height);
    }
    return { text: (node.nodeValue ?? "").slice(0, r.startOffset), node, offset: r.startOffset, rect };
  }

  /** Typing "{" opens the menu of fields; the letters after it narrow it; "}" makes the chip. */
  function lookForBrace() {
    const b = beforeCaret();
    const m = b && /(^|[^\\])\{(\w*)$/.exec(b.text);
    if (!b || !m) {
      menu = null;
      return;
    }
    const box0 = box!.getBoundingClientRect();
    menu = { query: m[2].toLowerCase(), at: b.text.length - m[2].length - 1, x: b.rect.left - box0.left, y: box0.height };
  }

  const matches = $derived(menu ? STAMP_FIELDS.filter((f) => f.startsWith(menu!.query)) : []);
  let picked = $state(0);
  $effect(() => {
    void menu?.query;
    picked = 0;
  });

  /** The menu's field chosen: "{" and what was typed after it become the chip. */
  function choose(f: string) {
    const b = beforeCaret();
    if (!b || !menu) return;
    const range = document.createRange();
    range.setStart(b.node, menu.at);
    range.setEnd(b.node, b.offset);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    menu = null;
    put(chip(f) + "​");
    tidy();
    changed();
  }

  function keys(e: KeyboardEvent) {
    e.stopPropagation(); // typing never reaches the app's shortcuts
    if (menu && matches.length) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        picked = (picked + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
        return;
      }
      if (e.key === "Enter" || e.key === "Tab" || e.key === "}") {
        e.preventDefault();
        choose(matches[picked]);
        return;
      }
    }
    if (e.key === "Escape") {
      if (menu) {
        menu = null;
        return;
      }
      if (box) box.innerHTML = html(p.value);
      shown = p.value;
      p.onCancel?.();
      box?.blur();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      p.onCommit?.(read());
    }
  }

  function paste(e: ClipboardEvent) {
    e.preventDefault();
    const t = (e.clipboardData?.getData("text/plain") ?? "").replace(/\s+/g, " ");
    put(html(t));
    tidy();
    changed();
  }

  function copy(e: ClipboardEvent) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const frag = document.createElement("div");
    frag.appendChild(sel.getRangeAt(0).cloneContents());
    e.clipboardData?.setData("text/plain", read(frag).replace(/​/g, ""));
    e.preventDefault();
    if (e.type === "cut") {
      document.execCommand("delete");
      changed();
    }
  }
</script>

<div class="wrap" class:disabled={p.disabled}>
  <div
    bind:this={box}
    class="field box"
    class:caps={p.caps}
    class:empty
    role="textbox"
    aria-label={p.label}
    aria-disabled={p.disabled}
    tabindex={p.disabled ? -1 : 0}
    contenteditable={p.disabled ? "false" : "true"}
    spellcheck="false"
    data-placeholder={p.placeholder ?? ""}
    oninput={changed}
    onkeydown={keys}
    onkeyup={(e) => e.stopPropagation()}
    onpaste={paste}
    oncopy={copy}
    oncut={copy}
    onblur={() => {
      menu = null;
      p.onCommit?.(read());
    }}
  ></div>
  {#if menu && matches.length}
    <div class="menu" role="listbox" aria-label="Fields" style:left="{menu.x}px" style:top="{menu.y + 2}px">
      {#each matches as f, i (f)}
        <button type="button" role="option" class="opt" class:on={i === picked} aria-selected={i === picked} onmousedown={(e) => e.preventDefault()} onclick={() => choose(f)}>
          <span class="chip">{fieldName(f)}</span>
          {#if p.preview}<span class="eg">{p.preview(f)}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
  }
  /* The app's field (.field): the same height, one line, the text in the middle. */
  .box {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    line-height: 30px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    cursor: text;
    outline: none;
  }
  .box.caps {
    text-transform: uppercase;
  }
  .box.empty::before {
    content: attr(data-placeholder);
    color: var(--tx3);
    text-transform: none;
    pointer-events: none;
  }
  .disabled .box {
    opacity: 0.5;
    cursor: default;
  }
  /* A field: shaded, so it reads as "filled in when placed", not as typed text. */
  .box :global(.chip),
  .chip {
    display: inline-block;
    padding: 0 5px;
    margin: 0 1px;
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: 11px;
    line-height: 18px;
    vertical-align: middle;
    text-transform: none;
    user-select: all;
  }
  .menu {
    position: absolute;
    z-index: 70;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    padding: 4px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 6px;
    box-shadow: var(--shadow-pop);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--tx);
    font-size: 12px;
    text-align: left;
  }
  .opt.on,
  .opt:hover {
    background: var(--hover);
  }
  .eg {
    color: var(--tx3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
