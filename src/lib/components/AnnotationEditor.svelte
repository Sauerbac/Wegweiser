<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { untrack } from 'svelte';
  import { getReviewContext } from '$lib/review/context.svelte';
  import type { Step, WindowRect } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
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
    /** Fabric.js undo snapshot stack to restore on init (from prior editor session). */
    initialFabricUndoStack?: string[];
    /** Fabric.js redo snapshot stack to restore on init (from prior editor session). */
    initialFabricRedoStack?: string[];
    /** Called when the editor closes, to persist the snapshot stacks for next reopen. */
    onsaveFabricSnapshots?: (undoStack: string[], redoStack: string[]) => void;
    /** Called after the editor has consumed the initial snapshot stacks. */
    onclearPendingFabricSnapshots?: () => void;
    /**
     * Called from handleClose() after depth has been incremented and
     * save_annotations has completed. Lets the Review undo store record the
     * session close at the correct depth before open is set to false.
     */
    onsessionclose?: (finalDepth: number) => void;
  }

  let {
    step,
    extraIndex = undefined,
    open = $bindable(false),
    depth = $bindable(0),
    redoDepth = $bindable(0),
    undoTick = 0,
    redoTick = 0,
    initialFabricUndoStack = [],
    initialFabricRedoStack = [],
    onsaveFabricSnapshots,
    onclearPendingFabricSnapshots,
    onsessionclose,
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
    arrow: 'Drag for a quick arrow, or click to start a multi-segment polyline.',
    rectangle: 'Click and drag to draw a rectangle.',
    ellipse: 'Click and drag to draw an ellipse.',
    freehand: 'Draw freely with the mouse.',
    text: 'Click to place a text label.',
    highlight: 'Draw freehand highlight strokes.',
    callout: 'Click to place a numbered callout.',
    obfuscation: 'Click and drag to apply blur or pixelate to a region.',
    crop: 'Click and drag to set the crop region.',
    'click-indicator': 'Toggle the click indicator on or off.',
  };

  /** Whether window-select click mode is active (crop tool). */
  let windowSelectActive = $state(false);

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

      // Always register the click position so the indicator tool knows where to
      // place the dot even when restoring from saved annotations_json.
      if (step.click_relative && extraIndex === undefined) {
        fabricCanvas.setClickIndicatorPosition(step.click_relative.x, step.click_relative.y);
      }

      // If the step has saved annotations, restore them.
      if (step.annotations_json) {
        await fabricCanvas.deserialize(step.annotations_json);
      } else if (step.click_relative && extraIndex === undefined) {
        // Fresh step with no annotations yet — inject an editable click indicator
        // at the monitor-relative click position so the user can move or delete it.
        fabricCanvas.initClickIndicator(step.click_relative.x, step.click_relative.y);
      }

      // Restore the per-step Fabric.js undo/redo stacks from a prior editor
      // session so that individual annotation operations are undoable on reopen.
      // initialFabricUndoStack is non-empty only when the editor is being
      // reopened for a step that was previously edited.
      if (initialFabricUndoStack.length > 0) {
        fabricCanvas.restoreUndoRedoStacks(initialFabricUndoStack, initialFabricRedoStack);
      } else {
        // Seed the initial baseline: makes canUndo=false and _dirty=false so
        // closing without real edits does not trigger a spurious save_annotations.
        // This is the single snapshot for the initial canvas state (empty, with
        // click indicator, or with restored annotations depending on the branch
        // taken above). Also cancels any pending debounce snapshot from init.
        fabricCanvas.initializeSnapshot();
      }

      // Tell the parent store that we've consumed the pending snapshot stacks
      // so they are not applied again on a subsequent re-render.
      onclearPendingFabricSnapshots?.();

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
        if (fabricCanvas.dirty) {
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

        // Notify the parent of the final depth. pushEditorSession early-returns
        // for depth=0, so this is a no-op when the user closed without saving.
        onsessionclose?.(depth);
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
    // Persist the current Fabric.js undo/redo stacks so they survive the close
    // and can be restored when the editor is reopened for the same step.
    onsaveFabricSnapshots?.(fabricCanvas.getUndoStack(), fabricCanvas.getRedoStack());
    fabricCanvas.dispose();
    initialized = false;
  }

  // ── Tool switching ────────────────────────────────────────────────────────

  function onSetTool(t: AnnotationTool) {
    fabricCanvas.setTool(t);
    // Deactivate window-select click mode when switching tools.
    if (windowSelectActive) {
      deactivateWindowSelect();
    }
  }

  // ── Window select (from Properties panel "Select Window" button) ──────────

  let _windowSelectHandler: ((e: any) => void) | null = null;

  function activateWindowSelect() {
    const canvas = fabricCanvas.getCanvas();
    if (!canvas) return;
    windowSelectActive = true;

    const handler = (e: any) => {
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
      // Deactivate after one selection.
      deactivateWindowSelect();
    };

    _windowSelectHandler = handler;
    canvas.on('mouse:down', handler);
  }

  function deactivateWindowSelect() {
    const canvas = fabricCanvas.getCanvas();
    if (canvas && _windowSelectHandler) {
      canvas.off('mouse:down', _windowSelectHandler);
      _windowSelectHandler = null;
    }
    windowSelectActive = false;
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

    // When Fabric.js IText is in editing mode its hidden textarea has focus.
    // Keys that would scroll the outer container (Enter, Space, arrow keys,
    // Page Up/Down) must be stopped here so they don't bubble to the scroll
    // container or dialog wrapper.
    if (document.activeElement instanceof HTMLTextAreaElement) {
      // Let Fabric.js handle all keys natively while editing.
      return;
    }

    // Enter: finalize an in-progress arrow polyline.
    if (e.key === 'Enter') {
      if (initialized && fabricCanvas.arrowPolylineMode) {
        e.preventDefault();
        e.stopPropagation();
        fabricCanvas.finalizeArrowPolyline();
        return;
      }
      // Fall through — not consumed.
    }

    // Escape: 3-stage behavior
    //   1. Something selected → deselect only
    //   2. Non-select tool active → switch to select tool
    //   3. Already on select, nothing selected → do nothing (don't close)
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (initialized) {
        // Stage 0: cancel an in-progress shape drag or polyline.
        if (fabricCanvas.cancelDrawing()) return;
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
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="icon-sm"
                aria-label="Undo"
                onclick={() => fabricCanvas.undo()}
                disabled={!fabricCanvas.canUndo || saving}
              ><Undo2 /></Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Undo<span data-slot="kbd">Ctrl+Z</span></Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="outline"
                size="icon-sm"
                aria-label="Redo"
                onclick={() => fabricCanvas.redo()}
                disabled={!fabricCanvas.canRedo || saving}
              ><Redo2 /></Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>Redo<span data-slot="kbd">Ctrl+Y</span></Tooltip.Content>
        </Tooltip.Root>
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
        onsetTool={onSetTool}
      />

      <!-- Canvas area -->
      <!-- tabindex="-1" + outline-none: clicking the canvas transfers browser
           focus here instead of leaving it on the Dialog content div, which
           would cause a focus-visible ring on the overlay on the next keypress. -->
      <div
        bind:this={canvasContainer}
        role="presentation"
        class="relative min-h-0 min-w-0 flex-1 overflow-clip bg-muted/20 outline-none"
        tabindex="-1"
        onmousedown={(e) => {
          // Move focus to the canvas container so the dialog content div does
          // not show a focus-visible ring when the user subsequently presses a key.
          if (e.currentTarget instanceof HTMLElement) e.currentTarget.focus();
        }}
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
        {fabricCanvas}
        hasWindowRects={visibleWindowRects.length > 0}
        onselectWindow={activateWindowSelect}
      />
    </div>

    <!-- Status bar -->
    <div class="flex shrink-0 items-center justify-between border-t px-4 py-1.5">
      <p class="text-xs text-muted-foreground">
        {#if windowSelectActive}
          Click a window border to crop to that window.
        {:else if fabricCanvas.arrowPolylineMode}
          Click to add waypoints. Double-click or press Enter to finish.
        {:else}
          {helpText[fabricCanvas.tool]}
        {/if}
      </p>
      <p class={`text-xs text-muted-foreground ${fabricCanvas.isDrawing ? '' : 'invisible'}`}>
        Press Esc to cancel
      </p>
    </div>
  </Dialog.Content>
</Dialog.Root>
