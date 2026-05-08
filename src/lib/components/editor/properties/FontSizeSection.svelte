<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const fontSizes = [
    { label: 'S', value: 2 },
    { label: 'M', value: 4 },
    { label: 'L', value: 8 },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Size</p>
  <div class="flex gap-1">
    {#each fontSizes as s}
      <Button
        variant={fabricCanvas.strokeWidth === s.value ? 'default' : 'outline'}
        size="icon-sm"
        class="flex-1"
        aria-label="Font size {s.label}"
        title="Font size {s.label}"
        onclick={() => fabricCanvas.setStrokeWidth(s.value)}
      >
        <span class="text-xs font-semibold leading-none">{s.label}</span>
      </Button>
    {/each}
  </div>
</div>
