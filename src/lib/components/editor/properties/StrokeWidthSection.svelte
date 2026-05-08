<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const presets: { value: number; strokeW: number }[] = [
    { value: 2, strokeW: 1 },
    { value: 4, strokeW: 2.5 },
    { value: 8, strokeW: 4 },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Stroke width</p>
  <div class="flex gap-1">
    {#each presets as s}
      <Button
        variant={fabricCanvas.strokeWidth === s.value ? 'default' : 'outline'}
        size="icon-sm"
        class="flex-1"
        aria-label="Stroke width {s.value}"
        title="Stroke width {s.value}"
        onclick={() => fabricCanvas.setStrokeWidth(s.value)}
      >
        <svg viewBox="0 0 16 16" class="size-4">
          <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" stroke-width={s.strokeW} stroke-linecap="round" />
        </svg>
      </Button>
    {/each}
  </div>
</div>
