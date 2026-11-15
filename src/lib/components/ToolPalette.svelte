<script lang="ts">
  // The markup tools in the toolbar's centre, from the tool registry (markup/tools.ts). Flat
  // when the toolbar has room for every tool: one row, a thin divider between groups. When it
  // hasn't, every group collapses to one button showing its last tool, with the rest in a
  // flyout (the caret beside it, or press and hold). All or nothing, decided by the width
  // alone (a hidden copy of the flat row is measured against the room), never by the active
  // tool, so it doesn't change while you work. A tool stays active after drawing; Esc or V
  // goes back to Select.
  import { type GroupId, type ToolDef, groupFace, keyLabel, paletteGroups, paletteLayout, toolTip } from "../markup/tools";
  import PopChoice from "./PopChoice.svelte";

  interface Props {
    tool: string;
    disabled: boolean;
    /** Why the tools are off, for their tooltips (e.g. an image). */
    disabledReason?: string;
    /** Each group's last tool (settings). */
    lastInGroup: Partial<Record<string, string>>;
    onTool: (id: string) => void;
  }
  let p: Props = $props();

  const groups = paletteGroups();
  /** The room the toolbar leaves, and the whole flat row's width. */
  let room = $state(0);
  let full = $state(0);
  const layout = $derived(paletteLayout(full, room));

  const tip = (t: ToolDef) => (p.disabled && p.disabledReason ? p.disabledReason : toolTip(t));
  /** What a collapsed group shows: the active tool if it's in the group, else its last. */
  const faceOf = (g: GroupId, tools: ToolDef[]) => tools.find((t) => t.id === p.tool) ?? groupFace(g, p.lastInGroup);

  // Press and hold a group's button to open its flyout.
  const HOLD_MS = 450;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  function holdStart(e: PointerEvent, toggle: () => void) {
    if (e.button !== 0 || p.disabled) return;
    held = false;
    holdTimer = setTimeout(() => {
      held = true;
      toggle();
    }, HOLD_MS);
  }
  function holdEnd() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  }
  function pressGroup(t: ToolDef) {
    if (held) {
      held = false;
      return;
    }
    p.onTool(t.id);
  }
</script>

{#snippet icon(t: ToolDef)}
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">{@html t.icon}</svg>
{/snippet}

{#snippet toolButton(t: ToolDef, measuring: boolean)}
  <button
    type="button"
    role="radio"
    aria-checked={p.tool === t.id}
    aria-label={t.label}
    class="icon-btn"
    class:on={p.tool === t.id}
    disabled={p.disabled}
    tabindex={measuring ? -1 : undefined}
    title={tip(t)}
    onclick={() => p.onTool(t.id)}
  >
    {@render icon(t)}
  </button>
{/snippet}

{#snippet flatRow(measuring: boolean)}
  {#each groups as g, i (g.group.id)}
    {#if i > 0}<span class="divider" aria-hidden="true"></span>{/if}
    {#each g.tools as t (t.id)}
      {@render toolButton(t, measuring)}
    {/each}
  {/each}
{/snippet}

<div class="palette" bind:clientWidth={room}>
  <!-- The flat row laid out out of sight, to measure against the room. -->
  <div class="group measure" aria-hidden="true" inert bind:clientWidth={full}>
    {@render flatRow(true)}
  </div>

  <div class="group" role="radiogroup" aria-label="Markup tools">
    {#if layout === "flat"}
      {@render flatRow(false)}
    {:else}
      {#each groups as g (g.group.id)}
        {#if g.tools.length === 1}
          {@render toolButton(g.tools[0], false)}
        {:else}
          {@const face = faceOf(g.group.id, g.tools)}
          {@const on = g.tools.some((t) => t.id === p.tool)}
          <PopChoice
            label={g.group.label}
            options={g.tools.map((t) => ({ key: t.id, name: t.key ? `${t.label} (${keyLabel(t)})` : t.label }))}
            value={on ? p.tool : null}
            out="down"
            sample={flySample}
            onChange={(id) => p.onTool(id)}
          >
            {#snippet trigger({ toggle, open })}
              <span class="split" class:on class:open>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label="{face.label} ({g.group.label} tools)"
                  class="icon-btn main"
                  disabled={p.disabled}
                  title={tip(face)}
                  onpointerdown={(e) => holdStart(e, toggle)}
                  onpointerup={holdEnd}
                  onpointerleave={holdEnd}
                  onclick={() => pressGroup(face)}
                >
                  {@render icon(face)}
                </button>
                <button
                  type="button"
                  class="caret"
                  aria-haspopup="listbox"
                  aria-expanded={open}
                  aria-label="More {g.group.label.toLowerCase()} tools"
                  title="More {g.group.label.toLowerCase()} tools"
                  disabled={p.disabled}
                  onclick={toggle}
                >
                  <svg width="7" height="5" viewBox="0 0 7 5" aria-hidden="true"><path d="M1 1l2.5 2.5L6 1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              </span>
            {/snippet}
          </PopChoice>
        {/if}
      {/each}
    {/if}
  </div>
</div>

{#snippet flySample(id: string | null, _w: number)}
  {@const t = groups.flatMap((g) => g.tools).find((x) => x.id === id)}
  {#if t}<span class="fly-icon">{@render icon(t)}</span>{/if}
{/snippet}

<style>
  .palette {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    justify-content: center;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--ctl);
    border: 1px solid var(--bd-ctl);
    border-radius: 8px;
  }
  .measure {
    position: absolute;
    left: 0;
    top: 0;
    width: max-content;
    visibility: hidden;
    pointer-events: none;
  }
  .divider {
    width: 1px;
    height: 18px;
    margin: 0 3px;
    background: var(--bd-ctl);
    flex-shrink: 0;
  }
  .icon-btn.on,
  .split.on .main {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .split {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }
  .split .main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .caret {
    width: 13px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 0 6px 6px 0;
    background: transparent;
    color: var(--tx3);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .caret:hover:not(:disabled),
  .split.open .caret {
    background: var(--hover);
    color: var(--tx);
  }
  .split.on .caret {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .fly-icon {
    width: 22px;
    display: flex;
    justify-content: center;
    color: var(--tx2);
  }
</style>
