<script lang="ts">
  // Line weight: the box is the field (docs/edit-lock-brief.md, 8). Type a weight and press
  // Enter (or leave the box) to set it; Esc puts it back. Clicking or focusing the box drops a
  // slider out of the bar, at right angles to it (down from a bar at the top, sideways from a
  // column), heavier towards the far end; dragging shows the weight live and letting go sets it
  // as one undo step. The mouse wheel over the box steps it. One number, in one place.
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
  let box: HTMLSpanElement;
  let field: HTMLInputElement;
  let pop = $state<HTMLDivElement>();
  let at = $state({ left: 0, top: 0 });
  let typed = $state<string | null>(null);
  /** The slider's stop while dragging, so the field follows it before the value comes back. */
  let live = $state<number | null>(null);

  const steps = $derived(weightSteps(p.min));
  const upright = $derived(p.out === "down" || p.out === "up");
  const index = $derived(nearestStep(steps, p.value));
  const shown = $derived(live ?? p.value);
  const LEN = 150; // the slider's length, CSS px

  /** A weight fit to set: never undefined, not a number, or below the least allowed. */
  const usable = (w: number | undefined): w is number => typeof w === "number" && Number.isFinite(w) && w >= p.min;

  function place() {
    at = popoutPosition(box.getBoundingClientRect(), pop?.offsetWidth ?? 0, pop?.offsetHeight ?? 0, p.out, window.innerWidth, window.innerHeight);
  }

  function show() {
    if (open) return;
    open = true;
    tick().then(place);
  }

  function slide(e: Event, done: boolean) {
    const w = steps[Number((e.currentTarget as HTMLInputElement).value)];
    if (!usable(w)) return;
    if (done) {
      live = null;
      p.onChange(w);
    } else {
      live = w;
      p.onPreview(w);
    }
  }

  /**
   * A drag that ends without the slider's change event (the pop closed under it, say) would leave
   * the previewed weight shown but never set. Set it.
   */
  function settleLive() {
    if (live === null) return;
    const w = live;
    live = null;
    p.onChange(w);
  }

  function typedDone() {
    if (typed === null) return;
    const w = parseWeight(typed, p.min);
    typed = null;
    if (w !== null && usable(w) && w !== p.value) p.onChange(w);
  }

  function close() {
    settleLive();
    open = false;
  }

  onMount(() => {
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.deltaY) return;
      typed = null;
      const w = stepWeight(p.value, e.deltaY < 0 ? 1 : -1, p.min);
      if (usable(w) && w !== p.value) p.onChange(w);
    };
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (open && !box.contains(t) && !pop?.contains(t)) {
        typedDone();
        close();
      }
    };
    const up = () => {
      // Let the slider's own change event go first; then whatever is left is set.
      if (live !== null) setTimeout(settleLive, 0);
    };
    box.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("pointerup", up, true);
    return () => {
      box.removeEventListener("wheel", wheel);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("pointerup", up, true);
      settleLive();
    };
  });
</script>

<span bind:this={box} class="box num" class:compact={p.compact} class:open>
  <input
    bind:this={field}
    id={p.id}
    class="num"
    aria-label="Line weight, points"
    aria-haspopup="dialog"
    aria-expanded={open}
    title="Line weight: type one and press Enter, drag the slider, or use the mouse wheel"
    spellcheck="false"
    inputmode="decimal"
    autocomplete="off"
    value={typed ?? showWeight(shown)}
    oninput={(e) => (typed = (e.currentTarget as HTMLInputElement).value)}
    onfocus={(e) => {
      (e.currentTarget as HTMLInputElement).select();
      show();
    }}
    onclick={show}
    onblur={typedDone}
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        typedDone();
        close();
        field.select();
      } else if (e.key === "Escape") {
        typed = null;
        close();
        field.blur();
      }
    }}
  />{#if !p.compact}<span class="unit">pt</span>{/if}
</span>

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
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          close();
          field.focus();
        }
      }}
    />
  </div>
{/if}

<style>
  /* The field: the box, with "pt" inside it after the number. */
  .box {
    height: 24px;
    width: 52px;
    padding: 0 6px 0 4px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-family: var(--font-num);
    font-size: 12px;
    box-sizing: border-box;
    cursor: text;
  }
  .box input {
    flex: 1 1 auto;
    min-width: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: right;
    user-select: text;
  }
  .box.compact {
    width: 36px;
    padding: 0 3px;
  }
  .box.compact input {
    text-align: center;
  }
  .box:hover {
    border-color: var(--bd-strong);
  }
  .box.open,
  .box:focus-within {
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
</style>
