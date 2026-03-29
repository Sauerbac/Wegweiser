/**
 * Svelte 5 runes-based wrapper around a Fabric.js Canvas.
 *
 * Manages:
 * - Canvas lifecycle (init, dispose)
 * - Background image loading (not part of serialized objects)
 * - Tool switching and drawing-mode configuration
 * - Internal undo/redo stack (JSON snapshots)
 * - Serialize/deserialize annotations (Fabric.js JSON, overlays only)
 * - toDataURL for preview generation (with optional crop)
 */

import {
  Canvas,
  Rect,
  Ellipse,
  Line,
  IText,
  PencilBrush,
  FabricImage,
  Group,
  Circle,
  FabricText,
  Polygon,
  type TPointerEventInfo,
  type TPointerEvent,
} from 'fabric';

export type AnnotationTool =
  | 'select'
  | 'arrow'
  | 'rectangle'
  | 'ellipse'
  | 'freehand'
  | 'text'
  | 'highlight'
  | 'callout'
  | 'blur'
  | 'crop'
  | 'window';

interface DrawState {
  startX: number;
  startY: number;
  shape: Rect | Ellipse | Line | null;
  arrowHead: Polygon | null;
}

const UNDO_CAP = 50;

export class FabricCanvasWrapper {
  /** The Fabric.js canvas instance. */
  private canvas: Canvas | null = null;

  /** Current active tool. */
  tool = $state<AnnotationTool>('select');

  /** Current annotation color. */
  color = $state('#ef4444');

  /** Current stroke width. */
  strokeWidth = $state(4);

  /** Current opacity (0–1). */
  opacity = $state(1);

  /** Internal undo stack of JSON snapshots. */
  private undoStack: string[] = [];
  /** Internal redo stack. */
  private redoStack: string[] = [];
  /** Whether we're currently loading from undo/redo (suppress snapshot). */
  private isRestoring = false;

  /** Reactive undo/redo availability. */
  canUndo = $state(false);
  canRedo = $state(false);

  /** Whether the canvas has any annotation objects. */
  hasAnnotations = $state(false);

  /** Count of objects on canvas (excluding crop mask internals). */
  objectCount = $state(0);

  /** Natural dimensions of the background image. */
  imageWidth = $state(0);
  imageHeight = $state(0);

  /** Current zoom/fit scale factor. */
  private fitScale = 1;

  /** Active draw state for drag-to-create tools. */
  private drawState: DrawState | null = null;

  /** Next callout number. */
  private nextCalloutNumber = 1;

  /** The crop mask rect (if any). */
  private cropRect: Rect | null = null;

  /** Dim overlay rects around the crop area. */
  private cropOverlays: Rect[] = [];

  /**
   * Initialize the Fabric.js canvas on the given HTML canvas element.
   * Loads the provided image URI as the non-selectable background.
   */
  async init(canvasEl: HTMLCanvasElement, imageUri: string): Promise<void> {
    // Load the image first to get natural dimensions.
    const img = await FabricImage.fromURL(imageUri);
    const w = img.width!;
    const h = img.height!;
    this.imageWidth = w;
    this.imageHeight = h;

    this.canvas = new Canvas(canvasEl, {
      width: w,
      height: h,
      selection: true,
    });

    // Set background image (not part of objects JSON).
    img.set({ selectable: false, evented: false });
    this.canvas.backgroundImage = img;
    this.canvas.renderAll();

    // Wire up event handlers.
    this.canvas.on('mouse:down', (e) => this.onMouseDown(e));
    this.canvas.on('mouse:move', (e) => this.onMouseMove(e));
    this.canvas.on('mouse:up', (e) => this.onMouseUp(e));

    // Track modifications for undo.
    this.canvas.on('object:added', () => this.onCanvasModified());
    this.canvas.on('object:modified', () => this.onCanvasModified());
    this.canvas.on('object:removed', () => this.onCanvasModified());

    // Push initial empty state.
    this.pushSnapshot();
  }

  /**
   * Resize the Fabric.js canvas element and set zoom so the full image
   * fits inside the given container dimensions.
   */
  updateFit(containerW: number, containerH: number): void {
    if (!this.canvas || this.imageWidth === 0 || this.imageHeight === 0) return;
    if (containerW === 0 || containerH === 0) return;

    const scale = Math.min(containerW / this.imageWidth, containerH / this.imageHeight);
    this.fitScale = scale;

    // Set the DOM element size to the scaled size.
    this.canvas.setDimensions({
      width: Math.round(this.imageWidth * scale),
      height: Math.round(this.imageHeight * scale),
    });

    // Set the viewport transform so Fabric.js maps scene coords correctly.
    this.canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
    this.canvas.renderAll();
  }

  /** Clean up the Fabric.js canvas. */
  dispose(): void {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.drawState = null;
    this.cropRect = null;
    this.cropOverlays = [];
    this.nextCalloutNumber = 1;
  }

  /** Set the active tool. */
  setTool(t: AnnotationTool): void {
    this.tool = t;
    if (!this.canvas) return;

    // Clear any in-progress draw state.
    this.drawState = null;

    if (t === 'freehand') {
      this.canvas.isDrawingMode = true;
      const brush = new PencilBrush(this.canvas);
      brush.color = this.color;
      brush.width = this.strokeWidth;
      this.canvas.freeDrawingBrush = brush;
      this.canvas.selection = false;
    } else if (t === 'select') {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = true;
      // Make all objects selectable.
      this.forEachAnnotation((obj) => {
        obj.set({ selectable: true, evented: true });
      });
    } else {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
      // Disable object selection while in a draw tool.
      this.canvas.discardActiveObject();
      this.forEachAnnotation((obj) => {
        obj.set({ selectable: false, evented: false });
      });
      this.canvas.renderAll();
    }
  }

  /** Update the annotation color. Also updates the selected object if any. */
  setColor(c: string): void {
    this.color = c;
    if (!this.canvas) return;
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = c;
    }
    this.updateSelectedObjectStyle();
  }

  /** Update the stroke width. Also updates the selected object if any. */
  setStrokeWidth(w: number): void {
    this.strokeWidth = w;
    if (!this.canvas) return;
    if (this.canvas.isDrawingMode && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.width = w;
    }
    this.updateSelectedObjectStyle();
  }

  /** Update the opacity. Also updates the selected object if any. */
  setOpacity(o: number): void {
    this.opacity = o;
    this.updateSelectedObjectStyle();
  }

  /** Delete the currently selected object(s). */
  deleteSelected(): void {
    if (!this.canvas) return;
    const active = this.canvas.getActiveObjects();
    if (active.length === 0) return;
    for (const obj of active) {
      // If deleting the crop rect, clear crop state.
      if (obj === this.cropRect) {
        this.clearCrop();
        continue;
      }
      this.canvas.remove(obj);
    }
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
  }

  /** Undo the last annotation change. */
  undo(): void {
    if (this.undoStack.length <= 1) return; // keep at least the initial state
    const current = this.undoStack.pop()!;
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.restoreSnapshot(prev);
  }

  /** Redo a previously undone change. */
  redo(): void {
    if (this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.restoreSnapshot(next);
  }

  /** Serialize the canvas overlay objects to JSON string. */
  serialize(): string {
    if (!this.canvas) return '{"objects":[]}';
    // Include custom properties in serialization.
    const json = this.canvas.toObject(['_wegweiserType', '_calloutNumber']);
    // Remove the backgroundImage from the serialized output (it's the base screenshot).
    delete (json as Record<string, unknown>).backgroundImage;
    return JSON.stringify(json);
  }

  /** Deserialize annotations JSON and add objects to the canvas. */
  async deserialize(json: string): Promise<void> {
    if (!this.canvas) return;
    this.isRestoring = true;

    // Save the background image reference.
    const bg = this.canvas.backgroundImage;

    // Load objects from JSON.
    const parsed = JSON.parse(json);
    await this.canvas.loadFromJSON(parsed);

    // Restore background image (loadFromJSON may clear it).
    this.canvas.backgroundImage = bg;
    this.canvas.renderAll();

    // Find crop rect if any.
    this.cropRect = null;
    this.canvas.getObjects().forEach((obj) => {
      if ((obj as any)._wegweiserType === 'cropMask') {
        this.cropRect = obj as Rect;
      }
    });

    // Recalculate callout numbering.
    this.recalcCalloutNumbers();

    // Update crop overlay if crop exists.
    if (this.cropRect) {
      this.updateCropOverlays();
    }

    this.isRestoring = false;
    this.updateCounts();

    // Reset undo stack to current state.
    this.undoStack = [this.serialize()];
    this.redoStack = [];
    this.updateUndoState();
  }

  /**
   * Export the canvas as a PNG data URL at full (natural) resolution.
   * If a crop rect exists, only the cropped region is exported.
   */
  toDataURL(): string {
    if (!this.canvas) return '';

    // Temporarily reset viewport to 1:1 for full-res export.
    const savedVpt = this.canvas.viewportTransform;
    const savedW = this.canvas.width;
    const savedH = this.canvas.height;
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.canvas.setDimensions({ width: this.imageWidth, height: this.imageHeight });

    // Temporarily hide crop visuals for export.
    this.hideCropVisuals();

    let dataUrl: string;
    if (this.cropRect) {
      const left = this.cropRect.left!;
      const top = this.cropRect.top!;
      const width = this.cropRect.width! * (this.cropRect.scaleX ?? 1);
      const height = this.cropRect.height! * (this.cropRect.scaleY ?? 1);
      dataUrl = this.canvas.toDataURL({
        format: 'png',
        multiplier: 1,
        left,
        top,
        width,
        height,
      });
    } else {
      dataUrl = this.canvas.toDataURL({ format: 'png', multiplier: 1 });
    }

    this.showCropVisuals();

    // Restore viewport.
    this.canvas.setDimensions({ width: savedW, height: savedH });
    this.canvas.setViewportTransform(savedVpt);
    this.canvas.renderAll();

    return dataUrl;
  }

  /** Get the underlying Fabric.js canvas (for advanced use). */
  getCanvas(): Canvas | null {
    return this.canvas;
  }

  // ─── Private helpers ──────────────────────────────────────────

  private onMouseDown(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas || !e.viewportPoint) return;
    const pointer = this.canvas.getScenePoint(e.e);
    const tool = this.tool;

    if (tool === 'select' || tool === 'freehand' || tool === 'window') return;

    if (tool === 'text') {
      this.placeText(pointer.x, pointer.y);
      return;
    }

    if (tool === 'callout') {
      this.placeCallout(pointer.x, pointer.y);
      return;
    }

    // Start drag for shape tools.
    this.drawState = {
      startX: pointer.x,
      startY: pointer.y,
      shape: null,
      arrowHead: null,
    };

    if (tool === 'rectangle' || tool === 'crop') {
      const rect = new Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: tool === 'crop' ? 'transparent' : 'transparent',
        stroke: tool === 'crop' ? '#ffffff' : this.color,
        strokeWidth: tool === 'crop' ? 2 : this.strokeWidth,
        strokeDashArray: tool === 'crop' ? [8, 4] : undefined,
        opacity: this.opacity,
        selectable: false,
        evented: false,
      });
      this.canvas.add(rect);
      this.drawState.shape = rect;
    } else if (tool === 'ellipse') {
      const ellipse = new Ellipse({
        left: pointer.x,
        top: pointer.y,
        rx: 0,
        ry: 0,
        fill: 'transparent',
        stroke: this.color,
        strokeWidth: this.strokeWidth,
        opacity: this.opacity,
        selectable: false,
        evented: false,
      });
      this.canvas.add(ellipse);
      this.drawState.shape = ellipse;
    } else if (tool === 'highlight') {
      const rect = new Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: this.color,
        stroke: '',
        strokeWidth: 0,
        opacity: 0.3,
        selectable: false,
        evented: false,
      });
      this.canvas.add(rect);
      this.drawState.shape = rect;
    } else if (tool === 'arrow') {
      const line = new Line([pointer.x, pointer.y, pointer.x, pointer.y], {
        stroke: this.color,
        strokeWidth: this.strokeWidth,
        opacity: this.opacity,
        selectable: false,
        evented: false,
      });
      this.canvas.add(line);
      this.drawState.shape = line;
    } else if (tool === 'blur') {
      const rect = new Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: 'rgba(128,128,128,0.3)',
        stroke: '#888',
        strokeWidth: 1,
        strokeDashArray: [4, 4],
        selectable: false,
        evented: false,
      });
      this.canvas.add(rect);
      this.drawState.shape = rect;
    }
  }

  private onMouseMove(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas || !this.drawState?.shape) return;
    const pointer = this.canvas.getScenePoint(e.e);
    const { startX, startY, shape } = this.drawState;
    const tool = this.tool;

    if (tool === 'rectangle' || tool === 'highlight' || tool === 'crop' || tool === 'blur') {
      const left = Math.min(startX, pointer.x);
      const top = Math.min(startY, pointer.y);
      const width = Math.abs(pointer.x - startX);
      const height = Math.abs(pointer.y - startY);
      (shape as Rect).set({ left, top, width, height });
    } else if (tool === 'ellipse') {
      const left = Math.min(startX, pointer.x);
      const top = Math.min(startY, pointer.y);
      const rx = Math.abs(pointer.x - startX) / 2;
      const ry = Math.abs(pointer.y - startY) / 2;
      (shape as Ellipse).set({ left, top, rx, ry });
    } else if (tool === 'arrow') {
      (shape as Line).set({ x2: pointer.x, y2: pointer.y });
    }

    this.canvas.renderAll();
  }

  private onMouseUp(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas || !this.drawState) return;
    const pointer = this.canvas.getScenePoint(e.e);
    const { startX, startY, shape } = this.drawState;
    const tool = this.tool;

    // Minimum size check — discard tiny accidental clicks.
    const dx = Math.abs(pointer.x - startX);
    const dy = Math.abs(pointer.y - startY);
    if (dx < 3 && dy < 3) {
      if (shape) this.canvas.remove(shape);
      this.drawState = null;
      return;
    }

    if (tool === 'arrow' && shape instanceof Line) {
      this.finalizeArrow(shape, pointer.x, pointer.y);
    } else if (tool === 'crop' && shape instanceof Rect) {
      this.finalizeCrop(shape);
    } else if (tool === 'blur' && shape instanceof Rect) {
      this.finalizeBlur(shape, startX, startY, pointer.x, pointer.y);
    } else if (shape) {
      // Rectangle, Ellipse, Highlight — just make selectable.
      shape.set({ selectable: true, evented: true });
      this.canvas.setActiveObject(shape);
    }

    this.drawState = null;
    this.canvas.renderAll();
  }

  /** Finalize an arrow: replace the Line with a Group(Line + arrowhead Polygon). */
  private finalizeArrow(line: Line, endX: number, endY: number): void {
    if (!this.canvas) return;
    const x1 = line.x1!;
    const y1 = line.y1!;
    const x2 = endX;
    const y2 = endY;

    this.canvas.remove(line);

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(this.strokeWidth * 4, 16);
    const headAngle = Math.PI / 6;

    const arrowHead = new Polygon(
      [
        { x: x2, y: y2 },
        {
          x: x2 - headLen * Math.cos(angle - headAngle),
          y: y2 - headLen * Math.sin(angle - headAngle),
        },
        {
          x: x2 - headLen * Math.cos(angle + headAngle),
          y: y2 - headLen * Math.sin(angle + headAngle),
        },
      ],
      {
        fill: this.color,
        stroke: this.color,
        strokeWidth: 1,
        selectable: false,
        evented: false,
      },
    );

    const arrowLine = new Line([x1, y1, x2, y2], {
      stroke: this.color,
      strokeWidth: this.strokeWidth,
      selectable: false,
      evented: false,
    });

    const group = new Group([arrowLine, arrowHead], {
      selectable: true,
      evented: true,
      opacity: this.opacity,
    });

    this.canvas.add(group);
    this.canvas.setActiveObject(group);
  }

  /** Place an editable IText at the given position. */
  private placeText(x: number, y: number): void {
    if (!this.canvas) return;
    const text = new IText('Text', {
      left: x,
      top: y,
      fill: this.color,
      fontSize: Math.max(this.strokeWidth * 6, 24),
      fontFamily: 'system-ui, -apple-system, sans-serif',
      opacity: this.opacity,
      selectable: true,
      evented: true,
    });
    this.canvas.add(text);

    // Switch to select mode so the IText can receive keyboard input,
    // then activate editing.
    this.setTool('select');
    this.canvas.setActiveObject(text);
    text.enterEditing();
    text.selectAll();
  }

  /** Place a numbered callout (circle + number) at the given position. */
  private placeCallout(x: number, y: number): void {
    if (!this.canvas) return;
    const num = this.nextCalloutNumber++;
    const radius = Math.max(this.strokeWidth * 3, 16);

    const circle = new Circle({
      radius,
      fill: this.color,
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
      opacity: this.opacity,
      _wegweiserType: 'callout',
      _calloutNumber: num,
    } as any);

    this.canvas.add(group);
    this.canvas.setActiveObject(group);
  }

  /** Finalize a crop rect: replace any existing crop, set up dim overlays. */
  private finalizeCrop(rect: Rect): void {
    if (!this.canvas) return;
    // Remove old crop if exists.
    if (this.cropRect) {
      this.canvas.remove(this.cropRect);
      this.removeCropOverlays();
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
    this.updateCropOverlays();
    this.canvas.setActiveObject(rect);
  }

  /**
   * Finalize a blur rect: pixelate the background region and replace the
   * placeholder rect with a FabricImage of the pixelated data.
   */
  private finalizeBlur(rect: Rect, sx: number, sy: number, ex: number, ey: number): void {
    if (!this.canvas) return;
    this.canvas.remove(rect);

    const left = Math.max(0, Math.min(sx, ex));
    const top = Math.max(0, Math.min(sy, ey));
    const width = Math.min(Math.abs(ex - sx), this.imageWidth - left);
    const height = Math.min(Math.abs(ey - sy), this.imageHeight - top);
    if (width < 4 || height < 4) return;

    // Grab the region from the background image.
    const bgImg = this.canvas.backgroundImage;
    if (!bgImg) return;

    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(bgEl, left, top, width, height, 0, 0, width, height);

    // Pixelate: downsample then upscale with nearest-neighbor.
    const blockSize = 10;
    const smallW = Math.max(1, Math.ceil(width / blockSize));
    const smallH = Math.max(1, Math.ceil(height / blockSize));

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = smallW;
    smallCanvas.height = smallH;
    const smallCtx = smallCanvas.getContext('2d')!;
    smallCtx.drawImage(offscreen, 0, 0, smallW, smallH);

    // Upscale back with pixelation.
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, width, height);

    const dataUrl = offscreen.toDataURL('image/png');
    FabricImage.fromURL(dataUrl).then((pixelImg) => {
      pixelImg.set({
        left,
        top,
        selectable: true,
        evented: true,
        _wegweiserType: 'pixelateOverlay',
      } as any);
      this.canvas!.add(pixelImg);
      this.canvas!.setActiveObject(pixelImg);
      this.canvas!.renderAll();
    });
  }

  /** Set the crop rect from external coordinates (used by Window Select). */
  setCropFromRect(x: number, y: number, w: number, h: number): void {
    if (!this.canvas) return;

    // Remove old crop.
    if (this.cropRect) {
      this.canvas.remove(this.cropRect);
      this.removeCropOverlays();
    }

    const rect = new Rect({
      left: x,
      top: y,
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

    this.canvas.add(rect);
    this.cropRect = rect;
    this.updateCropOverlays();
    this.canvas.setActiveObject(rect);
    this.canvas.renderAll();
  }

  /** Clear the crop rect and overlays. */
  clearCrop(): void {
    if (!this.canvas || !this.cropRect) return;
    this.canvas.remove(this.cropRect);
    this.removeCropOverlays();
    this.cropRect = null;
    this.canvas.renderAll();
  }

  /** Create/update the 4 dim overlay rects around the crop area. */
  private updateCropOverlays(): void {
    if (!this.canvas || !this.cropRect) return;
    this.removeCropOverlays();

    const cx = this.cropRect.left!;
    const cy = this.cropRect.top!;
    const cw = this.cropRect.width! * (this.cropRect.scaleX ?? 1);
    const ch = this.cropRect.height! * (this.cropRect.scaleY ?? 1);
    const iw = this.imageWidth;
    const ih = this.imageHeight;

    const dimColor = 'rgba(0, 0, 0, 0.5)';
    const common = {
      fill: dimColor,
      selectable: false,
      evented: false,
      excludeFromExport: true,
      _wegweiserType: 'cropOverlay',
    } as any;

    // Top strip.
    if (cy > 0) {
      this.cropOverlays.push(new Rect({ left: 0, top: 0, width: iw, height: cy, ...common }));
    }
    // Bottom strip.
    if (cy + ch < ih) {
      this.cropOverlays.push(new Rect({ left: 0, top: cy + ch, width: iw, height: ih - cy - ch, ...common }));
    }
    // Left strip (between top and bottom).
    if (cx > 0) {
      this.cropOverlays.push(new Rect({ left: 0, top: cy, width: cx, height: ch, ...common }));
    }
    // Right strip (between top and bottom).
    if (cx + cw < iw) {
      this.cropOverlays.push(new Rect({ left: cx + cw, top: cy, width: iw - cx - cw, height: ch, ...common }));
    }

    for (const overlay of this.cropOverlays) {
      this.canvas.add(overlay);
    }

    // Ensure crop rect is above overlays.
    this.canvas.bringObjectToFront(this.cropRect);
  }

  /** Remove all crop overlay rects from the canvas. */
  private removeCropOverlays(): void {
    if (!this.canvas) return;
    for (const overlay of this.cropOverlays) {
      this.canvas.remove(overlay);
    }
    this.cropOverlays = [];
  }

  /** Hide crop visuals for export (overlays + crop rect stroke). */
  private hideCropVisuals(): void {
    for (const overlay of this.cropOverlays) {
      overlay.set({ visible: false });
    }
    if (this.cropRect) {
      this.cropRect.set({ visible: false });
    }
  }

  /** Show crop visuals after export. */
  private showCropVisuals(): void {
    for (const overlay of this.cropOverlays) {
      overlay.set({ visible: true });
    }
    if (this.cropRect) {
      this.cropRect.set({ visible: true });
    }
  }

  /** Iterate over all annotation objects (excluding crop overlays). */
  private forEachAnnotation(fn: (obj: any) => void): void {
    if (!this.canvas) return;
    this.canvas.getObjects().forEach((obj) => {
      if ((obj as any)._wegweiserType !== 'cropOverlay') {
        fn(obj);
      }
    });
  }

  /** Update style of the currently selected object. */
  private updateSelectedObjectStyle(): void {
    if (!this.canvas) return;
    const active = this.canvas.getActiveObject();
    if (!active) return;

    if (active instanceof IText) {
      active.set({ fill: this.color });
    } else if (active instanceof Group) {
      // For groups (arrows, callouts), update child colors.
      active.getObjects().forEach((child) => {
        if (child instanceof Line || child instanceof Polygon) {
          child.set({ stroke: this.color, fill: this.color });
        } else if (child instanceof Circle) {
          child.set({ fill: this.color });
        }
      });
      active.set({ opacity: this.opacity });
    } else {
      if (active.stroke) active.set({ stroke: this.color, strokeWidth: this.strokeWidth });
      if (active.fill && active.fill !== 'transparent') active.set({ fill: this.color });
      active.set({ opacity: this.opacity });
    }

    this.canvas.renderAll();
  }

  /** Push a JSON snapshot onto the undo stack. */
  private pushSnapshot(): void {
    const json = this.serialize();
    if (this.undoStack.length >= UNDO_CAP) {
      this.undoStack.shift();
    }
    this.undoStack.push(json);
    this.redoStack = [];
    this.updateUndoState();
  }

  /** Restore canvas from a JSON snapshot. */
  private async restoreSnapshot(json: string): Promise<void> {
    if (!this.canvas) return;
    this.isRestoring = true;
    const bg = this.canvas.backgroundImage;

    const parsed = JSON.parse(json);
    await this.canvas.loadFromJSON(parsed);

    this.canvas.backgroundImage = bg;

    // Rebuild crop state.
    this.cropRect = null;
    this.cropOverlays = [];
    this.canvas.getObjects().forEach((obj) => {
      if ((obj as any)._wegweiserType === 'cropMask') {
        this.cropRect = obj as Rect;
      }
    });
    if (this.cropRect) {
      this.updateCropOverlays();
    }

    this.recalcCalloutNumbers();
    this.canvas.renderAll();
    this.isRestoring = false;
    this.updateUndoState();
    this.updateCounts();
  }

  /** Called when objects are added/modified/removed. */
  private onCanvasModified(): void {
    if (this.isRestoring) return;
    this.pushSnapshot();
    this.updateCounts();

    // Update crop overlays if the crop rect was modified.
    if (this.cropRect) {
      this.updateCropOverlays();
    }
  }

  /** Update reactive undo/redo state. */
  private updateUndoState(): void {
    this.canUndo = this.undoStack.length > 1;
    this.canRedo = this.redoStack.length > 0;
  }

  /** Update reactive object counts. */
  private updateCounts(): void {
    if (!this.canvas) {
      this.hasAnnotations = false;
      this.objectCount = 0;
      return;
    }
    let count = 0;
    this.canvas.getObjects().forEach((obj) => {
      const type = (obj as any)._wegweiserType;
      if (type !== 'cropOverlay') {
        count++;
      }
    });
    this.objectCount = count;
    this.hasAnnotations = count > 0;
  }

  /** Recalculate the next callout number from existing callouts on canvas. */
  private recalcCalloutNumbers(): void {
    let max = 0;
    if (!this.canvas) return;
    this.canvas.getObjects().forEach((obj) => {
      const n = (obj as any)._calloutNumber;
      if (typeof n === 'number' && n > max) max = n;
    });
    this.nextCalloutNumber = max + 1;
  }
}
