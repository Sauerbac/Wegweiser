<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import { Trash2 } from '@lucide/svelte';
  import ColorPicker from './ColorPicker.svelte';
  import StrokeWidthPicker from './StrokeWidthPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';
  import FillColorPicker from './FillColorPicker.svelte';

  interface Props {
    color: string;
    strokeWidth: number;
    opacity: number;
    fillEnabled: boolean;
    fillColor: string;
    hasSelection: boolean;
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
    onfillEnabledChange: (enabled: boolean) => void;
    onfillColorChange: (c: string) => void;
    ondelete: () => void;
  }

  let {
    color,
    strokeWidth,
    opacity,
    fillEnabled,
    fillColor,
    hasSelection,
    oncolorChange,
    onstrokeWidthChange,
    onopacityChange,
    onfillEnabledChange,
    onfillColorChange,
    ondelete,
  }: Props = $props();
</script>

{#if hasSelection}
  <ColorPicker label="Color" value={color} allowTransparent onchange={oncolorChange} />

  <Separator />

  <!-- Fill (only shown when selection is active — the parent controls showFill; here we always show) -->
  <FillColorPicker
    {fillEnabled}
    {fillColor}
    {onfillEnabledChange}
    {onfillColorChange}
  />

  <Separator />

  <StrokeWidthPicker value={strokeWidth} onchange={onstrokeWidthChange} />

  <Separator />

  <OpacitySlider value={opacity} onchange={onopacityChange} />

  <Separator />

  <Button variant="destructive" size="sm" onclick={ondelete}>
    <Trash2 />Delete
  </Button>
{:else}
  <p class="text-xs text-muted-foreground">Select an object to edit its properties.</p>

  <Separator />

  <Button variant="destructive" size="sm" disabled onclick={ondelete}>
    <Trash2 />Delete
  </Button>
{/if}
