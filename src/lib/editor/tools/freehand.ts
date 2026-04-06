import { PencilBrush } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler } from './tool-handler.js';

export class FreehandToolHandler implements ToolHandler {
  readonly toolId = 'freehand';

  onActivate(ctx: ToolContext, _forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = true;
    const brush = new PencilBrush(ctx.canvas);
    brush.color = ctx.color;
    brush.width = ctx.strokeWidth;
    ctx.canvas.freeDrawingBrush = brush;
    ctx.canvas.selection = false;
  }

  onDeactivate(ctx: ToolContext): void {
    ctx.canvas.isDrawingMode = false;
  }

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
}
