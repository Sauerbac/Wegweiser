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
  ActiveSelection,
  Rect,
  Ellipse,
  Line,
  Path,
  IText,
  PencilBrush,
  FabricImage,
  Group,
  Circle,
  FabricText,
  Polygon,
  Control,
  Point,
  util,
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
  | 'obfuscation'
  | 'crop';

export type ObfuscationEffect = 'blur' | 'pixelate';

interface DrawState {
  startX: number;
  startY: number;
  shape: Rect | Ellipse | Line | Path | null;
  arrowHead: Polygon | null;
}

/** State for the arrow polyline (click-to-add-waypoints) mode. */
interface ArrowPolylineState {
  /** Accumulated waypoints so far (at least one). */
  points: { x: number; y: number }[];
  /**
   * Live preview path showing all committed waypoints + cursor position.
   * Rebuilt on every mouse:move. Uses standard stroke (not dashed).
   */
  previewPath: Path | null;
  /** Color/strokeWidth captured at polyline start (for consistent preview). */
  color: string;
  strokeWidth: number;
}

const UNDO_CAP = 50;

/**
 * Convert an array of waypoints to a smooth SVG path string using
 * Catmull-Rom → Cubic Bézier conversion.
 * 2-point paths use a straight line; 3+ points use smooth curves.
 */
function waypointsToSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return `M 0,0`;
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i + 2 < points.length ? points[i + 2] : p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x},${p2.y}`;
  }
  return d;
}

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

  /** Whether shapes (rectangle/ellipse) should have a fill. */
  fillEnabled = $state(false);

  /** Fill color for shapes (rectangle/ellipse). */
  fillColor = $state('#ef4444');

  /** Active effect mode for the Obfuscation tool. */
  obfuscationEffect = $state<ObfuscationEffect>('blur');

  /** Blur radius for gaussian blur (px). */
  blurRadius = $state(10);

  /** Block size for pixelate effect (px). */
  pixelateBlockSize = $state(10);

  /** Internal undo stack of JSON snapshots. */
  private undoStack: string[] = [];
  /** Internal redo stack. */
  private redoStack: string[] = [];
  /** Whether we're currently loading from undo/redo (suppress snapshot). */
  private isRestoring = false;
  /** Whether the user is currently dragging to create a shape (suppress intermediate snapshots). */
  isDrawing = $state(false);
  /** Debounce timer for coalescing rapid canvas-modification events (e.g. freehand path:created). */
  private _modifiedTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reactive undo/redo availability. */
  canUndo = $state(false);
  canRedo = $state(false);

  /** Whether the canvas has any annotation objects. */
  hasAnnotations = $state(false);

  /** Count of objects on canvas (excluding crop mask internals). */
  objectCount = $state(0);

  /** Count of currently selected objects. */
  selectedCount = $state(0);

  /** Natural dimensions of the background image. */
  imageWidth = $state(0);
  imageHeight = $state(0);

  /** Current zoom/fit scale factor. */
  private fitScale = 1;

  /** Active draw state for drag-to-create tools. */
  private drawState: DrawState | null = null;

  /** Active state for arrow polyline (click-to-add-waypoints) mode. */
  private arrowPolylineState: ArrowPolylineState | null = null;

  /**
   * True while the user is in arrow polyline mode (between the first click
   * that starts the polyline and the final Enter / double-click).
   */
  arrowPolylineMode = $state(false);

  /**
   * The Fabric object id of the polyline-arrow currently in edit mode
   * (waypoint handles visible). null means no arrow is being edited.
   */
  arrowEditingId = $state<string | null>(null);

  /** Next callout number. */
  private nextCalloutNumber = 1;

  /** The crop mask rect (if any). */
  private cropRect: Rect | null = null;

  /** Dim overlay rects around the crop area. */
  private cropOverlays: Rect[] = [];

  /** Clipboard buffer for copy/paste. */
  private clipboard: any[] = [];

  /** Last known mouse position in scene (canvas) coordinates, updated on every mouse:move. */
  private lastMouseScenePos: { x: number; y: number } | null = null;

  /** Keyboard event listeners for Shift-to-constrain. */
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private _onKeyUp: ((e: KeyboardEvent) => void) | null = null;

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

    console.log('[FabricCanvas] init: img dimensions', w, h, 'dpr', window.devicePixelRatio);

    this.canvas = new Canvas(canvasEl, {
      width: w,
      height: h,
      selection: true,
      uniformScaling: false,
    });

    console.log('[FabricCanvas] init: canvas logical', this.canvas.width, this.canvas.height,
      'lower el', canvasEl.width, canvasEl.height,
      'css', canvasEl.style.width, canvasEl.style.height,
      'backgroundVpt', this.canvas.backgroundVpt);

    // Set background image (not part of objects JSON).
    // In Fabric 7 the default origin is 'center', so we must pin it to 'left'/'top'
    // so that left=0, top=0 places the image at the canvas origin, not its center.
    img.set({ selectable: false, evented: false, originX: 'left', originY: 'top', left: 0, top: 0 });
    this.canvas.backgroundImage = img;
    this.canvas.renderAll();

    // Wire up event handlers.
    this.canvas.on('mouse:down', (e) => this.onMouseDown(e));
    this.canvas.on('mouse:move', (e) => this.onMouseMove(e));
    this.canvas.on('mouse:up', (e) => this.onMouseUp(e));

    // Shift key: enable uniform (constrained) scaling while held.
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && this.canvas) {
        this.canvas.uniformScaling = true;
      }
    };
    this._onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && this.canvas) {
        this.canvas.uniformScaling = false;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);

    // Track modifications for undo.
    this.canvas.on('object:added', () => this.onCanvasModified());
    this.canvas.on('object:modified', (e) => {
      // Re-render blur/pixelate overlays when they are moved or scaled.
      const obj = e.target as any;
      if (obj && (obj._wegweiserType === 'blurOverlay' || obj._wegweiserType === 'pixelateOverlay')) {
        this.reRenderOverlay(obj as FabricImage);
        // Don't call onCanvasModified here — reRenderOverlay will handle it
        // after the async image update completes.
        return;
      }
      this.onCanvasModified();
    });
    this.canvas.on('object:removed', () => this.onCanvasModified());

    // Track selection changes.
    this.canvas.on('selection:created', (e) => {
      this.updateSelectedCount();
      const target = (e as any).selected?.[0];
      if (target && (target as any).customType === 'polyline-arrow') {
        this.enterArrowEditMode(target as Group);
      }
    });
    this.canvas.on('selection:updated', (e) => {
      this.updateSelectedCount();
      const newTarget = (e as any).selected?.[0];
      if (newTarget && this.arrowEditingId !== null && (newTarget as any)._arrowUid !== this.arrowEditingId) {
        this.exitArrowEditMode();
      }
      if (newTarget && (newTarget as any).customType === 'polyline-arrow' &&
          (newTarget as any)._arrowUid !== this.arrowEditingId) {
        this.enterArrowEditMode(newTarget as Group);
      }
    });
    this.canvas.on('selection:cleared', () => {
      this.updateSelectedCount();
      if (this.arrowEditingId !== null) {
        this.exitArrowEditMode();
      }
    });

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

    console.log('[FabricCanvas] updateFit: container', containerW, containerH, 'scale', scale);

    // Resize only the CSS display size; the backing pixel buffer stays at the
    // natural image dimensions (imageWidth × imageHeight) so that:
    //   - the background image fills the buffer exactly at 1:1
    //   - all shape/mouse coordinates stay in natural image space (0..imageWidth, 0..imageHeight)
    //   - Fabric's getScenePoint auto-corrects for the CSS-to-buffer ratio
    this.canvas.setDimensions(
      { width: Math.round(this.imageWidth * scale), height: Math.round(this.imageHeight * scale) },
      { cssOnly: true },
    );

    const el = this.canvas.getElement();
    console.log('[FabricCanvas] updateFit after: el.width', el.width, 'el.height', el.height,
      'css', el.style.width, el.style.height,
      'vpt', this.canvas.viewportTransform);

    this.canvas.renderAll();
  }

  /** Clean up the Fabric.js canvas. */
  dispose(): void {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener('keyup', this._onKeyUp);
    this._onKeyDown = null;
    this._onKeyUp = null;

    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = [];
    this.drawState = null;
    this.arrowPolylineState = null;
    this.arrowPolylineMode = false;
    this.arrowEditingId = null;
    this.cropRect = null;
    this.cropOverlays = [];
    this.nextCalloutNumber = 1;
    this.selectedCount = 0;
    this.isDrawing = false;
    this.lastMouseScenePos = null;
    if (this._modifiedTimer !== null) {
      clearTimeout(this._modifiedTimer);
      this._modifiedTimer = null;
    }
  }

  /** Set the active tool. */
  setTool(t: AnnotationTool): void {
    this.tool = t;
    if (!this.canvas) return;

    // Clear any in-progress draw state.
    this.drawState = null;
    // Clear any in-progress polyline.
    this.cancelArrowPolyline();

    if (t === 'freehand') {
      this.canvas.isDrawingMode = true;
      const brush = new PencilBrush(this.canvas);
      brush.color = this.color;
      brush.width = this.strokeWidth;
      this.canvas.freeDrawingBrush = brush;
      this.canvas.selection = false;
    } else if (t === 'obfuscation' || t === 'crop') {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
      this.canvas.discardActiveObject();
      this.forEachAnnotation((obj) => {
        obj.set({ selectable: false, evented: false });
      });
      this.canvas.renderAll();
    } else if (t === 'select') {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = true;
      // Make all objects selectable.
      this.forEachAnnotation((obj) => {
        obj.set({ selectable: true, evented: true });
      });
    } else if (t === 'text') {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
      // In text mode, disable selection on all objects but keep IText objects
      // evented so that clicking on an existing text enters editing mode.
      this.canvas.discardActiveObject();
      this.forEachAnnotation((obj) => {
        if (obj instanceof IText) {
          obj.set({ selectable: false, evented: true });
        } else {
          obj.set({ selectable: false, evented: false });
        }
      });
      this.canvas.renderAll();
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

  /** Toggle fill on/off for shapes. Also updates the selected object if any. */
  setFillEnabled(enabled: boolean): void {
    this.fillEnabled = enabled;
    this.updateSelectedObjectStyle();
  }

  /** Update the fill color. Also updates the selected object if any. */
  setFillColor(c: string): void {
    this.fillColor = c;
    this.updateSelectedObjectStyle();
  }

  /** Set the obfuscation effect mode. */
  setObfuscationEffect(effect: ObfuscationEffect): void {
    this.obfuscationEffect = effect;
    const active = this.canvas?.getActiveObject();
    if (
      active &&
      ((active as any)._wegweiserType === 'blurOverlay' ||
        (active as any)._wegweiserType === 'pixelateOverlay')
    ) {
      (active as any)._wegweiserType = effect === 'blur' ? 'blurOverlay' : 'pixelateOverlay';
      (active as any)._wegweiserEffect = effect;
      this.reRenderOverlay(active as FabricImage);
    }
  }

  /** Set the blur radius for the gaussian blur effect. */
  setBlurRadius(r: number): void {
    this.blurRadius = r;
    // Re-render any currently selected blur overlay with the new radius.
    const active = this.canvas?.getActiveObject();
    if (active && (active as any)._wegweiserType === 'blurOverlay') {
      this.reRenderOverlay(active as FabricImage);
    }
  }

  /** Set the block size for the pixelate effect. */
  setPixelateBlockSize(size: number): void {
    this.pixelateBlockSize = size;
    // Re-render any currently selected pixelate overlay with the new block size.
    const active = this.canvas?.getActiveObject();
    if (active && (active as any)._wegweiserType === 'pixelateOverlay') {
      this.reRenderOverlay(active as FabricImage);
    }
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

  /** Select all annotation objects on the canvas. */
  selectAll(): void {
    if (!this.canvas || this.tool !== 'select') return;
    const objs = this.canvas.getObjects().filter(
      (obj) => (obj as any)._wegweiserType !== 'cropOverlay' && obj !== this.cropRect,
    );
    if (objs.length === 0) return;
    if (objs.length === 1) {
      this.canvas.setActiveObject(objs[0]);
    } else {
      const sel = new ActiveSelection(objs, { canvas: this.canvas });
      this.canvas.setActiveObject(sel);
    }
    this.canvas.requestRenderAll();
  }

  /** Discard the current selection without switching tools. */
  discardSelection(): void {
    if (!this.canvas) return;
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  /**
   * Cancel an in-progress shape drag (if any) without adding it to the canvas.
   * Returns true if a draw was cancelled, false if nothing was in progress.
   */
  cancelDrawing(): boolean {
    if (!this.canvas) return false;
    let cancelled = false;
    if (this.drawState) {
      const { shape } = this.drawState;
      if (shape) this.canvas.remove(shape);
      this.drawState = null;
      this.isDrawing = false;
      cancelled = true;
    }
    if (this.arrowPolylineState) {
      this.cancelArrowPolyline();
      cancelled = true;
    }
    if (cancelled) this.canvas.renderAll();
    return cancelled;
  }

  /** Cut selected objects: copy them to the clipboard, then delete them. */
  async cutSelected(): Promise<void> {
    await this.copySelected();
    this.deleteSelected();
  }

  /** Copy selected objects to internal clipboard. */
  async copySelected(): Promise<void> {
    if (!this.canvas) return;
    const active = this.canvas.getActiveObjects();
    if (active.length === 0) return;
    // Clone each object via toObject.
    this.clipboard = await Promise.all(active.map((obj) => obj.clone(['_wegweiserType', '_calloutNumber', '_wegweiserEffect', '_wegweiserBlurRadius', '_wegweiserBlockSize', 'customType', 'arrowColor', 'waypointData', '_arrowUid', '_waypointOriginLeft', '_waypointOriginTop'])));
  }

  /** Paste previously copied objects, centering them at the last known mouse position. */
  async pasteSelected(): Promise<void> {
    if (!this.canvas || this.clipboard.length === 0) return;
    this.canvas.discardActiveObject();
    const clones = await Promise.all(this.clipboard.map((obj) => obj.clone(['_wegweiserType', '_calloutNumber', '_wegweiserEffect', '_wegweiserBlurRadius', '_wegweiserBlockSize', 'customType', 'arrowColor', 'waypointData', '_arrowUid', '_waypointOriginLeft', '_waypointOriginTop'])));
    // Pasted polyline-arrows get fresh _arrowUid so they don't conflict with the originals.
    for (const clone of clones) {
      if ((clone as any).customType === 'polyline-arrow') {
        (clone as any)._arrowUid = Math.random().toString(36).slice(2, 10);
      }
    }

    if (this.lastMouseScenePos) {
      // Compute the bounding box of all clones in their original positions.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const clone of clones) {
        const l = clone.left ?? 0;
        const t = clone.top ?? 0;
        const w = clone.getScaledWidth?.() ?? clone.width ?? 0;
        const h = clone.getScaledHeight?.() ?? clone.height ?? 0;
        minX = Math.min(minX, l);
        minY = Math.min(minY, t);
        maxX = Math.max(maxX, l + w);
        maxY = Math.max(maxY, t + h);
      }
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const dx = this.lastMouseScenePos.x - centerX;
      const dy = this.lastMouseScenePos.y - centerY;
      for (const clone of clones) {
        clone.set({ left: (clone.left ?? 0) + dx, top: (clone.top ?? 0) + dy, selectable: true, evented: true });
        this.canvas.add(clone);
      }
    } else {
      // Fallback: no mouse position known — offset by 10px from original.
      const OFFSET = 10;
      for (const clone of clones) {
        clone.set({ left: (clone.left ?? 0) + OFFSET, top: (clone.top ?? 0) + OFFSET, selectable: true, evented: true });
        this.canvas.add(clone);
      }
    }

    if (clones.length === 1) {
      this.canvas.setActiveObject(clones[0]);
    }
    this.canvas.requestRenderAll();
    // Shift the clipboard so repeated pastes cascade.
    this.clipboard = clones;
  }

  /** Duplicate selected objects in place (copy + paste in one step). */
  async duplicateSelected(): Promise<void> {
    await this.copySelected();
    await this.pasteSelected();
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

  /**
   * Return a copy of the current internal undo snapshot stack.
   * Used to persist undo history across editor open/close cycles.
   */
  getUndoStack(): string[] {
    return [...this.undoStack];
  }

  /**
   * Return a copy of the current internal redo snapshot stack.
   * Used to persist redo history across editor open/close cycles.
   */
  getRedoStack(): string[] {
    return [...this.redoStack];
  }

  /**
   * Restore undo/redo snapshot stacks from a prior editor session.
   * Call this after `deserialize()` to reinstate per-shape undo history
   * when the editor is reopened for a step that was previously edited.
   *
   * The provided stacks replace the stacks set by `deserialize()` (which
   * resets them to `[currentSnapshot]` / `[]`). The last entry of
   * `undoStack` must describe the same canvas state as after `deserialize()`
   * so that the first undo correctly reverts to the prior state.
   */
  restoreUndoRedoStacks(undoStack: string[], redoStack: string[]): void {
    if (undoStack.length === 0) return;
    this.undoStack = [...undoStack];
    this.redoStack = [...redoStack];
    this.updateUndoState();
  }

  /** Serialize the canvas overlay objects to JSON string. */
  serialize(): string {
    if (!this.canvas) return '{"objects":[]}';
    // Include custom properties in serialization.
    const json = this.canvas.toObject(['_wegweiserType', '_calloutNumber', '_wegweiserEffect', '_wegweiserBlurRadius', '_wegweiserBlockSize', 'customType', 'arrowColor', 'waypointData', '_arrowUid', '_waypointOriginLeft', '_waypointOriginTop']);
    // Remove the backgroundImage (it's the base screenshot, not an annotation).
    delete (json as Record<string, unknown>).backgroundImage;
    // Exclude crop overlays — they're purely visual and are always rebuilt from
    // the crop mask rect on deserialize, so including them causes duplicates.
    (json as any).objects = ((json as any).objects as any[]).filter(
      (o: any) => o._wegweiserType !== 'cropOverlay',
    );
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

    // Fix up IText objects that lost their hiddenTextareaContainer during JSON
    // round-trip. Without this the hidden textarea is appended to document.body,
    // which is outside the Dialog focus trap and breaks keyboard input.
    this.fixupITextContainers();

    // Re-attach waypoint controls to polyline-arrow groups (lost during JSON round-trip).
    this.fixupPolylineArrowControls();

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

    // The pixel buffer is always at natural image dimensions with identity VPT,
    // so no viewport/dimension adjustments are needed before export.

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
    this.canvas.renderAll();

    return dataUrl;
  }

  /** Get the underlying Fabric.js canvas (for advanced use). */
  getCanvas(): Canvas | null {
    return this.canvas;
  }

  // ─── Private helpers ──────────────────────────────────────────

  /** Timestamp (ms) of the previous arrow-polyline click, for double-click detection. */
  private _lastPolylineClickTime = 0;

  private onMouseDown(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas || !e.viewportPoint) return;
    const pointer = this.canvas.getScenePoint(e.e);
    const tool = this.tool;

    if (tool === 'select' || tool === 'freehand') return;

    if (tool === 'text') {
      // If the click landed on an existing IText, re-enter editing mode on it
      // rather than placing a new text object.
      if (e.target instanceof IText) {
        this.enterTextEditing(e.target);
        return;
      }
      // If click landed on any other existing object, do nothing.
      if (e.target) return;
      this.placeText(pointer.x, pointer.y);
      return;
    }

    // In arrow polyline mode, each click adds a waypoint.
    if (tool === 'arrow' && this.arrowPolylineState) {
      const now = Date.now();
      const isDoubleClick = now - this._lastPolylineClickTime < 400;
      this._lastPolylineClickTime = now;
      if (isDoubleClick) {
        // Double-click: finalize the polyline (the extra point is ignored —
        // the second click of a double-click lands at the same position).
        this.finalizeArrowPolyline();
      } else {
        // Add a new waypoint.
        this.addArrowPolylinePoint(pointer.x, pointer.y);
      }
      return;
    }

    // If the click landed on an existing object (or its transform controls),
    // do not start a new draw operation.
    if (e.target) return;

    if (tool === 'callout') {
      this.placeCallout(pointer.x, pointer.y);
      return;
    }

    // Start drag for shape tools.
    // Suppress canvas modification events until mouseup so only ONE snapshot is
    // pushed after the shape reaches its final size/position.
    this.isDrawing = true;
    this.drawState = {
      startX: pointer.x,
      startY: pointer.y,
      shape: null,
      arrowHead: null,
    };

    if (tool === 'obfuscation') {
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
      this.canvas.add(rect);
      this.drawState.shape = rect;
    } else if (tool === 'crop') {
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
      this.canvas.add(rect);
      this.drawState.shape = rect;
    } else if (tool === 'rectangle') {
      const rect = new Rect({
        left: pointer.x,
        top: pointer.y,
        originX: 'left',
        originY: 'top',
        width: 0,
        height: 0,
        fill: this.fillEnabled ? this.fillColor : 'transparent',
        stroke: this.color,
        strokeWidth: this.strokeWidth,
        strokeUniform: true,
        opacity: this.opacity,
        selectable: false,
        evented: false,
        lockUniScaling: false,
      });
      this.canvas.add(rect);
      this.drawState.shape = rect;
    } else if (tool === 'ellipse') {
      const ellipse = new Ellipse({
        left: pointer.x,
        top: pointer.y,
        originX: 'left',
        originY: 'top',
        rx: 0,
        ry: 0,
        fill: this.fillEnabled ? this.fillColor : 'transparent',
        stroke: this.color,
        strokeWidth: this.strokeWidth,
        strokeUniform: true,
        opacity: this.opacity,
        selectable: false,
        evented: false,
        lockUniScaling: false,
      });
      this.canvas.add(ellipse);
      this.drawState.shape = ellipse;
    } else if (tool === 'highlight') {
      const rect = new Rect({
        left: pointer.x,
        top: pointer.y,
        originX: 'left',
        originY: 'top',
        width: 0,
        height: 0,
        fill: this.color,
        stroke: '',
        strokeWidth: 0,
        opacity: 0.3,
        selectable: false,
        evented: false,
        lockUniScaling: false,
      });
      this.canvas.add(rect);
      this.drawState.shape = rect;
    } else if (tool === 'arrow') {
      // Use a Path for the drag preview so it can be updated live with the
      // same catmull-rom rendering as the final arrow.
      const previewPath = new Path(
        `M ${pointer.x},${pointer.y} L ${pointer.x},${pointer.y}`,
        {
          stroke: this.color,
          strokeWidth: this.strokeWidth,
          strokeUniform: true,
          fill: '',
          opacity: this.opacity,
          selectable: false,
          evented: false,
        },
      );
      this.canvas.add(previewPath);
      this.drawState.shape = previewPath;
    }
  }

  private onMouseMove(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas) return;
    const pointer = this.canvas.getScenePoint(e.e);
    // Always track the last mouse position so paste can land at the cursor.
    this.lastMouseScenePos = { x: pointer.x, y: pointer.y };

    // Update polyline preview: show all committed waypoints + cursor as a live path.
    if (this.arrowPolylineState) {
      const state = this.arrowPolylineState;
      // Build path from all committed points plus the current cursor position.
      const previewPts = [...state.points, { x: pointer.x, y: pointer.y }];
      const d = waypointsToSmoothPath(previewPts);
      if (state.previewPath) {
        this.canvas.remove(state.previewPath);
      }
      state.previewPath = new Path(d, {
        stroke: state.color,
        strokeWidth: state.strokeWidth,
        strokeUniform: true,
        fill: '',
        opacity: this.opacity,
        selectable: false,
        evented: false,
      });
      this.canvas.add(state.previewPath);
      this.canvas.renderAll();
      return;
    }

    if (!this.drawState?.shape) return;
    const { startX, startY, shape } = this.drawState;
    const tool = this.tool;

    if (tool === 'rectangle' || tool === 'highlight' || tool === 'obfuscation' || tool === 'crop') {
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
      // Update the preview Path to reflect the current drag endpoint.
      const previewPts = [{ x: startX, y: startY }, { x: pointer.x, y: pointer.y }];
      const newD = waypointsToSmoothPath(previewPts);
      // Fabric Path does not expose a simple set('path', …) API — we must
      // initialize a new Path and swap it, or re-use the existing one by
      // replacing its internal path data.  The simplest approach that avoids
      // re-adding to the canvas is to mutate the private `path` property and
      // call `_setPath` / `initialize` equivalents.  The safest cross-version
      // approach is to remove the old path and add a fresh one.
      this.canvas.remove(shape);
      const updatedPath = new Path(newD, {
        stroke: (shape as Path).stroke as string,
        strokeWidth: (shape as Path).strokeWidth,
        strokeUniform: true,
        fill: '',
        opacity: (shape as Path).opacity,
        selectable: false,
        evented: false,
      });
      this.canvas.add(updatedPath);
      this.drawState!.shape = updatedPath;
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
      this.isDrawing = false; // discard: no snapshot needed

      // For the arrow tool a tiny click (no drag) enters polyline mode.
      if (tool === 'arrow') {
        this._lastPolylineClickTime = Date.now();
        this.startArrowPolyline(startX, startY);
      }
      return;
    }

    if (tool === 'arrow' && shape instanceof Path) {
      this.finalizeArrow(shape, startX, startY, pointer.x, pointer.y);
    } else if (tool === 'crop' && shape instanceof Rect) {
      this.finalizeCrop(shape);
    } else if (tool === 'obfuscation' && shape instanceof Rect) {
      if (this.obfuscationEffect === 'blur') {
        // Gaussian blur finalises asynchronously via fromURL.
        this.finalizeGaussianBlur(shape, startX, startY, pointer.x, pointer.y);
        this.drawState = null;
        this.canvas.renderAll();
        return;
      } else {
        // Pixelate finalises asynchronously via fromURL.
        this.finalizePixelate(shape, startX, startY, pointer.x, pointer.y);
        this.drawState = null;
        this.canvas.renderAll();
        return;
      }
    } else if (shape) {
      // Rectangle, Ellipse, Highlight — make selectable with final geometry.
      shape.set({ selectable: true, evented: true });
      this.canvas.setActiveObject(shape);
    }

    // Push ONE snapshot capturing the fully-finalised shape at its correct size.
    // (isDrawing suppressed all intermediate object:added/modified events above.)
    this.isDrawing = false;
    this.pushSnapshot();
    this.updateCounts();

    this.drawState = null;
    this.canvas.renderAll();
  }

  /**
   * Finalize an arrow: replace the drag-preview Path with a
   * Group(Path + arrowhead Polygon) with waypoint controls for both endpoints.
   */
  private finalizeArrow(
    previewPath: Path,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): void {
    if (!this.canvas) return;
    this.canvas.remove(previewPath);

    const pts = [{ x: startX, y: startY }, { x: endX, y: endY }];
    const group = this.buildPolylineArrowGroup(pts);
    this.canvas.add(group);
    this.enterArrowEditMode(group);
  }

  // ─── Arrow polyline mode ──────────────────────────────────────────────────

  /**
   * Enter polyline mode: the first waypoint has been placed by a single click.
   * All subsequent clicks add waypoints; Enter or double-click finalizes.
   */
  private startArrowPolyline(x: number, y: number): void {
    this.arrowPolylineState = {
      points: [{ x, y }],
      previewPath: null,
      color: this.color,
      strokeWidth: this.strokeWidth,
    };
    this.arrowPolylineMode = true;
    this.isDrawing = true;
  }

  /**
   * Add a new waypoint to the polyline.
   * The dashed preview line continues to follow the cursor; no permanent
   * segment is drawn yet — everything is assembled on finalization.
   */
  private addArrowPolylinePoint(x: number, y: number): void {
    if (!this.canvas || !this.arrowPolylineState) return;
    const state = this.arrowPolylineState;

    state.points.push({ x, y });
    // Preview path will be rebuilt on next mouse:move to reflect the new waypoint.
    this.canvas.renderAll();
  }

  /**
   * Finalize the polyline: build a single Group(Path + Polygon arrowhead)
   * and attach custom waypoint controls.
   */
  finalizeArrowPolyline(): void {
    if (!this.canvas || !this.arrowPolylineState) return;
    const state = this.arrowPolylineState;

    // Need at least two points for a valid arrow.
    if (state.points.length < 2) {
      this.cancelArrowPolyline();
      return;
    }

    // Remove accumulated preview path before creating the final group.
    if (state.previewPath) {
      this.canvas.remove(state.previewPath);
      state.previewPath = null;
    }

    const pts = state.points;
    const group = this.buildPolylineArrowGroup(pts);
    this.canvas.add(group);
    this.enterArrowEditMode(group);

    // Clean up polyline state.
    this.arrowPolylineState = null;
    this.arrowPolylineMode = false;
    this.isDrawing = false;
    this.pushSnapshot();
    this.updateCounts();
    this.canvas.renderAll();
  }

  // ─── Polyline-arrow Group helpers ────────────────────────────────────────

  /**
   * Build a brand-new Group([Path, Polygon]) for a polyline arrow with
   * the given waypoints. Custom waypoint controls are attached.
   */
  private buildPolylineArrowGroup(pts: { x: number; y: number }[]): Group {
    const color = this.color;
    const strokeW = this.strokeWidth;
    const opacity = this.opacity;

    const group = new Group([], {
      selectable: true,
      evented: true,
      opacity,
      // Store metadata so updatePolylineArrow and serialization can read them.
      customType: 'polyline-arrow',
      arrowColor: color,
      strokeWidth: strokeW,
      // Stable custom UID used for edit-mode tracking (does not depend on
      // Fabric's internal id assignment).
      _arrowUid: Math.random().toString(36).slice(2, 10),
    } as any);

    // Store waypoints on the group.
    (group as any).waypointData = pts.map((p) => ({ ...p }));

    // Build inner Path and Polygon, then add to group.
    this.rebuildGroupContents(group, pts);

    // Record the group's position at the time waypointData was set.
    // positionHandler uses this to offset controls when the group is dragged.
    (group as any)._waypointOriginLeft = group.left ?? 0;
    (group as any)._waypointOriginTop = group.top ?? 0;

    // Start in non-edit mode: use default move/scale/rotate handles.
    // Waypoint handles are shown only after double-click (enterArrowEditMode).
    this.detachWaypointControls(group);

    return group;
  }

  /**
   * Rebuild the Path and Polygon inside an existing polyline-arrow Group,
   * and update waypointData + controls. Called both at creation and on
   * every waypoint drag.
   */
  private updatePolylineArrow(
    group: Group,
    newPoints: { x: number; y: number }[],
  ): void {
    if (!this.canvas) return;

    // Remove old children.
    const old = group.getObjects();
    old.forEach((o) => group.remove(o));

    // Rebuild contents.
    this.rebuildGroupContents(group, newPoints);

    // Update stored waypoints and record the group's current position as origin.
    (group as any).waypointData = newPoints.map((p) => ({ ...p }));
    (group as any)._waypointOriginLeft = group.left ?? 0;
    (group as any)._waypointOriginTop = group.top ?? 0;

    // Rebuild controls — only attach waypoint handles if still in edit mode.
    const arrowUid = (group as any)._arrowUid;
    if (arrowUid && arrowUid === this.arrowEditingId) {
      this.attachWaypointControls(group, newPoints);
    } else {
      this.detachWaypointControls(group);
    }

    this.canvas.requestRenderAll();
  }

  /**
   * Create Path + Polygon children and add them to the group.
   * Does NOT update waypointData or controls — callers do that.
   */
  private rebuildGroupContents(
    group: Group,
    pts: { x: number; y: number }[],
  ): void {
    const color = (group as any).arrowColor ?? this.color;
    const strokeW = (group as any).strokeWidth ?? this.strokeWidth;

    // Build smooth SVG path string using Catmull-Rom → Cubic Bézier.
    const d = waypointsToSmoothPath(pts);

    const pathObj = new Path(d, {
      stroke: color,
      strokeWidth: strokeW,
      fill: '',
      strokeUniform: true,
      selectable: false,
      evented: false,
    });

    // Arrowhead points in the direction of the last segment (P[N-2] → P[N-1]).
    // This matches the catmull-rom tangent at the endpoint (duplicated endpoint
    // means the tangent equals the last chord direction).
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const headLen = Math.max(strokeW * 4, 16);
    const headAngle = Math.PI / 6;

    const arrowHead = new Polygon(
      [
        { x: last.x, y: last.y },
        {
          x: last.x - headLen * Math.cos(angle - headAngle),
          y: last.y - headLen * Math.sin(angle - headAngle),
        },
        {
          x: last.x - headLen * Math.cos(angle + headAngle),
          y: last.y - headLen * Math.sin(angle + headAngle),
        },
      ],
      {
        fill: color,
        stroke: '',
        selectable: false,
        evented: false,
      },
    );

    group.add(pathObj, arrowHead);
  }

  /**
   * Attach custom Control instances (one per waypoint) to the group.
   * Hides all default corner/edge/rotation handles.
   * Called when entering edit mode on an arrow.
   */
  private attachWaypointControls(
    group: Group,
    pts: { x: number; y: number }[],
  ): void {
    if (!this.canvas) return;
    const canvas = this.canvas;
    const self = this;

    const controls: Record<string, Control> = {};

    // ── Waypoint handles (solid blue circles) ──────────────────────────────
    pts.forEach((_, idx) => {
      controls[`wp_${idx}`] = new Control({
        x: 0,
        y: 0,
        cursorStyle: 'crosshair',
        actionName: 'moveWaypoint',
        positionHandler(_dim, _finalMatrix, obj) {
          const waypoints: { x: number; y: number }[] = (obj as any).waypointData;
          if (!waypoints || !waypoints[idx]) return new Point(0, 0);
          // Offset by the delta between the group's current position and where
          // it was when waypointData was last set, so controls follow the group
          // during drag.
          const dx = (obj.left ?? 0) - ((obj as any)._waypointOriginLeft ?? 0);
          const dy = (obj.top ?? 0) - ((obj as any)._waypointOriginTop ?? 0);
          const pt = { x: waypoints[idx].x + dx, y: waypoints[idx].y + dy };
          const vpt = canvas.viewportTransform;
          if (!vpt) return new Point(pt.x, pt.y);
          return util.transformPoint(new Point(pt.x, pt.y), vpt);
        },
        actionHandler(_eventData, transform, x, y) {
          const obj = transform.target as Group;
          // Sync waypointData with accumulated group drag before editing.
          self.syncWaypointDataWithGroupPosition(obj);
          const waypoints: { x: number; y: number }[] = [
            ...((obj as any).waypointData as { x: number; y: number }[]),
          ];
          const vpt = canvas.viewportTransform;
          const invVpt = vpt ? util.invertTransform(vpt) : ([1, 0, 0, 1, 0, 0] as any);
          const scene = util.transformPoint(new Point(x, y), invVpt);
          waypoints[idx] = { x: scene.x, y: scene.y };
          self.updatePolylineArrow(obj, waypoints);
          return true;
        },
        render(ctx, left, top) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(left, top, 6, 0, Math.PI * 2);
          ctx.fillStyle = 'white';
          ctx.fill();
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        },
      });
    });

    group.controls = controls;

    // Hide all default transform handles.
    group.setControlsVisibility({
      tl: false,
      tr: false,
      bl: false,
      br: false,
      ml: false,
      mr: false,
      mt: false,
      mb: false,
      mtr: false,
    });
  }

  /**
   * Restore the default Fabric.js transform controls on a polyline-arrow group
   * (move/scale corners + rotate handle). Removes all custom waypoint controls.
   * Called when exiting arrow edit mode.
   */
  private detachWaypointControls(group: Group): void {
    // Delete instance-level overrides so Fabric falls back to the class-level
    // default controls (tl, tr, bl, br, ml, mr, mt, mb, mtr) on the prototype.
    // The previous approach of copying controls from `new Group([])` produced
    // undefined entries that crashed Fabric's findControl / drawControls.
    if (Object.prototype.hasOwnProperty.call(group, 'controls')) {
      delete (group as any).controls;
    }
    if (Object.prototype.hasOwnProperty.call(group, '_controlsVisibility')) {
      delete (group as any)._controlsVisibility;
    }
  }

  /**
   * Bake the accumulated group drag delta into waypointData so that
   * waypoint coordinates match the group's current scene position.
   */
  private syncWaypointDataWithGroupPosition(group: Group): void {
    const dx = (group.left ?? 0) - ((group as any)._waypointOriginLeft ?? 0);
    const dy = (group.top ?? 0) - ((group as any)._waypointOriginTop ?? 0);
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    const waypoints: { x: number; y: number }[] = (group as any).waypointData;
    if (!waypoints) return;
    for (const wp of waypoints) {
      wp.x += dx;
      wp.y += dy;
    }
    (group as any)._waypointOriginLeft = group.left ?? 0;
    (group as any)._waypointOriginTop = group.top ?? 0;
  }

  /**
   * Enter waypoint-edit mode for the given polyline-arrow group.
   * Shows draggable waypoint and midpoint handles.
   */
  private enterArrowEditMode(group: Group): void {
    if (!this.canvas) return;
    const waypoints: { x: number; y: number }[] | undefined = (group as any).waypointData;
    if (!waypoints || waypoints.length < 2) return;
    this.arrowEditingId = (group as any)._arrowUid ?? null;
    group.set({ evented: true });
    this.syncWaypointDataWithGroupPosition(group);
    this.attachWaypointControls(group, (group as any).waypointData);
    if (this.canvas.getActiveObject() !== group) {
      this.canvas.setActiveObject(group);
    }
    this.canvas.renderAll();
  }

  /**
   * Exit waypoint-edit mode: restore move/scale/rotate handles on the
   * arrow currently being edited, then clear `arrowEditingId`.
   */
  private exitArrowEditMode(): void {
    if (!this.canvas || this.arrowEditingId === null) return;
    const editingId = this.arrowEditingId;
    this.arrowEditingId = null;

    const obj = this.canvas.getObjects().find((o) => (o as any)._arrowUid === editingId);
    if (obj && (obj as any).customType === 'polyline-arrow') {
      this.detachWaypointControls(obj as Group);
      if (this.tool !== 'select') {
        obj.set({ evented: false });
      }
      this.canvas.requestRenderAll();
    }
  }

  /**
   * Cancel an in-progress arrow polyline without creating anything.
   */
  private cancelArrowPolyline(): void {
    if (!this.canvas || !this.arrowPolylineState) {
      this.arrowPolylineMode = false;
      this.arrowPolylineState = null;
      return;
    }
    const state = this.arrowPolylineState;
    if (state.previewPath) this.canvas.remove(state.previewPath);
    this.arrowPolylineState = null;
    this.arrowPolylineMode = false;
    this.isDrawing = false;
  }

  /** Place an editable IText at the given position. */
  private placeText(x: number, y: number): void {
    if (!this.canvas) return;
    // Place the hidden textarea inside the canvas wrapper rather than document.body.
    // This is required because the annotation editor runs inside a Dialog that has a
    // focus trap; any element appended to document.body is outside the trap and has
    // its focus immediately stolen back, breaking IText keyboard input.
    const canvasContainer = this.canvas.getElement().parentElement;
    const text = new IText('Text', {
      left: x,
      top: y,
      originX: 'left',
      originY: 'top',
      fill: this.color,
      fontSize: Math.max(this.strokeWidth * 6, 24),
      fontFamily: 'system-ui, -apple-system, sans-serif',
      opacity: this.opacity,
      selectable: true,
      evented: true,
      hiddenTextareaContainer: canvasContainer,
      // Ensure a visible blinking cursor during editing (match text fill color).
      cursorColor: this.color,
      cursorWidth: 2,
    });
    this.canvas.add(text);

    // Enable selection mode temporarily so the IText can receive keyboard
    // input, without changing this.tool (so the toolbar stays on "text").
    this.canvas.isDrawingMode = false;
    this.canvas.selection = true;
    this.canvas.renderAll();
    this.canvas.setActiveObject(text);

    // When the user finishes editing (clicks away or presses Escape/Enter),
    // restore canvas to text-tool state so the next click places another text.
    const onEditingExited = () => {
      text.off('editing:exited', onEditingExited);
      if (!this.canvas || this.tool !== 'text') return;
      // Restore non-select canvas state (tool visually stays on "text").
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
      // In text mode: IText objects stay evented (for re-editing), all others off.
      this.forEachAnnotation((obj) => {
        if (obj instanceof IText) {
          obj.set({ selectable: false, evented: true });
        } else {
          obj.set({ selectable: false, evented: false });
        }
      });
      this.canvas.discardActiveObject();
      this.canvas.renderAll();
    };
    text.on('editing:exited', onEditingExited);

    // Defer enterEditing to after the current mouse-event cycle so that:
    // 1. Fabric.js finishes its internal mouse:down/up handling
    // 2. The browser allows the hidden textarea to receive focus
    //    (browsers often block focus() calls mid-mousedown handler)
    requestAnimationFrame(() => {
      if (!this.canvas) return;
      // Fabric.js discards the active object in its own mouse:up handler (the
      // click had no target when mouse:down fired). Re-set it here so
      // enterEditing() actually gets applied to an active object.
      this.canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      this.canvas.renderAll();
    });
  }

  /**
   * Enter editing mode on an existing IText object.
   * Used when the user double-clicks a text object while in text tool mode.
   */
  private enterTextEditing(text: IText): void {
    if (!this.canvas) return;
    // Temporarily enable selection so the IText can be activated.
    this.canvas.isDrawingMode = false;
    this.canvas.selection = true;
    this.canvas.setActiveObject(text);

    const onEditingExited = () => {
      text.off('editing:exited', onEditingExited);
      if (!this.canvas || this.tool !== 'text') return;
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
      // In text mode: IText objects stay evented (for re-editing), all others off.
      this.forEachAnnotation((obj) => {
        if (obj instanceof IText) {
          obj.set({ selectable: false, evented: true });
        } else {
          obj.set({ selectable: false, evented: false });
        }
      });
      this.canvas.discardActiveObject();
      this.canvas.renderAll();
    };
    text.on('editing:exited', onEditingExited);

    requestAnimationFrame(() => {
      if (!this.canvas) return;
      this.canvas.setActiveObject(text);
      text.enterEditing();
      this.canvas.renderAll();
    });
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
   * Finalize a region as gaussian blur: apply CSS blur filter to the background
   * region and replace the placeholder rect with a FabricImage of the blurred data.
   */
  private finalizeGaussianBlur(rect: Rect, sx: number, sy: number, ex: number, ey: number): void {
    if (!this.canvas) return;
    this.canvas.remove(rect);

    const left = Math.max(0, Math.min(sx, ex));
    const top = Math.max(0, Math.min(sy, ey));
    const width = Math.min(Math.abs(ex - sx), this.imageWidth - left);
    const height = Math.min(Math.abs(ey - sy), this.imageHeight - top);
    if (width < 4 || height < 4) return;

    const bgImg = this.canvas.backgroundImage;
    if (!bgImg) return;

    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;

    // Extract the region to a temp canvas with extra padding to avoid edge artifacts.
    const radius = this.blurRadius;
    const pad = radius * 2;
    const padLeft = Math.max(0, left - pad);
    const padTop = Math.max(0, top - pad);
    const padRight = Math.min(this.imageWidth, left + width + pad);
    const padBottom = Math.min(this.imageHeight, top + height + pad);
    const padW = padRight - padLeft;
    const padH = padBottom - padTop;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = padW;
    tempCanvas.height = padH;
    const tempCtx = tempCanvas.getContext('2d')!;
    // Apply CSS blur filter then draw the padded region.
    tempCtx.filter = `blur(${radius}px)`;
    tempCtx.drawImage(bgEl, padLeft, padTop, padW, padH, 0, 0, padW, padH);
    tempCtx.filter = 'none';

    // Crop out just the requested region from the blurred padded canvas.
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(tempCanvas, left - padLeft, top - padTop, width, height, 0, 0, width, height);

    const dataUrl = offscreen.toDataURL('image/png');
    FabricImage.fromURL(dataUrl).then((blurImg) => {
      if (!this.canvas) {
        this.isDrawing = false;
        return;
      }
      blurImg.set({
        left,
        top,
        originX: 'left',
        originY: 'top',
        selectable: true,
        evented: true,
        _wegweiserType: 'blurOverlay',
        _wegweiserEffect: 'blur',
        _wegweiserBlurRadius: radius,
      } as any);
      this.canvas.add(blurImg);
      this.isDrawing = false;
      this.pushSnapshot();
      this.updateCounts();
      this.canvas.setActiveObject(blurImg);
      this.canvas.renderAll();
    });
  }

  /**
   * Finalize a region as pixelate: downsample then upscale with nearest-neighbor
   * and replace the placeholder rect with a FabricImage of the pixelated data.
   */
  private finalizePixelate(rect: Rect, sx: number, sy: number, ex: number, ey: number): void {
    if (!this.canvas) return;
    this.canvas.remove(rect);

    const left = Math.max(0, Math.min(sx, ex));
    const top = Math.max(0, Math.min(sy, ey));
    const width = Math.min(Math.abs(ex - sx), this.imageWidth - left);
    const height = Math.min(Math.abs(ey - sy), this.imageHeight - top);
    if (width < 4 || height < 4) return;

    const bgImg = this.canvas.backgroundImage;
    if (!bgImg) return;

    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(bgEl, left, top, width, height, 0, 0, width, height);

    const blockSize = this.pixelateBlockSize;
    const smallW = Math.max(1, Math.ceil(width / blockSize));
    const smallH = Math.max(1, Math.ceil(height / blockSize));

    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = smallW;
    smallCanvas.height = smallH;
    const smallCtx = smallCanvas.getContext('2d')!;
    smallCtx.drawImage(offscreen, 0, 0, smallW, smallH);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, width, height);

    const dataUrl = offscreen.toDataURL('image/png');
    FabricImage.fromURL(dataUrl).then((pixelImg) => {
      if (!this.canvas) {
        this.isDrawing = false;
        return;
      }
      pixelImg.set({
        left,
        top,
        originX: 'left',
        originY: 'top',
        selectable: true,
        evented: true,
        _wegweiserType: 'pixelateOverlay',
        _wegweiserEffect: 'pixelate',
        _wegweiserBlockSize: blockSize,
      } as any);
      this.canvas.add(pixelImg);
      this.isDrawing = false;
      this.pushSnapshot();
      this.updateCounts();
      this.canvas.setActiveObject(pixelImg);
      this.canvas.renderAll();
    });
  }

  /**
   * Re-render a blur or pixelate overlay in place.
   * Re-extracts the region from the background image at the object's current
   * bounding box (accounting for scale) and re-applies the stored effect.
   * Updates the overlay's image source via setSrc, preserving position and z-index.
   */
  private reRenderOverlay(obj: FabricImage): void {
    if (!this.canvas) return;
    const wegType = (obj as any)._wegweiserType as string;
    if (wegType !== 'blurOverlay' && wegType !== 'pixelateOverlay') return;

    const bgImg = this.canvas.backgroundImage;
    if (!bgImg) return;
    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;

    const left = Math.round(obj.left ?? 0);
    const top = Math.round(obj.top ?? 0);
    const width = Math.round((obj.width ?? 0) * (obj.scaleX ?? 1));
    const height = Math.round((obj.height ?? 0) * (obj.scaleY ?? 1));

    if (width < 4 || height < 4) return;

    // Clamp to image bounds.
    const clampedLeft = Math.max(0, Math.min(left, this.imageWidth - 1));
    const clampedTop = Math.max(0, Math.min(top, this.imageHeight - 1));
    const clampedW = Math.min(width, this.imageWidth - clampedLeft);
    const clampedH = Math.min(height, this.imageHeight - clampedTop);
    if (clampedW < 4 || clampedH < 4) return;

    let dataUrl: string;

    if (wegType === 'blurOverlay') {
      const radius = this.blurRadius;
      const pad = radius * 2;
      const padLeft = Math.max(0, clampedLeft - pad);
      const padTop = Math.max(0, clampedTop - pad);
      const padRight = Math.min(this.imageWidth, clampedLeft + clampedW + pad);
      const padBottom = Math.min(this.imageHeight, clampedTop + clampedH + pad);
      const padW = padRight - padLeft;
      const padH = padBottom - padTop;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = padW;
      tempCanvas.height = padH;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.filter = `blur(${radius}px)`;
      tempCtx.drawImage(bgEl, padLeft, padTop, padW, padH, 0, 0, padW, padH);
      tempCtx.filter = 'none';

      const offscreen = document.createElement('canvas');
      offscreen.width = clampedW;
      offscreen.height = clampedH;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(tempCanvas, clampedLeft - padLeft, clampedTop - padTop, clampedW, clampedH, 0, 0, clampedW, clampedH);
      dataUrl = offscreen.toDataURL('image/png');

      // Update stored parameters.
      (obj as any)._wegweiserBlurRadius = radius;
    } else {
      // Pixelate.
      const blockSize = this.pixelateBlockSize;
      const offscreen = document.createElement('canvas');
      offscreen.width = clampedW;
      offscreen.height = clampedH;
      const ctx = offscreen.getContext('2d')!;
      ctx.drawImage(bgEl, clampedLeft, clampedTop, clampedW, clampedH, 0, 0, clampedW, clampedH);

      const smallW = Math.max(1, Math.ceil(clampedW / blockSize));
      const smallH = Math.max(1, Math.ceil(clampedH / blockSize));

      const smallCanvas = document.createElement('canvas');
      smallCanvas.width = smallW;
      smallCanvas.height = smallH;
      const smallCtx = smallCanvas.getContext('2d')!;
      smallCtx.drawImage(offscreen, 0, 0, smallW, smallH);

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, clampedW, clampedH);
      ctx.drawImage(smallCanvas, 0, 0, smallW, smallH, 0, 0, clampedW, clampedH);
      dataUrl = offscreen.toDataURL('image/png');

      // Update stored parameters.
      (obj as any)._wegweiserBlockSize = blockSize;
    }

    // Update the overlay image source in place, then reset scale to 1 since
    // the new image already has the correct pixel dimensions.
    obj.setSrc(dataUrl).then(() => {
      if (!this.canvas) return;
      obj.set({
        left: clampedLeft,
        top: clampedTop,
        scaleX: 1,
        scaleY: 1,
        width: clampedW,
        height: clampedH,
      });
      obj.setCoords();
      this.canvas.renderAll();
      // Push a snapshot after the async image update.
      this.pushSnapshot();
      this.updateCounts();
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
      originX: 'left',
      originY: 'top',
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

    // Blur/pixelate overlays are FabricImages — color/stroke properties don't apply.
    const wegType = (active as any)._wegweiserType as string | undefined;
    if (wegType === 'blurOverlay' || wegType === 'pixelateOverlay') return;

    if (active instanceof IText) {
      active.set({ fill: this.color });
    } else if (active instanceof Group) {
      // For groups (arrows, callouts), update child colors.
      active.getObjects().forEach((child) => {
        if (child instanceof Path) {
          child.set({ stroke: this.color });
        } else if (child instanceof Line || child instanceof Polygon) {
          child.set({ stroke: this.color, fill: this.color });
        } else if (child instanceof Circle) {
          child.set({ fill: this.color });
        }
      });
      // Also update stored arrowColor for polyline-arrows so rebuilds use the new color.
      if ((active as any).customType === 'polyline-arrow') {
        (active as any).arrowColor = this.color;
      }
      active.set({ opacity: this.opacity });
    } else if (active instanceof Rect || active instanceof Ellipse) {
      if (active.stroke) active.set({ stroke: this.color, strokeWidth: this.strokeWidth, strokeUniform: true });
      active.set({
        fill: this.fillEnabled ? this.fillColor : 'transparent',
        opacity: this.opacity,
      });
    } else {
      if (active.stroke) active.set({ stroke: this.color, strokeWidth: this.strokeWidth, strokeUniform: true });
      if (active.fill && active.fill !== 'transparent') active.set({ fill: this.color });
      active.set({ opacity: this.opacity });
    }

    this.canvas.renderAll();
    // Fire object:modified so onCanvasModified() records an undo snapshot.
    this.canvas.fire('object:modified', { target: active });
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
    // Re-attach hiddenTextareaContainer on IText objects lost during JSON round-trip.
    this.fixupITextContainers();
    this.fixupPolylineArrowControls();
    this.canvas.renderAll();
    this.isRestoring = false;
    this.updateUndoState();
    this.updateCounts();
  }

  /** Called when objects are added/modified/removed. */
  private onCanvasModified(): void {
    if (this.isRestoring || this.isDrawing) return;
    // Debounce: coalesce rapid bursts (e.g. freehand fires object:added then
    // a follow-up event; crop operations fire remove+add for overlay rects).
    if (this._modifiedTimer !== null) clearTimeout(this._modifiedTimer);
    this._modifiedTimer = setTimeout(() => {
      this._modifiedTimer = null;
      if (!this.canvas) return;
      this.pushSnapshot();
      this.updateCounts();
      // Rebuild crop overlays if the crop rect was moved/resized.
      // Use isRestoring=true to suppress the object:added/removed events fired
      // by the overlay update — they must not trigger another onCanvasModified.
      if (this.cropRect) {
        this.isRestoring = true;
        this.updateCropOverlays();
        this.isRestoring = false;
      }
    }, 0);
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

  /** Update the reactive selected object count. */
  private updateSelectedCount(): void {
    if (!this.canvas) {
      this.selectedCount = 0;
      return;
    }
    this.selectedCount = this.canvas.getActiveObjects().length;
  }

  /**
   * After any loadFromJSON call, IText objects lose their hiddenTextareaContainer
   * because it is a DOM reference and cannot be serialized. Re-attach it here so
   * that double-click to edit works correctly inside the Dialog focus trap.
   */
  private fixupITextContainers(): void {
    if (!this.canvas) return;
    const container = this.canvas.getElement().parentElement;
    if (!container) return;
    this.canvas.getObjects().forEach((obj) => {
      if (obj instanceof IText) {
        (obj as any).hiddenTextareaContainer = container;
        // Ensure cursor is visible and matches the text fill color.
        obj.set({ cursorColor: (obj.fill as string) || '#000000', cursorWidth: 2 });
      }
    });
  }

  /**
   * After any loadFromJSON call, polyline-arrow groups lose their custom
   * Control instances (controls are not serialized). Re-attach them here
   * in the default non-edit state (move/scale/rotate handles only).
   */
  private fixupPolylineArrowControls(): void {
    if (!this.canvas) return;
    this.canvas.getObjects().forEach((obj) => {
      if ((obj as any).customType === 'polyline-arrow') {
        if (!(obj as any)._arrowUid) {
          (obj as any)._arrowUid = Math.random().toString(36).slice(2, 10);
        }
        // Ensure origin is set for deserialized arrows.
        if ((obj as any)._waypointOriginLeft == null) {
          (obj as any)._waypointOriginLeft = obj.left ?? 0;
        }
        if ((obj as any)._waypointOriginTop == null) {
          (obj as any)._waypointOriginTop = obj.top ?? 0;
        }
        this.detachWaypointControls(obj as Group);
      }
    });
    this.arrowEditingId = null;
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
