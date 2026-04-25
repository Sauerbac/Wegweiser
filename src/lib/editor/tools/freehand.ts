import { Path, PencilBrush } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

export class FreehandToolHandler implements ToolHandler {
  readonly toolId = 'freehand';
  readonly propertySections = ['stroke-color', 'stroke-width', 'opacity'] as const;

  /** Listener tagging brush-created paths so identifiesObject() can find them positively. */
  private _onPathCreated: ((e: { path: FabricObject }) => void) | null = null;

  onActivate(ctx: ToolContext, _forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = true;
    const brush = new PencilBrush(ctx.canvas);
    brush.color = ctx.color;
    brush.width = ctx.strokeWidth;
    ctx.canvas.freeDrawingBrush = brush;
    ctx.canvas.selection = false;

    // Tag every freshly drawn path so identifiesObject() can match positively.
    this._onPathCreated = (e) => {
      if (e.path) (e.path as any)._wegweiserType = 'freehand';
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
    if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  }

  applyProperties(ctx: ToolContext, obj: FabricObject, shared: SharedDefaults): void {
    obj.set({
      stroke: shared.color,
      strokeWidth: shared.strokeWidth,
      strokeUniform: true,
      opacity: shared.opacity,
    });
    // Also update the freehand brush for the next stroke.
    if (ctx.canvas.isDrawingMode && ctx.canvas.freeDrawingBrush) {
      ctx.canvas.freeDrawingBrush.color = shared.color;
      ctx.canvas.freeDrawingBrush.width = shared.strokeWidth;
    }
  }
}
