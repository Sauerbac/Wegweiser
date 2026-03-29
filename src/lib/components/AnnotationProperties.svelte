<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Separator } from '$lib/components/ui/separator';
  import { Trash2 } from '@lucide/svelte';

  interface Props {
    color: string;
    strokeWidth: number;
    opacity: number;
    hasSelection: boolean;
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
    ondelete: () => void;
  }

  let {
    color,
    strokeWidth,
    opacity,
    hasSelection,
    oncolorChange,
    onstrokeWidthChange,
    onopacityChange,
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

  const strokePresets: { label: string; value: number }[] = [
    { label: 'S', value: 2 },
    { label: 'M', value: 4 },
    { label: 'L', value: 8 },
  ];
</script>

<div class="flex w-40 shrink-0 flex-col gap-3 border-l bg-muted/30 p-3">
  <!-- Color -->
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Color</p>
    <div class="flex flex-wrap gap-1">
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
      value={color}
      onchange={(e) => oncolorChange(e.currentTarget.value)}
      class="h-7 w-full cursor-pointer rounded border bg-transparent"
    />
  </div>

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
