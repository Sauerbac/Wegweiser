<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const presets: { label: string; value: number[] | null; dasharray: string }[] = [
    { label: 'Solid', value: null, dasharray: '' },
    { label: 'Dashed', value: [8, 4], dasharray: '4 2' },
    { label: 'Dotted', value: [2, 4], dasharray: '1.5 2' },
  ];

  function isActive(preset: typeof presets[number]): boolean {
    const current = fabricCanvas.strokeDashArray;
    if (preset.value === null) return current === null;
    return Array.isArray(current) && current[0] === preset.value[0];
  }
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Stroke style</p>
  <div class="flex gap-1">
    {#each presets as preset}
      <Button
        variant={isActive(preset) ? 'default' : 'outline'}
        size="icon-sm"
        class="flex-1"
        aria-label={preset.label}
        title={preset.label}
        onclick={() => fabricCanvas.setStrokeDashArray(preset.value)}
      >
        <svg viewBox="0 0 16 16" class="size-4">
          <line
            x1="2" y1="8" x2="14" y2="8"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-dasharray={preset.dasharray || undefined}
          />
        </svg>
      </Button>
    {/each}
  </div>
</div>
