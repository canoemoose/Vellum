<script lang="ts">
  // A custom colour: a saturation / brightness square, a hue bar, a hex field, and an
  // eyedropper that picks any colour on screen (the drawing included) where WebView2 offers
  // one. The colour applies when you let go, press Enter in the hex field, or pick with the
  // eyedropper, so dragging around the square doesn't fill the undo history. Esc or a click
  // elsewhere closes it.
  import { onMount, untrack } from "svelte";
  import type { Rgb } from "../markup/types";
  import { type Hsv, fromHex, hsvToRgb, rgbToHsv, toHex } from "../markup/colour";

  interface Props {
    /** The colour to start from. */
    value: Rgb;
    /** Where to open: the swatch's rectangle on screen. */
    anchor: DOMRect;
    onPick: (c: Rgb) => void;
    onClose: () => void;
  }
  let p: Props = $props();

  // Starts from the colour it was opened with; it's opened afresh each time.
  const start = untrack(() => p.value);
  let hsv = $state<Hsv>(rgbToHsv(start));
  let hex = $state(toHex(start));
  let box: HTMLDivElement;
  let picking = false;
  const rgb = $derived(hsvToRgb(hsv));
  const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
  const hasDropper = typeof window !== "undefined" && "EyeDropper" in window;

  // Open below the swatch, or above it if there's no room; inside the window.
  const W = 212, H = hasDropper ? 238 : 210;
  const left = $derived(Math.max(8, Math.min(window.innerWidth - W - 8, p.anchor.left + p.anchor.width / 2 - W / 2)));
  const top = $derived(p.anchor.bottom + 8 + H < window.innerHeight ? p.anchor.bottom + 8 : Math.max(8, p.anchor.top - 8 - H));

  function set(next: Partial<Hsv>) {
    hsv = { ...hsv, ...next };
    hex = toHex(hsvToRgb(hsv));
  }

  function commit() {
    p.onPick(hsvToRgb(hsv));
  }

  /** Drag inside an element, reporting 0..1 positions; commit on release. */
  function track(e: PointerEvent, f: (x: number, y: number) => void) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const at = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      f(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("lostpointercapture", up);
      commit();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("lostpointercapture", up);
  }

  function hexDone() {
    const c = fromHex(hex);
    if (!c) {
      hex = toHex(rgb);
      return;
    }
    hsv = rgbToHsv(c);
    commit();
  }

  async function dropper() {
    const Ctor = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Ctor) return;
    picking = true;
    try {
      const r = await new Ctor().open();
      const c = fromHex(r.sRGBHex);
      if (c) {
        hsv = rgbToHsv(c);
        hex = toHex(c);
        commit();
      }
    } catch {
      // Cancelled with Esc.
    } finally {
      picking = false;
    }
  }

  onMount(() => {
    const outside = (e: PointerEvent) => {
      if (!picking && !box.contains(e.target as Node)) p.onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !picking) {
        e.stopPropagation();
        p.onClose();
      }
    };
    // Next tick: the click that opened the picker mustn't close it.
    const t = setTimeout(() => window.addEventListener("pointerdown", outside, true));
    window.addEventListener("keydown", key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  });
</script>

<div class="picker" bind:this={box} role="dialog" aria-label="Custom colour" style:left="{left}px" style:top="{top}px" style:width="{W}px">
  <div
    class="sv"
    role="slider"
    tabindex="-1"
    aria-label="Saturation and brightness"
    aria-valuenow={Math.round(hsv.s * 100)}
    style:--hue="hsl({hsv.h} 100% 50%)"
    onpointerdown={(e) => track(e, (x, y) => set({ s: x, v: 1 - y }))}
  >
    <span class="knob" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={css(rgb)}></span>
  </div>
  <div class="hue" role="slider" tabindex="-1" aria-label="Hue" aria-valuenow={Math.round(hsv.h)} onpointerdown={(e) => track(e, (x) => set({ h: x * 360 }))}>
    <span class="knob" style:left="{(hsv.h / 360) * 100}%" style:background="hsl({hsv.h} 100% 50%)"></span>
  </div>
  <div class="row">
    <span class="preview" style:background={css(rgb)}></span>
    <input
      class="hex num"
      aria-label="Hex colour"
      spellcheck="false"
      bind:value={hex}
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") hexDone();
      }}
      onblur={hexDone}
    />
  </div>
  {#if hasDropper}
    <button type="button" class="btn dropper" onclick={dropper} title="Pick a colour from anywhere on screen">
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3-1.6 1.6-.9-.9-5.6 5.6-2.4.6.6-2.4 5.6-5.6-.9-.9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
      Pick from screen
    </button>
  {/if}
</div>

<style>
  .picker {
    position: fixed;
    z-index: 60;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    box-sizing: border-box;
  }
  .sv {
    position: relative;
    height: 120px;
    border-radius: 4px;
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, transparent),
      var(--hue);
    cursor: crosshair;
    touch-action: none;
  }
  .hue {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    cursor: ew-resize;
    touch-action: none;
  }
  .knob {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-sizing: border-box;
  }
  .hue .knob {
    top: 50%;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .preview {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
    flex-shrink: 0;
  }
  .hex {
    flex: 1 1 auto;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--bd-input);
    background: var(--app);
    color: var(--tx);
    border-radius: 4px;
    font-family: var(--font-num);
    font-size: 12px;
    user-select: text;
  }
  .dropper {
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 12px;
  }
</style>
