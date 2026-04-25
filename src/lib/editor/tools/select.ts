import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

export class SelectToolHandler implements ToolHandler {
  readonly toolId = 'select';
  readonly propertySections = [] as const;

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = true;
    forEachAnnotation((obj) => obj.set({ selectable: true, evented: true }));
  }

  onDeactivate(_ctx: ToolContext): void {}

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  identifiesObject(_obj: FabricObject): boolean { return false; }
  syncFromObject(_obj: FabricObject, _shared: SharedDefaults): void {}
  applyProperties(_ctx: ToolContext, _obj: FabricObject, _shared: SharedDefaults): void {}
}
