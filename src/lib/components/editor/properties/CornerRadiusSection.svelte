<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const presets = [
    { label: 'Sharp', radius: 0 },
    { label: 'Rounded', radius: 12 },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Corners</p>
  <div class="flex gap-1">
    {#each presets as preset}
      <Button
        variant={fabricCanvas.cornerRadius === preset.radius ? 'default' : 'outline'}
        size="icon-sm"
        class="flex-1"
        aria-label={preset.label}
        title={preset.label}
        onclick={() => fabricCanvas.setCornerRadius(preset.radius)}
      >
        <svg viewBox="0 0 16 16" class="size-4" fill="none">
          {#if preset.radius === 0}
            <rect x="3" y="3" width="10" height="10" stroke="currentColor" stroke-width="1.5" />
          {:else}
            <rect x="3" y="3" width="10" height="10" rx="3" stroke="currentColor" stroke-width="1.5" />
          {/if}
        </svg>
      </Button>
    {/each}
  </div>
</div>
