import { Path, Group } from 'fabric';
import type { Canvas } from 'fabric';

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type Pt = { x: number; y: number };

const TIP_HALF = 4;

/** Build the individual segment Path objects for a highlight stroke. */
export function buildSegmentPaths(
  pts: Pt[],
  width: number,
  color: string,
  opacity: number,
): Path[] {
  const hh = width / 2;
  const T = TIP_HALF;
  const f = (n: number) => n.toFixed(2);
  const fill = hexToRgba(color, opacity);
  const paths: Path[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = `M ${f(a.x - T)},${f(a.y - hh)} `
            + `L ${f(b.x - T)},${f(b.y - hh)} `
            + `L ${f(b.x + T)},${f(b.y + hh)} `
            + `L ${f(a.x + T)},${f(a.y + hh)} Z`;
    paths.push(new Path(d, {
      fill,
      stroke: '',
      strokeWidth: 0,
      selectable: false,
      evented: false,
      objectCaching: false,
    }));
  }
  return paths;
}

/**
 * Build a Fabric Group of individual segment Paths for a highlight stroke.
 * Each segment is a separate Path so overlapping segments darken naturally
 * (same as two separate highlight strokes overlapping each other).
 * Exported so applyProperties can rebuild on width change.
 */
export function buildHighlightGroup(
  pts: Pt[],
  width: number,
  color: string,
  opacity: number,
): Group {
  return new Group(buildSegmentPaths(pts, width, color, opacity), {
    selectable: true,
    evented: true,
    objectCaching: true,
    perPixelTargetFind: true,
  });
}

/**
 * Flat horizontal-tip brush — like a highlighter marker.
 * - Dragging in X → full `width`-px-tall stripe.
 * - Dragging in Y → TIP_HALF*2 px thin mark.
 *
 * Width and opacity are provided as getter callbacks so the brush always
 * uses the current wrapper state at draw time without needing explicit sync.
 */
export class FlatHighlightBrush {
  color: string = '#f97316';

  // Forwarded to getters so Fabric duck-typing still works.
  get width(): number { return this._getWidth(); }
  set width(_v: number) { /* ignored — read from getter */ }
  get opacity(): number { return this._getOpacity(); }
  set opacity(_v: number) { /* ignored — read from getter */ }

  shadow: null = null;
  strokeDashArray: null = null;
  limitedToCanvasSize: boolean = false;

  private readonly _canvas: Canvas;
  private readonly _getWidth: () => number;
  private readonly _getOpacity: () => number;
  private _pts: Pt[] = [];
  private _active = false;

  constructor(canvas: Canvas, getWidth: () => number, getOpacity: () => number) {
    this._canvas = canvas;
    this._getWidth = getWidth;
    this._getOpacity = getOpacity;
  }

  onMouseDown(pointer: Pt, _opts: unknown): void {
    this._active = true;
    this._pts = [{ x: pointer.x, y: pointer.y }];
    this._clearTop();
  }

  onMouseMove(pointer: Pt, _opts: unknown): void {
    if (!this._active) return;
    this._pts.push({ x: pointer.x, y: pointer.y });
    this._redrawPreview();
  }

  onMouseUp(_opts: unknown): boolean {
    if (!this._active) return true;
    this._active = false;
    this._clearTop();
    if (this._pts.length >= 2) this._commit();
    this._pts = [];
    return true;
  }

  private _clearTop(): void {
    const ctx = this._canvas.contextTop;
    ctx.clearRect(0, 0, this._canvas.width!, this._canvas.height!);
  }

  private _redrawPreview(): void {
    this._clearTop();
    const ctx = this._canvas.contextTop;
    const vpt = this._canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
    ctx.save();
    ctx.transform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5]);
    this._paintSegments(ctx, this._pts, this._getWidth(), this.color, this._getOpacity());
    ctx.restore();
  }

  /**
   * Draw one filled parallelogram per segment. Each is its own fill() call so
   * overlapping areas (e.g. when the stroke loops back) are painted multiple
   * times and appear darker — consistent with two separate highlight strokes.
   */
  private _paintSegments(
    ctx: CanvasRenderingContext2D,
    pts: Pt[],
    width: number,
    color: string,
    opacity: number,
  ): void {
    if (pts.length < 2) return;
    const hh = width / 2;
    const T = TIP_HALF;

    ctx.fillStyle = hexToRgba(color, opacity);

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      ctx.beginPath();
      ctx.moveTo(a.x - T, a.y - hh);
      ctx.lineTo(b.x - T, b.y - hh);
      ctx.lineTo(b.x + T, b.y + hh);
      ctx.lineTo(a.x + T, a.y + hh);
      ctx.closePath();
      ctx.fill();
    }
  }

  private _commit(): void {
    const pts = this._dedupe(this._pts);
    if (pts.length < 2) return;

    const width = this._getWidth();
    const opacity = this._getOpacity();

    const group = buildHighlightGroup(pts, width, this.color, opacity);
    (group as any)._wegweiserType = 'highlight';
    (group as any)._highlightColor = this.color;
    (group as any)._highlightOpacity = opacity;
    (group as any)._highlightWidth = width;
    (group as any)._highlightPoints = pts;

    this._canvas.add(group);
    this._canvas.requestRenderAll();
  }

  private _dedupe(pts: Pt[]): Pt[] {
    if (pts.length <= 2) return pts;
    const out: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = out[out.length - 1];
      const dx = pts[i].x - prev.x, dy = pts[i].y - prev.y;
      if (dx * dx + dy * dy >= 4) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}
