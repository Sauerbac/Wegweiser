/**
 * Custom selection-handle rendering for all Fabric.js objects.
 *
 * Replaces the default square handles by overriding
 * `FabricObject.createControls()` (the factory called per-instance) so every
 * new object gets our custom renders:
 *  - L-shaped corners (tl/tr/bl/br) sitting OUTSIDE the bounding box
 *  - I-shaped midpoints (ml/mr/mt/mb) sitting OUTSIDE each edge
 *  - A circle for the rotation control (mtr)
 *
 * Handles rotate with the object (getTotalAngle()) and use rounded line caps
 * so the arm tips show a blue border against the white fill.
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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  drawPath();
  ctx.strokeStyle = WHITE;
  ctx.lineWidth = INNER_W;
  ctx.stroke();
}

/**
 * Draw an L-shaped corner handle in the CURRENT transform's coordinate space.
 * The handle's inner edge sits at the origin (0, 0), which is the bbox corner.
 * (dx, dy) is the outward direction: the arms extend in dx and dy away from the bbox.
 */
function drawCornerL(ctx: CanvasRenderingContext2D, dx: Sign, dy: Sign): void {
  // Offset path center outward by half the stroke so the inner stroke edge
  // lands exactly at the origin (bbox corner/edge).
  const cx = dx * (OUTER_W / 2);
  const cy = dy * (OUTER_W / 2);
  ctx.save();
  strokeDouble(ctx, () => {
    ctx.beginPath();
    ctx.moveTo(cx - dx * CORNER_ARM, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy - dy * CORNER_ARM);
  });
  ctx.restore();
}

/**
 * Draw an I-bar handle in the CURRENT transform's coordinate space.
 * The handle's inner edge sits at the origin (bbox edge midpoint).
 * vertical: true = bar runs up/down (for left/right edge midpoints)
 *           false = bar runs left/right (for top/bottom edge midpoints)
 * outwardDir: -1 or +1 indicating which axis direction is "away from the bbox"
 */
function drawSideI(ctx: CanvasRenderingContext2D, vertical: boolean, outwardDir: Sign): void {
  const half = SIDE_LEN / 2;
  const shift = outwardDir * (OUTER_W / 2);
  ctx.save();
  strokeDouble(ctx, () => {
    ctx.beginPath();
    if (vertical) {
      ctx.moveTo(shift, -half);
      ctx.lineTo(shift, half);
    } else {
      ctx.moveTo(-half, shift);
      ctx.lineTo(half, shift);
    }
  });
  ctx.restore();
}

function drawRotateCircle(ctx: CanvasRenderingContext2D, left: number, top: number): void {
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

/**
 * Translate to the handle's screen position and rotate by the object's total
 * angle before calling the drawing function, so handles follow object rotation.
 */
function withObjectRotation(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  angle: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.translate(left, top);
  ctx.rotate((angle * Math.PI) / 180);
  draw();
  ctx.restore();
}

function buildCustomControls(): Record<string, any> {
  const c = controlsUtils.createObjectDefaultControls();

  // Corner handles: the (dx, dy) pair is the outward direction from the bbox
  // corner in object-local space. After withObjectRotation the axes align with
  // the object's edges, so (-1,-1) for tl means "left and up in object space".

  c.tl.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawCornerL(ctx, -1, -1));

  c.tr.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawCornerL(ctx, 1, -1));

  c.bl.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawCornerL(ctx, -1, 1));

  c.br.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawCornerL(ctx, 1, 1));

  // Edge midpoint handles: outwardDir matches the axis direction away from the bbox.
  // ml = left edge → outward is -x → outwardDir -1, vertical bar
  // mr = right edge → outward is +x → outwardDir +1, vertical bar
  // mt = top edge → outward is -y → outwardDir -1, horizontal bar
  // mb = bottom edge → outward is +y → outwardDir +1, horizontal bar

  c.ml.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawSideI(ctx, true, -1));

  c.mr.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawSideI(ctx, true, 1));

  c.mt.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawSideI(ctx, false, -1));

  c.mb.render = (ctx: CanvasRenderingContext2D, l: number, t: number, _s: unknown, obj: any) =>
    withObjectRotation(ctx, l, t, obj.getTotalAngle(), () => drawSideI(ctx, false, 1));

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
