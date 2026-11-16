<script module lang="ts">
  // The icons a library row's buttons use (Manage stamps, and the add rows): a plus and a bin.
  // Drawn in currentColor, 16 x 16.
  export type RowIcon = "add" | "delete";
</script>

<script lang="ts">
  let { icon }: { icon: RowIcon } = $props();
</script>

<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
  {#if icon === "add"}
    <path d="M8 3v10M3 8h10" />
  {:else}
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
  {/if}
</svg>
