<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import { Trash2 } from '@lucide/svelte';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';
  import type { ToolHandler } from '$lib/editor/tools/tool-handler';
  import ColorPicker from './properties/ColorPicker.svelte';
  import StrokeWidthPicker from './properties/StrokeWidthPicker.svelte';
  import OpacitySlider from './properties/OpacitySlider.svelte';
  import FillColorPicker from './properties/FillColorPicker.svelte';
  import TextProperties from './properties/TextProperties.svelte';
  import CalloutProperties from './properties/CalloutProperties.svelte';
  import ObfuscationProperties from './properties/ObfuscationProperties.svelte';
  import CropProperties from './properties/CropProperties.svelte';
  import ClickIndicatorProperties from './properties/ClickIndicatorProperties.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
    hasWindowRects: boolean;
    onselectWindow: () => void;
  }

  let {
    fabricCanvas,
    hasWindowRects,
    onselectWindow,
  }: Props = $props();

  /**
   * Determine which tool handlers should show their property panels.
   * - When objects are selected: show panels for each distinct selected object type.
   * - When nothing is selected: show the active tool's panel (for "next new object" defaults).
   */
  let panelHandlers = $derived.by<ToolHandler[]>(() => {
    const selected = fabricCanvas.selectedObjectHandlers;
    if (selected.length > 0) return selected;
    const active = fabricCanvas.activeToolHandler;
    return active ? [active] : [];
  });

  let hasSelection = $derived(fabricCanvas.selectedCount > 0);

  function handleColorChange(c: string) {
    fabricCanvas.setColor(c);
  }

  function handleStrokeWidthChange(w: number) {
    fabricCanvas.setStrokeWidth(w);
  }

  function handleOpacityChange(o: number) {
    fabricCanvas.setOpacity(o);
  }

  function handleFillEnabledChange(enabled: boolean) {
    fabricCanvas.setFillEnabled(enabled);
  }

  function handleFillColorChange(c: string) {
    fabricCanvas.setFillColor(c);
  }

  function handleDelete() {
    fabricCanvas.deleteSelected();
  }
</script>

<div class="flex w-40 shrink-0 flex-col gap-3 border-l bg-muted/30 p-3">
  {#each panelHandlers as handler (handler.toolId)}
    {@const componentId = handler.propertiesComponentId}

    {#if componentId === 'select'}
      <!-- Select tool: show properties of selected object, or placeholder when nothing selected -->
      {#if hasSelection}
        <ColorPicker label="Color" value={fabricCanvas.color} allowTransparent onchange={handleColorChange} />
        <Separator />
        <FillColorPicker
          fillEnabled={fabricCanvas.fillEnabled}
          fillColor={fabricCanvas.fillColor}
          onfillEnabledChange={handleFillEnabledChange}
          onfillColorChange={handleFillColorChange}
        />
        <Separator />
        <StrokeWidthPicker value={fabricCanvas.strokeWidth} onchange={handleStrokeWidthChange} />
        <Separator />
        <OpacitySlider value={fabricCanvas.opacity} onchange={handleOpacityChange} />
        <Separator />
        <Button variant="destructive" size="sm" onclick={handleDelete}>
          <Trash2 />Delete
        </Button>
      {:else}
        <p class="text-xs text-muted-foreground">Select an object to edit its properties.</p>
        <Separator />
        <Button variant="destructive" size="sm" disabled onclick={handleDelete}>
          <Trash2 />Delete
        </Button>
      {/if}

    {:else if componentId === 'shape'}
      <ColorPicker label="Color" value={fabricCanvas.color} onchange={handleColorChange} />
      <Separator />
      <FillColorPicker
        fillEnabled={fabricCanvas.fillEnabled}
        fillColor={fabricCanvas.fillColor}
        onfillEnabledChange={handleFillEnabledChange}
        onfillColorChange={handleFillColorChange}
      />
      <Separator />
      <StrokeWidthPicker value={fabricCanvas.strokeWidth} onchange={handleStrokeWidthChange} />
      <Separator />
      <OpacitySlider value={fabricCanvas.opacity} onchange={handleOpacityChange} />

    {:else if componentId === 'arrow'}
      <ColorPicker label="Color" value={fabricCanvas.color} onchange={handleColorChange} />
      <Separator />
      <StrokeWidthPicker value={fabricCanvas.strokeWidth} onchange={handleStrokeWidthChange} />
      <Separator />
      <OpacitySlider value={fabricCanvas.opacity} onchange={handleOpacityChange} />

    {:else if componentId === 'text'}
      <TextProperties
        color={fabricCanvas.color}
        strokeWidth={fabricCanvas.strokeWidth}
        opacity={fabricCanvas.opacity}
        fontFamily={fabricCanvas.fontFamily}
        oncolorChange={handleColorChange}
        onstrokeWidthChange={handleStrokeWidthChange}
        onopacityChange={handleOpacityChange}
        onfontFamilyChange={(f) => fabricCanvas.setFontFamily(f)}
      />

    {:else if componentId === 'freehand'}
      <ColorPicker label="Color" value={fabricCanvas.color} onchange={handleColorChange} />
      <Separator />
      <StrokeWidthPicker value={fabricCanvas.strokeWidth} onchange={handleStrokeWidthChange} />
      <Separator />
      <OpacitySlider value={fabricCanvas.opacity} onchange={handleOpacityChange} />

    {:else if componentId === 'highlight'}
      <ColorPicker label="Color" value={fabricCanvas.color} onchange={handleColorChange} />
      <Separator />
      <OpacitySlider value={fabricCanvas.opacity} onchange={handleOpacityChange} />

    {:else if componentId === 'callout'}
      <CalloutProperties
        color={fabricCanvas.color}
        strokeWidth={fabricCanvas.strokeWidth}
        opacity={fabricCanvas.opacity}
        calloutGroups={fabricCanvas.calloutGroups}
        oncolorChange={handleColorChange}
        onstrokeWidthChange={handleStrokeWidthChange}
        onopacityChange={handleOpacityChange}
      />

    {:else if componentId === 'obfuscation'}
      <ObfuscationProperties
        obfuscationEffect={fabricCanvas.obfuscationEffect}
        blurRadius={fabricCanvas.blurRadius}
        pixelateBlockSize={fabricCanvas.pixelateBlockSize}
        onobfuscationEffectChange={(effect) => fabricCanvas.setObfuscationEffect(effect)}
        onblurRadiusChange={(r) => fabricCanvas.setBlurRadius(r)}
        onpixelateBlockSizeChange={(s) => fabricCanvas.setPixelateBlockSize(s)}
      />

    {:else if componentId === 'crop'}
      <CropProperties
        {hasWindowRects}
        {onselectWindow}
      />

    {:else if componentId === 'click-indicator'}
      <ClickIndicatorProperties
        visible={fabricCanvas.clickIndicatorVisible}
        ontoggle={() => fabricCanvas.toggleClickIndicator()}
      />
    {/if}
  {/each}

  <!-- Show delete button for multi-select when not already shown by select tool -->
  {#if hasSelection && !panelHandlers.some((h) => h.propertiesComponentId === 'select')}
    <Separator />
    <Button variant="destructive" size="sm" onclick={handleDelete}>
      <Trash2 />Delete
    </Button>
  {/if}
</div>
