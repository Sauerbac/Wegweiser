<script lang="ts">
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();
</script>

{#if fabricCanvas.calloutGroups.length > 0}
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Groups</p>
    <div class="flex flex-wrap gap-1">
      {#each fabricCanvas.calloutGroups as groupColor}
        <button
          class="size-6 rounded-full border-2 transition-transform hover:scale-110"
          class:border-foreground={fabricCanvas.color === groupColor}
          class:border-transparent={fabricCanvas.color !== groupColor}
          style="background: {groupColor};"
          onclick={() => fabricCanvas.setColor(groupColor)}
          aria-label="Continue group {groupColor}"
          title="Continue {groupColor} group"
        ></button>
      {/each}
    </div>
  </div>
{/if}
