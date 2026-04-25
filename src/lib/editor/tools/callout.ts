import { Circle, FabricText, Group } from 'fabric';
import type { Canvas, FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

/**
 * Return '#000000' or '#ffffff' — whichever has higher contrast against the
 * given hex background color, based on WCAG relative luminance.
 */
export function contrastColor(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#ffffff';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}

export class CalloutToolHandler implements ToolHandler {
  readonly toolId = 'callout';
  readonly propertySections = ['stroke-color', 'callout-groups', 'stroke-width', 'opacity'] as const;

  /** Per-color counter: color → next number to assign for that color group. */
  private colorCounters: Map<string, number> = new Map();

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    // Don't discard when a callout is already selected (e.g. switching here by clicking
    // a callout from another tool) — that would force the user to click twice.
    const currentActive = ctx.canvas.getActiveObject();
    if (!currentActive || (currentActive as any)._wegweiserType !== 'callout') {
      ctx.canvas.discardActiveObject();
    }
    forEachAnnotation((obj) => {
      // Keep existing callouts selectable so the user can re-select and move them.
      if ((obj as any)._wegweiserType === 'callout') {
        obj.set({ selectable: true, evented: true });
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
    if (e.target) return;
    this.placeCallout(ctx, pointer.x, pointer.y);
  }

  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}
  onMouseUp(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  /**
   * Recalculate all per-color counters from the current canvas state.
   * Sets each counter to canvas-max + 1 so the next placed callout always
   * follows the highest number currently visible.
   */
  recalcCalloutNumbers(canvas: Canvas): void {
    const maxPerColor = new Map<string, number>();
    canvas.getObjects().forEach((obj) => {
      const n = (obj as any)._calloutNumber;
      const c = (obj as any)._calloutColor;
      if (typeof n === 'number' && typeof c === 'string') {
        const cur = maxPerColor.get(c) ?? 0;
        if (n > cur) maxPerColor.set(c, n);
      }
    });
    // Reset all counters to canvas state (no high-watermark).
    this.colorCounters.clear();
    maxPerColor.forEach((max, color) => {
      this.colorCounters.set(color, max + 1);
    });
  }

  /**
   * Recalculate the counter for a single color from the current canvas state.
   * Call this after a callout of that color is deleted or recolored away.
   */
  recalcColorCounter(canvas: Canvas, color: string): void {
    let max = 0;
    canvas.getObjects().forEach((obj) => {
      if (
        (obj as any)._wegweiserType === 'callout' &&
        (obj as any)._calloutColor === color &&
        typeof (obj as any)._calloutNumber === 'number' &&
        (obj as any)._calloutNumber > max
      ) {
        max = (obj as any)._calloutNumber;
      }
    });
    if (max === 0) {
      this.colorCounters.delete(color);
    } else {
      this.colorCounters.set(color, max + 1);
    }
  }

  /** Consume and return the next number for the given color group. */
  takeNextForColor(color: string): number {
    const n = this.colorCounters.get(color) ?? 1;
    this.colorCounters.set(color, n + 1);
    return n;
  }

  private placeCallout(ctx: ToolContext, x: number, y: number): void {
    const color = ctx.color;
    const num = this.takeNextForColor(color);
    const radius = Math.max(ctx.strokeWidth * 3, 16);

    const circle = new Circle({
      radius,
      fill: color,
      originX: 'center',
      originY: 'center',
      selectable: false,
      evented: false,
    });

    const label = new FabricText(String(num), {
      fontSize: radius * 1.2,
      fill: contrastColor(color),
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
      _calloutColor: color,
    } as any);

    ctx.canvas.add(group);
    ctx.canvas.setActiveObject(group);
  }

  identifiesObject(obj: FabricObject): boolean {
    return (obj as any)._wegweiserType === 'callout';
  }

  syncFromObject(obj: FabricObject, shared: SharedDefaults): void {
    const c = (obj as any)._calloutColor;
    if (typeof c === 'string') shared.color = c;
    if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  }

  applyProperties(ctx: ToolContext, obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void {
    if (!(obj instanceof Group)) return;
    if (changedProperty === 'color') {
      const oldColor = (obj as any)._calloutColor as string | undefined;
      if (shared.color !== oldColor) {
        const newNum = this.takeNextForColor(shared.color);
        (obj as any)._calloutColor = shared.color;
        (obj as any)._calloutNumber = newNum;
        if (oldColor) this.recalcColorCounter(ctx.canvas, oldColor);
        obj.getObjects().forEach((child) => {
          if (child instanceof Circle) {
            child.set({ fill: shared.color });
          } else if (child instanceof FabricText) {
            child.set({ text: String(newNum), fill: contrastColor(shared.color) });
          }
        });
      }
    } else if (changedProperty === 'opacity') {
      obj.set({ opacity: shared.opacity });
    }
  }
}
