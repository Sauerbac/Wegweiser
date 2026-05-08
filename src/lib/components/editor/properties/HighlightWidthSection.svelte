<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const presets: { label: string; value: number }[] = [
    { label: 'S', value: 16 },
    { label: 'M', value: 24 },
    { label: 'L', value: 36 },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Highlight width</p>
  <div class="flex gap-1">
    {#each presets as p}
      <Button
        variant={fabricCanvas.highlightWidth === p.value ? 'default' : 'outline'}
        size="sm"
        class="flex-1"
        aria-label="Highlight width {p.value}"
        onclick={() => fabricCanvas.setHighlightWidth(p.value)}
      >{p.label}</Button>
    {/each}
  </div>
</div>
