<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Viewer, ViewerStats } from "../engine/viewer";
  import { jsHeapMb, memoryStats, type MemStats } from "../platform";

  interface Props {
    viewer: Viewer;
  }
  let { viewer }: Props = $props();

  let s = $state<ViewerStats | null>(null);
  let mem = $state<MemStats | null>(null);
  let heap = $state<number | null>(null);
  let lastActiveFps = $state(0);
  let timers: ReturnType<typeof setInterval>[] = [];

  onMount(() => {
    const tick = () => {
      s = viewer.stats();
      heap = jsHeapMb();
      if (s.fps > 0) lastActiveFps = s.fps;
    };
    tick();
    timers.push(setInterval(tick, 250));
    const memTick = async () => {
      try {
        mem = await memoryStats();
      } catch {
        mem = null;
      }
    };
    memTick();
    timers.push(setInterval(memTick, 1000));
  });
  onDestroy(() => timers.forEach(clearInterval));

  const f = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? "–" : v.toFixed(d));
</script>

{#if s}
  <aside class="dbg num">
    <div class="row"><span>renderer</span><b>{s.renderer}</b></div>
    <div class="row"><span>fps (live)</span><b>{s.fps > 0 ? f(s.fps) : "idle"}</b></div>
    <div class="row"><span>fps (last active)</span><b>{f(lastActiveFps)}</b></div>
    <div class="row"><span>draw p95</span><b>{f(s.drawMsP95, 2)} ms</b></div>
    <div class="row"><span>settle → sharp</span><b>{f(s.lastSettleToSharpMs)} ms</b></div>
    <div class="row"><span>last region render</span><b>{f(s.lastRenderMs)} ms</b></div>
    <div class="row"><span>queue / busy</span><b>{s.queue} / {s.rendering ? "yes" : "no"}</b></div>
    <div class="row"><span>tiles</span><b>{s.tiles} ({f(s.cacheMB)} / {f(s.cacheLimitMB)} MB)</b></div>
    <div class="row"><span>evictions</span><b>{s.evictions}</b></div>
    <div class="row"><span>previews</span><b>{s.previews} ({f(s.previewMB)} MB)</b></div>
    <div class="row"><span>JS heap</span><b>{heap === null ? "n/a" : f(heap) + " MB"}</b></div>
    <div class="row"><span>process tree</span><b>{mem ? f(mem.current.privateWsMb) + " MB" : "–"}</b></div>
    <div class="row"><span>peak</span><b>{mem ? f(mem.peak.privateWsMb) + " MB" : "–"}</b></div>
    <div class="row"><span>zoom / rs / dpr</span><b>{f(s.zoom * 100)}% / {f(s.rs, 3)} / {s.dpr}</b></div>
    <div class="row"><span>renders / errors</span><b>{s.rendersDone} / {s.renderErrors}</b></div>
    <div class="wheel">{s.lastWheel || "wheel: –"}</div>
  </aside>
{/if}

<style>
  .dbg {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 300px;
    padding: 8px 10px;
    background: color-mix(in srgb, var(--chrome), transparent 8%);
    border: 1px solid var(--bd-strong);
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.6;
    color: var(--tx2);
    pointer-events: none;
    z-index: 10;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .row span {
    color: var(--tx3);
  }
  .row b {
    font-weight: 400;
    color: var(--tx);
  }
  .wheel {
    margin-top: 4px;
    color: var(--tx3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
