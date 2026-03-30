<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import ColorPicker from './ColorPicker.svelte';
  import StrokeWidthPicker from './StrokeWidthPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';

  interface Props {
    color: string;
    strokeWidth: number;
    opacity: number;
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
  }

  let { color, strokeWidth, opacity, oncolorChange, onstrokeWidthChange, onopacityChange }: Props =
    $props();
</script>

<ColorPicker label="Color" value={color} onchange={oncolorChange} />

<Separator />

<StrokeWidthPicker value={strokeWidth} onchange={onstrokeWidthChange} />

<Separator />

<OpacitySlider value={opacity} onchange={onopacityChange} />
