<script lang="ts">
  // Line pattern: a box showing the current pattern. Clicking it drops the patterns out of the
  // bar (the same way the weight slider does); picking one sets it.
  import { onMount, tick } from "svelte";
  import { DASHES, dashOption, sameDash } from "../markup/dash";
  import { type Out, popoutPosition } from "../shell/popout";

  interface Props {
    value: number[] | null;
    /** A narrower box (the bar's thin column). */
    compact?: boolean;
    /** Which way the patterns drop out of the bar. */
    out: Out;
    onChange: (dash: number[] | null) => void;
  }
  let p: Props = $props();

  let open = $state(false);
  let btn: HTMLButtonElement;
  let pop = $state<HTMLDivElement>();
  let at = $state({ left: 0, top: 0 });
  const current = $derived(dashOption(p.value));

  /** The pattern as an SVG dash array: points on paper, drawn a little larger. */
  const svgDash = (d: number[] | null) => (d?.length ? d.map((v) => v * 1.4).join(" ") : "none");

  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    if (!pop) return;
    at = popoutPosition(btn.getBoundingClientRect(), pop.offsetWidth, pop.offsetHeight, p.out, window.innerWidth, window.innerHeight);
    (pop.querySelector(".on") as HTMLElement | null)?.focus();
  }

  function choose(d: number[] | null) {
    open = false;
    btn.focus();
    if (!sameDash(d, p.value)) p.onChange(d);
  }

  function keys(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(pop?.querySelectorAll("button") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  onMount(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open && !btn.contains(t) && !pop?.contains(t)) open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (open && e.key === "Escape") {
        e.stopPropagation();
        open = false;
        btn.focus();
      }
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  });
</script>

{#snippet sample(d: number[] | null, w: number)}
  <svg width={w} height="10" viewBox="0 0 {w} 10" aria-hidden="true">
    <line x1="3" y1="5" x2={w - 3} y2="5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-dasharray={svgDash(d)} />
  </svg>
{/snippet}

<button
  bind:this={btn}
  type="button"
  class="box"
  class:compact={p.compact}
  class:open
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-label="Line pattern: {current?.name ?? 'Custom'}"
  title="Line pattern: {current?.name ?? 'Custom'}"
  onclick={toggle}
>
  {@render sample(p.value, p.compact ? 26 : 34)}
  {#if !p.compact}
    <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" class="chev"><path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
  {/if}
</button>

{#if open}
  <div class="pop" bind:this={pop} role="listbox" tabindex="-1" aria-label="Line pattern" style:left="{at.left}px" style:top="{at.top}px" onkeydown={keys}>
    {#each DASHES as o (o.name)}
      {@const on = sameDash(o.dash, p.value)}
      <button type="button" role="option" class="opt" class:on aria-selected={on} title={o.name} onclick={() => choose(o.dash)}>
        {@render sample(o.dash, 64)}
        <span class="name">{o.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .box {
    height: 24px;
    padding: 0 5px 0 4px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    cursor: default;
  }
  .box.compact {
    width: 36px;
    padding: 0;
    justify-content: center;
  }
  .box:hover {
    border-color: var(--bd-strong);
  }
  .box.open {
    border-color: var(--accent);
  }
  .chev {
    color: var(--tx3);
  }
  .pop {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    height: 28px;
    padding: 0 10px 0 6px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--tx);
    font-size: 12px;
    text-align: left;
    cursor: default;
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
  .name {
    white-space: nowrap;
  }
</style>
