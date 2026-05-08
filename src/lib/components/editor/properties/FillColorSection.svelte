<script lang="ts">
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';
  import FillColorPicker from './FillColorPicker.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();
</script>

<FillColorPicker
  fillEnabled={fabricCanvas.fillEnabled}
  fillColor={fabricCanvas.fillColor}
  onfillEnabledChange={(enabled) => fabricCanvas.setFillEnabled(enabled)}
  onfillColorChange={(c) => fabricCanvas.setFillColor(c)}
/>
