<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Bold, Italic, Underline } from '@lucide/svelte';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Style</p>
  <div class="flex gap-1">
    <Button
      variant={fabricCanvas.fontBold ? 'default' : 'outline'}
      size="icon-sm"
      class="flex-1"
      aria-label="Bold"
      title="Bold"
      onclick={() => fabricCanvas.setFontBold(!fabricCanvas.fontBold)}
    >
      <Bold />
    </Button>
    <Button
      variant={fabricCanvas.fontItalic ? 'default' : 'outline'}
      size="icon-sm"
      class="flex-1"
      aria-label="Italic"
      title="Italic"
      onclick={() => fabricCanvas.setFontItalic(!fabricCanvas.fontItalic)}
    >
      <Italic />
    </Button>
    <Button
      variant={fabricCanvas.fontUnderline ? 'default' : 'outline'}
      size="icon-sm"
      class="flex-1"
      aria-label="Underline"
      title="Underline"
      onclick={() => fabricCanvas.setFontUnderline(!fabricCanvas.fontUnderline)}
    >
      <Underline />
    </Button>
  </div>
</div>
