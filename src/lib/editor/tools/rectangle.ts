import { Rect } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';
import { applyShapeProperties, syncShapeFromObject } from './shape-props.js';

export class RectangleToolHandler implements ToolHandler {
  readonly toolId = 'rectangle';
  readonly propertySections = ['stroke-color', 'fill-color', 'stroke-width', 'stroke-style', 'corner-radius', 'opacity'] as const;

  private startX = 0;
  private startY = 0;
  private shape: Rect | null = null;
  private _isDrawing = false;

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.discardActiveObject();
    forEachAnnotation((obj) => obj.set({ selectable: false, evented: false }));
    ctx.canvas.renderAll();
  }

  onDeactivate(_ctx: ToolContext): void {
    this.shape = null;
    this._isDrawing = false;
  }

  cancel(ctx: ToolContext): boolean {
    if (!this.shape) return false;
    ctx.canvas.remove(this.shape);
    this.shape = null;
    this._isDrawing = false;
    ctx.setDrawing(false);
    return true;
  }

  isDrawing(): boolean { return this._isDrawing; }

  onMouseDown(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    if (e.target) return;
    this.startX = pointer.x;
    this.startY = pointer.y;
    this._isDrawing = true;
    ctx.setDrawing(true);
    const rect = new Rect({
      left: pointer.x,
      top: pointer.y,
      originX: 'left',
      originY: 'top',
      width: 0,
      height: 0,
      fill: ctx.fillEnabled ? ctx.fillColor : 'transparent',
      stroke: ctx.color,
      strokeWidth: ctx.strokeWidth,
      strokeUniform: true,
      strokeDashArray: ctx.strokeDashArray ?? undefined,
      rx: ctx.cornerRadius,
      ry: ctx.cornerRadius,
      opacity: ctx.opacity,
      perPixelTargetFind: !ctx.fillEnabled,
      selectable: false,
      evented: false,
      lockUniScaling: false,
    });
    ctx.canvas.add(rect);
    this.shape = rect;
  }

  onMouseMove(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.shape) return;
    let dx = pointer.x - this.startX;
    let dy = pointer.y - this.startY;
    if ((e.e as MouseEvent).shiftKey) {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * side;
      dy = (dy < 0 ? -1 : 1) * side;
    }
    const left = Math.min(this.startX, this.startX + dx);
    const top = Math.min(this.startY, this.startY + dy);
    this.shape.set({ left, top, width: Math.abs(dx), height: Math.abs(dy) });
    ctx.canvas.renderAll();
  }

  onMouseUp(ctx: ToolContext, pointer: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.shape) return;
    const dx = Math.abs(pointer.x - this.startX);
    const dy = Math.abs(pointer.y - this.startY);
    if (dx < 3 && dy < 3) {
      ctx.canvas.remove(this.shape);
      this.shape = null;
      this._isDrawing = false;
      ctx.setDrawing(false);
      return;
    }
    this.shape.set({ selectable: true, evented: true });
    ctx.canvas.setActiveObject(this.shape);
    this.shape = null;
    this._isDrawing = false;
    ctx.setDrawing(false);
    ctx.pushSnapshot();
    ctx.updateCounts();
    ctx.canvas.renderAll();
  }

  identifiesObject(obj: FabricObject): boolean {
    if (!(obj instanceof Rect)) return false;
    // Plain rectangles have no _wegweiserType marker; tagged rects (highlight,
    // cropMask, cropOverlay, blur/pixelate overlays) belong to other tools.
    return !(obj as any)._wegweiserType;
  }

  syncFromObject(obj: FabricObject, shared: SharedDefaults): void {
    syncShapeFromObject(obj, shared);
  }

  applyProperties(_ctx: ToolContext, obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void {
    applyShapeProperties(obj, shared, changedProperty);
  }
}
