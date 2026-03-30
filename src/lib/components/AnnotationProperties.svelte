<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { Trash2 } from '@lucide/svelte';

  interface Props {
    color: string;
    strokeWidth: number;
    opacity: number;
    fillEnabled: boolean;
    fillColor: string;
    hasSelection: boolean;
    showFill: boolean;
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
    showFill,
    oncolorChange,
    onstrokeWidthChange,
    onopacityChange,
    onfillEnabledChange,
    onfillColorChange,
    ondelete,
  }: Props = $props();

  const presetColors = [
    '#ef4444', // red
    '#3b82f6', // blue
    '#22c55e', // green
    '#eab308', // yellow
    '#f97316', // orange
    '#ffffff', // white
    '#000000', // black
  ];

  /** True when the current stroke color is transparent (no stroke). */
  const strokeIsTransparent = $derived(color === 'transparent');

  /** True when fill is disabled (no fill). */
  const fillIsTransparent = $derived(!fillEnabled);

  const strokePresets: { label: string; value: number }[] = [
    { label: 'S', value: 2 },
    { label: 'M', value: 4 },
    { label: 'L', value: 8 },
  ];
</script>

<div class="flex w-40 shrink-0 flex-col gap-3 border-l bg-muted/30 p-3">
  <!-- Stroke Color -->
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Color</p>
    <div class="flex flex-wrap gap-1">
      <!-- Transparent / no stroke swatch -->
      <button
        class="relative size-6 overflow-hidden rounded-full border-2 transition-transform hover:scale-110"
        class:border-foreground={strokeIsTransparent}
        class:border-muted-foreground={!strokeIsTransparent}
        onclick={() => oncolorChange('transparent')}
        aria-label="No stroke color"
        title="No color"
      >
        <span class="absolute inset-0 bg-white"></span>
        <span class="absolute inset-0" style="background: linear-gradient(to bottom right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px));"></span>
      </button>
      {#each presetColors as c}
        <button
          class="size-6 rounded-full border-2 transition-transform hover:scale-110"
          class:border-foreground={color === c}
          class:border-transparent={color !== c}
          style="background: {c};"
          onclick={() => oncolorChange(c)}
          aria-label="Color {c}"
        ></button>
      {/each}
    </div>
    <input
      type="color"
      value={strokeIsTransparent ? '#ef4444' : color}
      onchange={(e) => oncolorChange(e.currentTarget.value)}
      class="h-7 w-full cursor-pointer rounded border bg-transparent"
    />
  </div>

  {#if showFill}
    <Separator />

    <!-- Fill -->
    <div class="space-y-1.5">
      <p class="text-xs font-medium text-muted-foreground">Fill</p>
      <div class="flex flex-wrap gap-1">
        <!-- Transparent / no fill swatch -->
        <button
          class="relative size-6 overflow-hidden rounded-full border-2 transition-transform hover:scale-110"
          class:border-foreground={fillIsTransparent}
          class:border-muted-foreground={!fillIsTransparent}
          onclick={() => onfillEnabledChange(false)}
          aria-label="No fill"
          title="No fill"
        >
          <span class="absolute inset-0 bg-white"></span>
          <span class="absolute inset-0" style="background: linear-gradient(to bottom right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px));"></span>
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
  {/if}

  <Separator />

  <!-- Stroke Width -->
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Stroke</p>
    <div class="flex gap-1">
      {#each strokePresets as s}
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

  <!-- Opacity -->
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Opacity</p>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={opacity}
      oninput={(e) => onopacityChange(Number(e.currentTarget.value))}
      class="w-full"
    />
    <p class="text-center text-xs text-muted-foreground">{Math.round(opacity * 100)}%</p>
  </div>

  <Separator />

  <!-- Delete -->
  <Button
    variant="destructive"
    size="sm"
    disabled={!hasSelection}
    onclick={ondelete}
  >
    <Trash2 />Delete
  </Button>
</div>
