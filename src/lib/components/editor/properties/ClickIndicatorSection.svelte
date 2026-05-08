<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();
</script>

<div class="flex items-center justify-between gap-2">
  <span class="text-xs text-muted-foreground">Show indicator</span>
  <Checkbox checked={fabricCanvas.clickIndicatorVisible} onCheckedChange={() => fabricCanvas.toggleClickIndicator()} />
</div>
