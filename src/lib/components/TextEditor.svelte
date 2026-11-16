<script lang="ts">
  // Typing into a text box: a borderless textarea laid exactly over the box on the canvas, in
  // the same screen font (fonts.ts), style, size, spacing and padding, so the text sits where
  // the saved text will. The canvas still draws the box's border and fill underneath. Esc or a click
  // elsewhere finishes; the box grows as you type (the markup tool does that).
  import { onMount } from "svelte";
  import type { TextStyle } from "../markup/types";
  import { fullText } from "../markup/types";
  import { cssFamily, screenMetrics } from "../markup/fonts";
  import { ASCENT } from "../markup/ops";

  interface Props {
    /** Screen (CSS px) position of the box's top-left corner, its size, and the view's rotation. */
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
    /** CSS px per point. */
    scale: number;
    textStyle: TextStyle;
    pad: number;
    text: string;
    onInput: (text: string) => void;
    onDone: () => void;
  }
  let p: Props = $props();
  let area: HTMLTextAreaElement;
  const t = $derived(fullText(p.textStyle));
  const colour = $derived(`rgb(${t.colour.map((x) => Math.round(x * 255)).join(",")})`);

  // The canvas puts the first baseline ASCENT em below the padding (ops.ts). In a textarea the
  // first baseline sits half the line's spare height plus the font's ascent below the top
  // padding (for Arial at 1.2 em: 0.0415 + 0.905 = 0.9465 em), so the top padding is adjusted
  // by the difference.
  const lift = $derived.by(() => {
    const m = screenMetrics(t.family);
    return (t.spacing - m.ascent - m.descent) / 2 + m.ascent - ASCENT;
  });
  onMount(() => {
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
  });
</script>

<textarea
  bind:this={area}
  class="editor"
  aria-label="Text box"
  spellcheck="true"
  value={p.text}
  style:left="{p.x}px"
  style:top="{p.y}px"
  style:width="{p.w}px"
  style:height="{p.h}px"
  style:transform="rotate({p.rotation}deg)"
  style:font-family={cssFamily(t.family)}
  style:font-weight={t.bold ? "bold" : "normal"}
  style:font-style={t.italic ? "italic" : "normal"}
  style:text-align={t.align}
  style:text-decoration={[t.underline ? "underline" : "", t.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none"}
  style:font-size="{t.size * p.scale}px"
  style:line-height="{t.size * t.spacing * p.scale}px"
  style:padding="{Math.max(0, p.pad - lift * t.size) * p.scale}px {p.pad * p.scale}px"
  style:color={colour}
  oninput={(e) => p.onInput((e.currentTarget as HTMLTextAreaElement).value)}
  onblur={() => p.onDone()}
  onkeydown={(e) => {
    e.stopPropagation(); // typing never reaches the viewer's or the shell's shortcuts
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      p.onDone();
    }
  }}
></textarea>

<style>
  .editor {
    position: absolute;
    transform-origin: 0 0;
    box-sizing: border-box;
    margin: 0;
    border: none;
    outline: 1px dashed var(--accent);
    background: transparent;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    z-index: 5;
    user-select: text;
  }
</style>
