<script lang="ts">
  // Adding one of your own text stamps: its wording (fields as chips), its colour, then Add. The
  // one control for it, in the stamp grid (where Add also arms it to place) and in Manage stamps,
  // where `cells` lays it out as a row of the dialog's table: a live preview, the wording, the
  // colour and Add in its columns, the field buttons under the wording.
  import { type Rgb } from "../../markup/types";
  import { OWN_TEXT_COLOUR, cleanLabel } from "../../markup/stamps";
  import ColourSwatches from "../ColourSwatches.svelte";
  import FieldChips from "./FieldChips.svelte";
  import FieldInput from "./FieldInput.svelte";
  import StampLikeness from "./StampLikeness.svelte";
  import RowIcon from "./RowIcons.svelte";

  interface Props {
    onAdd: (label: string, colour: Rgb) => void;
    /** What a field would say now (a chip's tooltip). */
    fieldValue?: (field: string) => string;
    /** Esc with nothing typed (the grid closes it). */
    onCancel?: () => void;
    autofocus?: boolean;
    /** As cells of Manage stamps' table (five columns), not a block of its own. */
    cells?: boolean;
  }
  let p: Props = $props();

  let wording = $state("");
  let colour = $state<Rgb>(OWN_TEXT_COLOUR);
  let input = $state<FieldInput>();
  /** Shown again (emptied) after each Add. */
  let round = $state(0);

  function add() {
    const label = cleanLabel(wording);
    if (!label) return;
    wording = "";
    round++;
    p.onAdd(label, colour);
  }
</script>

{#snippet field()}
  {#key round}
    <FieldInput
      bind:this={input}
      label="A new text stamp's wording"
      placeholder="New wording"
      maxlength={60}
      caps
      autofocus={p.autofocus || round > 0}
      value=""
      preview={p.fieldValue}
      onInput={(v) => (wording = v)}
      onCommit={() => {}}
      onCancel={() => !wording && p.onCancel?.()}
    />
  {/key}
{/snippet}

{#snippet addButton()}
  <button type="button" class="icon-btn" disabled={!cleanLabel(wording)} aria-label="Add this text stamp" title="Add" onclick={add}><RowIcon icon="add" /></button>
{/snippet}

{#if p.cells}
  <span class="cell like">
    {#if cleanLabel(wording)}<StampLikeness content={{ type: "text", label: cleanLabel(wording), sub: null, colour }} size={10} sub={false} maxWidth={110} />{:else}<span class="new-frame" aria-hidden="true"></span>{/if}
  </span>
  <span class="cell">{@render field()}</span>
  <span class="cell"></span>
  <span class="cell"><ColourSwatches value={colour} onPick={(c) => (colour = c)} label="The new stamp's colour" /></span>
  <span class="cell end">{@render addButton()}</span>
  <span class="cell bare"></span>
  <span class="cell bare chips"><FieldChips onField={(f) => input?.insert(f)} /></span>
{:else}
  <div class="adder">
    <div class="line">
      {@render field()}
      {@render addButton()}
    </div>
    <ColourSwatches value={colour} onPick={(c) => (colour = c)} label="The new stamp's colour" />
    <FieldChips onField={(f) => input?.insert(f)} />
  </div>
{/if}

<style>
  .adder {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  /* Cells of Manage stamps' table (the same as its own cells). */
  .cell {
    display: flex;
    align-items: center;
    min-width: 0;
    height: 44px;
    padding: 0 6px;
    border-bottom: 1px solid var(--bd);
  }
  .cell.like {
    justify-content: center;
  }
  .cell.end {
    justify-content: flex-end;
  }
  .cell.bare {
    height: auto;
    padding-top: 6px;
    padding-bottom: 8px;
    border-bottom: none;
  }
  .chips {
    grid-column: 2 / -1;
  }
  /* A new row's empty preview (as Manage stamps' "new picture" row). */
  .new-frame {
    width: 72px;
    height: 24px;
    border: 1px dashed var(--bd-strong);
    border-radius: 3px;
  }
</style>
