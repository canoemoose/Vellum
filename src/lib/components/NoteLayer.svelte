<script lang="ts">
  // Notes on the canvas (markup/kinds/note.ts): the small editor beside a note's icon (opened
  // when a note is placed, and on a double-click), and its text shown when the pointer rests on
  // it. Esc, Ctrl+Enter or a click elsewhere finishes editing; the change is one undo step. A
  // click on the drawing that ends the typing does nothing else (rule 3: it doesn't place
  // another note), and an empty note stays, to be written in later.
  //
  // Stage 7: a note can be pinned open, with the pin in its editor (and on the box itself), each
  // pin or unpin one undo step. A pinned note's text shows in a small box beside the icon, a
  // fixed size on screen and upright at any view rotation, for as long as the overlay draws the
  // note (one from another app that hasn't been changed is PDFium's, which draws its own open
  // pop-up). In Select a click on the box opens the editor and its pin unpins it; with any other
  // tool out the pointer passes through the box, so it never gets in the way of drawing.
  import { onMount, tick } from "svelte";
  import type { Viewer } from "../engine/viewer";
  import type { MarkupTool } from "../engine/markupTool";
  import type { Markup } from "../markup/types";
  import { hits } from "../markup/geometry";
  import { type NoteMarkup, besideIcon, noteBox } from "../markup/kinds/note";

  interface Props {
    viewer: Viewer;
    markupTool: MarkupTool;
    /** Changes whenever the markups, selection or tool change (App's markVersion). */
    version: number;
    /** Changes whenever the view moves (so the editor follows its note). */
    view: unknown;
    tool: string;
    areaW: number;
    areaH: number;
  }
  let p: Props = $props();

  let editing = $state<string | null>(null);
  let draft = $state("");
  let hover = $state<{ id: string; x: number; y: number } | null>(null);
  let area = $state<HTMLTextAreaElement>();
  /** Notes whose editor has opened since they were placed (so a new note opens it once). */
  const opened = new Set<string>();
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;

  const noteById = (id: string | null): NoteMarkup | null => {
    const m = id ? p.markupTool.doc?.byId(id) : undefined;
    return m?.kind === "note" ? m : null;
  };

  /** A note's pin is showing its text beside it here (pinned, and the overlay draws it). */
  const showsPinned = (n: NoteMarkup): boolean => !!n.pinned && !!p.markupTool.doc?.overlayDraws(n);

  /** Pin or unpin a note open: one undo step. */
  function setPin(id: string | null, pinned: boolean) {
    const n = noteById(id);
    if (n && !!n.pinned !== pinned) p.markupTool.updateMarkup({ ...n, pinned });
  }

  /** The icon's corners on screen (a view rotation turns them). */
  function iconCorners(n: NoteMarkup): [number, number][] | null {
    const b = noteBox(n);
    const cs = [
      [b[0], b[1]],
      [b[2], b[1]],
      [b[2], b[3]],
      [b[0], b[3]],
    ].map(([x, y]) => p.viewer.pageToScreen(n.page, x, y));
    return cs.every((c) => c !== null) ? (cs as [number, number][]) : null;
  }

  /** The topmost note under a stage point, if any. */
  function noteAt(x: number, y: number): NoteMarkup | null {
    const pp = p.viewer.pagePointAt(x, y);
    const doc = p.markupTool.doc;
    if (!pp || !doc) return null;
    const on = doc.markups.filter((m): m is NoteMarkup => m.kind === "note" && m.page === pp.page);
    for (let i = on.length - 1; i >= 0; i--) if (hits(on[i] as Markup, [pp.x, pp.y], 0)) return on[i];
    return null;
  }

  async function open(id: string) {
    const n = noteById(id);
    if (!n) return;
    opened.add(id);
    hover = null;
    editing = id;
    draft = n.text;
    // A press on the drawing ends the typing (and only that): markupTool.ts, down().
    p.markupTool.typingElsewhere = () => area?.blur();
    await tick();
    area?.focus();
    area?.setSelectionRange(draft.length, draft.length);
  }

  function done() {
    const n = noteById(editing);
    editing = null;
    p.markupTool.typingElsewhere = null;
    if (n && draft !== n.text) p.markupTool.updateMarkup({ ...n, text: draft });
  }

  // A note just placed (the Note tool's new note, selected and empty) opens its editor.
  $effect(() => {
    void p.version;
    if (p.tool !== "note" || editing) return;
    const sel = p.markupTool.selected();
    const n = sel.length === 1 && sel[0].kind === "note" ? sel[0] : null;
    if (n && !n.text && !opened.has(n.id)) void open(n.id);
  });

  // The note being edited went away (undone, deleted, another tab): close without saving.
  $effect(() => {
    void p.version;
    if (editing && !noteById(editing)) {
      editing = null;
      p.markupTool.typingElsewhere = null;
    }
  });

  /** Always present, so its parent (the stage, which holds the canvas) is known. */
  let anchor: HTMLSpanElement;
  /** The event's point in the stage (the viewer's coordinates), if it's on the drawing. */
  const onDrawing = (e: MouseEvent): readonly [number, number] | null => {
    const stage = anchor?.parentElement;
    // With the pointer captured (a press on the drawing), events land on the stage itself.
    if (!stage || !(e.target === stage || (e.target instanceof HTMLCanvasElement && e.target.parentElement === stage))) return null;
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  onMount(() => {
    const move = (e: PointerEvent) => {
      const at = e.buttons ? null : onDrawing(e);
      if (!at) {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = null;
        if (hover) hover = null;
        return;
      }
      const [x, y] = at;
      const n = noteAt(x, y);
      // A pinned note already shows its text: no hover box as well.
      if (!n || n.id === editing || showsPinned(n)) {
        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = null;
        hover = null;
        return;
      }
      if (hover?.id === n.id) return;
      hover = null;
      if (hoverTimer) clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => (hover = { id: n.id, x, y }), 300);
    };
    const dbl = (e: MouseEvent) => {
      const at = p.tool === "select" ? onDrawing(e) : null;
      const n = at ? noteAt(at[0], at[1]) : null;
      // Phase 7b: a note that came with the file opens only once the document is unlocked.
      if (n && p.markupTool.doc?.editable(n)) void open(n.id);
    };
    const leave = () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      hover = null;
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("dblclick", dbl);
    window.addEventListener("blur", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("dblclick", dbl);
      window.removeEventListener("blur", leave);
      if (hoverTimer) clearTimeout(hoverTimer);
    };
  });

  /** The editor's place: beside the icon (right of it), kept inside the drawing area. */
  const editorAt = $derived.by(() => {
    void p.view;
    void p.version;
    const n = noteById(editing);
    if (!n) return null;
    const cs = iconCorners(n);
    if (!cs) return null;
    const W = 220, H = 120;
    // The whole editor (its header and the text area) kept inside the drawing area.
    const { x, y } = besideIcon(cs, W, H + 30, { w: p.areaW, h: p.areaH });
    return { x, y, w: W, h: H, author: n.meta.author, pinned: !!n.pinned };
  });

  /** The pinned notes' boxes on screen (stage 7): beside each icon, travelling with it. */
  const PIN_W = 200, PIN_H = 140;
  const pinnedBoxes = $derived.by(() => {
    void p.view;
    void p.version;
    const doc = p.markupTool.doc;
    if (!doc) return [];
    const out: { id: string; x: number; y: number; text: string; colour: string; live: boolean }[] = [];
    for (const m of doc.markups) {
      if (m.kind !== "note" || m.id === editing || !showsPinned(m)) continue;
      const cs = iconCorners(m);
      if (!cs) continue;
      const { x, y } = besideIcon(cs, PIN_W, PIN_H, null);
      if (x > p.areaW || y > p.areaH || x + PIN_W < 0 || y + PIN_H < 0) continue; // off screen
      const c = m.style.stroke.map((v) => Math.round(v * 255)).join(", ");
      out.push({ id: m.id, x, y, text: m.text, colour: `rgb(${c})`, live: p.tool === "select" && doc.editable(m) });
    }
    return out;
  });

  const hoverNote = $derived.by(() => {
    void p.version;
    return hover ? noteById(hover.id) : null;
  });
</script>

<span class="anchor" bind:this={anchor} aria-hidden="true"></span>

{#if editorAt}
  <div class="note-editor" style:left="{editorAt.x}px" style:top="{editorAt.y}px" style:width="{editorAt.w}px">
    <div class="head">
      <span class="who">{editorAt.author}</span>
      <!-- Stage 7: the pin. A press keeps the focus in the text, so pinning doesn't end the typing. -->
      <button
        type="button"
        class="icon-btn pin"
        class:on={editorAt.pinned}
        aria-pressed={editorAt.pinned}
        aria-label="Pin open"
        title={editorAt.pinned ? "Pinned open: the text shows beside the note. Click to show it only on hover." : "Pin open: show the text beside the note all the time. It doesn't print; use a callout for that."}
        onmousedown={(e) => e.preventDefault()}
        onclick={() => setPin(editing, !editorAt.pinned)}
      >
        {@render pinIcon(editorAt.pinned)}
      </button>
    </div>
    <textarea
      bind:this={area}
      bind:value={draft}
      aria-label="Note"
      spellcheck="true"
      style:height="{editorAt.h}px"
      onblur={done}
      onkeydown={(e) => {
        e.stopPropagation(); // typing never reaches the viewer's or the shell's shortcuts
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          area?.blur();
        }
      }}
    ></textarea>
  </div>
{/if}

{#snippet pinIcon(on: boolean)}
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.5 1.8h5l-.8 4.4 2.6 2.6v1.3H3.7V8.8l2.6-2.6z" fill={on ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
    <path d="M8 10.1v4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
  </svg>
{/snippet}

{#each pinnedBoxes as b (b.id)}
  <!-- A pinned note's text (stage 7). In Select a click opens the editor; otherwise the pointer passes through. -->
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="note-pinned" class:live={b.live} style:left="{b.x}px" style:top="{b.y}px" style:border-left-color={b.colour} onclick={() => b.live && open(b.id)}>
    {#if b.live}
      <button
        type="button"
        class="icon-btn unpin"
        aria-label="Unpin"
        title="Unpin: show the text only on hover"
        onclick={(e) => {
          e.stopPropagation();
          setPin(b.id, false);
        }}
      >
        {@render pinIcon(true)}
      </button>
    {/if}
    {#if b.text.trim()}{b.text}{:else}<span class="empty">Empty note</span>{/if}
  </div>
{/each}

{#if hover && hoverNote}
  <div class="note-tip" role="tooltip" style:left="{Math.min(hover.x + 14, p.areaW - 270)}px" style:top="{hover.y + 18}px">
    {#if hoverNote.text.trim()}{hoverNote.text}{:else}<span class="empty">Empty note (double-click to write in it)</span>{/if}
  </div>
{/if}

<style>
  .anchor {
    display: none;
  }
  .note-editor {
    position: absolute;
    z-index: 7;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    background: var(--app);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    box-sizing: border-box;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 20px;
  }
  .who {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    color: var(--tx3);
    padding: 0 2px;
  }
  .pin {
    flex: 0 0 auto;
    width: 22px;
    height: 20px;
    padding: 0;
  }
  .pin.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .note-pinned {
    position: absolute;
    z-index: 6;
    width: max-content;
    max-width: 200px;
    max-height: 140px;
    overflow: hidden;
    box-sizing: border-box;
    padding: 5px 8px;
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--tx-pop);
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-left-width: 3px;
    border-radius: 6px;
    box-shadow: var(--shadow-pop);
    /* With a drawing tool out, the pointer passes through to the drawing. */
    pointer-events: none;
  }
  .note-pinned.live {
    pointer-events: auto;
    overflow: auto;
    cursor: pointer;
  }
  .unpin {
    float: right;
    width: 20px;
    height: 18px;
    margin: -3px -6px 0 4px;
    padding: 0;
    color: var(--tx3);
  }
  .unpin:hover {
    color: var(--tx);
  }
  textarea {
    resize: none;
    width: 100%;
    box-sizing: border-box;
    padding: 6px 7px;
    font: inherit;
    font-size: 12px;
    line-height: 1.4;
    color: var(--tx);
    background: var(--ctl);
    border: 1px solid var(--bd-input);
    border-radius: 5px;
    outline: none;
  }
  textarea:focus {
    border-color: var(--accent);
  }
  .note-tip {
    position: absolute;
    z-index: 7;
    max-width: 260px;
    padding: 6px 8px;
    font-size: 12px;
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--tx-pop);
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 6px;
    box-shadow: var(--shadow-pop);
    pointer-events: none;
  }
  .empty {
    color: var(--tx3);
  }
</style>
