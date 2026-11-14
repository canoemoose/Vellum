<script lang="ts">
  // Dev-only harness for the signature pad and library (npm run dev:signatures). Shows what a
  // picked signature looks like at full size on white and on a dark checkerboard (to judge the
  // transparency), and a drawn one's vector form beside its PNG.
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import SignaturePad from "../lib/components/signature/SignaturePad.svelte";
  import SignatureLibrary from "../lib/components/signature/SignatureLibrary.svelte";
  import { getSignature, getSignatureStrokes, pngUrl, signatureMessage, type SignatureItem } from "../lib/signature/api";
  import { parse, toSvg } from "../lib/signature/strokes";

  let library = $state<SignatureLibrary>();
  let picked = $state<{ item: SignatureItem; url: string; bytes: number; svg: string | null; points: number } | null>(null);
  let error = $state("");
  let theme = $state<"dark" | "light">("dark");

  onMount(() => {
    document.documentElement.dataset.theme = theme;
    getCurrentWindow().show();
  });

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
  }

  async function pick(item: SignatureItem) {
    error = "";
    try {
      const png = await getSignature(item.id);
      const json = await getSignatureStrokes(item.id);
      const drawn = json ? parse(json) : null;
      if (picked) URL.revokeObjectURL(picked.url);
      picked = {
        item,
        url: pngUrl(png),
        bytes: png.length,
        svg: drawn ? toSvg(drawn.strokes, drawn.pen) : null,
        points: drawn ? drawn.strokes.reduce((n, s) => n + s.length, 0) : 0,
      };
    } catch (e) {
      error = signatureMessage(e, "open the signature");
    }
  }
</script>

<div class="page">
  <header data-tauri-drag-region>
    <span data-tauri-drag-region>Signatures (dev page)</span>
    <span class="spacer" data-tauri-drag-region></span>
    <button class="btn small ghost" onclick={toggleTheme}>{theme === "dark" ? "Light" : "Dark"} theme</button>
    <button class="btn small ghost" onclick={() => getCurrentWindow().close()}>Close</button>
  </header>

  <main>
    <section class="left">
      <h2>New signature</h2>
      <SignaturePad onsaved={() => library?.refresh()} />

      {#if error}<p class="error">{error}</p>{/if}
      {#if picked}
        <h2>{picked.item.name}</h2>
        <p class="meta">
          {picked.item.kind === "drawn" ? "Drawn" : "Imported"}, {picked.item.width} x {picked.item.height} px,
          {(picked.bytes / 1024).toFixed(0)} KB PNG{#if picked.svg}, {picked.points} points{/if}
        </p>
        <div class="previews">
          <figure class="paper"><img src={picked.url} alt="On white" /><figcaption>PNG on white</figcaption></figure>
          <figure class="checker"><img src={picked.url} alt="On a dark checkerboard" /><figcaption>PNG on dark</figcaption></figure>
          {#if picked.svg}
            <figure class="paper">{@html picked.svg}<figcaption>Vector (from the strokes)</figcaption></figure>
          {/if}
        </div>
      {/if}
    </section>

    <section class="right">
      <h2>Library</h2>
      <SignatureLibrary bind:this={library} onpick={pick} selectedId={picked?.item.id ?? null} />
    </section>
  </main>
</div>

<style>
  .page {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  header {
    height: 36px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px 0 14px;
    background: var(--chrome);
    border-bottom: 1px solid var(--bd);
    color: var(--tx2);
    user-select: none;
  }
  .spacer {
    flex: 1;
    align-self: stretch;
  }
  main {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 24px;
    padding: 20px;
  }
  h2 {
    font-size: 13px;
    font-weight: 600;
    color: var(--tx2);
    margin: 0 0 10px;
  }
  .left h2:not(:first-child) {
    margin-top: 24px;
  }
  .meta,
  .error {
    margin: 0 0 10px;
    color: var(--tx3);
  }
  .error {
    color: var(--danger);
  }
  .previews {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  figure {
    margin: 0;
    padding: 12px;
    border-radius: 6px;
    border: 1px solid var(--bd-strong);
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    max-width: 100%;
  }
  figure img,
  figure :global(svg) {
    max-width: 300px;
    max-height: 120px;
    width: auto;
    height: auto;
  }
  figcaption {
    font-size: 12px;
    color: #77776f;
  }
  .paper {
    background: var(--paper);
  }
  .checker {
    background-color: #2a2b2f;
    background-image: conic-gradient(#3a3b40 25%, transparent 0 50%, #3a3b40 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  .checker figcaption {
    color: #b0b0b0;
  }
</style>
