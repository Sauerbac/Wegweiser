<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import ColorPicker from './ColorPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';

  interface Props {
    color: string;
    strokeWidth: number;
    opacity: number;
    fontFamily: string;
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
    onfontFamilyChange: (f: string) => void;
  }

  let { color, strokeWidth, opacity, fontFamily, oncolorChange, onstrokeWidthChange, onopacityChange, onfontFamilyChange }: Props =
    $props();

  // Reuse strokeWidth as font-size bucket: S=2→24px, M=4→36px, L=8→48px
  const fontSizes = [
    { label: 'S', value: 2 },
    { label: 'M', value: 4 },
    { label: 'L', value: 8 },
  ];

  const fonts: { family: string; label: string }[] = [
    { family: 'system-ui, -apple-system, sans-serif', label: 'System Default' },
    { family: 'Arial', label: 'Arial' },
    { family: 'Calibri', label: 'Calibri' },
    { family: 'Cambria', label: 'Cambria' },
    { family: 'Comic Sans MS', label: 'Comic Sans MS' },
    { family: 'Courier New', label: 'Courier New' },
    { family: 'Georgia', label: 'Georgia' },
    { family: 'Impact', label: 'Impact' },
    { family: 'Segoe UI', label: 'Segoe UI' },
    { family: 'Tahoma', label: 'Tahoma' },
    { family: 'Times New Roman', label: 'Times New Roman' },
    { family: 'Trebuchet MS', label: 'Trebuchet MS' },
    { family: 'Verdana', label: 'Verdana' },
  ];
</script>

<ColorPicker label="Color" value={color} onchange={oncolorChange} />

<Separator />

<!-- Font family -->
<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Font</p>
  <select
    value={fontFamily}
    onchange={(e) => onfontFamilyChange(e.currentTarget.value)}
    class="w-full rounded border bg-background px-1.5 py-1 text-xs text-foreground"
  >
    {#each fonts as f}
      <option value={f.family} style="font-family: {f.family};">{f.label}</option>
    {/each}
  </select>
</div>

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
