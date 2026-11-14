<script lang="ts">
  // Line weight: a box showing the weight. Clicking it drops a slider out of the bar, at right
  // angles to it (down from a bar at the top, sideways from a column), heavier towards the far
  // end. Dragging shows the weight live; letting go sets it as one undo step. The field under
  // the slider takes a typed weight, and the mouse wheel over the box steps it.
  import { onMount, tick } from "svelte";
  import { nearestStep, parseWeight, showWeight, stepWeight, weightSteps } from "../markup/weight";
  import { type Out, popoutPosition } from "../shell/popout";
  interface Props {
    id: string;
    value: number;
    /** The lowest weight: 0 where no line is allowed (a text box's border). */
    min: number;
    /** No "pt" (the bar's thin column). */
    compact?: boolean;
    /** Which way the slider drops out of the bar. */
    out: Out;
    onChange: (w: number) => void;
    onPreview: (w: number) => void;
  }
  let p: Props = $props();

  let open = $state(false);
  let btn: HTMLButtonElement;
  let pop = $state<HTMLDivElement>();
  let at = $state({ left: 0, top: 0 });
  let typed = $state<string | null>(null);
  /** The slider's stop while dragging, so the readout follows it before the value comes back. */
  let live = $state<number | null>(null);

  const steps = $derived(weightSteps(p.min));
  const upright = $derived(p.out === "down" || p.out === "up");
  const index = $derived(nearestStep(steps, p.value));
  const shown = $derived(live ?? p.value);
  const LEN = 150; // the slider's length, CSS px

  function place() {
    at = popoutPosition(btn.getBoundingClientRect(), pop?.offsetWidth ?? 0, pop?.offsetHeight ?? 0, p.out, window.innerWidth, window.innerHeight);
  }

  function toggle() {
    open = !open;
    typed = null;
    if (open) tick().then(place);
  }

  function slide(e: Event, done: boolean) {
    const w = steps[Number((e.currentTarget as HTMLInputElement).value)];
    if (done) {
      live = null;
      p.onChange(w);
    } else {
      live = w;
      p.onPreview(w);
    }
  }

  function typedDone() {
    if (typed === null) return;
    const w = parseWeight(typed, p.min);
    typed = null;
    if (w !== null && w !== p.value) p.onChange(w);
  }

  onMount(() => {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.deltaY) return;
      const w = stepWeight(p.value, e.deltaY < 0 ? 1 : -1, p.min);
      if (w !== p.value) p.onChange(w);
    };
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
    btn.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      btn.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  });
</script>

<button
  bind:this={btn}
  id={p.id}
  type="button"
  class="box num"
  class:compact={p.compact}
  class:open
  aria-haspopup="dialog"
  aria-expanded={open}
  title="Line weight: click for a slider, or use the mouse wheel"
  onclick={toggle}
>
  {showWeight(shown)}{#if !p.compact}<span class="unit">pt</span>{/if}
</button>

{#if open}
  <div class="pop" class:upright bind:this={pop} role="dialog" aria-label="Line weight" style:left="{at.left}px" style:top="{at.top}px">
    <input
      type="range"
      min="0"
      max={steps.length - 1}
      step="1"
      value={index}
      aria-label="Line weight"
      aria-valuetext="{showWeight(shown)} points"
      style:--len="{LEN}px"
      oninput={(e) => slide(e, false)}
      onchange={(e) => slide(e, true)}
      onkeydown={(e) => e.stopPropagation()}
    />
    <span class="read">
      <input
        class="num"
        aria-label="Line weight, points"
        spellcheck="false"
        inputmode="decimal"
        value={typed ?? showWeight(shown)}
        oninput={(e) => (typed = (e.currentTarget as HTMLInputElement).value)}
        onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        onblur={typedDone}
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            typedDone();
            open = false;
            btn.focus();
          } else if (e.key === "Escape") {
            typed = null;
            open = false;
            btn.focus();
          }
        }}
      /><span class="unit">pt</span>
    </span>
  </div>
{/if}

<style>
  .box {
    height: 24px;
    min-width: 52px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-family: var(--font-num);
    font-size: 12px;
    cursor: default;
  }
  .box.compact {
    min-width: 0;
    width: 36px;
    padding: 0;
  }
  .box:hover {
    border-color: var(--bd-strong);
  }
  .box.open {
    border-color: var(--accent);
  }
  .unit {
    color: var(--tx3);
    font-size: 11px;
  }
  .pop {
    position: fixed;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
  }
  .pop.upright {
    flex-direction: column;
  }
  input[type="range"] {
    width: var(--len);
    margin: 0;
    accent-color: var(--accent);
  }
  /* Upright, heavier at the top. */
  .upright input[type="range"] {
    writing-mode: vertical-lr;
    direction: rtl;
    width: auto;
    height: var(--len);
  }
  .read {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .read input {
    width: 38px;
    height: 22px;
    padding: 0 4px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-family: var(--font-num);
    font-size: 12px;
    text-align: right;
    user-select: text;
  }
</style>
