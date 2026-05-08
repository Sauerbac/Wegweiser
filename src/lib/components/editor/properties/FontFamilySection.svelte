<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const fonts = [
    { family: 'system-ui, -apple-system, sans-serif', label: 'Sans', style: 'font-family: Arial, sans-serif;' },
    { family: 'Georgia, serif', label: 'Serif', style: 'font-family: Georgia, serif;' },
    { family: 'Courier New, monospace', label: 'Mono', style: 'font-family: Courier New, monospace;' },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Font</p>
  <div class="flex gap-1">
    {#each fonts as f}
      <Button
        variant={fabricCanvas.fontFamily === f.family ? 'default' : 'outline'}
        size="icon-sm"
        class="flex-1"
        aria-label={f.label}
        title={f.label}
        onclick={() => fabricCanvas.setFontFamily(f.family)}
      >
        <span class="text-xs font-semibold leading-none" style={f.style}>A</span>
      </Button>
    {/each}
  </div>
</div>
