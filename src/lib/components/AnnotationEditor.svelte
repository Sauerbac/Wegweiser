<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { untrack } from 'svelte';
  import { getReviewContext } from '$lib/stores/review-context.svelte';
  import type { Step, WindowRect } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Undo2, Redo2, X } from '@lucide/svelte';
  import AnnotationToolbar from '$lib/components/AnnotationToolbar.svelte';
  import PropertiesPanel from '$lib/components/editor/PropertiesPanel.svelte';
  import { FabricCanvasWrapper, type AnnotationTool } from '$lib/fabric-canvas.svelte';
  import { clipRect } from '$lib/utils';
  import { handleEditorKeyDown } from '$lib/editor/keyboard-shortcuts';

  interface Props {
    step: Step;
    extraIndex?: number;
    open: boolean;
    depth: number;
    redoDepth: number;
    undoTick: number;
    redoTick: number;
  }

  let {
    step,
    extraIndex = undefined,
    open = $bindable(false),
    depth = $bindable(0),
    redoDepth = $bindable(0),
    undoTick = 0,
    redoTick = 0,
  }: Props = $props();

  const { imageStore } = getReviewContext();

  const fabricCanvas = new FabricCanvasWrapper();
  let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
  let canvasContainer = $state<HTMLElement | undefined>(undefined);
  let initialized = $state(false);
  let errorMsg = $state<string | null>(null);
  let saving = $state(false);
  let closing = false;

  /** The data URI for the base image (un-annotated, for editor background). */
  let imageUri = $derived.by(() => {
    if (extraIndex !== undefined) {
      const key = imageStore.extraImageKey(step.id, extraIndex, step.image_version ?? 0);
      return imageStore.extraImageCache[key] ?? null;
    }
    // Prefer the base image (without annotations baked in) if available.
    const baseKey = imageStore.baseImageKey(step);
    if (imageStore.baseImageCache[baseKey]) {
      return imageStore.baseImageCache[baseKey];
    }
    // Fall back to display cache (which is the base when no annotations exist).
    const key = imageStore.imageCacheKey(step);
    return imageStore.imageCache[key] ?? null;
  });

  /** Visible window rects (for the Window Select tool). */
  let visibleWindowRects = $derived.by<WindowRect[]>(() => {
    const iw = fabricCanvas.imageWidth;
    const ih = fabricCanvas.imageHeight;
    if (iw === 0 || ih === 0) return step.window_rects ?? [];
    return (step.window_rects ?? []).filter(
      (wr) =>
        wr.x < iw &&
        wr.y < ih &&
        wr.x + wr.w > 0 &&
        wr.y + wr.h > 0,
    );
  });

  /** Help text per tool. */
  const helpText: Record<AnnotationTool, string> = {
    select: 'Click an annotation to select it. Drag to move, use handles to resize.',
    arrow: 'Click and drag to draw an arrow.',
    rectangle: 'Click and drag to draw a rectangle.',
    ellipse: 'Click and drag to draw an ellipse.',
    freehand: 'Draw freely with the mouse.',
    text: 'Click to place a text label.',
    highlight: 'Click and drag to draw a highlight area.',
    callout: 'Click to place a numbered callout.',
    blur: 'Click and drag to pixelate a region.',
    crop: 'Click and drag to define the crop area. Adjust handles afterward.',
    window: 'Click a highlighted window border to crop to that window.',
  };

  // ── Initialize Fabric.js when dialog opens ────────────────────────────────

  $effect(() => {
    if (open && canvasEl && imageUri && !initialized) {
      initCanvas();
    }
  });

  // ── Observe container size and update Fabric.js zoom ──────────────────────

  $effect(() => {
    const container = canvasContainer;
    if (!container || !initialized) return;

    const obs = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      fabricCanvas.updateFit(width, height);
    });
    obs.observe(container);

    // Initial fit.
    const rect = container.getBoundingClientRect();
    fabricCanvas.updateFit(rect.width, rect.height);

    return () => obs.disconnect();
  });

  async function initCanvas() {
    if (!canvasEl || !imageUri) return;
    try {
      await fabricCanvas.init(canvasEl, imageUri);
      initialized = true;

      // If the step has saved annotations, restore them.
      if (step.annotations_json) {
        await fabricCanvas.deserialize(step.annotations_json);
      }

      // Set initial tool.
      fabricCanvas.setTool('select');
    } catch (err) {
      errorMsg = `Failed to initialize editor: ${err}`;
    }
  }

  // ── Handle dialog close: save annotations ─────────────────────────────────

  async function handleClose() {
    if (closing) return;
    closing = true;

    try {
      if (initialized) {
        saving = true;
        errorMsg = null;

        try {
          const json = fabricCanvas.serialize();
          const hasContent = fabricCanvas.hasAnnotations;

          let previewBase64: string | null = null;
          if (hasContent) {
            const dataUrl = fabricCanvas.toDataURL();
            // Strip data:image/png;base64, prefix.
            previewBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
          }

          // Clear cache so the new preview loads.
          imageStore.clearStepImageCache(step.id);

          await invoke('save_annotations', {
            stepId: step.id,
            annotationsJson: hasContent ? json : null,
            previewPngBase64: previewBase64,
            extraIndex: extraIndex ?? null,
          });

          // Increment depth so Review-level undo covers this save.
          depth += 1;
          redoDepth = 0;
        } catch (err) {
          console.error('Failed to save annotations:', err);
          errorMsg = `Failed to save annotations: ${err}`;
          // Still close the editor even on save failure.
        }

        saving = false;
      }

      cleanup();
      open = false;
    } finally {
      // Always reset the re-entrancy guard, even if an unexpected error occurs.
      closing = false;
    }
  }

  /** Cleanup Fabric.js on close. */
  function cleanup() {
    fabricCanvas.dispose();
    initialized = false;
  }

  // ── Tool switching ────────────────────────────────────────────────────────

  function onSetTool(t: AnnotationTool) {
    fabricCanvas.setTool(t);

    // Window select: set up click handler for window rects.
    if (t === 'window') {
      setupWindowClickHandler();
    }
  }

  /** Set up a click handler for window selection. */
  function setupWindowClickHandler() {
    const canvas = fabricCanvas.getCanvas();
    if (!canvas) return;

    const handler = (e: any) => {
      if (fabricCanvas.tool !== 'window') {
        canvas.off('mouse:down', handler);
        return;
      }
      const pointer = canvas.getScenePoint(e.e);
      const px = pointer.x;
      const py = pointer.y;

      // Find topmost visible window rect that contains the click.
      const hit = visibleWindowRects.find((wr) => {
        const c = clipRect(wr, fabricCanvas.imageWidth, fabricCanvas.imageHeight);
        return c !== null && px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;
      });

      if (hit) {
        const clipped = clipRect(hit, fabricCanvas.imageWidth, fabricCanvas.imageHeight);
        if (clipped) {
          fabricCanvas.setCropFromRect(clipped.x, clipped.y, clipped.w, clipped.h);
        }
      }
    };

    canvas.on('mouse:down', handler);
  }

  // ── Undo/redo from parent ticks ───────────────────────────────────────────

  let prevUndoTick = untrack(() => undoTick);
  let prevRedoTick = untrack(() => redoTick);

  $effect(() => {
    if (undoTick !== prevUndoTick) {
      prevUndoTick = undoTick;
      fabricCanvas.undo();
    }
  });

  $effect(() => {
    if (redoTick !== prevRedoTick) {
      prevRedoTick = redoTick;
      fabricCanvas.redo();
    }
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  async function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    // Escape: 3-stage behavior
    //   1. Something selected → deselect only
    //   2. Non-select tool active → switch to select tool
    //   3. Already on select, nothing selected → do nothing (don't close)
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (initialized) {
        // If an IText is actively being edited, let Fabric.js handle Escape
        // (it exits editing mode and keeps the object selected).
        if (document.activeElement instanceof HTMLTextAreaElement) return;
        const hasSelection = !!fabricCanvas.getCanvas()?.getActiveObject();
        if (hasSelection) {
          fabricCanvas.discardSelection();
          return;
        }
        if (fabricCanvas.tool !== 'select') {
          onSetTool('select');
          return;
        }
        // Nothing selected and already on select → do nothing.
      }
      return;
    }

    // All other shortcuts — delegate to the shared shortcuts module.
    const consumed = await handleEditorKeyDown(e, {
      canvas: fabricCanvas,
      initialized,
      setTool: onSetTool,
    });
    if (consumed) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<Dialog.Root
  bind:open
  onOpenChange={(isOpen) => { if (!isOpen) handleClose(); }}
>
  <Dialog.Content
    class="flex h-[90vh] w-[90vw] max-w-none sm:max-w-none flex-col gap-0 p-0"
    showCloseButton={false}
    escapeKeydownBehavior="ignore"
  >
    <!-- Header -->
    <div class="flex shrink-0 items-center justify-between border-b px-4 py-2">
      <Dialog.Title class="text-sm font-medium">
        Edit Image — Step {step.order}
      </Dialog.Title>
      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Undo"
          onclick={() => fabricCanvas.undo()}
          disabled={!fabricCanvas.canUndo || saving}
        >
          <Undo2 />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Redo"
          onclick={() => fabricCanvas.redo()}
          disabled={!fabricCanvas.canRedo || saving}
        >
          <Redo2 />
        </Button>
        <Dialog.Close>
          {#snippet child({ props })}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              {...props}
              disabled={saving}
            >
              <X />
            </Button>
          {/snippet}
        </Dialog.Close>
      </div>
    </div>

    {#if errorMsg}
      <p class="shrink-0 px-4 py-1 text-sm text-destructive">{errorMsg}</p>
    {/if}

    <!-- Main body: toolbar | canvas | properties -->
    <div class="flex min-h-0 flex-1">
      <!-- Left toolbar -->
      <AnnotationToolbar
        tool={fabricCanvas.tool}
        hasWindowRects={visibleWindowRects.length > 0}
        onsetTool={onSetTool}
      />

      <!-- Canvas area -->
      <div
        bind:this={canvasContainer}
        class="relative min-h-0 flex-1 overflow-hidden bg-muted/20"
      >
        {#if imageUri}
          <canvas bind:this={canvasEl}></canvas>
        {:else}
          <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading image…
          </div>
        {/if}
      </div>

      <!-- Right properties panel -->
      <PropertiesPanel
        tool={fabricCanvas.tool}
        color={fabricCanvas.color}
        strokeWidth={fabricCanvas.strokeWidth}
        opacity={fabricCanvas.opacity}
        fillEnabled={fabricCanvas.fillEnabled}
        fillColor={fabricCanvas.fillColor}
        hasSelection={fabricCanvas.selectedCount > 0}
        oncolorChange={(c) => fabricCanvas.setColor(c)}
        onstrokeWidthChange={(w) => fabricCanvas.setStrokeWidth(w)}
        onopacityChange={(o) => fabricCanvas.setOpacity(o)}
        onfillEnabledChange={(enabled) => fabricCanvas.setFillEnabled(enabled)}
        onfillColorChange={(c) => fabricCanvas.setFillColor(c)}
        ondelete={() => fabricCanvas.deleteSelected()}
      />
    </div>

    <!-- Status bar -->
    <div class="shrink-0 border-t px-4 py-1.5">
      <p class="text-xs text-muted-foreground">
        {helpText[fabricCanvas.tool]}
      </p>
    </div>
  </Dialog.Content>
</Dialog.Root>
