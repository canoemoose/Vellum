<script lang="ts">
  // Make a signature: draw it with a mouse or pen, or import a photo or scan (framed first in
  // SignatureFrame, then the paper is knocked out in Rust), name it and save it to the library.
  // Standalone: not wired into the app yet (placing a signature needs the markup foundation).
  // Try it with `npm run dev:signatures` (docs/signatures-backend.md).
  import { onMount, untrack } from "svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import SignatureFrame from "./SignatureFrame.svelte";
  import { Drawing, drawStrokes, INK, PEN_WIDTH, type Pt } from "../../signature/strokes";
  import { INKS, parseHex, toHex, tooLight } from "../../signature/ink";
  import ColourSwatches from "../ColourSwatches.svelte";
  import type { Rgb } from "../../markup/base";
  import { initialAdjust, type Adjust } from "../../signature/frame";
  import {
    addSignature,
    drawingToPng,
    IMPORT_EXTENSIONS,
    importSignature,
    pngUrl,
    previewSignature,
    recolourPng,
    signatureMessage,
    type SignatureItem,
  } from "../../signature/api";

  interface Props {
    /** Called with the new library entry after a save. */
    onsaved?: (item: SignatureItem) => void;
    /** The Save button under the name; off where the pad's host has its own (a dialog's footer calls `save()`). */
    saveButton?: boolean;
    /** Out: there's something to save and nothing in progress. */
    ready?: boolean;
    /** Out: a photo is being framed (its view has its own buttons). */
    framed?: boolean;
  }
  let { onsaved, saveButton = true, ready = $bindable(false), framed = $bindable(false) }: Props = $props();

  const drawing = new Drawing();
  /** Bumped whenever the finished strokes change, so derived state re-reads `drawing`. */
  let version = $state(0);
  /** An imported signature: as the importer made it, and as shown (recoloured, maybe). */
  let imported = $state<{ png: Uint8Array; url: string } | null>(null);
  let shown = $state<{ png: Uint8Array; url: string } | null>(null);
  /** A photo: its path, its preview and how it's framed. */
  type Photo = { path: string; image: ImageBitmap; adjust: Adjust };
  /** The photo the current import came from (to adjust it again). */
  let source = $state.raw<Photo | null>(null);
  /** The photo being framed: a new one, or `source` again. */
  let framing = $state.raw<Photo | null>(null);
  /** The ink, "#rrggbb", or "original" (an import's own colour). */
  let choice = $state<string>(INK);
  let name = $state("");
  let busy = $state(false);
  let error = $state("");

  let canvas = $state<HTMLCanvasElement>();
  let surface = $state<HTMLDivElement>();
  let dpr = 1;
  let pointer: number | null = null;

  const empty = $derived.by(() => {
    void version;
    return imported === null && drawing.isEmpty;
  });
  /** The ink in use, or null for an import's own colour. */
  const inkHex = $derived(choice === "original" ? null : choice);
  // The pen inks and the chosen one as the app's swatches have them: 0 to 1 a channel.
  const to01 = (hex: string): Rgb => (parseHex(hex) ?? [0, 0, 0]).map((v) => v / 255) as Rgb;
  const inkSwatches = INKS.map((i) => ({ name: i.label, c: to01(i.hex) }));
  const inkValue = $derived(inkHex === null ? null : to01(inkHex));
  const pale = $derived(inkHex !== null && tooLight(parseHex(inkHex) ?? [0, 0, 0]));

  const canUndo = $derived.by(() => {
    void version;
    return imported === null && drawing.strokes.length > 0;
  });

  function redraw() {
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const all = drawing.live ? [...drawing.strokes, drawing.live] : drawing.strokes;
    drawStrokes(ctx, all, { colour: inkHex ?? INK, width: PEN_WIDTH });
  }

  // The whole drawing takes the ink chosen (a signature is one colour).
  $effect(() => {
    void inkHex;
    redraw();
  });

  // An import is shown, and saved, in the ink chosen. A result that's been overtaken by a
  // later choice is dropped.
  let recolourSeq = 0;
  $effect(() => {
    const src = imported;
    const hex = inkHex;
    const seq = ++recolourSeq;
    if (!src) return;
    if (hex === null) {
      untrack(() => setShown(src)); // reads `shown`: not a dependency
      return;
    }
    recolourPng(src.png, parseHex(hex)!)
      .then((png) => {
        if (seq === recolourSeq) setShown({ png, url: pngUrl(png) });
      })
      .catch((e) => {
        console.error("[signature] recolour failed:", e);
        if (seq === recolourSeq) error = signatureMessage(e, "change the ink");
      });
  });

  /** Show an import's version; revokes the previous one's URL unless it's the original's. */
  function setShown(next: { png: Uint8Array; url: string } | null) {
    if (shown && shown !== imported && shown.url !== next?.url) URL.revokeObjectURL(shown.url);
    shown = next;
  }

  function fit() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    if (!surface) return;
    const r = surface.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    redraw();
  }

  // The surface comes and goes with the framing view: watch whichever is there.
  $effect(() => {
    if (!surface) return;
    const ro = new ResizeObserver(fit);
    ro.observe(surface);
    return () => ro.disconnect();
  });

  onMount(() => {
    return () => {
      setShown(null);
      if (imported) URL.revokeObjectURL(imported.url);
      dropPhotos();
    };
  });

  // The canvas comes and goes with import mode; size it when it appears.
  $effect(() => {
    if (canvas) fit();
  });

  function at(e: PointerEvent, r: DOMRect): Pt {
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function down(e: PointerEvent) {
    if (!canvas || e.button !== 0 || pointer !== null) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    pointer = e.pointerId;
    drawing.begin(at(e, canvas.getBoundingClientRect()));
    error = "";
    redraw();
  }

  function move(e: PointerEvent) {
    if (!canvas || e.pointerId !== pointer) return;
    const r = canvas.getBoundingClientRect();
    // Coalesced events carry every sample since the last frame (a pen reports far more often
    // than the screen draws).
    const evs = e.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) drawing.extend(at(ev, r));
    redraw();
  }

  function up(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    drawing.end();
    version++;
    redraw();
  }

  function cancelStroke(e: PointerEvent) {
    if (e.pointerId !== pointer) return;
    pointer = null;
    drawing.cancel();
    redraw();
  }

  function undo() {
    if (drawing.undo()) {
      version++;
      redraw();
    }
  }

  /** Forget the imported result (not the photo it came from). */
  function dropImported() {
    setShown(null);
    if (imported) URL.revokeObjectURL(imported.url);
    imported = null;
  }

  function dropPhotos() {
    if (framing && framing !== source) framing.image.close();
    source?.image.close();
    source = framing = null;
  }

  function clearAll() {
    drawing.clear();
    dropImported();
    dropPhotos();
    if (choice === "original") choice = INK;
    error = "";
    version++;
    redraw();
  }

  function onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.stopPropagation();
      undo();
    }
  }

  async function importFile() {
    const path = await openDialog({
      multiple: false,
      directory: false,
      title: "Import a signature",
      filters: [{ name: "Pictures", extensions: IMPORT_EXTENSIONS }],
    });
    if (typeof path !== "string") return;
    busy = true;
    error = "";
    try {
      const jpeg = await previewSignature(path);
      const image = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
      // Whatever was on the pad stays until the new photo is applied (Cancel goes back to it).
      framing = { path, image, adjust: initialAdjust() };
    } catch (e) {
      console.error("[signature] preview failed:", e);
      error = signatureMessage(e, "open this picture");
    } finally {
      busy = false;
    }
  }

  /** Knock the paper out of the photo as framed. On failure, stay framing so it can be tried again. */
  async function applyFrame(adjust: Adjust) {
    const photo = framing;
    if (!photo) return;
    busy = true;
    error = "";
    try {
      const png = await importSignature(photo.path, adjust);
      drawing.clear();
      dropImported();
      imported = { png, url: pngUrl(png) };
      choice = "original";
      if (source && source !== photo) source.image.close();
      source = { ...photo, adjust };
      framing = null;
      version++;
    } catch (e) {
      console.error("[signature] import failed:", e);
      error = signatureMessage(e, "import this picture");
    } finally {
      busy = false;
    }
  }

  /** Back to what was on the pad before; a new photo that wasn't applied is dropped. */
  function cancelFrame() {
    error = "";
    if (framing && framing !== source) framing.image.close();
    framing = null;
  }

  $effect(() => {
    ready = !empty && !busy;
    framed = framing !== null;
  });

  export async function save() {
    if (empty || busy) return;
    busy = true;
    error = "";
    try {
      let item: SignatureItem;
      if (imported) {
        const png = inkHex === null ? imported.png : shown && shown !== imported ? shown.png : null;
        if (!png) throw new Error("The ink is still being changed. Try again in a moment.");
        item = await addSignature(name, "imported", png);
      } else {
        const out = await drawingToPng(drawing.strokes, inkHex ?? INK);
        if (!out) throw new Error("Couldn't draw the signature.");
        item = await addSignature(name, "drawn", out.png, out.json);
      }
      clearAll();
      name = "";
      onsaved?.(item);
    } catch (e) {
      console.error("[signature] save failed:", e);
      error = signatureMessage(e, "save the signature");
    } finally {
      busy = false;
    }
  }
</script>

<!-- Ctrl+Z undoes a stroke while focus is anywhere in the pad (its buttons, the name). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="pad" role="group" aria-label="Signature pad" tabindex="-1" onkeydown={onKey}>
  {#if framing}
    {#key framing}
      <SignatureFrame image={framing.image} adjust={framing.adjust} {busy} onapply={applyFrame} oncancel={cancelFrame} />
    {/key}
  {:else}
  <div class="surface" class:imported={imported !== null} bind:this={surface}>
    {#if imported}
      <img src={(shown ?? imported).url} alt="Imported signature" />
    {:else}
      <div class="line" aria-hidden="true"></div>
      {#if empty}
        <div class="hint" aria-hidden="true">Sign here with a mouse or pen</div>
      {/if}
      <canvas
        bind:this={canvas}
        aria-label="Drawing area"
        onpointerdown={down}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={cancelStroke}
        onlostpointercapture={cancelStroke}
      ></canvas>
    {/if}
  </div>

  <div class="row">
    <button class="btn small" onclick={undo} disabled={!canUndo || busy} title="Undo the last stroke (Ctrl+Z)">Undo</button>
    <button class="btn small" onclick={clearAll} disabled={empty || busy}>Clear</button>
    <button class="btn small" onclick={importFile} disabled={busy}>Import a picture…</button>
    {#if imported && source}
      <button class="btn small" onclick={() => (framing = source)} disabled={busy}
        title="Crop, turn or straighten the photo again">Adjust the photo…</button>
    {/if}
    <span class="spacer"></span>
    <span class="inks" role="group" aria-label="Ink">
      <span class="label">Ink</span>
      {#if imported}
        <button class="chip" class:on={choice === "original"} role="radio" aria-checked={choice === "original"}
          onclick={() => (choice = "original")} title="The ink's own colour, from the picture">Original</button>
      {/if}
      <ColourSwatches label="Ink" value={inkValue} colours={inkSwatches} onPick={(c) => (choice = toHex(c.map((v) => v * 255) as Rgb))} />
    </span>
  </div>

  <div class="row">
    <!-- On the name's row, so it doesn't move anything when it comes and goes. -->
    <span class="spacer">
      {#if pale && !error}
        <span class="warn" role="status">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 14.6 13.5H1.4Z" /><path d="M8 6.5v3.2M8 11.6v.1" /></svg>
          This ink is pale, so it may be hard to read on the page.
        </span>
      {/if}
    </span>
    <input class="field" placeholder="Name" maxlength="80" bind:value={name} aria-label="Signature name"
      onkeydown={(e) => e.key === "Enter" && save()} />
    {#if saveButton}<button class="btn primary" onclick={save} disabled={empty || busy}>Save</button>{/if}
  </div>
  {/if}

  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if framing}
    <!-- nothing: the framing view has its own hint -->
  {:else if imported}
    <p class="note">The paper has been removed. Check the edges look clean, then save it, or adjust the photo and try again.</p>
  {/if}
</div>

<style>
  .pad {
    display: flex;
    flex-direction: column;
    gap: 10px;
    outline: none;
  }
  /* Paper: signatures are made on white whatever the theme, as they'll sit on white pages. */
  .surface {
    position: relative;
    width: 100%;
    aspect-ratio: 3 / 1;
    background: var(--paper);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    overflow: hidden;
  }
  /* An imported signature sits on a faint checkerboard, so its transparency shows. */
  .surface.imported {
    background-color: var(--paper);
    background-image: conic-gradient(#eeeeec 25%, transparent 0 50%, #eeeeec 0 75%, transparent 0);
    background-size: 16px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  img {
    max-width: 92%;
    max-height: 88%;
    object-fit: contain;
  }
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
    cursor: crosshair;
  }
  .line {
    position: absolute;
    left: 8%;
    right: 8%;
    bottom: 26%;
    border-bottom: 1px solid #c8c8c2;
  }
  .hint {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(26% + 10px);
    text-align: center;
    color: #9a9a94;
    font-size: 13px;
    pointer-events: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
    min-width: 0;
  }
  .warn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--warn);
    font-size: 13px;
  }
  .warn svg {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .field {
    width: 220px;
  }
  .inks {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .label {
    color: var(--tx3);
  }
  /* The chosen "Original" gets the swatches' accent ring with a gap. */
  .chip.on {
    box-shadow:
      0 0 0 2px var(--app),
      0 0 0 4px var(--accent);
  }
  .chip {
    height: 22px;
    padding: 0 8px;
    border-radius: 11px;
    border: 1px solid var(--bd-strong);
    background: var(--ctl);
    color: var(--tx2);
    font-size: 12px;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }
  .note {
    margin: 0;
    color: var(--tx3);
    font-size: 13px;
  }
</style>
