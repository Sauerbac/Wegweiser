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
  import ObfuscationProperties from './properties/ObfuscationProperties.svelte';
  import CropProperties from './properties/CropProperties.svelte';
  import ClickIndicatorProperties from './properties/ClickIndicatorProperties.svelte';
  import type { ObfuscationEffect } from '$lib/fabric-canvas.svelte';

  interface Props {
    tool: AnnotationTool;
    color: string;
    strokeWidth: number;
    opacity: number;
    fillEnabled: boolean;
    fillColor: string;
    hasSelection: boolean;
    obfuscationEffect: ObfuscationEffect;
    blurRadius: number;
    pixelateBlockSize: number;
    hasWindowRects: boolean;
    indicatorVisible: boolean;
    calloutGroups: string[];
    oncolorChange: (c: string) => void;
    onstrokeWidthChange: (w: number) => void;
    onopacityChange: (o: number) => void;
    onfillEnabledChange: (enabled: boolean) => void;
    onfillColorChange: (c: string) => void;
    ondelete: () => void;
    onobfuscationEffectChange: (effect: ObfuscationEffect) => void;
    onblurRadiusChange: (r: number) => void;
    onpixelateBlockSizeChange: (s: number) => void;
    onselectWindow: () => void;
    onindicatorToggle: () => void;
  }

  let {
    tool,
    color,
    strokeWidth,
    opacity,
    fillEnabled,
    fillColor,
    hasSelection,
    obfuscationEffect,
    blurRadius,
    pixelateBlockSize,
    hasWindowRects,
    indicatorVisible,
    calloutGroups,
    oncolorChange,
    onstrokeWidthChange,
    onopacityChange,
    onfillEnabledChange,
    onfillColorChange,
    ondelete,
    onobfuscationEffectChange,
    onblurRadiusChange,
    onpixelateBlockSizeChange,
    onselectWindow,
    onindicatorToggle,
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
      {calloutGroups}
      {oncolorChange}
      {onstrokeWidthChange}
      {onopacityChange}
    />
  {:else if tool === 'obfuscation'}
    <ObfuscationProperties
      {obfuscationEffect}
      {blurRadius}
      {pixelateBlockSize}
      {onobfuscationEffectChange}
      {onblurRadiusChange}
      {onpixelateBlockSizeChange}
    />
  {:else if tool === 'crop'}
    <CropProperties
      {hasWindowRects}
      {onselectWindow}
    />
  {:else if tool === 'click-indicator'}
    <ClickIndicatorProperties visible={indicatorVisible} ontoggle={onindicatorToggle} />
  {/if}
</div>
