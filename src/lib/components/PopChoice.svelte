<script lang="ts" generics="K extends string">
  // A choice from a short list that drops out of the properties bar: a box showing the current
  // option's picture; clicking it opens the list (away from the bar's edge, like the weight
  // slider), each option a picture and a name. Arrow keys move through the list; Esc closes it.
  // With `trigger`, the caller draws what opens it (the tool palette's group buttons) instead of
  // the box, and the list opens beside that.
  import { type Snippet, onMount, tick } from "svelte";
  import { type Out, popoutPosition } from "../shell/popout";

  interface Props {
    /** What the choice is: "Line pattern", "Arrow head". */
    label: string;
    options: { key: K; name: string }[];
    /** The current option, or null for one that isn't offered. */
    value: K | null;
    /** A narrower box (the bar's thin column). */
    compact?: boolean;
    out: Out;
    /** An option's picture, `w` px wide (a null key: the current value, not an offered one). */
    sample: Snippet<[K | null, number]>;
    onChange: (key: K) => void;
    /** Draw your own opener instead of the box: call toggle() to open or close the list. */
    trigger?: Snippet<[{ toggle: () => void; open: boolean }]>;
  }
  let p: Props = $props();

  let open = $state(false);
  let btn = $state<HTMLButtonElement>();
  let trig = $state<HTMLSpanElement>();
  /** What the list opens beside: the box, or the caller's opener. */
  const anchor = () => (btn ?? trig) as HTMLElement;
  const focusAnchor = () => (btn ?? trig?.querySelector("button"))?.focus();
  let pop = $state<HTMLDivElement>();
  let at = $state({ left: 0, top: 0 });
  const currentName = $derived(p.options.find((o) => o.key === p.value)?.name ?? "Custom");

  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    if (!pop) return;
    at = popoutPosition(anchor().getBoundingClientRect(), pop.offsetWidth, pop.offsetHeight, p.out, window.innerWidth, window.innerHeight);
    ((pop.querySelector(".on") ?? pop.querySelector("button")) as HTMLElement | null)?.focus();
  }

  function choose(k: K) {
    open = false;
    focusAnchor();
    if (k !== p.value) p.onChange(k);
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
      if (open && !anchor().contains(t) && !pop?.contains(t)) open = false;
    };
    const key = (e: KeyboardEvent) => {
      if (open && e.key === "Escape") {
        e.stopPropagation();
        open = false;
        focusAnchor();
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

{#if p.trigger}
  <span class="trigger" bind:this={trig}>{@render p.trigger({ toggle, open })}</span>
{:else}
<button
  bind:this={btn}
  type="button"
  class="box"
  class:compact={p.compact}
  class:open
  aria-haspopup="listbox"
  aria-expanded={open}
  aria-label="{p.label}: {currentName}"
  title="{p.label}: {currentName}"
  onclick={toggle}
>
  {@render p.sample(p.value, p.compact ? 26 : 34)}
  {#if !p.compact}
    <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" class="chev"><path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
  {/if}
</button>
{/if}

{#if open}
  <div class="pop" bind:this={pop} role="listbox" tabindex="-1" aria-label={p.label} style:left="{at.left}px" style:top="{at.top}px" onkeydown={keys}>
    {#each p.options as o (o.key)}
      {@const on = o.key === p.value}
      <button type="button" role="option" class="opt" class:on aria-selected={on} title={o.name} onclick={() => choose(o.key)}>
        {@render p.sample(o.key, 64)}
        <span class="name">{o.name}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  /* A box of its own (not display: contents), so the list can be placed beside it. */
  .trigger {
    display: inline-flex;
    align-items: center;
  }
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
