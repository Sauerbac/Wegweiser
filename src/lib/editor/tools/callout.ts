import { Circle, FabricText, Group } from 'fabric';
import type { Canvas, FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler } from './tool-handler.js';

export class CalloutToolHandler implements ToolHandler {
  readonly toolId = 'callout';

  private nextCalloutNumber = 1;

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.discardActiveObject();
    forEachAnnotation((obj) => obj.set({ selectable: false, evented: false }));
    ctx.canvas.renderAll();
  }

  onDeactivate(_ctx: ToolContext): void {}

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    if (e.target) return;
    this.placeCallout(ctx, pointer.x, pointer.y);
  }

  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  /** Recalculate the next callout number from existing callouts on the canvas. */
  recalcCalloutNumbers(canvas: Canvas): void {
    let max = 0;
    canvas.getObjects().forEach((obj) => {
      const n = (obj as any)._calloutNumber;
      if (typeof n === 'number' && n > max) max = n;
    });
    this.nextCalloutNumber = max + 1;
  }

  private placeCallout(ctx: ToolContext, x: number, y: number): void {
    const num = this.nextCalloutNumber++;
    const radius = Math.max(ctx.strokeWidth * 3, 16);

    const circle = new Circle({
      radius,
      fill: ctx.color,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    const label = new FabricText(String(num), {
      fontSize: radius * 1.2,
      fill: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: 'bold',
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    const group = new Group([circle, label], {
      left: x,
      top: y,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      opacity: ctx.opacity,
      _wegweiserType: 'callout',
      _calloutNumber: num,
    } as any);

    ctx.canvas.add(group);
    ctx.canvas.setActiveObject(group);
  }
}
