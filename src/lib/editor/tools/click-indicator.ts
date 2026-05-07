import { Circle, Group } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';
import { CLICK_INDICATOR_COLOR } from '../constants.js';

/** Build an rgba() string from a 6-digit hex color + alpha (0–1). */
function hexAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export class ClickIndicatorToolHandler implements ToolHandler {
  readonly toolId = 'click-indicator';
  readonly propertySections = ['click-indicator'] as const;

  private _x = 0;
  private _y = 0;

  /** Set the monitor-relative click position before calling placeIndicator(). */
  setPosition(x: number, y: number): void {
    this._x = x;
    this._y = y;
  }

  isPresent(ctx: ToolContext): boolean {
    return ctx.canvas.getObjects().some((o) => (o as any)._wegweiserType === 'clickIndicator');
  }

  placeIndicator(ctx: ToolContext): void {
    if (this.isPresent(ctx)) return;

    const glow = new Circle({
      radius: 28,
      fill: hexAlpha(CLICK_INDICATOR_COLOR, 0.18),
      stroke: hexAlpha(CLICK_INDICATOR_COLOR, 0.45),
      strokeWidth: 2,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    const core = new Circle({
      radius: 6,
      fill: hexAlpha(CLICK_INDICATOR_COLOR, 0.85),
      stroke: '',
      strokeWidth: 0,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    const group = new Group([glow, core], {
      left: this._x,
      top: this._y,
      originX: 'center',
      originY: 'center',
      selectable: true,
      evented: true,
      _wegweiserType: 'clickIndicator',
    } as any);

    ctx.canvas.add(group);
    ctx.canvas.renderAll();
    ctx.updateCounts();
  }

  removeIndicator(ctx: ToolContext): void {
    const objs = ctx.canvas.getObjects().filter((o) => (o as any)._wegweiserType === 'clickIndicator');
    for (const obj of objs) {
      // Capture current position (group uses originX/Y 'center', so left/top is the center)
      // so that the next placeIndicator() restores it to where the user moved it.
      if (obj.left !== undefined) this._x = obj.left;
      if (obj.top !== undefined) this._y = obj.top;
      ctx.canvas.remove(obj);
    }
    ctx.canvas.renderAll();
    ctx.updateCounts();
  }

  toggleIndicator(ctx: ToolContext): void {
    if (this.isPresent(ctx)) {
      this.removeIndicator(ctx);
    } else {
      this.placeIndicator(ctx);
    }
  }

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = true;
    forEachAnnotation((obj) => obj.set({ selectable: true, evented: true }));
    ctx.canvas.renderAll();
  }

  onDeactivate(_ctx: ToolContext): void {}

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  identifiesObject(obj: FabricObject): boolean {
    return (obj as any)._wegweiserType === 'clickIndicator';
  }

  syncFromObject(_obj: FabricObject, _shared: SharedDefaults): void {}
  applyProperties(_ctx: ToolContext, _obj: FabricObject, _shared: SharedDefaults, _changedProperty: keyof SharedDefaults): void {}
}
