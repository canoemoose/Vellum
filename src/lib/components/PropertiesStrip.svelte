<script lang="ts">
  // Floats over the canvas while a drawing tool or a markup is selected (App.svelte puts it in
  // the stage, so showing it never resizes the canvas): line colour and opacity, line weight,
  // dash, fill colour and opacity, and for text boxes the text size and colour. With a tool, it
  // sets what the tool draws next (remembered per tool); with markups selected, it changes them.
  // Drag its grip to dock it against any edge, anywhere along it (it snaps to the middle). On
  // the sides it's a thin column where the drawing area is tall enough for the largest bar (a
  // text box's), else a wider stack of sections: decided by the area, never by the tool, so it
  // doesn't jump about. Each palette ends with a custom colour (ColourPicker, with an eyedropper).
  import { type MarkupKind, type Rgb, type Style, type TextStyle, DEFAULT_TEXT, fillOpacity } from "../markup/types";
  import { type Dock, type Edge, DOCK_MARGIN, dockAt, dockPosition, isSide } from "../shell/dock";
  import { sameColour as same } from "../markup/colour";
  import ColourPicker from "./ColourPicker.svelte";
  import WeightControl from "./WeightControl.svelte";
  import DashControl from "./DashControl.svelte";
  import { outFrom } from "../shell/popout";

  interface Props {
    /** The kinds involved: the tool's, or the selected markups'. */
    kinds: MarkupKind[];
    style: Style;
    text: TextStyle | null;
    /** "Arrow tool" or "2 markups selected". */
    label: string;
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
  {@const fillable = kinds.some((k) => k === "rect" || k === "cloud" || k === "text")}
  {@const isText = kinds.includes("text")}
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
      <DashControl value={p.style.dash} compact={narrow} {out} onChange={(d) => p.onStyle({ dash: d })} />
    </div>
  </div>

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
    {@const t = text}
    <span class="sep" aria-hidden="true"></span>
    <div class="prop" role="group" aria-label="Text">
      <label class="k" for="{idp}-size">Text</label>
      <select id="{idp}-size" title="Text size" value={String(t.size)} onchange={(e) => p.onText({ size: Number((e.currentTarget as HTMLSelectElement).value) })}>
        {#each SIZES as s (s)}<option value={String(s)}>{s} pt</option>{/each}
        {#if !SIZES.includes(t.size)}<option value={String(t.size)}>{t.size} pt</option>{/if}
      </select>
      <div class="swatches" role="radiogroup" aria-label="Text colour">
        {#each COLOURS as col (col.name)}
          <button type="button" role="radio" class="sw" class:on={same(t.colour, col.c)} aria-checked={same(t.colour, col.c)} aria-label={`Text ${col.name}`} title={`Text: ${col.name}`} style:--c={css(col.c)} onclick={() => p.onText({ colour: col.c })}></button>
        {/each}
        {@render custom("text", t.colour, COLOURS)}
      </div>
    </div>
  {/if}
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
  .column select {
    width: 40px;
    padding: 0 2px;
    text-align: center;
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
  select {
    height: 24px;
    min-width: 0;
    padding: 0 4px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-size: 12px;
    font-family: var(--font-num);
  }
  select:disabled {
    opacity: 0.45;
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
