<script lang="ts">
  // The fields a text stamp's wording can hold, as buttons that put one in (as a chip) where the caret is:
  // in the second line's wording (the stamp grid) and a new text stamp's (the grid and Manage
  // stamps alike). The app's own small buttons; a press keeps the focus in the field being typed in.
  import { STAMP_FIELDS } from "../../markup/stamps";

  let { onField, disabled = false }: { onField: (f: string) => void; disabled?: boolean } = $props();
</script>

<div class="fields" role="group" aria-label="Put in a field">
  {#each STAMP_FIELDS as f (f)}
    <button type="button" class="btn small field" {disabled} title="Put in {'{'}{f}{'}'}: filled in when the stamp is placed" onmousedown={(e) => e.preventDefault()} onclick={() => onField(f)}>{f}</button>
  {/each}
</div>

<style>
  .fields {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  /* Lighter than a full button: they only put a field in. */
  .field {
    height: 22px;
    padding: 0 7px;
    font-size: 11px;
    color: var(--tx2);
  }
</style>
