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
  import { type KnockMode, type Pixels, type Rgb8, guessBackground, hasTransparency, knockOut } from "../../stamps/knockout";
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
  let remove = $state(true);
  /** The picture has a transparent background already: nothing to remove, so no controls. */
  let transparent = $state(false);
  let mode = $state<KnockMode>("edges");
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
        remove = !transparent;
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

  // The live preview: redrawn whenever a setting changes.
  $effect(() => {
    if (!canvas || !preview) return;
    const data = remove ? knockOut(preview, { bg, tolerance, mode }) : preview.data;
    canvas.width = preview.width;
    canvas.height = preview.height;
    canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), preview.width, preview.height), 0, 0);
  });

  /** Where the pointer is in the framed picture's full-size pixels (beyond it too, off its edges). */
  function pixelUnder(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
    if (!framedPx || !canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * framedPx.width), y: Math.floor(((e.clientY - r.top) / r.height) * framedPx.height) };
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
      c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(knockOut(framedPx, { bg, tolerance, mode })), framedPx.width, framedPx.height), 0, 0);
      shown = c;
    } else shown = framed;
    picking = true;
  }

  function drawLoupe(e: PointerEvent) {
    // Anywhere over the stage: what's beyond the picture shows as clear.
    const at = pixelUnder(e);
    const src = shown ?? framed;
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

  function hoverAt(e: PointerEvent) {
    if (!picking) return;
    hover = colourAt(e);
    drawLoupe(e);
  }

  function hoverOff() {
    hover = null;
    loupeAt = null;
  }

  function stopPicking() {
    picking = false;
    shown = null;
    hoverOff();
  }

  /** A click while picking: on the picture, its colour; beside it, nothing (still picking). */
  function pickAt(e: MouseEvent) {
    if (!picking || !pixelAt(e)) return;
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
      const data = remove ? knockOut(px, { bg, tolerance, mode }) : px.data;
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
    <div class="stage" class:picking bind:this={stage} onpointermove={hoverAt} onpointerleave={hoverOff} onclick={pickAt}>
      <canvas bind:this={canvas}></canvas>
      <canvas class="loupe" bind:this={loupe} hidden={!loupeAt} style:left="{loupeAt?.left ?? 0}px" style:top="{loupeAt?.top ?? 0}px" style:width="{LOUPE}px" style:height="{LOUPE}px" aria-hidden="true"></canvas>
    </div>

    {#if transparent}
      <p class="note">This picture already has a transparent background.</p>
    {:else}
      <div class="row">
        <label class="check"><input type="checkbox" bind:checked={remove} /> Remove the background</label>
        <button
          type="button"
          class="btn colour"
          class:on={picking}
          aria-pressed={picking}
          disabled={!remove}
          title={picking ? "Click the picture to pick this colour (Esc cancels)" : "The colour removed. Click, then click the picture to pick another."}
          onclick={() => (picking ? stopPicking() : startPicking())}
        >
          <span class="sample" style:background={hex(hover ?? bg)}></span> Colour
        </button>
        <div class="seg" class:off={!remove} role="group" aria-label="Which background to remove">
          {#each [["edges", "From the edges"], ["everywhere", "Everywhere"]] as [v, text] (v)}
            <button type="button" aria-pressed={mode === v} class:on={mode === v} disabled={!remove} onclick={() => (mode = v as KnockMode)}>{text}</button>
          {/each}
        </div>
        <label class="tol" class:off={!remove}>
          Tolerance
          <input type="range" min="0" max="100" step="1" bind:value={tolerance} disabled={!remove} />
        </label>
      </div>
    {/if}

    <div class="row">
      <input class="field grow" maxlength="80" aria-label="Name" placeholder="Name" bind:value={name} />
      <button type="button" class="btn" disabled={busy} onclick={() => (view = "frame")}>Back to framing</button>
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
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
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
    width: 28px;
    height: 14px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.25);
    flex: 0 0 auto;
  }
  .off {
    opacity: 0.5;
  }
  .tol {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--tx2);
  }
  .tol input {
    width: 180px;
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
