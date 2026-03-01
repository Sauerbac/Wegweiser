<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { store } from '$lib/stores/session.svelte';
  import type { Step, WindowRect } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Blend, Crop, MousePointer2, RotateCcw, X } from '@lucide/svelte';

  interface Props {
    step: Step;
    /** Set to undefined to edit the primary image; set to index for an extra image. */
    extraIndex?: number;
    open: boolean;
    onclose: () => void;
  }

  let { step, extraIndex = undefined, open, onclose }: Props = $props();

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

  /** The data URI for the image to display. */
  let imageUri = $derived.by(() => {
    const key = store.imageCacheKey(step);
    return store.imageCache[key] ?? null;
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
      if (tool === 'window') {
        ctx.save();
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
        step.window_rects.forEach((wr, i) => {
          const color = colors[i % colors.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 3]);
          ctx.strokeRect(wr.x, wr.y, wr.w, wr.h);

          // Title label background
          if (wr.title) {
            ctx.font = '12px sans-serif';
            const textW = ctx.measureText(wr.title).width + 8;
            ctx.fillStyle = color + 'cc';
            ctx.fillRect(wr.x, wr.y - 18, textW, 18);
            ctx.fillStyle = '#fff';
            ctx.fillText(wr.title, wr.x + 4, wr.y - 4);
          }
        });
        ctx.restore();
      }

      // Draw selection rectangle.
      const active = selRect ?? (selectedWindowRect
        ? { x: selectedWindowRect.x, y: selectedWindowRect.y, w: selectedWindowRect.w, h: selectedWindowRect.h }
        : null);
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
    if (open && imageUri) {
      redraw();
    }
  });

  $effect(() => {
    // Redraw whenever tool changes to show/hide window overlays.
    tool;
    selRect;
    selectedWindowRect;
    redraw();
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
    // Find topmost window rect that contains the click.
    const hit = [...step.window_rects].reverse().find(
      (wr) => px >= wr.x && px <= wr.x + wr.w && py >= wr.y && py <= wr.y + wr.h
    ) ?? null;
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

  /** The active rect to send to the backend (image-pixel coordinates). */
  function activeRect() {
    if (selRect) return selRect;
    if (selectedWindowRect) {
      return { x: selectedWindowRect.x, y: selectedWindowRect.y, w: selectedWindowRect.w, h: selectedWindowRect.h };
    }
    return null;
  }

  async function applyBlur() {
    const r = activeRect();
    if (!r) return;
    applying = true;
    errorMsg = null;
    try {
      await invoke('apply_image_edit', {
        stepId: step.id,
        edit: { type: 'Blur', x: r.x, y: r.y, w: r.w, h: r.h, sigma: 12.0 },
        extraIndex: extraIndex ?? null,
      });
      resetSelection();
      onclose();
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
      await invoke('apply_image_edit', {
        stepId: step.id,
        edit: { type: 'Crop', x: r.x, y: r.y, w: r.w, h: r.h },
        extraIndex: extraIndex ?? null,
      });
      resetSelection();
      onclose();
    } catch (err) {
      errorMsg = String(err);
    } finally {
      applying = false;
    }
  }

  const hasSelection = $derived(selRect !== null || selectedWindowRect !== null);
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[90vh] max-w-[95vw] flex-col gap-3 p-4">
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
      {#if step.window_rects?.length > 0}
        <Button
          variant={tool === 'window' ? 'default' : 'outline'}
          size="sm"
          onclick={() => setTool('window')}
        >
          <MousePointer2 />Select Window
        </Button>
      {/if}

      <div class="flex-1"></div>

      {#if hasSelection}
        <Button variant="ghost" size="sm" onclick={resetSelection}>
          <RotateCcw />Reset
        </Button>
        {#if tool === 'blur' || tool === 'window'}
          <Button size="sm" onclick={applyBlur} disabled={applying}>
            {applying ? 'Applying…' : 'Apply Blur'}
          </Button>
        {/if}
        {#if tool === 'crop'}
          <Button size="sm" onclick={applyCrop} disabled={applying}>
            {applying ? 'Applying…' : 'Apply Crop'}
          </Button>
        {/if}
      {/if}

      <Button variant="ghost" size="icon" aria-label="Close" onclick={onclose}>
        <X />
      </Button>
    </div>

    {#if errorMsg}
      <p class="shrink-0 text-sm text-destructive">{errorMsg}</p>
    {/if}

    <!-- Canvas area -->
    <div class="min-h-0 flex-1 overflow-auto rounded border bg-muted/20">
      {#if imageUri}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <canvas
          bind:this={canvas}
          class="max-w-full cursor-crosshair"
          style="display: block;"
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
        Click a highlighted window border to select it, then click <strong>Apply Blur</strong>.
      {/if}
    </p>
  </Dialog.Content>
</Dialog.Root>
