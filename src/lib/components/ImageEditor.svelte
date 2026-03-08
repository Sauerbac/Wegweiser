<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { untrack } from 'svelte';
  import { store } from '$lib/stores/session.svelte';
  import type { Step, WindowRect } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Blend, Crop, MousePointer2, Redo2, RotateCcw, Undo2, X } from '@lucide/svelte';

  /** Read a CSS custom property from the document root (resolves theme variables). */
  function cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  interface Props {
    step: Step;
    /** Set to undefined to edit the primary image; set to index for an extra image. */
    extraIndex?: number;
    open: boolean;
    /**
     * Number of image edits that can be undone in the current editor session.
     * Bound by the parent (Review) so it can read the value on close and set
     * the initial value on open (restoring state after Review-level undo/redo).
     */
    depth: number;
    /**
     * Number of image edits that can be redone in the current editor session.
     * Bound by the parent (Review) so it can restore redo state after a
     * Review-level undo.
     */
    redoDepth: number;
    /**
     * Tick counter incremented by Review when Ctrl+Z is pressed while the editor
     * is open. Each increment triggers an editor undo via a reactive $effect.
     */
    undoTick: number;
    /**
     * Tick counter incremented by Review when Ctrl+Y/Ctrl+Shift+Z is pressed while
     * the editor is open. Each increment triggers an editor redo via a reactive $effect.
     */
    redoTick: number;
  }

  let { step, extraIndex = undefined, open = $bindable(false), depth = $bindable(0), redoDepth = $bindable(0), undoTick = 0, redoTick = 0 }: Props = $props();

  type Tool = 'blur' | 'crop' | 'window';

  let tool = $state<Tool>('blur');
  let canvas = $state<HTMLCanvasElement | undefined>(undefined);
  let isDragging = $state(false);
  let startX = $state(0);
  let startY = $state(0);
  let selRect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let selectedWindowRect = $state<WindowRect | null>(null);
  let applying = $state(false);
  let errorMsg = $state<string | null>(null);

  /** Natural image dimensions (set when the image loads onto canvas). */
  let imgNaturalW = $state(0);
  let imgNaturalH = $state(0);

  /** Scale factor: canvas CSS pixels per image pixel. */
  let scale = $derived(imgNaturalW > 0 ? (canvas?.clientWidth ?? imgNaturalW) / imgNaturalW : 1);

  /** The data URI for the image to display (primary or extra depending on extraIndex). */
  let imageUri = $derived.by(() => {
    if (extraIndex !== undefined) {
      const key = store.extraImageKey(step.id, extraIndex, step.image_version ?? 0);
      return store.extraImageCache[key] ?? null;
    }
    const key = store.imageCacheKey(step);
    return store.imageCache[key] ?? null;
  });

  /**
   * Window rects filtered to those that have at least some overlap with the
   * image canvas (i.e. visible on the monitor where the screenshot was taken).
   * Uses imgNaturalW/H which are set once the image loads onto the canvas.
   */
  let visibleWindowRects = $derived.by<WindowRect[]>(() => {
    if (imgNaturalW === 0 || imgNaturalH === 0) return step.window_rects ?? [];
    return (step.window_rects ?? []).filter(
      (wr) =>
        wr.x < imgNaturalW &&
        wr.y < imgNaturalH &&
        wr.x + wr.w > 0 &&
        wr.y + wr.h > 0,
    );
  });

  /** Convert canvas-local coordinates to image-pixel coordinates. */
  function toImageCoords(cx: number, cy: number): [number, number] {
    const rect = canvas!.getBoundingClientRect();
    const px = ((cx - rect.left) / rect.width) * imgNaturalW;
    const py = ((cy - rect.top) / rect.height) * imgNaturalH;
    return [Math.round(px), Math.round(py)];
  }

  /** Render the base image + current selection overlay onto the canvas. */
  function redraw() {
    if (!canvas || !imageUri) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas!.width = img.naturalWidth;
      canvas!.height = img.naturalHeight;
      imgNaturalW = img.naturalWidth;
      imgNaturalH = img.naturalHeight;
      ctx.drawImage(img, 0, 0);

      // Draw window rects when in window mode.
      // Only show rects that have a visible portion within the image bounds.
      if (tool === 'window') {
        ctx.save();
        const chartColors = [
          cssVar('--chart-1'),
          cssVar('--chart-2'),
          cssVar('--chart-3'),
          cssVar('--chart-4'),
          cssVar('--chart-5'),
        ];
        // Filter to windows that have at least some overlap with the image canvas.
        const visibleRects = step.window_rects.filter(
          (wr) =>
            wr.x < img.naturalWidth &&
            wr.y < img.naturalHeight &&
            wr.x + wr.w > 0 &&
            wr.y + wr.h > 0,
        );
        // Draw back-to-front so the topmost window (index 0) is painted last and
        // appears visually on top of windows behind it.
        // We iterate the indices in reverse so the last (backmost) window is
        // drawn first and the first (topmost) window is drawn on top.
        for (let i = visibleRects.length - 1; i >= 0; i--) {
          const wr = visibleRects[i];
          const color = chartColors[i % chartColors.length];
          // Clip the drawn rect to the image bounds so strokes don't spill outside.
          const cx = Math.max(wr.x, 0);
          const cy = Math.max(wr.y, 0);
          const cw = Math.min(wr.x + wr.w, img.naturalWidth) - cx;
          const ch = Math.min(wr.y + wr.h, img.naturalHeight) - cy;
          if (cw <= 0 || ch <= 0) continue;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(cx, cy, cw, ch);

        }
        ctx.restore();
      }

      // Draw selection rectangle (clipped to image bounds for window selections).
      let active: { x: number; y: number; w: number; h: number } | null = null;
      if (selRect) {
        active = selRect;
      } else if (selectedWindowRect) {
        const cx = Math.max(selectedWindowRect.x, 0);
        const cy = Math.max(selectedWindowRect.y, 0);
        const cw = Math.min(selectedWindowRect.x + selectedWindowRect.w, img.naturalWidth) - cx;
        const ch = Math.min(selectedWindowRect.y + selectedWindowRect.h, img.naturalHeight) - cy;
        if (cw > 0 && ch > 0) active = { x: cx, y: cy, w: cw, h: ch };
      }
      if (active) {
        ctx.save();
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.strokeRect(active.x, active.y, active.w, active.h);
        ctx.fillStyle = 'rgba(249,115,22,0.15)';
        ctx.fillRect(active.x, active.y, active.w, active.h);
        ctx.restore();
      }
    };
    img.src = imageUri;
  }

  $effect(() => {
    // Redraw whenever tool, selection, or the underlying image URI changes
    // (e.g. after an undo/redo that swaps the image version in the cache).
    tool;
    selRect;
    selectedWindowRect;
    imageUri;
    if (open) redraw();
  });

  function onMouseDown(e: MouseEvent) {
    if (tool === 'window') return;
    isDragging = true;
    const rect = canvas!.getBoundingClientRect();
    [startX, startY] = toImageCoords(e.clientX, e.clientY);
    selRect = null;
    selectedWindowRect = null;
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging || tool === 'window') return;
    const [ex, ey] = toImageCoords(e.clientX, e.clientY);
    const x = Math.min(startX, ex);
    const y = Math.min(startY, ey);
    const w = Math.abs(ex - startX);
    const h = Math.abs(ey - startY);
    selRect = { x, y, w, h };
    redraw();
  }

  function onMouseUp(e: MouseEvent) {
    if (tool === 'window') return;
    isDragging = false;
    const [ex, ey] = toImageCoords(e.clientX, e.clientY);
    const x = Math.min(startX, ex);
    const y = Math.min(startY, ey);
    const w = Math.abs(ex - startX);
    const h = Math.abs(ey - startY);
    selRect = w > 2 && h > 2 ? { x, y, w, h } : null;
    redraw();
  }

  function onCanvasClick(e: MouseEvent) {
    if (tool !== 'window') return;
    const [px, py] = toImageCoords(e.clientX, e.clientY);
    // Find topmost visible window rect that contains the click (use clipped bounds).
    // visibleWindowRects is ordered front-to-back (index 0 = topmost), so iterate
    // forward and take the first match — the frontmost window wins.
    const hit = visibleWindowRects.find((wr) => {
      const cx = Math.max(wr.x, 0);
      const cy = Math.max(wr.y, 0);
      const cw = Math.min(wr.x + wr.w, imgNaturalW) - cx;
      const ch = Math.min(wr.y + wr.h, imgNaturalH) - cy;
      return cw > 0 && ch > 0 && px >= cx && px <= cx + cw && py >= cy && py <= cy + ch;
    }) ?? null;
    selectedWindowRect = hit;
    if (hit) selRect = null;
    redraw();
  }

  function resetSelection() {
    selRect = null;
    selectedWindowRect = null;
    redraw();
  }

  function setTool(t: Tool) {
    tool = t;
    selRect = null;
    selectedWindowRect = null;
  }

  /**
   * The active rect to send to the backend (image-pixel coordinates).
   * When a window is selected, the rect is clipped to the image bounds so that
   * the crop operation never requests pixels outside the screenshot.
   */
  function activeRect() {
    if (selRect) return selRect;
    if (selectedWindowRect) {
      const cx = Math.max(selectedWindowRect.x, 0);
      const cy = Math.max(selectedWindowRect.y, 0);
      const cw = Math.min(selectedWindowRect.x + selectedWindowRect.w, imgNaturalW) - cx;
      const ch = Math.min(selectedWindowRect.y + selectedWindowRect.h, imgNaturalH) - cy;
      if (cw <= 0 || ch <= 0) return null;
      return { x: cx, y: cy, w: cw, h: ch };
    }
    return null;
  }

  async function applyBlur() {
    const r = activeRect();
    if (!r) return;
    applying = true;
    errorMsg = null;
    try {
      store.clearStepImageCache(step.id);
      await invoke('apply_image_edit', {
        stepId: step.id,
        edit: { type: 'Blur', x: r.x, y: r.y, w: r.w, h: r.h, sigma: 12.0 },
        extraIndex: extraIndex ?? null,
      });
      depth += 1;
      redoDepth = 0;
      resetSelection();
    } catch (err) {
      errorMsg = String(err);
    } finally {
      applying = false;
    }
  }

  async function applyCrop() {
    const r = activeRect();
    if (!r) return;
    applying = true;
    errorMsg = null;
    try {
      store.clearStepImageCache(step.id);
      await invoke('apply_image_edit', {
        stepId: step.id,
        edit: { type: 'Crop', x: r.x, y: r.y, w: r.w, h: r.h },
        extraIndex: extraIndex ?? null,
      });
      depth += 1;
      redoDepth = 0;
      resetSelection();
    } catch (err) {
      errorMsg = String(err);
    } finally {
      applying = false;
    }
  }

  async function editorUndo() {
    if (depth <= 0) return;
    applying = true;
    errorMsg = null;
    try {
      await invoke('undo_session');
      depth -= 1;
      redoDepth += 1;
      resetSelection();
    } catch (err) {
      errorMsg = String(err);
    } finally {
      applying = false;
    }
  }

  async function editorRedo() {
    if (redoDepth <= 0) return;
    applying = true;
    errorMsg = null;
    try {
      await invoke('redo_session');
      depth += 1;
      redoDepth -= 1;
      resetSelection();
    } catch (err) {
      errorMsg = String(err);
    } finally {
      applying = false;
    }
  }

  /** Container element for the canvas — used to compute available display size. */
  let canvasContainerEl = $state<HTMLElement | undefined>(undefined);
  let containerW = $state(0);
  let containerH = $state(0);

  $effect(() => {
    const el = canvasContainerEl;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      containerW = entry.contentRect.width;
      containerH = entry.contentRect.height;
    });
    obs.observe(el);
    return () => obs.disconnect();
  });

  /** CSS style for the canvas — scales to fill the container while preserving aspect ratio. */
  let canvasStyle = $derived.by(() => {
    if (imgNaturalW === 0 || imgNaturalH === 0 || containerW === 0 || containerH === 0)
      return 'display: block; max-width: 100%;';
    const s = Math.min(containerW / imgNaturalW, containerH / imgNaturalH);
    return `display: block; width: ${Math.round(imgNaturalW * s)}px; height: ${Math.round(imgNaturalH * s)}px;`;
  });

  const hasSelection = $derived(selRect !== null || selectedWindowRect !== null);
  const canEditorUndo = $derived(depth > 0);
  const canEditorRedo = $derived(redoDepth > 0);

  // Trigger editorUndo/editorRedo when the parent increments the tick counters.
  // We track the previous tick values in plain (non-reactive) variables so the
  // effects only fire on *changes* to the props, not on initial mount.
  // untrack() suppresses the "captures initial value" Svelte warning — the initial
  // capture is intentional here (we want a snapshot, not a reactive binding).
  let prevUndoTick = untrack(() => undoTick);
  let prevRedoTick = untrack(() => redoTick);

  $effect(() => {
    if (undoTick !== prevUndoTick) {
      prevUndoTick = undoTick;
      editorUndo();
    }
  });

  $effect(() => {
    if (redoTick !== prevRedoTick) {
      prevRedoTick = redoTick;
      editorRedo();
    }
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[90vh] w-[90vw] max-w-none sm:max-w-none flex-col gap-3 p-4" showCloseButton={false}>
    <Dialog.Header class="shrink-0">
      <Dialog.Title>Edit Image — Step {step.order}</Dialog.Title>
    </Dialog.Header>

    <!-- Tool buttons -->
    <div class="flex shrink-0 items-center gap-2">
      <Button
        variant={tool === 'blur' ? 'default' : 'outline'}
        size="sm"
        onclick={() => setTool('blur')}
      >
        <Blend />Blur
      </Button>
      <Button
        variant={tool === 'crop' ? 'default' : 'outline'}
        size="sm"
        onclick={() => setTool('crop')}
      >
        <Crop />Crop
      </Button>
      {#if visibleWindowRects.length > 0}
        <Button
          variant={tool === 'window' ? 'default' : 'outline'}
          size="sm"
          onclick={() => setTool('window')}
        >
          <MousePointer2 />Select Window
        </Button>
      {/if}

      <div class="flex-1"></div>

      <Button
        variant="outline"
        size="icon"
        aria-label="Undo"
        onclick={editorUndo}
        disabled={!canEditorUndo || applying}
      >
        <Undo2 />
      </Button>
      <Button
        variant="outline"
        size="icon"
        aria-label="Redo"
        onclick={editorRedo}
        disabled={!canEditorRedo || applying}
      >
        <Redo2 />
      </Button>

      {#if hasSelection}
        <Button variant="ghost" size="sm" onclick={resetSelection}>
          <RotateCcw />Reset
        </Button>
        {#if tool === 'blur'}
          <Button size="sm" onclick={applyBlur} disabled={applying}>
            {applying ? 'Applying…' : 'Apply Blur'}
          </Button>
        {/if}
        {#if tool === 'crop' || tool === 'window'}
          <Button size="sm" onclick={applyCrop} disabled={applying}>
            {applying ? 'Applying…' : 'Apply Crop'}
          </Button>
        {/if}
      {/if}

      <Button variant="ghost" size="icon" aria-label="Close" onclick={() => { open = false; }}>
        <X />
      </Button>
    </div>

    {#if errorMsg}
      <p class="shrink-0 text-sm text-destructive">{errorMsg}</p>
    {/if}

    <!-- Canvas area -->
    <div bind:this={canvasContainerEl} class="min-h-0 flex-1 overflow-hidden flex items-center justify-center rounded border bg-muted/20">
      {#if imageUri}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <canvas
          bind:this={canvas}
          class="cursor-crosshair"
          style={canvasStyle}
          onmousedown={onMouseDown}
          onmousemove={onMouseMove}
          onmouseup={onMouseUp}
          onclick={onCanvasClick}
        ></canvas>
      {:else}
        <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading image…
        </div>
      {/if}
    </div>

    <p class="shrink-0 text-xs text-muted-foreground">
      {#if tool === 'blur'}
        Draw a rectangle over the area to blur, then click <strong>Apply Blur</strong>.
      {:else if tool === 'crop'}
        Draw a rectangle to keep, then click <strong>Apply Crop</strong>.
      {:else}
        Click a highlighted window border to select it, then click <strong>Apply Crop</strong>.
      {/if}
    </p>
  </Dialog.Content>
</Dialog.Root>
