<script lang="ts">
  // The HTML menu bar (32 px, follows the theme). Menus open on click, switch on hover while
  // one is open, close on Escape or an outside click, and are keyboard-navigable. Alt (pressed
  // and released on its own) or F10 opens the first menu from the keyboard.
  import { onMount } from "svelte";
  import type { Menu } from "../shell/menuNav";
  import MenuPopup from "./MenuPopup.svelte";

  interface Props {
    menus: Menu[];
    /** A modal is open: Alt and F10 mustn't open a menu behind it. */
    disabled?: boolean;
  }
  let { menus, disabled = false }: Props = $props();

  let open = $state<{ index: number; keyboard: boolean } | null>(null);
  let bar: HTMLElement;
  let buttons: HTMLButtonElement[] = $state([]);
  let anchor = $state({ x: 0, y: 0 });

  function show(index: number, keyboard: boolean) {
    const b = buttons[index];
    if (!b) return;
    const r = b.getBoundingClientRect();
    anchor = { x: r.left, y: r.bottom + 6 };
    open = { index, keyboard };
  }

  function close() {
    open = null;
  }

  onMount(() => {
    let altAlone = false;
    const down = (e: PointerEvent) => {
      if (!open) return;
      const t = e.target as Node;
      if (bar.contains(t) || (t instanceof Element && t.closest(".menu"))) return;
      close();
    };
    const keydown = (e: KeyboardEvent) => {
      if (disabled) {
        altAlone = false;
        return;
      }
      if (e.key === "Alt") {
        altAlone = !e.repeat;
        return;
      }
      altAlone = false;
      if (e.key === "F10" && !e.shiftKey) {
        e.preventDefault();
        if (open) close();
        else show(0, true);
      }
    };
    const keyup = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone || disabled) return;
      altAlone = false;
      e.preventDefault();
      if (open) close();
      else show(0, true);
    };
    const blur = () => close();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  });
</script>

<nav class="bar" aria-label="Application menu" bind:this={bar}>
  {#each menus as m, i (m.label)}
    <button
      type="button"
      class:on={open?.index === i}
      aria-haspopup="menu"
      aria-expanded={open?.index === i}
      bind:this={buttons[i]}
      onclick={() => (open?.index === i ? close() : show(i, false))}
      onpointerenter={() => {
        if (open && open.index !== i) show(i, false);
      }}
    >
      {m.label}
    </button>
  {/each}
</nav>

{#if open}
  {#key open.index}
    <MenuPopup
      items={menus[open.index].items}
      x={anchor.x}
      y={anchor.y}
      initialIndex={open.keyboard ? 0 : -1}
      menu={open.index}
      menuCount={menus.length}
      onClose={close}
      onSwitchMenu={(i) => show(i, true)}
    />
  {/key}
{/if}

<style>
  .bar {
    height: 32px;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    background: var(--app);
    border-bottom: 1px solid var(--bd);
    flex-shrink: 0;
  }
  button {
    height: 26px;
    padding: 0 10px;
    border: none;
    background: transparent;
    color: var(--tx2);
    border-radius: 5px;
  }
  button:hover,
  button.on {
    background: var(--tab-on);
    color: var(--tx);
  }
</style>
