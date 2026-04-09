import { FabricImage, Rect, type FabricObject, type TPointerEvent, type TPointerEventInfo } from 'fabric';
import {
  clampRegion,
  clampOverlayRegion,
  renderBlurRegion,
  renderPixelateRegion,
} from '../obfuscation.js';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';

type DrawState = { startX: number; startY: number; shape: Rect | null };

export class ObfuscationToolHandler implements ToolHandler {
  readonly toolId = 'obfuscation';
  readonly propertiesComponentId = 'obfuscation';

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
      fill: 'rgba(128,128,128,0.3)',
      stroke: '#888',
      strokeWidth: 1,
      strokeDashArray: [4, 4],
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
      if (ctx.obfuscationEffect === 'blur') {
        this.finalizeGaussianBlur(ctx, shape, startX, startY, pointer.x, pointer.y);
      } else {
        this.finalizePixelate(ctx, shape, startX, startY, pointer.x, pointer.y);
      }
    }

    this.drawState = null;
    ctx.canvas.renderAll();
  }

  /**
   * Re-render a blur or pixelate overlay in place.
   * Called by setObfuscationEffect / setBlurRadius / setPixelateBlockSize in the main wrapper.
   */
  reRenderOverlay(ctx: ToolContext, obj: FabricImage): void {
    const wegType = (obj as any)._wegweiserType as string;
    if (wegType !== 'blurOverlay' && wegType !== 'pixelateOverlay') return;

    const bgImg = ctx.canvas.backgroundImage;
    if (!bgImg) return;
    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;

    const left = Math.round(obj.left ?? 0);
    const top = Math.round(obj.top ?? 0);
    const width = Math.round((obj.width ?? 0) * (obj.scaleX ?? 1));
    const height = Math.round((obj.height ?? 0) * (obj.scaleY ?? 1));

    const region = clampOverlayRegion(left, top, width, height, ctx.imageWidth, ctx.imageHeight);
    if (!region) return;

    let dataUrl: string;
    if (wegType === 'blurOverlay') {
      const radius = ctx.blurRadius;
      dataUrl = renderBlurRegion(bgEl, region, radius, ctx.imageWidth, ctx.imageHeight);
      (obj as any)._wegweiserBlurRadius = radius;
    } else {
      const blockSize = ctx.pixelateBlockSize;
      dataUrl = renderPixelateRegion(bgEl, region, blockSize);
      (obj as any)._wegweiserBlockSize = blockSize;
    }

    obj.setSrc(dataUrl).then(() => {
      if (!ctx.canvas) return;
      obj.set({
        left: region.left,
        top: region.top,
        scaleX: 1,
        scaleY: 1,
        width: region.width,
        height: region.height,
      });
      obj.setCoords();
      ctx.canvas.renderAll();
      ctx.pushSnapshot();
      ctx.updateCounts();
    });
  }

  private finalizeGaussianBlur(
    ctx: ToolContext,
    rect: Rect,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
  ): void {
    ctx.canvas.remove(rect);

    const region = clampRegion(sx, sy, ex, ey, ctx.imageWidth, ctx.imageHeight);
    if (!region) {
      ctx.setDrawing(false);
      return;
    }

    const bgImg = ctx.canvas.backgroundImage;
    if (!bgImg) {
      ctx.setDrawing(false);
      return;
    }
    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;
    const radius = ctx.blurRadius;
    const dataUrl = renderBlurRegion(bgEl, region, radius, ctx.imageWidth, ctx.imageHeight);

    FabricImage.fromURL(dataUrl).then((blurImg) => {
      if (!ctx.canvas) {
        ctx.setDrawing(false);
        return;
      }
      blurImg.set({
        left: region.left,
        top: region.top,
        originX: 'left',
        originY: 'top',
        selectable: true,
        evented: true,
        _wegweiserType: 'blurOverlay',
        _wegweiserEffect: 'blur',
        _wegweiserBlurRadius: radius,
      } as any);
      ctx.canvas.add(blurImg);
      ctx.setDrawing(false);
      ctx.pushSnapshot();
      ctx.updateCounts();
      ctx.canvas.setActiveObject(blurImg);
      ctx.canvas.renderAll();
    });
  }

  private finalizePixelate(
    ctx: ToolContext,
    rect: Rect,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
  ): void {
    ctx.canvas.remove(rect);

    const region = clampRegion(sx, sy, ex, ey, ctx.imageWidth, ctx.imageHeight);
    if (!region) {
      ctx.setDrawing(false);
      return;
    }

    const bgImg = ctx.canvas.backgroundImage;
    if (!bgImg) {
      ctx.setDrawing(false);
      return;
    }
    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;
    const blockSize = ctx.pixelateBlockSize;
    const dataUrl = renderPixelateRegion(bgEl, region, blockSize);

    FabricImage.fromURL(dataUrl).then((pixelImg) => {
      if (!ctx.canvas) {
        ctx.setDrawing(false);
        return;
      }
      pixelImg.set({
        left: region.left,
        top: region.top,
        originX: 'left',
        originY: 'top',
        selectable: true,
        evented: true,
        _wegweiserType: 'pixelateOverlay',
        _wegweiserEffect: 'pixelate',
        _wegweiserBlockSize: blockSize,
      } as any);
      ctx.canvas.add(pixelImg);
      ctx.setDrawing(false);
      ctx.pushSnapshot();
      ctx.updateCounts();
      ctx.canvas.setActiveObject(pixelImg);
      ctx.canvas.renderAll();
    });
  }

  identifiesObject(obj: FabricObject): boolean {
    const type = (obj as any)._wegweiserType;
    return type === 'blurOverlay' || type === 'pixelateOverlay';
  }

  syncFromObject(obj: FabricObject, shared: SharedDefaults): void {
    const effect = (obj as any)._wegweiserEffect;
    if (effect === 'blur' || effect === 'pixelate') shared.obfuscationEffect = effect;
    const radius = (obj as any)._wegweiserBlurRadius;
    if (typeof radius === 'number') shared.blurRadius = radius;
    const block = (obj as any)._wegweiserBlockSize;
    if (typeof block === 'number') shared.pixelateBlockSize = block;
  }

  applyProperties(ctx: ToolContext, obj: FabricObject, shared: SharedDefaults): void {
    if (!(obj instanceof FabricImage)) return;
    (obj as any)._wegweiserType = shared.obfuscationEffect === 'blur' ? 'blurOverlay' : 'pixelateOverlay';
    (obj as any)._wegweiserEffect = shared.obfuscationEffect;
    this.reRenderOverlay(ctx, obj);
  }
}
