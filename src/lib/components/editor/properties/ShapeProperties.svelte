<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import ColorPicker from './ColorPicker.svelte';
  import StrokeWidthPicker from './StrokeWidthPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';

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

  const presetColors = [
    '#ef4444',
    '#3b82f6',
    '#22c55e',
    '#eab308',
    '#f97316',
    '#ffffff',
    '#000000',
  ];

  const fillIsTransparent = $derived(!fillEnabled);
</script>

<ColorPicker label="Stroke" value={color} allowTransparent onchange={oncolorChange} />

<Separator />

<!-- Fill -->
<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Fill</p>
  <div class="flex flex-wrap gap-1">
    <button
      class="relative size-6 overflow-hidden rounded-full border-2 transition-transform hover:scale-110"
      class:border-foreground={fillIsTransparent}
      class:border-muted-foreground={!fillIsTransparent}
      onclick={() => onfillEnabledChange(false)}
      aria-label="No fill"
      title="No fill"
    >
      <span class="absolute inset-0 bg-white"></span>
      <span
        class="absolute inset-0"
        style="background: linear-gradient(to bottom right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px));"
      ></span>
    </button>
    {#each presetColors as c}
      <button
        class="size-6 rounded-full border-2 transition-transform hover:scale-110"
        class:border-foreground={fillEnabled && fillColor === c}
        class:border-transparent={!(fillEnabled && fillColor === c)}
        style="background: {c};"
        onclick={() => { onfillEnabledChange(true); onfillColorChange(c); }}
        aria-label="Fill color {c}"
      ></button>
    {/each}
  </div>
  <input
    type="color"
    value={fillColor}
    onchange={(e) => { onfillEnabledChange(true); onfillColorChange(e.currentTarget.value); }}
    class="h-7 w-full cursor-pointer rounded border bg-transparent"
  />
</div>

<Separator />

<StrokeWidthPicker value={strokeWidth} onchange={onstrokeWidthChange} />

<Separator />

<OpacitySlider value={opacity} onchange={onopacityChange} />
