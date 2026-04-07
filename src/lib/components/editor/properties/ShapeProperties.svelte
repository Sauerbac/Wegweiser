<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
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
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
    onfillEnabledChange: (enabled: boolean) => void;
    onfillColorChange: (c: string) => void;
  }

  let {
    color,
    strokeWidth,
    opacity,
    fillEnabled,
    fillColor,
    oncolorChange,
    onstrokeWidthChange,
    onopacityChange,
    onfillEnabledChange,
    onfillColorChange,
  }: Props = $props();
</script>

<ColorPicker label="Stroke" value={color} allowTransparent onchange={oncolorChange} />

<Separator />

<!-- Fill -->
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
