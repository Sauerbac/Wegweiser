import { IText } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler } from './tool-handler.js';

export class TextToolHandler implements ToolHandler {
  readonly toolId = 'text';

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.discardActiveObject();
    // IText objects stay evented so clicking re-enters editing; all others off.
    forEachAnnotation((obj) => {
      if (obj instanceof IText) {
        obj.set({ selectable: false, evented: true });
      } else {
        obj.set({ selectable: false, evented: false });
      }
    });
    ctx.canvas.renderAll();
  }

  onDeactivate(_ctx: ToolContext): void {}

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    if (e.target instanceof IText) {
      this.enterTextEditing(ctx, e.target);
      return;
    }
    if (e.target) return;
    this.placeText(ctx, pointer.x, pointer.y);
  }

  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  /**
   * After loadFromJSON, IText objects lose their hiddenTextareaContainer.
   * Re-attach it here so keyboard input works inside the Dialog focus trap.
   */
  fixupContainers(ctx: ToolContext): void {
    const container = ctx.canvas.getElement().parentElement;
    if (!container) return;
    ctx.canvas.getObjects().forEach((obj) => {
      if (obj instanceof IText) {
        (obj as any).hiddenTextareaContainer = container;
        obj.set({ cursorColor: (obj.fill as string) || '#000000', cursorWidth: 2 });
      }
    });
  }

  private placeText(ctx: ToolContext, x: number, y: number): void {
    const canvasContainer = ctx.canvas.getElement().parentElement;
    const text = new IText('Text', {
      left: x,
      top: y,
      originX: 'left',
      originY: 'top',
      fill: ctx.color,
      fontSize: Math.max(ctx.strokeWidth * 6, 24),
      fontFamily: 'system-ui, -apple-system, sans-serif',
      opacity: ctx.opacity,
      selectable: true,
      evented: true,
      hiddenTextareaContainer: canvasContainer,
      cursorColor: ctx.color,
      cursorWidth: 2,
    });
    ctx.canvas.add(text);

    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = true;
    ctx.canvas.renderAll();
    ctx.canvas.setActiveObject(text);

    this.attachTextEditingExitedHandler(ctx, text);

    requestAnimationFrame(() => {
      if (!ctx.canvas) return;
      ctx.canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      ctx.canvas.renderAll();
    });
  }

  private enterTextEditing(ctx: ToolContext, text: IText): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = true;
    ctx.canvas.setActiveObject(text);

    this.attachTextEditingExitedHandler(ctx, text);

    requestAnimationFrame(() => {
      if (!ctx.canvas) return;
      ctx.canvas.setActiveObject(text);
      text.enterEditing();
      ctx.canvas.renderAll();
    });
  }

  private attachTextEditingExitedHandler(ctx: ToolContext, text: IText): void {
    const onEditingExited = () => {
      text.off('editing:exited', onEditingExited);
      // Guard: only restore text-tool state if still in text mode.
      if (ctx.getCurrentTool() !== 'text') return;
      ctx.canvas.isDrawingMode = false;
      ctx.canvas.selection = false;
      ctx.canvas.getObjects().forEach((obj) => {
        if (obj instanceof IText) {
          obj.set({ selectable: false, evented: true });
        } else if ((obj as any)._wegweiserType !== 'cropOverlay') {
          obj.set({ selectable: false, evented: false });
        }
      });
      ctx.canvas.discardActiveObject();
      ctx.canvas.renderAll();
    };
    text.on('editing:exited', onEditingExited);
  }
}
