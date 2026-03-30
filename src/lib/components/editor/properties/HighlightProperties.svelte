<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';

  interface Props {
    color: string;
    opacity: number;
    oncolorChange: (c: string) => void;
    onopacityChange: (o: number) => void;
  }

  let { color, opacity, oncolorChange, onopacityChange }: Props = $props();
</script>

<ColorPicker label="Color" value={color} onchange={oncolorChange} />

<Separator />

<OpacitySlider value={opacity} onchange={onopacityChange} />
