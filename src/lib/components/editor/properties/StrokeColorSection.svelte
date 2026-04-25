<script lang="ts">
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';
  import ColorPicker from './ColorPicker.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();
</script>

<ColorPicker
  label="Stroke"
  value={fabricCanvas.color}
  allowTransparent={fabricCanvas.selectedCount > 0}
  onchange={(c) => fabricCanvas.setColor(c)}
/>
