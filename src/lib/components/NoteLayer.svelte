<script lang="ts">
  // Notes on the canvas (markup/kinds/note.ts): the small editor beside a note's icon (opened
  // when a note is placed, and on a double-click), and its text shown when the pointer rests on
  // it. Esc, Ctrl+Enter or a click elsewhere finishes editing; the change is one undo step. A
  // click on the drawing that ends the typing does nothing else (rule 3: it doesn't place
  // another note), and an empty note stays, to be written in later.
  import { onMount, tick } from "svelte";
  import type { Viewer } from "../engine/viewer";
  import type { MarkupTool } from "../engine/markupTool";
  import type { Markup } from "../markup/types";
  import { hits } from "../markup/geometry";
  import { type NoteMarkup, NOTE_SIZE } from "../markup/kinds/note";

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
      if (!n || n.id === editing) {
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
    const tl = p.viewer.pageToScreen(n.page, n.at[0], n.at[1]);
    if (!tl) return null;
    const W = 220, H = 120;
    const x = Math.max(6, Math.min(tl[0] + NOTE_SIZE + 6, p.areaW - W - 6));
    const y = Math.max(6, Math.min(tl[1], p.areaH - H - 6));
    return { x, y, w: W, h: H, author: n.meta.author };
  });

  const hoverNote = $derived.by(() => {
    void p.version;
    return hover ? noteById(hover.id) : null;
  });
</script>

<span class="anchor" bind:this={anchor} aria-hidden="true"></span>

{#if editorAt}
  <div class="note-editor" style:left="{editorAt.x}px" style:top="{editorAt.y}px" style:width="{editorAt.w}px">
    {#if editorAt.author}<div class="who">{editorAt.author}</div>{/if}
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
  .who {
    font-size: 11px;
    color: var(--tx3);
    padding: 0 2px;
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
