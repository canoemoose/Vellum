<script lang="ts">
  // Making an image stamp from a picture (docs/stamp-library-dialogs-scope.md, step 5): frame it
  // (SignatureFrame, as a signature import), then remove its background, keeping its colours
  // (src/lib/stamps/knockout.ts), name it and save it. Manage stamps shows it in place of its
  // list; its Save and Cancel are the dialog's footer, as the Signatures dialog's pad.
  //
  // The background comes out the same in the preview and in the stamp: the preview runs the same
  // code on a smaller copy. The background colour starts as the picture's border's; a click on
  // the preview picks another.
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import SignatureFrame from "./SignatureFrame.svelte";
  import { type Adjust, initialAdjust } from "../../signature/frame";
  import { type KnockMode, type Pixels, type Regions, type Rgb8, guessBackground, hasTransparency, knockOut, regionAt, regions } from "../../stamps/knockout";
  import { drawFramed, pixelsOf } from "../../stamps/framed";
  import { type StampItem, addStampPng } from "../../stamps/api";
  import { userMessage } from "../../shell/messages";

  interface Props {
    /** The picture file. */
    path: string;
    onSaved: (item: StampItem) => void;
    /** Leave without saving (Cancel while framing). */
    onCancel: () => void;
    /** Out: it can be saved now. */
    ready?: boolean;
    /** Out: the picture is being framed (that view has its own buttons, so no footer). */
    framing?: boolean;
  }
  let { path, onSaved, onCancel, ready = $bindable(false), framing = $bindable(true) }: Props = $props();

  /** The stamp's longest side (as the library keeps it: MAX_SIDE in stamps.rs). */
  const MAX_SIDE = 2000;
  /** The preview's size at most, in CSS pixels. */
  const PREVIEW_W = 820;
  const PREVIEW_H = 340;

  /** The picture, full size and a smaller copy to frame on. */
  let full: ImageBitmap | null = null;
  let small = $state<ImageBitmap | null>(null);
  let adjust = $state<Adjust>(initialAdjust());
  let view = $state<"loading" | "frame" | "background">("loading");
  let error = $state("");
  let busy = $state(false);

  // The background view.
  let framed: HTMLCanvasElement | null = null;
  /** The framed picture's pixels, full size: what the picking reads (the saved stamp's own). */
  let framedPx: Pixels | null = null;
  let preview = $state<Pixels | null>(null);
  /** How the background is removed: not at all, joined to the edges, or everywhere. */
  let how = $state<"off" | KnockMode>("edges");
  const remove = $derived(how !== "off");
  const mode = $derived<KnockMode>(how === "off" ? "edges" : how);
  /** The picture has a transparent background already: nothing to remove, so no controls. */
  let transparent = $state(false);
  let tolerance = $state(20);
  let bg = $state<Rgb8>([255, 255, 255]);
  let canvas = $state<HTMLCanvasElement>();
  // The file's name to start with; the editor is made afresh for each picture.
  // svelte-ignore state_referenced_locally
  let name = $state(nameFrom(path));

  function nameFrom(p: string): string {
    const base = p.split(/[\\/]/).pop() ?? "";
    return base.replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim().slice(0, 80) || "Stamp";
  }

  const hex = (c: Rgb8) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

  onMount(() => {
    void (async () => {
      try {
        const bytes = new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
        const blob = new Blob([bytes as BlobPart]);
        // EXIF orientation is honoured by default, so a phone photo comes up the right way.
        full = await createImageBitmap(blob);
        const s = Math.min(1, 2048 / Math.max(full.width, full.height));
        small = s < 1 ? await createImageBitmap(blob, { resizeWidth: Math.round(full.width * s), resizeHeight: Math.round(full.height * s), resizeQuality: "high" }) : full;
        // Judged on the picture as it comes, not as framed: a turned crop has clear corners.
        const c = document.createElement("canvas");
        c.width = small.width;
        c.height = small.height;
        c.getContext("2d")!.drawImage(small, 0, 0);
        transparent = hasTransparency(pixelsOf(c));
        how = transparent ? "off" : "edges";
        view = "frame";
      } catch (e) {
        console.error("[stamps] editor could not open the picture:", e instanceof Error ? e.message : String(e));
        error = userMessage(e, "open the picture");
      }
    })();
    return () => {
      full?.close();
      if (small && small !== full) small.close();
    };
  });

  $effect(() => {
    framing = view !== "background";
    ready = view === "background" && !busy && name.trim().length > 0;
  });

  /** Framing done: draw it full size, guess the background, make the preview copy. */
  function framedDone(a: Adjust) {
    if (!full) return;
    adjust = a;
    framed = drawFramed(full, a, MAX_SIDE);
    framedPx = pixelsOf(framed);
    // Holes are points on the framed picture: a new framing makes them meaningless.
    holes = [];
    bg = guessBackground(framedPx);
    const s = Math.min(1, PREVIEW_W / framed.width, PREVIEW_H / framed.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(framed.width * s));
    c.height = Math.max(1, Math.round(framed.height * s));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(framed, 0, 0, c.width, c.height);
    preview = pixelsOf(c);
    view = "background";
  }

  /** Holes chosen (see the holes below): points on the framed picture, as fractions. */
  let holes = $state<[number, number][]>([]);
  /** The background-coloured areas of the preview, numbered (for "Outside only"). */
  const areas = $derived<Regions | null>(preview && how === "edges" ? regions(preview, { bg, tolerance }) : null);
  /** The enclosed area under the pointer that a click would toggle (0: none). */
  let hoverArea = $state(0);

  /** The preview with the background removed, as it stands. */
  const knocked = $derived(preview ? (remove ? knockOut(preview, { bg, tolerance, mode, holes }) : preview.data) : null);

  /** The highlight on an area a click would toggle: the accent colour, read from the theme. */
  function accent(): Rgb8 {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [32, 160, 150];
  }

  // The live preview: redrawn whenever a setting changes, or the area under the pointer does
  // (it's tinted, so it's plain what a click will remove or keep).
  $effect(() => {
    if (!canvas || !preview || !knocked) return;
    const data = new Uint8ClampedArray(knocked);
    if (hoverArea && areas) {
      const [r, g, b] = accent();
      const lab = areas.label;
      for (let k = 0; k < lab.length; k++) {
        if (lab[k] !== hoverArea) continue;
        const i = k * 4;
        const a = data[i + 3] / 255;
        // Over what's there (or over nothing, where it's already removed): half the accent.
        data[i] = (data[i] * a + r) / (1 + a) | 0;
        data[i + 1] = (data[i + 1] * a + g) / (1 + a) | 0;
        data[i + 2] = (data[i + 2] * a + b) / (1 + a) | 0;
        data[i + 3] = Math.max(data[i + 3], 140);
      }
    }
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.getContext("2d")!.putImageData(new ImageData(data, preview.width, preview.height), 0, 0);
  });

  /** Where the pointer is in the framed picture's full-size pixels (beyond it too, off its edges). */
  function pixelUnder(e: PointerEvent | MouseEvent, size: { width: number; height: number } | null = framedPx): { x: number; y: number } | null {
    if (!size || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * size.width), y: Math.floor(((e.clientY - r.top) / r.height) * size.height) };
  }

  /** As pixelUnder, or null off the picture. */
  function pixelAt(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
    const p = pixelUnder(e);
    return !p || !framedPx || p.x < 0 || p.y < 0 || p.x >= framedPx.width || p.y >= framedPx.height ? null : p;
  }

  /** The picture's colour there (as it was, before removal), or null where it's clear. */
  function colourAt(e: PointerEvent | MouseEvent): Rgb8 | null {
    const at = pixelAt(e);
    if (!at || !framedPx) return null;
    const i = (at.y * framedPx.width + at.x) * 4;
    if (framedPx.data[i + 3] < 128) return null;
    return [framedPx.data[i], framedPx.data[i + 1], framedPx.data[i + 2]];
  }

  /** The colour chip picks the colour to remove from the picture: crosshair and a loupe, the chip
   * showing what's under it, a click takes it, Esc (or the chip again) gives up. */
  let picking = $state(false);
  let hover = $state<Rgb8 | null>(null);

  // The loupe: the pixels round the pointer, enlarged, the one picked outlined. Beside the
  // pointer, flipped to the other side near the stage's edges so it stays in view.
  const LOUPE = 120; // CSS pixels across
  const SPAN = 11; // picture pixels across (odd, so one is in the middle)
  let stage = $state<HTMLDivElement>();
  let loupe = $state<HTMLCanvasElement>();
  let loupeAt = $state<{ left: number; top: number } | null>(null);
  /** What the loupe shows: the framed picture as the preview shows it (background removed),
   * full size, made when picking starts. The colour picked is still the picture's own. */
  let shown: HTMLCanvasElement | null = null;

  function startPicking() {
    if (!framed || !framedPx) return;
    if (remove) {
      const c = document.createElement("canvas");
      c.width = framedPx.width;
      c.height = framedPx.height;
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(knockOut(framedPx, { bg, tolerance, mode, holes })), framedPx.width, framedPx.height), 0, 0);
      shown = c;
    } else shown = framed;
    picking = true;
  }

  /** The loupe at the pointer, enlarging `src` (the full-size picture while picking; the preview,
   * highlight and all, over a hole). */
  function drawLoupe(e: PointerEvent, src: HTMLCanvasElement | null) {
    // Anywhere over the stage: what's beyond the picture shows as clear.
    const at = src ? pixelUnder(e, src) : null;
    if (!at || !src || !loupe || !stage) {
      loupeAt = null;
      return;
    }
    const st = stage.getBoundingClientRect();
    const px = e.clientX - st.left;
    const py = e.clientY - st.top;
    const gap = 18;
    loupeAt = {
      left: px + gap + LOUPE > st.width ? px - gap - LOUPE : px + gap,
      top: py + gap + LOUPE > st.height ? py - gap - LOUPE : py + gap,
    };
    const dpr = window.devicePixelRatio || 1;
    const side = Math.round(LOUPE * dpr);
    if (loupe.width !== side) loupe.width = loupe.height = side;
    const ctx = loupe.getContext("2d")!;
    const cell = side / SPAN;
    const half = (SPAN - 1) / 2;
    // A checkerboard under it, for what's clear (beyond a turned crop).
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = "#e4e4e0";
    for (let j = 0; j < SPAN; j++) for (let i = (j % 2); i < SPAN; i += 2) ctx.fillRect(i * cell, j * cell, cell, cell);
    // Source and destination clipped together at the picture's edges, so the pixels stay square.
    const sx = Math.max(0, at.x - half);
    const sy = Math.max(0, at.y - half);
    const ex = Math.min(src.width, at.x + half + 1);
    const ey = Math.min(src.height, at.y + half + 1);
    ctx.imageSmoothingEnabled = false;
    if (ex > sx && ey > sy) ctx.drawImage(src, sx, sy, ex - sx, ey - sy, (sx - (at.x - half)) * cell, (sy - (at.y - half)) * cell, (ex - sx) * cell, (ey - sy) * cell);
    // The picked pixel: a dark and a light ring, so it shows on any colour.
    const c = half * cell;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.strokeRect(c - ctx.lineWidth / 2, c - ctx.lineWidth / 2, cell + ctx.lineWidth, cell + ctx.lineWidth);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.strokeRect(c - ctx.lineWidth * 1.5, c - ctx.lineWidth * 1.5, cell + ctx.lineWidth * 3, cell + ctx.lineWidth * 3);
  }

  // Holes: with "Outside only", a click on an enclosed area of the background's colour (the hole
  // in an e) removes it too; a click on a removed one keeps it again. The picture can't tell a
  // hole from a fill of the same colour (a white star on a red badge), so the click decides.

  /** The pointer as fractions of the picture, or null off it. */
  function pointAt(e: PointerEvent | MouseEvent): [number, number] | null {
    if (!canvas || !pixelAt(e)) return null;
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  /** The enclosed area under the pointer (0 if none: not the background's colour, or outside). */
  function holeAreaAt(e: PointerEvent | MouseEvent): number {
    const pt = pointAt(e);
    if (!pt || !areas) return 0;
    const a = regionAt(areas, pt);
    return a && !areas.outside.has(a) ? a : 0;
  }

  function toggleHole(e: MouseEvent) {
    const a = holeAreaAt(e);
    const pt = pointAt(e);
    if (!a || !pt || !areas) return;
    const kept = holes.filter((h) => regionAt(areas, h) !== a);
    holes = kept.length < holes.length ? kept : [...holes, pt];
  }

  function hoverAt(e: PointerEvent) {
    if (!picking) {
      hoverArea = holeAreaAt(e);
      // Over a hole: the loupe on the preview, so a small one is easy to hit.
      if (hoverArea) drawLoupe(e, canvas ?? null);
      else loupeAt = null;
      return;
    }
    hover = colourAt(e);
    drawLoupe(e, shown ?? framed);
  }

  function hoverOff() {
    hover = null;
    loupeAt = null;
    hoverArea = 0;
  }

  function stopPicking() {
    picking = false;
    shown = null;
    hoverOff();
  }

  /** A click: picking, the colour there (beside the picture, nothing: still picking); otherwise a hole on or off. */
  function pickAt(e: MouseEvent) {
    if (!picking) {
      toggleHole(e);
      return;
    }
    if (!pixelAt(e)) return;
    const c = colourAt(e);
    if (c) bg = c;
    stopPicking();
  }

  $effect(() => {
    if (!picking) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Only the picking ends, not the dialog.
      e.preventDefault();
      e.stopPropagation();
      stopPicking();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  /** Back from the background view to framing (the dialog's footer button). */
  export function backToFraming() {
    stopPicking();
    view = "frame";
  }

  /** Save it to the library (the dialog's Save). */
  export async function save() {
    if (!framed || busy || !name.trim()) return;
    busy = true;
    error = "";
    try {
      const px = pixelsOf(framed);
      const out = document.createElement("canvas");
      out.width = px.width;
      out.height = px.height;
      const data = remove ? knockOut(px, { bg, tolerance, mode, holes }) : px.data;
      out.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), px.width, px.height), 0, 0);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) throw new Error("could not encode the picture");
      const item = await addStampPng(name.trim(), new Uint8Array(await blob.arrayBuffer()));
      onSaved(item);
    } catch (e) {
      console.error("[stamps] editor save failed:", e instanceof Error ? e.message : String(e));
      error = userMessage(e, "save the stamp");
    } finally {
      busy = false;
    }
  }
</script>

<div class="editor">
  {#if view === "loading"}
    <p class="note">{error ? "" : "Opening the picture…"}</p>
  {:else if view === "frame" && small}
    <SignatureFrame image={small} {adjust} {busy} applyLabel="Next" onapply={framedDone} oncancel={onCancel} />
  {:else if view === "background"}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="stage" class:picking class:hole={hoverArea > 0} bind:this={stage} onpointermove={hoverAt} onpointerleave={hoverOff} onclick={pickAt}>
      <canvas bind:this={canvas}></canvas>
      <canvas class="loupe" bind:this={loupe} hidden={!loupeAt} style:left="{loupeAt?.left ?? 0}px" style:top="{loupeAt?.top ?? 0}px" style:width="{LOUPE}px" style:height="{LOUPE}px" aria-hidden="true"></canvas>
    </div>

    {#if transparent}
      <p class="note">This picture already has a transparent background.</p>
    {:else}
      <div class="row">
        <span class="k">Remove background</span>
        <div class="seg" role="group" aria-label="Remove background: off, outside only (around the shape, not holes in it) or everywhere">
          {#each [["off", "Off"], ["edges", "Outside only"], ["everywhere", "Everywhere"]] as [v, text] (v)}
            <button type="button" aria-pressed={how === v} class:on={how === v} onclick={() => (how = v as typeof how)}>{text}</button>
          {/each}
        </div>
        <button
          type="button"
          class="btn colour"
          class:on={picking}
          aria-pressed={picking}
          disabled={!remove}
          title={picking ? "Click the picture to pick this colour (Esc cancels)" : "Pick the colour to remove from the picture"}
          onclick={() => (picking ? stopPicking() : startPicking())}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 2.5l3 3-1.6 1.6-.9-.9-5.6 5.6-2.4.6.6-2.4 5.6-5.6-.9-.9z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
          Pick colour
          <span class="sample" style:background={hex(hover ?? bg)}></span>
        </button>
        <label class="tol" class:off={!remove}>
          Tolerance
          <input type="range" min="0" max="100" step="1" bind:value={tolerance} disabled={!remove} />
          <span class="val num">{tolerance}</span>
        </label>
      </div>
      <!-- Always there (hidden unless "Outside only"), so the dialog doesn't change height. -->
      <p class="hint" class:gone={how !== "edges"}>Enclosed regions are kept. Click one to remove; click again to restore.</p>
    {/if}

    <div class="row">
      <span class="k">Name</span>
      <input class="field grow" maxlength="80" aria-label="Name" bind:value={name} />
    </div>
  {/if}

  {#if error}<p class="error" role="alert">{error}</p>{/if}
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* The picture on a checkerboard, so what's been removed shows as removed. */
  .stage {
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 360px;
    background-color: var(--paper);
    background-image: conic-gradient(#e4e4e0 25%, transparent 0 50%, #e4e4e0 0 75%, transparent 0);
    background-size: 16px 16px;
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
  }
  canvas {
    max-width: 100%;
    max-height: 100%;
  }
  .stage.picking {
    cursor: crosshair;
  }
  .stage.hole:not(.picking) {
    cursor: crosshair;
  }
  .hint.gone {
    visibility: hidden;
  }
  .hint {
    margin: -4px 0 0 136px;
    font-size: 12px;
    color: var(--tx3);
  }
  .loupe {
    position: absolute;
    max-width: none;
    max-height: none;
    border-radius: 50%;
    border: 2px solid var(--bd-strong);
    box-shadow: var(--shadow-pop);
    pointer-events: none;
    box-sizing: content-box;
  }
  .loupe[hidden] {
    display: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  /* Row labels, one width so the controls after them line up. */
  .k {
    flex: 0 0 124px;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 600;
    color: var(--tx2);
  }
  /* The shared button group at this row's height (32 px, as .btn). */
  .row .seg {
    padding: 1px;
    border-radius: 7px;
  }
  .row .seg > button {
    height: 28px;
    font-size: 13px;
  }
  /* The colour being removed: a wide chip, so it isn't mistaken for a checkbox or a radio;
     picking, it's pressed (as a selected segment). */
  .colour.on {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .colour {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--tx2);
  }
  .sample {
    width: 20px;
    height: 12px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.25);
    flex: 0 0 auto;
  }
  .val {
    flex: 0 0 3ch;
    text-align: right;
    color: var(--tx);
  }
  .off {
    opacity: 0.5;
  }
  .tol {
    flex: 1 1 auto;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--tx2);
  }
  .tol input {
    flex: 1 1 auto;
    min-width: 60px;
    margin: 0;
    accent-color: var(--accent);
  }
  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }
  .note {
    margin: 0;
    font-size: 13px;
    color: var(--tx3);
  }
  .error {
    margin: 0;
    font-size: 13px;
    color: var(--danger);
  }
</style>
