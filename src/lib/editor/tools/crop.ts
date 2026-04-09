import { Rect, type FabricObject, type TPointerEvent, type TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

type DrawState = { startX: number; startY: number; shape: Rect | null };

export class CropToolHandler implements ToolHandler {
  readonly toolId = 'crop';
  readonly propertiesComponentId = 'crop';

  private cropRect: Rect | null = null;
  private cropOverlays: Rect[] = [];
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
    ctx.canvas.renderAll();
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancel(ctx);
  }

  cancel(ctx: ToolContext): boolean {
    if (!this.drawState) return false;
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
    ctx.canvas.renderAll();
  }

  onMouseUp(
    ctx: ToolContext,
    pointer: { x: number; y: number },
    _e: TPointerEventInfo<TPointerEvent>,
  ): void {
    if (!this.drawState) return;
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
    this.cropRect = null;
    this.cropOverlays = [];
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

    const cx = this.cropRect.left!;
    const cy = this.cropRect.top!;
    const cw = this.cropRect.width! * (this.cropRect.scaleX ?? 1);
    const ch = this.cropRect.height! * (this.cropRect.scaleY ?? 1);
    const iw = ctx.imageWidth;
    const ih = ctx.imageHeight;

    const dimColor = 'rgba(0, 0, 0, 0.5)';
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

    ctx.canvas.bringObjectToFront(this.cropRect);
  }

  private removeCropOverlays(ctx: ToolContext): void {
    for (const overlay of this.cropOverlays) {
      ctx.canvas.remove(overlay);
    }
    this.cropOverlays = [];
  }

  identifiesObject(obj: FabricObject): boolean {
    const type = (obj as any)._wegweiserType;
    return type === 'cropMask' || type === 'cropOverlay';
  }

  syncFromObject(_obj: FabricObject, _shared: SharedDefaults): void {}
  applyProperties(_ctx: ToolContext, _obj: FabricObject, _shared: SharedDefaults): void {}
}
