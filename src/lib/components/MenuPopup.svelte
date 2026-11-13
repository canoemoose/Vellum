<script lang="ts">
  // A dropdown list of menu items (menu bar menus, submenus, context menus). Keyboard:
  // arrows, Home/End, type-ahead, Enter, Escape; Left/Right switch menus or open submenus
  // (shell/menuNav.ts decides). Other keys are swallowed, except shortcuts, which close the
  // menu and run.
  import { onMount, tick } from "svelte";
  import { menuKey, type MenuItem } from "../shell/menuNav";
  import MenuPopup from "./MenuPopup.svelte";

  interface Props {
    items: MenuItem[];
    /** Fixed position of the popup's top-left, CSS px. */
    x: number;
    y: number;
    /** Initial highlighted item (-1 = none, e.g. opened with the mouse). */
    initialIndex?: number;
    inSub?: boolean;
    menu?: number;
    menuCount?: number;
    onClose: () => void;
    onSwitchMenu?: (menu: number) => void;
    /** Submenu only: Left / Escape returns to the parent. */
    onCloseSub?: () => void;
  }
  let { items, x, y, initialIndex = -1, inSub = false, menu = 0, menuCount = 1, onClose, onSwitchMenu, onCloseSub }: Props =
    $props();

  let el: HTMLDivElement;
  // svelte-ignore state_referenced_locally
  let index = $state(initialIndex);
  let sub = $state<{ index: number; x: number; y: number; keyboard: boolean } | null>(null);
  let pos = $state({ x: 0, y: 0 });

  const labels = $derived(items.map((i) => i.label ?? null));
  /** Reserve a column for ticks only when some item has one (the File menu has none). */
  const hasMarks = $derived(items.some((i) => i.checked !== undefined));

  onMount(async () => {
    pos = { x, y };
    await tick();
    // Keep the popup inside the window.
    const r = el.getBoundingClientRect();
    const nx = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const ny = Math.max(4, Math.min(y, window.innerHeight - r.height - 4));
    pos = { x: nx, y: ny };
    el.focus({ preventScroll: true });
  });

  function openSub(i: number, keyboard: boolean) {
    const item = items[i];
    if (!item?.submenu || item.disabled) return;
    const row = el.querySelector<HTMLElement>(`[data-i="${i}"]`);
    const r = row?.getBoundingClientRect();
    if (!r) return;
    sub = { index: i, x: r.right + 2, y: r.top - 7, keyboard };
  }

  function activate(i: number) {
    const item = items[i];
    if (!item || item.disabled || item.separator) return;
    if (item.submenu) return openSub(i, false);
    onClose();
    item.action?.();
  }

  function onKey(e: KeyboardEvent) {
    if (sub) return; // the submenu has focus and handles keys
    const a = menuKey(e.key, { items, labels, index, menu, menuCount, inSub, mods: { ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey } });
    if (a.type === "pass") return;
    if (a.type === "closeAndPass") {
      onClose(); // the key carries on to the window, where its shortcut runs
      return;
    }
    // Everything else stops here, used or not, so it can't act on the drawing behind.
    e.preventDefault();
    e.stopPropagation();
    switch (a.type) {
      case "move":
        index = a.index;
        break;
      case "switchMenu":
        onSwitchMenu?.(a.menu);
        break;
      case "openSub":
        openSub(index, true);
        break;
      case "closeSub":
        onCloseSub?.();
        break;
      case "activate":
        activate(index);
        break;
      case "close":
        onClose();
        break;
    }
  }

  function closeSubmenu() {
    sub = null;
    el.focus({ preventScroll: true });
  }
</script>

<div
  class="menu"
  role="menu"
  tabindex="-1"
  bind:this={el}
  style:left="{pos.x}px"
  style:top="{pos.y}px"
  onkeydown={onKey}
>
  {#each items as item, i (i)}
    {#if item.separator}
      <span class="sep" role="separator"></span>
    {:else}
      <button
        type="button"
        role={item.radio ? "menuitemradio" : item.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
        aria-checked={item.checked === undefined ? undefined : item.checked}
        aria-haspopup={item.submenu ? "menu" : undefined}
        aria-expanded={item.submenu ? sub?.index === i : undefined}
        class="item"
        class:on={index === i}
        disabled={item.disabled}
        data-i={i}
        tabindex="-1"
        onpointerenter={() => {
          index = i;
          if (item.submenu) openSub(i, false);
          else if (sub) closeSubmenu(); // take focus back, or keys would reach the drawing
        }}
        onclick={() => activate(i)}
      >
        {#if hasMarks}<span class="mark">
          {#if item.checked}
            {#if item.radio}
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="currentColor" /></svg>
            {:else}
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
            {/if}
          {/if}
        </span>{/if}
        <span class="label">{item.label}</span>
        {#if item.submenu}
          <span class="hint">›</span>
        {:else if item.shortcut}
          <span class="hint">{item.shortcut}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>

{#if sub}
  {@const s = sub}
  <MenuPopup
    items={items[s.index].submenu ?? []}
    x={s.x}
    y={s.y}
    initialIndex={s.keyboard ? 0 : -1}
    inSub={true}
    {menu}
    {menuCount}
    {onClose}
    {onSwitchMenu}
    onCloseSub={closeSubmenu}
  />
{/if}

<style>
  .menu {
    position: fixed;
    z-index: var(--z-menu);
    min-width: 260px;
    max-width: 420px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: 6px;
    background: var(--ctl);
    border: 1px solid var(--bd-strong);
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .item {
    height: 30px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--tx);
    border-radius: 5px;
    text-align: left;
  }
  .item.on:not(:disabled) {
    background: var(--accent-soft);
  }
  .mark {
    width: 16px;
    margin-left: -4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tx2);
    flex-shrink: 0;
  }
  .label {
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hint {
    color: var(--tx3);
    font-size: 12px;
    white-space: nowrap;
    padding-left: 16px;
  }
  .sep {
    height: 1px;
    flex-shrink: 0;
    background: var(--bd);
    margin: 5px 4px;
  }
</style>
