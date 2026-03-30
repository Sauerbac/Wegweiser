<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import ColorPicker from './ColorPicker.svelte';
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

  // Reuse strokeWidth as font-size bucket: S=2→24px, M=4→36px, L=8→48px
  const fontSizes = [
    { label: 'S', value: 2 },
    { label: 'M', value: 4 },
    { label: 'L', value: 8 },
  ];
</script>

<ColorPicker label="Color" value={color} onchange={oncolorChange} />

<Separator />

<!-- Font size (reuses strokeWidth state which maps to fontSize in placeText) -->
<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Size</p>
  <div class="flex gap-1">
    {#each fontSizes as s}
      <Button
        variant={strokeWidth === s.value ? 'default' : 'outline'}
        size="sm"
        class="flex-1"
        onclick={() => onstrokeWidthChange(s.value)}
      >
        {s.label}
      </Button>
    {/each}
  </div>
</div>

<Separator />

<OpacitySlider value={opacity} onchange={onopacityChange} />
