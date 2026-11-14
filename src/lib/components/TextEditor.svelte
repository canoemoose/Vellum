<script lang="ts">
  // Typing into a text box: a borderless textarea laid exactly over the box on the canvas, in
  // the same font (Arial, Helvetica's widths), size and padding, so the text sits where the
  // saved text will. The canvas still draws the box's border and fill underneath. Esc or a click
  // elsewhere finishes; the box grows as you type (the markup tool does that).
  import { onMount } from "svelte";

  interface Props {
    /** Screen (CSS px) position of the box's top-left corner, its size, and the view's rotation. */
    x: number;
    y: number;
    w: number;
    h: number;
    rotation: number;
    /** CSS px per point. */
    scale: number;
    size: number;
    pad: number;
    colour: string;
    text: string;
    onInput: (text: string) => void;
    onDone: () => void;
  }
  let p: Props = $props();
  let area: HTMLTextAreaElement;

  // The canvas puts the first baseline 0.78 em below the padding (ops.ts). In a textarea with a
  // 1.2 em line height, Arial's first baseline sits 0.9465 em below the top padding (0.905 em
  // ascent plus half the extra leading), so the top padding is 0.1665 em less to match.
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
  style:font-size="{p.size * p.scale}px"
  style:line-height="{p.size * 1.2 * p.scale}px"
  style:padding="{Math.max(0, p.pad - 0.1665 * p.size) * p.scale}px {p.pad * p.scale}px"
  style:color={p.colour}
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
    font-family: Arial, Helvetica, sans-serif;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    z-index: 5;
    user-select: text;
  }
</style>
