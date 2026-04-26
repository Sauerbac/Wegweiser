import { Path, PencilBrush } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

export class FreehandToolHandler implements ToolHandler {
  readonly toolId = 'freehand';
  readonly propertySections = ['stroke-color', 'stroke-width', 'stroke-style', 'opacity'] as const;

  /** Listener tagging brush-created paths so identifiesObject() can find them positively. */
  private _onPathCreated: ((e: { path: FabricObject }) => void) | null = null;

  onActivate(ctx: ToolContext, _forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    // Reset Fabric's internal drawing-start flag before entering drawing mode.
    // Without this, switching from another drawing-mode tool (e.g. highlight)
    // while the mouse button is held causes Fabric to fire a synthetic mousedown
    // on the new brush, producing a ghost stroke from the previous cursor position.
    (ctx.canvas as any)._isCurrentlyDrawing = false;
    ctx.canvas.clearContext(ctx.canvas.contextTop);

    ctx.canvas.isDrawingMode = true;
    const brush = new PencilBrush(ctx.canvas);
    brush.color = ctx.color;
    brush.width = ctx.strokeWidth;
    brush.strokeDashArray = ctx.strokeDashArray ? [...ctx.strokeDashArray] : null;
    brush.strokeLineCap = ctx.strokeDashArray ? 'butt' : 'round';
    ctx.canvas.freeDrawingBrush = brush;
    ctx.canvas.selection = false;

    // Tag every freshly drawn path so identifiesObject() can match positively.
    // Also apply the current stroke dash style (PencilBrush doesn't support it natively).
    this._onPathCreated = (e) => {
      if (e.path) {
        (e.path as any)._wegweiserType = 'freehand';
        const dashArray = ctx.strokeDashArray;
        e.path.set({
          strokeDashArray: dashArray ?? undefined,
          strokeLineCap: dashArray ? 'butt' : 'round',
        });
      }
    };
    ctx.canvas.on('path:created', this._onPathCreated as any);
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.canvas.isDrawingMode = false;
    if (this._onPathCreated) {
      ctx.canvas.off('path:created', this._onPathCreated as any);
      this._onPathCreated = null;
    }
  }

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  identifiesObject(obj: FabricObject): boolean {
    return obj instanceof Path && (obj as any)._wegweiserType === 'freehand';
  }

  syncFromObject(obj: FabricObject, shared: SharedDefaults): void {
    if (typeof obj.stroke === 'string' && obj.stroke) shared.color = obj.stroke;
    if (typeof obj.strokeWidth === 'number') shared.strokeWidth = obj.strokeWidth;
    shared.strokeDashArray = obj.strokeDashArray ?? null;
    if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  }

  applyProperties(ctx: ToolContext, obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void {
    switch (changedProperty) {
      case 'color':
        obj.set({ stroke: shared.color, strokeUniform: true });
        if (ctx.canvas.isDrawingMode && ctx.canvas.freeDrawingBrush) {
          ctx.canvas.freeDrawingBrush.color = shared.color;
        }
        break;
      case 'strokeWidth':
        obj.set({ strokeWidth: shared.strokeWidth, strokeUniform: true });
        if (ctx.canvas.isDrawingMode && ctx.canvas.freeDrawingBrush) {
          ctx.canvas.freeDrawingBrush.width = shared.strokeWidth;
        }
        break;
      case 'strokeDashArray':
        obj.set({
          strokeDashArray: shared.strokeDashArray ?? undefined,
          strokeLineCap: shared.strokeDashArray ? 'butt' : 'round',
        });
        break;
      case 'opacity':
        obj.set({ opacity: shared.opacity });
        break;
    }
  }
}
