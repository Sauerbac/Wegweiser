<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { AlignLeft, AlignCenter, AlignRight } from '@lucide/svelte';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Alignment</p>
  <div class="flex gap-1">
    <Button
      variant={fabricCanvas.textAlign === 'left' ? 'default' : 'outline'}
      size="icon-sm"
      class="flex-1"
      aria-label="Align left"
      title="Align left"
      onclick={() => fabricCanvas.setTextAlign('left')}
    >
      <AlignLeft />
    </Button>
    <Button
      variant={fabricCanvas.textAlign === 'center' ? 'default' : 'outline'}
      size="icon-sm"
      class="flex-1"
      aria-label="Align center"
      title="Align center"
      onclick={() => fabricCanvas.setTextAlign('center')}
    >
      <AlignCenter />
    </Button>
    <Button
      variant={fabricCanvas.textAlign === 'right' ? 'default' : 'outline'}
      size="icon-sm"
      class="flex-1"
      aria-label="Align right"
      title="Align right"
      onclick={() => fabricCanvas.setTextAlign('right')}
    >
      <AlignRight />
    </Button>
  </div>
</div>
