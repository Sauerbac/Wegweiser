<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import ColorPicker from './ColorPicker.svelte';
  import StrokeWidthPicker from './StrokeWidthPicker.svelte';
  import OpacitySlider from './OpacitySlider.svelte';

  interface Props {
    color: string;
    strokeWidth: number;
    opacity: number;
    /** Distinct callout group colors currently on the canvas. */
    calloutGroups: string[];
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
  }

  let { color, strokeWidth, opacity, calloutGroups, oncolorChange, onstrokeWidthChange, onopacityChange }: Props =
    $props();
</script>

<!-- strokeWidth controls callout size since radius = strokeWidth * 3 in placeCallout -->
<ColorPicker label="Color" value={color} onchange={oncolorChange} />

{#if calloutGroups.length > 0}
  <Separator />

  <!-- Group picker: click a swatch to continue that group's number sequence -->
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Groups</p>
    <div class="flex flex-wrap gap-1">
      {#each calloutGroups as groupColor}
        <button
          class="size-6 rounded-full border-2 transition-transform hover:scale-110"
          class:border-foreground={color === groupColor}
          class:border-transparent={color !== groupColor}
          style="background: {groupColor};"
          onclick={() => oncolorChange(groupColor)}
          aria-label="Continue group {groupColor}"
          title="Continue {groupColor} group"
        ></button>
      {/each}
    </div>
  </div>
{/if}

<Separator />

<StrokeWidthPicker value={strokeWidth} onchange={onstrokeWidthChange} />

<Separator />

<OpacitySlider value={opacity} onchange={onopacityChange} />
