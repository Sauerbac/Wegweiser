<script lang="ts">
  import { Separator } from '$lib/components/ui/separator';
  import { Button } from '$lib/components/ui/button';
  import { Trash2, BringToFront, SendToBack, ChevronUp, ChevronDown } from '@lucide/svelte';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';
  import type { ToolHandler } from '$lib/editor/tools/tool-handler';
  import type { PropertySection } from '$lib/editor/tools/tool-handler';
  import { SECTION_ORDER } from '$lib/editor/property-sections';
  import StrokeColorSection from './properties/StrokeColorSection.svelte';
  import FillColorSection from './properties/FillColorSection.svelte';
  import StrokeWidthSection from './properties/StrokeWidthSection.svelte';
  import StrokeStyleSection from './properties/StrokeStyleSection.svelte';
  import CornerRadiusSection from './properties/CornerRadiusSection.svelte';
  import FontFamilySection from './properties/FontFamilySection.svelte';
  import FontSizeSection from './properties/FontSizeSection.svelte';
  import OpacitySection from './properties/OpacitySection.svelte';
  import CalloutGroupsSection from './properties/CalloutGroupsSection.svelte';
  import ObfuscationSection from './properties/ObfuscationSection.svelte';
  import CropSection from './properties/CropSection.svelte';
  import ClickIndicatorSection from './properties/ClickIndicatorSection.svelte';
  import ArrowHeadsSection from './properties/ArrowHeadsSection.svelte';
  import HighlightWidthSection from './properties/HighlightWidthSection.svelte';
  import HighlightOpacitySection from './properties/HighlightOpacitySection.svelte';

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
   * Determine which tool handlers should drive the property sections.
   * - When objects are selected: handlers for each distinct selected object type.
   * - When nothing selected: the active tool's handler (for "next new object" defaults).
   */
  let panelHandlers = $derived.by<ToolHandler[]>(() => {
    // Both getters below are plain getters with no $state reads of their own, so
    // reading the two backing state fields here forces re-derivation on any change.
    void fabricCanvas.selectedCount;
    void fabricCanvas.tool;
    const selected = fabricCanvas.selectedObjectHandlers;
    if (selected.length > 0) return selected;
    const active = fabricCanvas.activeToolHandler;
    return active ? [active] : [];
  });

  /**
   * Active sections: union of all handlers' declared sections.
   * Each handler's applyProperties only touches its own properties, so
   * sections irrelevant to a given selected object are silently ignored.
   */
  let activeSections = $derived.by<Set<PropertySection>>(() => {
    const handlers = panelHandlers;
    if (handlers.length === 0) return new Set<PropertySection>();
    const union = new Set<PropertySection>();
    for (const h of handlers) {
      for (const s of h.propertySections) union.add(s);
    }
    return union;
  });

  /** Sections that will actually render (in order). */
  let visibleSections = $derived(SECTION_ORDER.filter((s) => activeSections.has(s)));

  let hasSelection = $derived(fabricCanvas.selectedCount > 0);

  let isEmpty = $derived(
    panelHandlers.length === 0 ||
    (panelHandlers.length === 1 && panelHandlers[0].propertySections.length === 0 && !hasSelection),
  );

  // --- Scroll shadow state ---
  let scrollEl = $state<HTMLDivElement | undefined>(undefined);
  let atTop = $state(true);
  let atBottom = $state(false);

  function checkScroll() {
    if (!scrollEl) return;
    atTop = scrollEl.scrollTop <= 0;
    atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 1;
  }

  $effect(() => {
    // Re-check when the visible sections change (content size may change)
    visibleSections;
    hasSelection;
    checkScroll();
  });
</script>

<div class="flex w-40 shrink-0 flex-col border-l bg-muted/30">
  <div class="relative min-h-0 flex-1">
    <!-- Scrollable content -->
    <div
      bind:this={scrollEl}
      class="h-full overflow-y-auto p-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      onscroll={checkScroll}
    >
      {#if isEmpty}
        <p class="text-xs text-muted-foreground">Select an object to edit its properties.</p>
      {:else}
        <div class="flex flex-col gap-3">
          {#each visibleSections as sectionId, idx}
            {#if idx > 0}
              <Separator />
            {/if}

            {#if sectionId === 'stroke-color'}
              <StrokeColorSection {fabricCanvas} />
            {:else if sectionId === 'fill-color'}
              <FillColorSection {fabricCanvas} />
            {:else if sectionId === 'stroke-width'}
              <StrokeWidthSection {fabricCanvas} />
            {:else if sectionId === 'stroke-style'}
              <StrokeStyleSection {fabricCanvas} />
            {:else if sectionId === 'arrow-heads'}
              <ArrowHeadsSection {fabricCanvas} />
            {:else if sectionId === 'corner-radius'}
              <CornerRadiusSection {fabricCanvas} />
            {:else if sectionId === 'font-family'}
              <FontFamilySection {fabricCanvas} />
            {:else if sectionId === 'font-size'}
              <FontSizeSection {fabricCanvas} />
            {:else if sectionId === 'callout-groups'}
              <CalloutGroupsSection {fabricCanvas} />
            {:else if sectionId === 'obfuscation'}
              <ObfuscationSection {fabricCanvas} />
            {:else if sectionId === 'crop'}
              <CropSection {hasWindowRects} {onselectWindow} />
            {:else if sectionId === 'click-indicator'}
              <ClickIndicatorSection {fabricCanvas} />
            {:else if sectionId === 'highlight-width'}
              <HighlightWidthSection {fabricCanvas} />
            {:else if sectionId === 'highlight-opacity'}
              <HighlightOpacitySection {fabricCanvas} />
            {:else if sectionId === 'opacity'}
              <OpacitySection {fabricCanvas} />
            {/if}
          {/each}

          <!-- Layer order controls — shown whenever at least one object is selected -->
          {#if hasSelection}
            <Separator />
            <div class="space-y-1.5">
              <p class="text-xs font-medium text-muted-foreground">Layers</p>
              <div class="flex gap-1">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Bring to front"
                  title="Bring to front (Ctrl+Shift+])"
                  onclick={() => fabricCanvas.bringToFront()}
                >
                  <BringToFront />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Bring forward"
                  title="Bring forward (])"
                  onclick={() => fabricCanvas.bringForward()}
                >
                  <ChevronUp />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Send backward"
                  title="Send backward ([)"
                  onclick={() => fabricCanvas.sendBackwards()}
                >
                  <ChevronDown />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Send to back"
                  title="Send to back (Ctrl+Shift+[)"
                  onclick={() => fabricCanvas.sendToBack()}
                >
                  <SendToBack />
                </Button>
              </div>
            </div>

            <Separator />
            <Button variant="destructive" size="sm" onclick={() => fabricCanvas.deleteSelected()}>
              <Trash2 />Delete
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Top scroll shadow -->
    <div
      class="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-linear-to-b from-muted/30 to-transparent transition-opacity duration-150"
      class:opacity-0={atTop}
    ></div>
    <!-- Bottom scroll shadow -->
    <div
      class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-linear-to-t from-muted/30 to-transparent transition-opacity duration-150"
      class:opacity-0={atBottom}
    ></div>
  </div>
</div>
