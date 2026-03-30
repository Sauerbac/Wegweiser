<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Trash2 } from '@lucide/svelte';
  import type { AnnotationTool } from '$lib/fabric-canvas.svelte';
  import SelectProperties from './properties/SelectProperties.svelte';
  import ShapeProperties from './properties/ShapeProperties.svelte';
  import ArrowProperties from './properties/ArrowProperties.svelte';
  import TextProperties from './properties/TextProperties.svelte';
  import FreehandProperties from './properties/FreehandProperties.svelte';
  import HighlightProperties from './properties/HighlightProperties.svelte';
  import CalloutProperties from './properties/CalloutProperties.svelte';
  import BlurProperties from './properties/BlurProperties.svelte';

  interface Props {
    tool: AnnotationTool;
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
    tool,
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

<div class="flex w-40 shrink-0 flex-col gap-3 border-l bg-muted/30 p-3">
  {#if tool === 'select'}
    <SelectProperties
      {color}
      {strokeWidth}
      {opacity}
      {fillEnabled}
      {fillColor}
      {hasSelection}
      {oncolorChange}
      {onstrokeWidthChange}
      {onopacityChange}
      {onfillEnabledChange}
      {onfillColorChange}
      {ondelete}
    />
  {:else if tool === 'rectangle' || tool === 'ellipse'}
    <ShapeProperties
      {color}
      {strokeWidth}
      {opacity}
      {fillEnabled}
      {fillColor}
      {oncolorChange}
      {onstrokeWidthChange}
      {onopacityChange}
      {onfillEnabledChange}
      {onfillColorChange}
    />
  {:else if tool === 'arrow'}
    <ArrowProperties
      {color}
      {strokeWidth}
      {opacity}
      {oncolorChange}
      {onstrokeWidthChange}
      {onopacityChange}
    />
  {:else if tool === 'text'}
    <TextProperties
      {color}
      {strokeWidth}
      {opacity}
      {oncolorChange}
      onstrokeWidthChange={onstrokeWidthChange}
      {onopacityChange}
    />
  {:else if tool === 'freehand'}
    <FreehandProperties
      {color}
      {strokeWidth}
      {opacity}
      {oncolorChange}
      {onstrokeWidthChange}
      {onopacityChange}
    />
  {:else if tool === 'highlight'}
    <HighlightProperties {color} {opacity} {oncolorChange} {onopacityChange} />
  {:else if tool === 'callout'}
    <CalloutProperties
      {color}
      {strokeWidth}
      {opacity}
      {oncolorChange}
      {onstrokeWidthChange}
      {onopacityChange}
    />
  {:else if tool === 'blur'}
    <BlurProperties />
  {:else if tool === 'crop' || tool === 'window'}
    <!-- No properties for crop / window select tools -->
    <p class="text-xs text-muted-foreground">No properties for this tool.</p>
  {/if}
</div>
