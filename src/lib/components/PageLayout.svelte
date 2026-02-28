<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    header: Snippet;
    left: Snippet;
    right: Snippet;
    footer?: Snippet;
    /** Extra classes applied to the header wrapper div. */
    headerClass?: string;
    /** Extra classes applied to the left panel div. */
    leftClass?: string;
    /** Extra classes applied to the right panel div. */
    rightClass?: string;
    /** Extra classes applied to the footer wrapper div. */
    footerClass?: string;
  }

  let {
    header,
    left,
    right,
    footer,
    headerClass = '',
    leftClass = '',
    rightClass = '',
    footerClass = '',
  }: Props = $props();
</script>

<div class="flex h-screen flex-col bg-background text-foreground">
  <!-- header zone -->
  <div class={headerClass}>
    {@render header()}
  </div>

  <!-- two-column body -->
  <div class="flex flex-1 overflow-hidden">
    <!-- left panel -->
    <div class={leftClass}>
      {@render left()}
    </div>
    <!-- right panel -->
    <div class={rightClass}>
      {@render right()}
    </div>
  </div>

  <!-- optional footer -->
  {#if footer}
    <div class={footerClass}>
      {@render footer()}
    </div>
  {/if}
</div>
