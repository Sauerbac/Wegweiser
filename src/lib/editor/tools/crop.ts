import { Rect, type FabricObject, type TPointerEvent, type TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

type DrawState = { startX: number; startY: number; shape: Rect | null };

export class CropToolHandler implements ToolHandler {
  readonly toolId = 'crop';
  readonly propertiesComponentId = 'crop';

  private cropRect: Rect | null = null;
  private cropOverlays: Rect[] = [];
  private drawOverlays: Rect[] = [];
  private drawState: DrawState | null = null;

  isDrawing(): boolean {
    return this.drawState !== null;
  }

  onActivate(
    ctx: ToolContext,
    forEachAnnotation: (fn: (obj: any) => void) => void,
  ): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.discardActiveObject();
    forEachAnnotation((obj) => obj.set({ selectable: false, evented: false }));
    // Keep the crop rect selectable so the user can resize/move/delete it.
    if (this.cropRect) {
      this.cropRect.set({ selectable: true, evented: true });
      ctx.canvas.setActiveObject(this.cropRect);
    }
    ctx.canvas.renderAll();
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  cancel(ctx: ToolContext): boolean {
    if (!this.drawState) return false;
    this.removeDrawOverlays(ctx);
    if (this.drawState.shape) {
      ctx.canvas.remove(this.drawState.shape);
      ctx.canvas.renderAll();
    }
    this.drawState = null;
    ctx.setDrawing(false);
    return true;
  }

  onMouseDown(
    ctx: ToolContext,
    pointer: { x: number; y: number },
    e: TPointerEventInfo<TPointerEvent>,
  ): void {
    if (e.target) return;

    ctx.setDrawing(true);
    const rect = new Rect({
      left: pointer.x,
      top: pointer.y,
      originX: 'left',
      originY: 'top',
      width: 0,
      height: 0,
      fill: 'transparent',
      stroke: '#ffffff',
      strokeWidth: 2,
      strokeDashArray: [8, 4],
      strokeUniform: true,
      selectable: false,
      evented: false,
      lockUniScaling: false,
    });
    ctx.canvas.add(rect);
    this.drawState = { startX: pointer.x, startY: pointer.y, shape: rect };

    // Create 4 dim overlay rects for immediate visual feedback.
    this.createDrawOverlays(ctx);
    this.updateDrawOverlays(ctx, pointer.x, pointer.y, 0, 0);
  }

  onMouseMove(
    ctx: ToolContext,
    pointer: { x: number; y: number },
    _e: TPointerEventInfo<TPointerEvent>,
  ): void {
    if (!this.drawState?.shape) return;
    const { startX, startY, shape } = this.drawState;
    const left = Math.min(startX, pointer.x);
    const top = Math.min(startY, pointer.y);
    const width = Math.abs(pointer.x - startX);
    const height = Math.abs(pointer.y - startY);
    shape.set({ left, top, width, height });
    this.updateDrawOverlays(ctx, left, top, width, height);
    ctx.canvas.renderAll();
  }

  onMouseUp(
    ctx: ToolContext,
    pointer: { x: number; y: number },
    _e: TPointerEventInfo<TPointerEvent>,
  ): void {
    if (!this.drawState) return;

    // Remove draw overlays before any finalization or snapshots.
    this.removeDrawOverlays(ctx);

    const { startX, startY, shape } = this.drawState;
    const dx = Math.abs(pointer.x - startX);
    const dy = Math.abs(pointer.y - startY);

    if (dx < 3 && dy < 3) {
      if (shape) ctx.canvas.remove(shape);
      this.drawState = null;
      ctx.setDrawing(false);
      ctx.canvas.renderAll();
      return;
    }

    if (shape instanceof Rect) {
      this.finalizeCrop(ctx, shape);
    }

    this.drawState = null;
    ctx.setDrawing(false);
    ctx.pushSnapshot();
    ctx.updateCounts();
    ctx.canvas.renderAll();
  }

  /** Return the current crop rect, if any. */
  getCropRect(): Rect | null {
    return this.cropRect;
  }

  /**
   * Set a crop rect from external coordinates (e.g. Window Select).
   * Replaces any existing crop.
   */
  setCropFromRect(ctx: ToolContext, x: number, y: number, w: number, h: number): void {
    if (this.cropRect) {
      ctx.canvas.remove(this.cropRect);
      this.removeCropOverlays(ctx);
    }

    const rect = new Rect({
      left: x,
      top: y,
      originX: 'left',
      originY: 'top',
      width: w,
      height: h,
      fill: 'transparent',
      stroke: '#ffffff',
      strokeWidth: 2,
      strokeDashArray: [8, 4],
      selectable: true,
      evented: true,
      hasRotatingPoint: false,
      lockRotation: true,
      strokeUniform: true,
      _wegweiserType: 'cropMask',
    } as any);

    ctx.canvas.add(rect);
    this.cropRect = rect;
    this.buildCropOverlays(ctx);
    ctx.canvas.setActiveObject(rect);
    ctx.canvas.renderAll();
  }

  /** Remove the crop rect and all overlays from the canvas and reset internal state. */
  clearCrop(ctx: ToolContext): void {
    if (!this.cropRect) return;
    ctx.canvas.remove(this.cropRect);
    this.removeCropOverlays(ctx);
    this.cropRect = null;
    ctx.canvas.renderAll();
  }

  /**
   * Scan the canvas for a cropMask object, then rebuild the dim overlays.
   * Called after loadFromJSON / restoreSnapshot so the handler re-adopts
   * any deserialized crop rect.
   */
  updateCropOverlays(ctx: ToolContext): void {
    // Remove old overlays from the canvas before clearing references.
    // (When called after loadFromJSON the objects are already gone, but during
    // live resize the old overlay rects are still on the canvas.)
    this.removeCropOverlays(ctx);
    this.cropRect = null;
    ctx.canvas.getObjects().forEach((obj) => {
      if ((obj as any)._wegweiserType === 'cropMask') {
        this.cropRect = obj as Rect;
      }
    });
    if (this.cropRect) {
      this.buildCropOverlays(ctx);
    }
  }

  /** Reset internal pointers without touching the canvas (called on canvas teardown). */
  resetState(): void {
    this.cropRect = null;
    this.cropOverlays = [];
    this.drawOverlays = [];
    this.drawState = null;
  }

  /** Hide crop visuals for export. */
  hideCropVisuals(): void {
    for (const overlay of this.cropOverlays) {
      overlay.set({ visible: false });
    }
    if (this.cropRect) {
      this.cropRect.set({ visible: false });
    }
  }

  /** Show crop visuals after export. */
  showCropVisuals(): void {
    for (const overlay of this.cropOverlays) {
      overlay.set({ visible: true });
    }
    if (this.cropRect) {
      this.cropRect.set({ visible: true });
    }
  }

  private finalizeCrop(ctx: ToolContext, rect: Rect): void {
    if (this.cropRect) {
      ctx.canvas.remove(this.cropRect);
      this.removeCropOverlays(ctx);
    }

    (rect as any)._wegweiserType = 'cropMask';
    rect.set({
      selectable: true,
      evented: true,
      hasRotatingPoint: false,
      lockRotation: true,
      strokeUniform: true,
    });
    this.cropRect = rect;
    this.buildCropOverlays(ctx);
    ctx.canvas.setActiveObject(rect);
  }

  private buildCropOverlays(ctx: ToolContext): void {
    if (!this.cropRect) return;
    this.removeCropOverlays(ctx);

    const inCropTool = ctx.getCurrentTool() === 'crop';

    // Hide and lock the crop rect when not in the crop tool.
    this.cropRect.set({
      visible: inCropTool,
      opacity: inCropTool ? 1 : 0,
      selectable: inCropTool,
      evented: inCropTool,
    });

    const cx = this.cropRect.left!;
    const cy = this.cropRect.top!;
    const cw = this.cropRect.width! * (this.cropRect.scaleX ?? 1);
    const ch = this.cropRect.height! * (this.cropRect.scaleY ?? 1);
    const iw = ctx.imageWidth;
    const ih = ctx.imageHeight;

    // Fully opaque when not in crop tool (hides cropped-out areas).
    const dimColor = inCropTool
      ? 'rgba(0, 0, 0, 0.5)'
      : 'rgba(0, 0, 0, 1)';
    const common = {
      fill: dimColor,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      excludeFromExport: true,
      _wegweiserType: 'cropOverlay',
    } as any;

    if (cy > 0) {
      this.cropOverlays.push(new Rect({ left: 0, top: 0, width: iw, height: cy, ...common }));
    }
    if (cy + ch < ih) {
      this.cropOverlays.push(new Rect({ left: 0, top: cy + ch, width: iw, height: ih - cy - ch, ...common }));
    }
    if (cx > 0) {
      this.cropOverlays.push(new Rect({ left: 0, top: cy, width: cx, height: ch, ...common }));
    }
    if (cx + cw < iw) {
      this.cropOverlays.push(new Rect({ left: cx + cw, top: cy, width: iw - cx - cw, height: ch, ...common }));
    }

    for (const overlay of this.cropOverlays) {
      ctx.canvas.add(overlay);
    }

    // Only bring crop rect to front when visible (in crop tool).
    // When hidden, keep overlays on top so they fully cover the outside area.
    if (inCropTool) {
      ctx.canvas.bringObjectToFront(this.cropRect);
    }
  }

  private removeCropOverlays(ctx: ToolContext): void {
    for (const overlay of this.cropOverlays) {
      ctx.canvas.remove(overlay);
    }
    this.cropOverlays = [];
  }

  /** Create 4 draw-time dim overlay rects (initially invisible). */
  private createDrawOverlays(ctx: ToolContext): void {
    this.removeDrawOverlays(ctx);
    const dimColor = 'rgba(0, 0, 0, 0.5)';
    const common = {
      fill: dimColor,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      excludeFromExport: true,
      _wegweiserType: 'cropDrawOverlay',
    } as any;
    for (let i = 0; i < 4; i++) {
      const r = new Rect({ left: 0, top: 0, width: 0, height: 0, ...common });
      this.drawOverlays.push(r);
      ctx.canvas.add(r);
    }
  }

  /** Update draw-time dim overlay positions to surround the given crop bounds. */
  private updateDrawOverlays(
    ctx: ToolContext,
    cx: number, cy: number, cw: number, ch: number,
  ): void {
    if (this.drawOverlays.length !== 4) return;
    const iw = ctx.imageWidth;
    const ih = ctx.imageHeight;
    const [top, bottom, left, right] = this.drawOverlays;
    // Top: full width, from y=0 to crop top
    top.set({ left: 0, top: 0, width: iw, height: Math.max(0, cy) });
    // Bottom: full width, from crop bottom to image bottom
    bottom.set({ left: 0, top: cy + ch, width: iw, height: Math.max(0, ih - cy - ch) });
    // Left: crop height, from x=0 to crop left
    left.set({ left: 0, top: cy, width: Math.max(0, cx), height: Math.max(0, ch) });
    // Right: crop height, from crop right to image right
    right.set({ left: cx + cw, top: cy, width: Math.max(0, iw - cx - cw), height: Math.max(0, ch) });
  }

  /** Remove draw-time dim overlays from the canvas. */
  private removeDrawOverlays(ctx: ToolContext): void {
    for (const overlay of this.drawOverlays) {
      ctx.canvas.remove(overlay);
    }
    this.drawOverlays = [];
  }

  identifiesObject(obj: FabricObject): boolean {
    const type = (obj as any)._wegweiserType;
    return type === 'cropMask' || type === 'cropOverlay' || type === 'cropDrawOverlay';
  }

  syncFromObject(_obj: FabricObject, _shared: SharedDefaults): void {}
  applyProperties(_ctx: ToolContext, _obj: FabricObject, _shared: SharedDefaults): void {}
}
