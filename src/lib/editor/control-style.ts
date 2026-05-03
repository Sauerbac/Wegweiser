/**
 * Custom selection-handle rendering for all Fabric.js objects.
 *
 * Replaces the default square handles by overriding
 * `FabricObject.createControls()` (the factory called per-instance) so every
 * new object gets our custom renders:
 *  - L-shaped corners (tl/tr/bl/br) hugging the bounding box inward
 *  - I-shaped midpoints (ml/mr/mt/mb) perpendicular to each edge
 *  - A circle for the rotation control (mtr)
 *
 * All handles are drawn with a white fill and a blue outline matching the
 * "blue" preset color.
 */

import { FabricObject, controlsUtils } from 'fabric';
import { PRESET_COLORS } from './constants.js';

const BLUE = PRESET_COLORS[1]; // '#3b82f6'
const WHITE = '#ffffff';

const CORNER_ARM = 12;
const SIDE_LEN = 16;
const ROTATE_RADIUS = 6;
const OUTER_W = 8;
const INNER_W = 4;

type Sign = -1 | 1;

function strokeDouble(ctx: CanvasRenderingContext2D, drawPath: () => void): void {
  drawPath();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = OUTER_W;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.stroke();
  drawPath();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = INNER_W;
  ctx.stroke();
}

function drawCornerL(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  dx: Sign,
  dy: Sign,
): void {
  ctx.save();
  strokeDouble(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(left + dx * CORNER_ARM, top);
    ctx.lineTo(left, top);
    ctx.lineTo(left, top + dy * CORNER_ARM);
  });
  ctx.restore();
}

function drawSideI(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  vertical: boolean,
): void {
  const half = SIDE_LEN / 2;
  ctx.save();
  strokeDouble(ctx, () => {
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(left, top - half);
      ctx.lineTo(left, top + half);
    } else {
      ctx.moveTo(left - half, top);
      ctx.lineTo(left + half, top);
    }
  });
  ctx.restore();
}

function drawRotateCircle(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(left, top, ROTATE_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.strokeStyle = BLUE;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function buildCustomControls(): Record<string, any> {
  const c = controlsUtils.createObjectDefaultControls();

  c.tl.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawCornerL(ctx, l, t, 1, 1);
  c.tr.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawCornerL(ctx, l, t, -1, 1);
  c.bl.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawCornerL(ctx, l, t, 1, -1);
  c.br.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawCornerL(ctx, l, t, -1, -1);

  c.ml.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawSideI(ctx, l, t, true);
  c.mr.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawSideI(ctx, l, t, true);
  c.mt.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawSideI(ctx, l, t, false);
  c.mb.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawSideI(ctx, l, t, false);

  c.mtr.render = (ctx: CanvasRenderingContext2D, l: number, t: number) => drawRotateCircle(ctx, l, t);

  return c;
}

let applied = false;

/**
 * Override `FabricObject.createControls` so every new object instance receives
 * our custom-rendered handles. Idempotent — safe to call multiple times.
 */
export function applyCustomControlStyle(): void {
  if (applied) return;
  applied = true;

  const customControls = buildCustomControls();
  (FabricObject as any).createControls = () => ({ controls: customControls });
}
