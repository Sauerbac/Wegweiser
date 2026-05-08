import { Group } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';
import { CLICK_INDICATOR_COLOR } from '../constants.js';
import { FlatHighlightBrush, buildSegmentPaths, hexToRgba } from './flat-highlight-brush.js';

const DEFAULT_COLOR: string = CLICK_INDICATOR_COLOR; // '#f97316'

export class HighlightToolHandler implements ToolHandler {
  readonly toolId = 'highlight';
  readonly propertySections = ['stroke-color', 'highlight-width', 'highlight-opacity'] as const;

  private _color: string = DEFAULT_COLOR;
  private _savedColor = '';

  onActivate(ctx: ToolContext, _forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.discardActiveObject();
    this._savedColor = ctx.color;
    ctx.overrideColor(this._color);

    const brush = new FlatHighlightBrush(
      ctx.canvas,
      () => ctx.highlightWidth,
      () => ctx.highlightOpacity,
    );
    brush.color = this._color;
    ctx.canvas.freeDrawingBrush = brush as any;
    ctx.canvas.isDrawingMode = true;
    ctx.canvas.selection = false;
  }

  onDeactivate(ctx: ToolContext): void {
    this._color = ctx.color;
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.contextTop.clearRect(0, 0, ctx.canvas.width!, ctx.canvas.height!);
    ctx.overrideColor(this._savedColor);
  }

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  identifiesObject(obj: FabricObject): boolean {
    // Accepts both new Group-based highlights and old Path-based ones from
    // prior sessions (no instanceof check — _wegweiserType is authoritative).
    return (obj as any)._wegweiserType === 'highlight';
  }

  syncFromObject(obj: FabricObject, shared: SharedDefaults): void {
    obj.set({ perPixelTargetFind: true });
    const color = (obj as any)._highlightColor;
    const opacity = (obj as any)._highlightOpacity;
    const width = (obj as any)._highlightWidth;
    if (typeof color === 'string') shared.color = color;
    if (typeof opacity === 'number') shared.highlightOpacity = opacity;
    if (typeof width === 'number') shared.highlightWidth = width;
  }

  applyProperties(ctx: ToolContext, obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void {
    const curColor: string = (obj as any)._highlightColor ?? DEFAULT_COLOR;
    const curOpacity: number = (obj as any)._highlightOpacity ?? ctx.highlightOpacity;

    switch (changedProperty) {
      case 'color': {
        (obj as any)._highlightColor = shared.color;
        const fill = hexToRgba(shared.color, curOpacity);
        if (obj instanceof Group) {
          obj.getObjects().forEach((child) => child.set({ fill }));
        } else {
          obj.set({ fill });
        }
        if (ctx.canvas.isDrawingMode && ctx.canvas.freeDrawingBrush) {
          ctx.canvas.freeDrawingBrush.color = shared.color;
        }
        break;
      }
      case 'highlightOpacity': {
        (obj as any)._highlightOpacity = shared.highlightOpacity;
        const fill = hexToRgba(curColor, shared.highlightOpacity);
        if (obj instanceof Group) {
          obj.getObjects().forEach((child) => child.set({ fill }));
        } else {
          obj.set({ fill });
        }
        if (ctx.canvas.isDrawingMode && ctx.canvas.freeDrawingBrush) {
          (ctx.canvas.freeDrawingBrush as any).opacity = shared.highlightOpacity;
        }
        break;
      }
      case 'highlightWidth': {
        if (!(obj instanceof Group)) break;
        const pts = (obj as any)._highlightPoints;
        if (!pts || pts.length < 2) break;

        (obj as any)._highlightWidth = shared.highlightWidth;

        // Rebuild children in place — the object reference stays the same so
        // any active multi-selection (ActiveSelection) remains intact.
        const newPaths = buildSegmentPaths(pts, shared.highlightWidth, curColor, curOpacity);
        obj.getObjects().slice().forEach((c) => obj.remove(c));
        newPaths.forEach((p) => obj.add(p));
        obj.setCoords();
        break;
      }
    }
  }
}
