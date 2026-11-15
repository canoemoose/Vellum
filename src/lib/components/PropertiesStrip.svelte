<script lang="ts">
  // Floats over the canvas while a drawing tool or a markup is selected (App.svelte puts it in
  // the stage, so showing it never resizes the canvas): line colour and opacity, line weight,
  // dash, fill colour and opacity, and for text boxes the text size and colour. With a tool, it
  // sets what the tool draws next (remembered per tool); with markups selected, it changes them.
  // Drag its grip to dock it against any edge, anywhere along it (it snaps to the middle). On
  // the sides it's a thin column where the drawing area is tall enough for the largest bar (a
  // text box's), else a wider stack of sections: decided by the area, never by the tool, so it
  // doesn't jump about. Each palette ends with a custom colour (ColourPicker, with an eyedropper).
  import { type Align, type LineEnd, type MarkupKind, type Rgb, type Style, type TextStyle, DEFAULT_TEXT, SPACINGS, arrowEnds, fillOpacity, fullText } from "../markup/types";
  import { type Family, cssFamily } from "../markup/fonts";
  import { type Dock, type Edge, DOCK_MARGIN, dockAt, dockPosition, isSide } from "../shell/dock";
  import { sameColour as same } from "../markup/colour";
  import ColourPicker from "./ColourPicker.svelte";
  import WeightControl from "./WeightControl.svelte";
  import PopChoice from "./PopChoice.svelte";
  import { DASHES, dashOption } from "../markup/dash";
  import { outFrom } from "../shell/popout";
  import { kindOf } from "../markup/kinds";

  interface Props {
    /** The kinds involved: the tool's, or the selected markups'. */
    kinds: MarkupKind[];
    style: Style;
    text: TextStyle | null;
    /** "Arrow tool" or "2 markups selected". */
    label: string;
    /** Hide the line-end choices (a tool whose ends are fixed, such as Line). */
    noEnds?: boolean;
    dock: Dock;
    /** The drawing area's size, CSS px. */
    areaW: number;
    areaH: number;
    /** live: a slider being dragged (show it, don't record it); a final call without follows. */
    onStyle: (patch: Partial<Style>, live?: boolean) => void;
    onText: (patch: Partial<TextStyle>) => void;
    /** The bar was dragged (done: let go, so remember it). */
    onDock: (d: Dock, done: boolean) => void;
  }
  let p: Props = $props();

  const COLOURS: { name: string; c: Rgb }[] = [
    { name: "Red", c: [0.85, 0.1, 0.1] },
    { name: "Orange", c: [0.95, 0.5, 0.05] },
    { name: "Yellow", c: [0.95, 0.78, 0.0] },
    { name: "Green", c: [0.1, 0.6, 0.2] },
    { name: "Blue", c: [0.05, 0.35, 0.8] },
    { name: "Magenta", c: [0.75, 0.1, 0.6] },
    { name: "Black", c: [0, 0, 0] },
  ];
  const FILLS: { name: string; c: Rgb }[] = [
    { name: "White", c: [1, 1, 1] },
    { name: "Pale yellow", c: [1, 0.97, 0.7] },
    { name: "Pale red", c: [1, 0.85, 0.85] },
    { name: "Pale blue", c: [0.85, 0.92, 1] },
    { name: "Pale green", c: [0.85, 0.96, 0.85] },
    { name: "Pale grey", c: [0.9, 0.9, 0.9] },
  ];
  const SIZES = [6, 8, 10, 12, 14, 18, 24, 36];
  const SIZE_OPTS = SIZES.map((v) => ({ key: String(v), name: `${v} pt` }));
  const ENDS: { key: LineEnd; name: string }[] = [
    { key: "none", name: "None" },
    { key: "open", name: "Open arrow" },
    { key: "filled", name: "Filled arrow" },
    { key: "dot", name: "Dot" },
    { key: "bar", name: "Bar" },
    { key: "slash", name: "Slash" },
  ];
  const PATTERNS = DASHES.map((o) => ({ key: o.name, name: o.name }));
  const FAMILIES: { key: Family; name: string }[] = [
    { key: "helvetica", name: "Helvetica" },
    { key: "times", name: "Times" },
    { key: "courier", name: "Courier" },
  ];
  const SPACING_OPTS = SPACINGS.map((v) => ({ key: String(v), name: `${v.toFixed(1)} lines` }));
  const ALIGNS: { key: Align; name: string }[] = [
    { key: "left", name: "Align left" },
    { key: "center", name: "Centre" },
    { key: "right", name: "Align right" },
  ];
  /** The pattern as an SVG dash array: points for a 1 pt line, drawn a little larger. */
  const svgDash = (name: string | null) => {
    const d = name === null ? p.style.dash : (DASHES.find((o) => o.name === name)?.dash ?? null);
    return d?.length ? d.map((v) => v * 1.4).join(" ") : "none";
  };
  function setEnd(i: 0 | 1, e: LineEnd) {
    const ends = arrowEnds(p.style);
    ends[i] = e;
    p.onStyle({ ends });
  }

  const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
  const vertical = $derived(isSide(p.dock.edge));
  /** Which way a pop-out (the weight slider) leaves the bar: away from its edge. */
  const out = $derived(outFrom(p.dock.edge));

  let w = $state(0);
  let h = $state(0);
  // The thin column's size with every section showing, from a hidden copy laid out that way.
  let colW = $state(0);
  let colH = $state(0);
  /** On a side: the thin column if the largest one fits the area's height, else the stack. */
  const column = $derived(vertical && colH > 0 && colH <= p.areaH - 2 * DOCK_MARGIN);
  const pos = $derived(dockPosition(p.dock, p.areaW, p.areaH, w, h));

  /** The custom colour picker that's open, and for which palette. */
  let picker = $state<{ which: "stroke" | "fill" | "text"; value: Rgb; anchor: DOMRect } | null>(null);

  function openPicker(e: MouseEvent, which: "stroke" | "fill" | "text", value: Rgb | null) {
    if (picker?.which === which) {
      picker = null;
      return;
    }
    picker = { which, value: value ?? [0.5, 0.5, 0.5], anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() };
  }

  function pick(c: Rgb) {
    if (!picker) return;
    if (picker.which === "stroke") p.onStyle({ stroke: c });
    else if (picker.which === "fill") p.onStyle({ fill: c });
    else p.onText({ colour: c });
  }

  /** Dragging the grip: dock to the nearest edge under the pointer. */
  function grip(e: PointerEvent) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const area = (el.closest(".strip") as HTMLElement).offsetParent as HTMLElement | null;
    if (!area) return;
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
    // The bar's size on each kind of edge: as measured now, or as it would be on the other kind.
    const fitsColumn = colH > 0 && colH <= area.clientHeight - 2 * DOCK_MARGIN;
    const sizes: Record<"along" | "side", { w: number; h: number }> = vertical
      ? { side: { w, h }, along: { w: Math.max(h, 560), h: 40 } }
      : { along: { w, h }, side: fitsColumn ? { w: colW, h: colH } : { w: 206, h: Math.max(w * 0.6, 320) } };
    const size = (edge: Edge) => (isSide(edge) ? sizes.side : sizes.along);
    // Where along the bar it was grabbed, kept for this orientation; the grip sits at the start
    // of the bar either way, so the other orientation holds it by its grip too.
    const bar = (el.closest(".strip") as HTMLElement).getBoundingClientRect();
    const held = vertical ? e.clientY - bar.top : e.clientX - bar.left;
    const gripAt = (edge: Edge) => (isSide(edge) === vertical ? held : 12);
    const at = (ev: PointerEvent, done: boolean) => {
      const r = area.getBoundingClientRect();
      p.onDock(dockAt(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height, size, gripAt), done);
    };
    const move = (ev: PointerEvent) => at(ev, false);
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      at(ev, true);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  }
</script>

<div
  class="strip"
  class:vertical
  class:column
  role="toolbar"
  aria-label="Markup properties"
  aria-orientation={vertical ? "vertical" : "horizontal"}
  bind:clientWidth={w}
  bind:clientHeight={h}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
>
  {@render body(p.kinds, p.text, "mk", column)}
</div>

<!-- Measures the thin column with every section (a text box's bar), to decide whether it fits. -->
<div class="strip vertical column measure" aria-hidden="true" inert bind:clientWidth={colW} bind:clientHeight={colH}>
  {@render body(["text"], p.text ?? DEFAULT_TEXT, "mk-measure", true)}
</div>

{#snippet body(kinds: MarkupKind[], text: TextStyle | null, idp: string, narrow: boolean)}
  {@const fillable = kinds.some((k) => kindOf(k).controls.fill)}
  {@const isText = kinds.some((k) => kindOf(k).controls.text)}
  <div class="head">
    <span class="grip" role="separator" aria-label="Move the properties bar" title={narrow ? `${p.label}: drag to move it to any edge` : "Drag to move it to any edge"} onpointerdown={grip}>
      <svg width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="2" r="1.2" /><circle cx="6" cy="2" r="1.2" /><circle cx="2" cy="7" r="1.2" /><circle cx="6" cy="7" r="1.2" /><circle cx="2" cy="12" r="1.2" /><circle cx="6" cy="12" r="1.2" /></g></svg>
    </span>
    <span class="label">{p.label}</span>
  </div>

  <span class="sep" aria-hidden="true"></span>
  <div class="prop" role="group" aria-label={isText ? "Border" : "Line"}>
    <span class="k">{isText ? "Border" : "Colour"}</span>
    <div class="pal">
      <div class="swatches" role="radiogroup" aria-label={isText ? "Border colour" : "Line colour"}>
        {#each COLOURS as col (col.name)}
          <button type="button" role="radio" class="sw" class:on={same(p.style.stroke, col.c)} aria-checked={same(p.style.stroke, col.c)} aria-label={col.name} title={col.name} style:--c={css(col.c)} onclick={() => p.onStyle({ stroke: col.c })}></button>
        {/each}
        {@render custom("stroke", p.style.stroke, COLOURS)}
      </div>
      {@render opacity(isText ? "Border opacity" : "Line opacity", p.style.opacity, p.style.stroke, false, (o, live) => p.onStyle({ opacity: o }, live))}
    </div>
  </div>

  <span class="sep" aria-hidden="true"></span>
  <div class="prop">
    <label class="k" for="{idp}-weight">Weight</label>
    <div class="controls">
      <WeightControl id="{idp}-weight" value={p.style.width} min={isText ? 0 : 0.25} compact={narrow} {out} onChange={(wt) => p.onStyle({ width: wt })} onPreview={(wt) => p.onStyle({ width: wt }, true)} />
      <PopChoice label="Line pattern" options={PATTERNS} value={dashOption(p.style.dash)?.name ?? null} compact={narrow} {out} sample={dashSample} onChange={(k) => p.onStyle({ dash: DASHES.find((o) => o.name === k)?.dash ?? null })} />
    </div>
  </div>

  {#if !p.noEnds && kinds.some((k) => kindOf(k).controls.ends)}
    {@const ends = arrowEnds(p.style)}
    <span class="sep" aria-hidden="true"></span>
    <div class="prop" role="group" aria-label="Ends">
      <span class="k">Ends</span>
      <div class="controls">
        <PopChoice label="Tail" options={ENDS} value={ends[0]} compact={narrow} {out} sample={tailSample} onChange={(k) => setEnd(0, k)} />
        <PopChoice label="Head" options={ENDS} value={ends[1]} compact={narrow} {out} sample={headSample} onChange={(k) => setEnd(1, k)} />
      </div>
    </div>
  {/if}

  {#if fillable}
    <span class="sep" aria-hidden="true"></span>
    <div class="prop" role="group" aria-label={isText ? "Background" : "Fill"}>
      <span class="k">{isText ? "Background" : "Fill"}</span>
      <div class="pal">
        <div class="swatches" role="radiogroup" aria-label={isText ? "Background colour" : "Fill colour"}>
          <button type="button" role="radio" class="sw none" class:on={!p.style.fill} aria-checked={!p.style.fill} aria-label="None" title="None" onclick={() => p.onStyle({ fill: null })}></button>
          {#each FILLS as col (col.name)}
            <button type="button" role="radio" class="sw" class:on={same(p.style.fill, col.c)} aria-checked={same(p.style.fill, col.c)} aria-label={col.name} title={col.name} style:--c={css(col.c)} onclick={() => p.onStyle({ fill: col.c })}></button>
          {/each}
          {@render custom("fill", p.style.fill, FILLS)}
        </div>
        {@render opacity(isText ? "Background opacity" : "Fill opacity", fillOpacity(p.style), p.style.fill, !p.style.fill, (o, live) => p.onStyle({ fillOpacity: o }, live))}
      </div>
    </div>
  {/if}

  {#if isText && text}
    {@const t = fullText(text)}
    <span class="sep" aria-hidden="true"></span>
    <div class="prop" role="group" aria-label="Text">
      <span class="k">Text</span>
      <div class="controls">
        <PopChoice label="Font" options={FAMILIES} value={t.family} compact={narrow} {out} sample={fontSample} onChange={(k) => p.onText({ family: k })} />
        <PopChoice label="Text size" options={SIZE_OPTS} value={SIZES.includes(t.size) ? String(t.size) : null} compact={narrow} {out} sample={sizeSample} onChange={(k) => p.onText({ size: Number(k) })} />
      </div>
      <div class="controls toggles">
        {@render toggle("Bold", t.bold, () => p.onText({ bold: !t.bold }), boldIcon)}
        {@render toggle("Italic", t.italic, () => p.onText({ italic: !t.italic }), italicIcon)}
        {@render toggle("Underline", t.underline, () => p.onText({ underline: !t.underline }), underIcon)}
        {@render toggle("Strikethrough", t.strike, () => p.onText({ strike: !t.strike }), strikeIcon)}
      </div>
      <div class="controls toggles" role="radiogroup" aria-label="Alignment">
        {#each ALIGNS as a (a.key)}
          {@render toggle(a.name, t.align === a.key, () => p.onText({ align: a.key }), alignIcon, a.key)}
        {/each}
        <PopChoice label="Line spacing" options={SPACING_OPTS} value={String(t.spacing)} compact={narrow} {out} sample={spacingSample} onChange={(k) => p.onText({ spacing: Number(k) })} />
      </div>
      <div class="swatches" role="radiogroup" aria-label="Text colour">
        {#each COLOURS as col (col.name)}
          <button type="button" role="radio" class="sw" class:on={same(t.colour, col.c)} aria-checked={same(t.colour, col.c)} aria-label={`Text ${col.name}`} title={`Text: ${col.name}`} style:--c={css(col.c)} onclick={() => p.onText({ colour: col.c })}></button>
        {/each}
        {@render custom("text", t.colour, COLOURS)}
      </div>
    </div>
  {/if}
{/snippet}

<!-- A small on/off button with an icon (bold, italic, alignment...). -->
{#snippet toggle(name: string, on: boolean, act: () => void, icon: import("svelte").Snippet<[string]>, arg: string = "")}
  <button type="button" class="tgl" class:on aria-pressed={on} aria-label={name} title={name} onclick={act}>{@render icon(arg)}</button>
{/snippet}

{#snippet boldIcon(_: string)}<span class="glyph" style:font-weight="bold">B</span>{/snippet}
{#snippet italicIcon(_: string)}<span class="glyph" style:font-style="italic" style:font-family="Times New Roman, serif">I</span>{/snippet}
{#snippet underIcon(_: string)}<span class="glyph" style:text-decoration="underline">U</span>{/snippet}
{#snippet strikeIcon(_: string)}<span class="glyph" style:text-decoration="line-through">S</span>{/snippet}
{#snippet alignIcon(a: string)}
  {@const ws = [12, 8, 12, 6]}
  <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">
    {#each [2, 5.5, 9, 12.5] as y, i (y)}
      {@const x = a === "left" ? 2 : a === "center" ? 8 - ws[i] / 2 : 14 - ws[i]}
      <path d="M{x} {y}h{ws[i]}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
    {/each}
  </svg>
{/snippet}

{#snippet fontSample(k: Family | null, w: number)}
  <span class="aa" style:font-family={cssFamily(k ?? "helvetica")} style:width="{Math.min(w, 26)}px">Aa</span>
{/snippet}

<!-- A size: in the box, the current one as a number (even one not offered); in the list, a
     letter growing with each size, beside its name. -->
{#snippet sizeSample(k: string | null, w: number)}
  {#if k === null || w < 40}
    <span class="num sz">{k ?? (p.text?.size ?? DEFAULT_TEXT.size)}{w > 30 ? " pt" : ""}</span>
  {:else}
    <span class="sz-a" style:font-size="{Math.min(22, 7 + Number(k) * 0.45)}px">A</span>
  {/if}
{/snippet}

{#snippet spacingSample(k: string | null, w: number)}
  {@const g = 2 + 3 * Number(k ?? 1.2)}
  <svg width={Math.min(w, 34)} height="14" viewBox="0 0 {Math.min(w, 34)} 14" aria-hidden="true">
    {#each [0, 1, 2] as i (i)}
      {#if 2 + i * g <= 13}<path d="M3 {2 + i * g}h{Math.min(w, 34) - 6}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />{/if}
    {/each}
  </svg>
{/snippet}

<!-- An opacity slider under its palette (beside it in the column), the track fading from clear
     to the colour. Dragging shows it live; letting go makes it one undo step. -->
{#snippet opacity(name: string, value: number, colour: Rgb | null, disabled: boolean, set: (o: number, live?: boolean) => void)}
  {@const pct = Math.round(value * 100)}
  <input
    type="range"
    class="op"
    min="5"
    max="100"
    step="5"
    value={pct}
    {disabled}
    aria-label={name}
    aria-valuetext="{pct}%"
    title="{name}: {pct}%"
    style:--c={colour ? css(colour) : "var(--tx3)"}
    oninput={(e) => set(Number((e.currentTarget as HTMLInputElement).value) / 100, true)}
    onchange={(e) => set(Number((e.currentTarget as HTMLInputElement).value) / 100)}
    onkeydown={(e) => e.stopPropagation()}
  />
{/snippet}

<!-- Pictures for the pop-out lists: a line pattern; an arrow end (the head at the right, the
     tail mirrored to the left). -->
{#snippet dashSample(k: string | null, w: number)}
  <svg width={w} height="12" viewBox="0 0 {w} 12" aria-hidden="true">
    <line x1="3" y1="6" x2={w - 3} y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray={svgDash(k)} />
  </svg>
{/snippet}

{#snippet endGlyph(e: LineEnd | null, w: number)}
  {@const x = w - 4}
  {@const stop = e === "filled" ? x - 6 : e === "dot" ? x - 2 : x}
  <line x1="4" y1="6" x2={stop} y2="6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {#if e === "open"}
    <path d="M{x - 6} 2.5L{x} 6L{x - 6} 9.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
  {:else if e === "filled"}
    <path d="M{x + 0.5} 6L{x - 7} 2L{x - 7} 10Z" fill="currentColor" />
  {:else if e === "dot"}
    <circle cx={x - 2} cy="6" r="3" fill="currentColor" />
  {:else if e === "bar"}
    <path d="M{x} 2V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {:else if e === "slash"}
    <path d="M{x - 2.3} 10L{x + 2.3} 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
  {/if}
{/snippet}

{#snippet headSample(e: LineEnd | null, w: number)}
  <svg width={w} height="12" viewBox="0 0 {w} 12" aria-hidden="true">{@render endGlyph(e, w)}</svg>
{/snippet}

{#snippet tailSample(e: LineEnd | null, w: number)}
  <svg width={w} height="12" viewBox="0 0 {w} 12" aria-hidden="true"><g transform="translate({w} 0) scale(-1 1)">{@render endGlyph(e, w)}</g></svg>
{/snippet}

<!-- The last swatch of a palette: the current colour when it's none of the presets, otherwise a
     rainbow; opens the picker. -->
{#snippet custom(which: "stroke" | "fill" | "text", value: Rgb | null, presets: { c: Rgb }[])}
  {@const isCustom = !!value && !presets.some((q) => same(q.c, value))}
  <button
    type="button"
    class="sw custom"
    class:on={isCustom}
    class:open={picker?.which === which}
    aria-label="Custom colour"
    aria-haspopup="dialog"
    title="Custom colour, or pick one from the screen"
    style:--c={isCustom && value ? css(value) : ""}
    onclick={(e) => openPicker(e, which, value)}
  ></button>
{/snippet}

{#if picker}
  <ColourPicker value={picker.value} anchor={picker.anchor} onPick={pick} onClose={() => (picker = null)} />
{/if}

<style>
  .strip {
    position: absolute;
    z-index: 6;
    max-width: calc(100% - 20px);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 5px 10px 5px 4px;
    background: var(--app);
    border: 1px solid var(--bd-strong);
    border-radius: 10px;
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    box-sizing: border-box;
  }
  /* On a side, where the column doesn't fit: one stack, each section a block. */
  .strip.vertical {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: stretch;
    width: 206px;
    max-height: calc(100% - 20px);
    overflow-y: auto;
    padding: 4px 10px 10px;
    gap: 8px;
  }
  /* The thin column: the bar turned on its side, one swatch wide, no words. */
  .strip.column {
    align-items: center;
    width: auto;
    padding: 4px 6px 8px;
    gap: 7px;
  }
  .strip.measure {
    visibility: hidden;
    pointer-events: none;
    left: 0;
    top: 0;
    max-height: none;
    overflow: visible;
  }
  .column .label,
  .column .k {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .column .sep {
    align-self: stretch;
  }
  .column .prop,
  .column .controls {
    flex-direction: column;
    align-items: center;
    gap: 7px;
  }
  .column .swatches {
    flex-direction: column;
    align-items: center;
    gap: 7px;
  }
  /* The slider stands beside its swatches, as long as they are. */
  .column .pal {
    flex-direction: row;
    align-items: stretch;
    gap: 9px;
  }
  .column .grip {
    width: 100%;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  /* The grip: move arrows, not a hand (Matt: grips get arrow cursors). */
  .grip {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 24px;
    color: var(--tx3);
    cursor: move;
    border-radius: 4px;
    touch-action: none;
  }
  .grip:hover {
    color: var(--tx2);
    background: var(--hover);
  }
  .vertical .grip {
    width: 100%;
    height: 14px;
  }
  .vertical .grip svg {
    transform: rotate(90deg);
  }
  .vertical .head {
    flex-direction: column;
    align-items: stretch;
  }
  .column .head {
    align-self: stretch;
  }
  .label {
    color: var(--tx);
    font-weight: 600;
    white-space: nowrap;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--bd);
  }
  .vertical .sep {
    width: auto;
    height: 1px;
  }
  .prop {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .vertical:not(.column) .prop {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .swatches,
  .controls {
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .vertical:not(.column) .swatches {
    flex-wrap: wrap;
    gap: 7px;
  }
  .k {
    color: var(--tx3);
    margin-right: 3px;
    white-space: nowrap;
  }
  /* Round swatches; the current one gets an accent ring with a gap. */
  .sw {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 50%;
    border: none;
    background: var(--c);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22);
    cursor: pointer;
    flex-shrink: 0;
  }
  .sw:hover {
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22), 0 0 0 2px var(--app), 0 0 0 3px var(--bd-strong);
  }
  .sw.on,
  .sw.open {
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.22), 0 0 0 2px var(--app), 0 0 0 4px var(--accent);
  }
  /* None: white with a red slash. */
  .sw.none {
    background: linear-gradient(to top right, #fff calc(50% - 1px), #d33 calc(50% - 1px), #d33 calc(50% + 1px), #fff calc(50% + 1px));
  }
  /* Custom: the colour when it's a custom one, else a rainbow. */
  .sw.custom {
    background: var(--c, conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00));
  }
  .sw.custom:not(.on) {
    background: conic-gradient(#f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
  .toggles {
    gap: 2px;
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
    cursor: default;
  }
  .tgl:hover {
    background: var(--hover);
    color: var(--tx);
  }
  .tgl.on {
    background: var(--accent-soft);
    color: var(--accent-text);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .glyph {
    font-size: 13px;
    line-height: 1;
    font-family: Arial, sans-serif;
  }
  .sz {
    font-size: 12px;
    white-space: nowrap;
  }
  .sz-a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 22px;
    line-height: 1;
  }
  .aa {
    display: inline-block;
    text-align: center;
    font-size: 13px;
    line-height: 1;
  }
  .column .toggles {
    gap: 3px;
  }
  /* A palette: its swatches with the opacity slider underneath. */
  .pal {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    /* Clear of the current swatch's ring. */
    gap: 9px;
  }
  .vertical:not(.column) .pal {
    align-self: stretch;
  }
  .op {
    -webkit-appearance: none;
    appearance: none;
    height: 8px;
    margin: 0;
    border-radius: 4px;
    /* Clear to the colour, over a chequer so "clear" reads as clear. */
    background:
      linear-gradient(to right, transparent, var(--c)),
      repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
    cursor: default;
  }
  .op::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    border: 1px solid var(--bd-strong);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  }
  .op:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .op:disabled {
    opacity: 0.35;
  }
  /* In the column it stands upright, more opaque upwards. */
  .column .op {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 8px;
    height: auto;
    background:
      linear-gradient(to top, transparent, var(--c)),
      repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px;
  }
</style>
