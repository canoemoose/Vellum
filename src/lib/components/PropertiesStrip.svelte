<script lang="ts">
  // Under the toolbar while a drawing tool or a markup is selected: colour, line weight, dash,
  // fill, opacity, and for text boxes the text size and colour. With a tool, it sets what the
  // tool draws next (remembered per tool); with markups selected, it changes them.
  import type { MarkupKind, Rgb, Style, TextStyle } from "../markup/types";

  interface Props {
    /** The kinds involved: the tool's, or the selected markups'. */
    kinds: MarkupKind[];
    style: Style;
    text: TextStyle | null;
    /** "Arrow tool" or "2 markups selected". */
    label: string;
    onStyle: (patch: Partial<Style>) => void;
    onText: (patch: Partial<TextStyle>) => void;
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
  ];
  const WEIGHTS = [0.5, 1, 1.5, 2, 3, 4, 6];
  const OPACITIES = [1, 0.75, 0.5, 0.25];
  const SIZES = [6, 8, 10, 12, 14, 18, 24, 36];
  const DASH = [4, 3];

  const same = (a: Rgb | null, b: Rgb | null) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
  const fillable = $derived(p.kinds.some((k) => k === "rect" || k === "cloud" || k === "text"));
  const isText = $derived(p.kinds.includes("text"));
</script>

<div class="strip" role="toolbar" aria-label="Markup properties">
  <span class="label">{p.label}</span>

  <div class="field" role="radiogroup" aria-label="Colour">
    <span class="k">{isText ? "Border" : "Colour"}</span>
    {#each COLOURS as col (col.name)}
      <button type="button" role="radio" class="sw" class:on={same(p.style.stroke, col.c)} aria-checked={same(p.style.stroke, col.c)} aria-label={col.name} title={col.name} style:background={css(col.c)} onclick={() => p.onStyle({ stroke: col.c })}></button>
    {/each}
  </div>

  <label class="field">
    <span class="k">Weight</span>
    <select value={String(p.style.width)} onchange={(e) => p.onStyle({ width: Number((e.currentTarget as HTMLSelectElement).value) })}>
      {#if isText}<option value="0">None</option>{/if}
      {#each WEIGHTS as w (w)}<option value={String(w)}>{w} pt</option>{/each}
      {#if !WEIGHTS.includes(p.style.width) && p.style.width !== 0}<option value={String(p.style.width)}>{p.style.width} pt</option>{/if}
    </select>
  </label>

  <button type="button" class="btn small" class:on={!!p.style.dash} aria-pressed={!!p.style.dash} title="Dashed line" onclick={() => p.onStyle({ dash: p.style.dash ? null : DASH })}>Dashed</button>

  {#if fillable}
    <div class="field" role="radiogroup" aria-label="Fill">
      <span class="k">{isText ? "Background" : "Fill"}</span>
      <button type="button" role="radio" class="sw none" class:on={!p.style.fill} aria-checked={!p.style.fill} aria-label="No fill" title="No fill" onclick={() => p.onStyle({ fill: null })}></button>
      {#each FILLS as col (col.name)}
        <button type="button" role="radio" class="sw" class:on={same(p.style.fill, col.c)} aria-checked={same(p.style.fill, col.c)} aria-label={col.name} title={col.name} style:background={css(col.c)} onclick={() => p.onStyle({ fill: col.c })}></button>
      {/each}
    </div>
  {/if}

  <label class="field">
    <span class="k">Opacity</span>
    <select value={String(p.style.opacity)} onchange={(e) => p.onStyle({ opacity: Number((e.currentTarget as HTMLSelectElement).value) })}>
      {#each OPACITIES as o (o)}<option value={String(o)}>{Math.round(o * 100)}%</option>{/each}
    </select>
  </label>

  {#if isText && p.text}
    {@const t = p.text}
    <label class="field">
      <span class="k">Text</span>
      <select value={String(t.size)} onchange={(e) => p.onText({ size: Number((e.currentTarget as HTMLSelectElement).value) })}>
        {#each SIZES as s (s)}<option value={String(s)}>{s} pt</option>{/each}
        {#if !SIZES.includes(t.size)}<option value={String(t.size)}>{t.size} pt</option>{/if}
      </select>
    </label>
    <div class="field" role="radiogroup" aria-label="Text colour">
      {#each COLOURS as col (col.name)}
        <button type="button" role="radio" class="sw" class:on={same(t.colour, col.c)} aria-checked={same(t.colour, col.c)} aria-label={`Text ${col.name}`} title={`Text: ${col.name}`} style:background={css(col.c)} onclick={() => p.onText({ colour: col.c })}></button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .strip {
    min-height: 36px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    padding: 4px 12px;
    background: var(--app);
    border-bottom: 1px solid var(--bd);
    flex-shrink: 0;
    font-size: 12px;
  }
  .label {
    color: var(--tx2);
    min-width: 110px;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .k {
    color: var(--tx3);
    margin-right: 2px;
  }
  .sw {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }
  .sw.on {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  /* No fill: a white square with a red slash. */
  .sw.none {
    background: linear-gradient(to top right, #fff calc(50% - 1px), #d33 calc(50% - 1px), #d33 calc(50% + 1px), #fff calc(50% + 1px));
  }
  select {
    height: 24px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-size: 12px;
  }
  .btn.small {
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
  }
  .btn.small.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
</style>
