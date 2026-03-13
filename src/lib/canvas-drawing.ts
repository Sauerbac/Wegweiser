/**
 * Pure canvas-drawing helpers for ImageEditor.
 *
 * Each function is responsible for one rendering concern and receives all
 * required data as explicit parameters — no closures over component state.
 *
 * Keeping these here (rather than inline in the component) makes each pass
 * independently readable and keeps `redraw()` a thin orchestrator.
 */

import type { WindowRect } from '$lib/types';
import { clipRect, cssVar } from '$lib/utils';

/**
 * Draw the base image onto the canvas, resizing the canvas to the image's
 * natural dimensions. Call this first on every redraw.
 */
export function drawBaseImage(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
): void {
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.drawImage(img, 0, 0);
}

/**
 * Overlay dashed coloured borders for each window rect that overlaps the
 * image. Rects are drawn back-to-front so index 0 (topmost window) appears
 * on top. Only called when the `window` tool is active.
 */
export function drawWindowRects(
  ctx: CanvasRenderingContext2D,
  windowRects: WindowRect[],
  imageW: number,
  imageH: number,
): void {
  const chartColors = [
    cssVar('--chart-1'),
    cssVar('--chart-2'),
    cssVar('--chart-3'),
    cssVar('--chart-4'),
    cssVar('--chart-5'),
  ];

  // Filter to windows that have at least some overlap with the image canvas.
  const visibleRects = windowRects.filter(
    (wr) => wr.x < imageW && wr.y < imageH && wr.x + wr.w > 0 && wr.y + wr.h > 0,
  );

  ctx.save();
  // Draw back-to-front so the topmost window (index 0) is painted last and
  // appears visually on top of windows behind it.
  for (let i = visibleRects.length - 1; i >= 0; i--) {
    const wr = visibleRects[i];
    const clipped = clipRect(wr, imageW, imageH);
    if (!clipped) continue;
    const color = chartColors[i % chartColors.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(clipped.x, clipped.y, clipped.w, clipped.h);
  }
  ctx.restore();
}

/**
 * Overlay the selection rectangle (used for both freehand drag
 * selections and selected-window highlights).
 */
export function drawSelectionRect(
  ctx: CanvasRenderingContext2D,
  active: { x: number; y: number; w: number; h: number },
): void {
  // Static --chart-5 light-theme value so it never changes with dark/light mode.
  const color = 'oklch(0.769 0.188 70.08)';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(active.x, active.y, active.w, active.h);
  ctx.fillStyle = `color-mix(in oklch, ${color} 15%, transparent)`;
  ctx.fillRect(active.x, active.y, active.w, active.h);
  ctx.restore();
}
