<script lang="ts">
  // Make a signature: draw it with a mouse or pen, or import a photo or scan (the paper is
  // knocked out in Rust), name it and save it to the library. Standalone: not wired into the
  // app yet (placing a signature needs the markup foundation). Try it with
  // `npm run dev:signatures` (docs/signatures-backend.md).
  import { onMount } from "svelte";
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import { Drawing, drawStrokes, INK, PEN_WIDTH, type Pt } from "../../signature/strokes";
  import {
    addSignature,
    drawingToPng,
    IMPORT_EXTENSIONS,
    importSignature,
    pngUrl,
    signatureMessage,
    type SignatureItem,
  } from "../../signature/api";

  interface Props {
    /** Called with the new library entry after a save. */
    onsaved?: (item: SignatureItem) => void;
  }
  let { onsaved }: Props = $props();

  const drawing = new Drawing();
  /** Bumped whenever the finished strokes change, so derived state re-reads `drawing`. */
  let version = $state(0);
  let imported = $state<{ png: Uint8Array; url: string } | null>(null);
  let name = $state("");
  let busy = $state(false);
  let error = $state("");

  let canvas = $state<HTMLCanvasElement>();
  let surface: HTMLDivElement;
  let dpr = 1;
  let pointer: number | null = null;

  const empty = $derived.by(() => {
    void version;
    return imported === null && drawing.isEmpty;
  });
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
    drawStrokes(ctx, all, { colour: INK, width: PEN_WIDTH });
  }

  function fit() {
    if (!canvas) return;
    dpr = window.devicePixelRatio || 1;
    const r = surface.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    redraw();
  }

  onMount(() => {
    const ro = new ResizeObserver(fit);
    ro.observe(surface);
    return () => {
      ro.disconnect();
      if (imported) URL.revokeObjectURL(imported.url);
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

  function clearAll() {
    drawing.clear();
    if (imported) URL.revokeObjectURL(imported.url);
    imported = null;
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
      const png = await importSignature(path);
      clearAll();
      imported = { png, url: pngUrl(png) };
    } catch (e) {
      console.error("[signature] import failed:", e);
      error = signatureMessage(e, "import this picture");
    } finally {
      busy = false;
    }
  }

  async function save() {
    if (empty || busy) return;
    busy = true;
    error = "";
    try {
      let item: SignatureItem;
      if (imported) {
        item = await addSignature(name, "imported", imported.png);
      } else {
        const out = await drawingToPng(drawing.strokes);
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
  <div class="surface" class:imported={imported !== null} bind:this={surface}>
    {#if imported}
      <img src={imported.url} alt="Imported signature" />
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
    <span class="spacer"></span>
    <input class="field" placeholder="Name" maxlength="80" bind:value={name} aria-label="Signature name"
      onkeydown={(e) => e.key === "Enter" && save()} />
    <button class="btn primary" onclick={save} disabled={empty || busy}>Save</button>
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else if imported}
    <p class="note">The paper has been removed. Check the edges look clean, then save it, or Clear to try another picture.</p>
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
  }
  .field {
    width: 180px;
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
