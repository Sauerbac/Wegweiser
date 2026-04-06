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
  Circle,
  Ellipse,
  FabricImage,
  Group,
  IText,
  Line,
  Path,
  Polygon,
  Rect,
  type TPointerEventInfo,
  type TPointerEvent,
} from 'fabric';
import { CUSTOM_PROPS } from './editor/canvas-props.js';
import {
  clampRegion,
  clampOverlayRegion,
  renderBlurRegion,
  renderPixelateRegion,
} from './editor/obfuscation.js';
import {
  createToolRegistry,
  type ToolContext,
  type ToolRegistry,
  ArrowToolHandler,
  TextToolHandler,
  CalloutToolHandler,
} from './editor/tools/index.js';

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

  /** Tool plugin registry — one handler per AnnotationTool. */
  private registry: ToolRegistry = createToolRegistry();

  /** Context object passed to every tool handler. Constructed in init(). */
  private ctx!: ToolContext;

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

    // Build the ToolContext — getter accessors ensure reactive $state values
    // are always read fresh when a handler accesses them.
    const wrapper = this;
    this.ctx = {
      get canvas() { return wrapper.canvas!; },
      get color() { return wrapper.color; },
      get strokeWidth() { return wrapper.strokeWidth; },
      get opacity() { return wrapper.opacity; },
      get fillEnabled() { return wrapper.fillEnabled; },
      get fillColor() { return wrapper.fillColor; },
      get blurRadius() { return wrapper.blurRadius; },
      get pixelateBlockSize() { return wrapper.pixelateBlockSize; },
      pushSnapshot: () => wrapper.pushSnapshot(),
      updateCounts: () => wrapper.updateCounts(),
      setDrawing: (v) => { wrapper.isDrawing = v; },
      setArrowPolylineMode: (v) => { wrapper.arrowPolylineMode = v; },
      setArrowEditingId: (id) => { wrapper.arrowEditingId = id; },
      getArrowEditingId: () => wrapper.arrowEditingId,
      getCurrentTool: () => wrapper.tool,
    };

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

    // Track selection changes. Arrow edit-mode transitions are delegated to ArrowToolHandler.
    const arrowHandler = this.registry.get('arrow') as ArrowToolHandler;
    this.canvas.on('selection:created', (e) => {
      this.updateSelectedCount();
      const target = (e as any).selected?.[0];
      if (target && (target as any).customType === 'polyline-arrow') {
        arrowHandler.enterEditMode(this.ctx, target as Group);
      }
    });
    this.canvas.on('selection:updated', (e) => {
      this.updateSelectedCount();
      const newTarget = (e as any).selected?.[0];
      if (newTarget && this.arrowEditingId !== null && (newTarget as any)._arrowUid !== this.arrowEditingId) {
        arrowHandler.exitEditMode(this.ctx, this.tool);
      }
      if (newTarget && (newTarget as any).customType === 'polyline-arrow' &&
          (newTarget as any)._arrowUid !== this.arrowEditingId) {
        arrowHandler.enterEditMode(this.ctx, newTarget as Group);
      }
    });
    this.canvas.on('selection:cleared', () => {
      this.updateSelectedCount();
      if (this.arrowEditingId !== null) {
        arrowHandler.exitEditMode(this.ctx, this.tool);
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
    this.arrowPolylineMode = false;
    this.arrowEditingId = null;
    this.cropRect = null;
    this.cropOverlays = [];
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
    if (!this.canvas) {
      this.tool = t;
      return;
    }
    const prev = this.registry.get(this.tool);
    prev?.onDeactivate(this.ctx);
    this.tool = t;

    const next = this.registry.get(t);
    if (next) {
      next.onActivate(this.ctx, (fn) => this.forEachAnnotation(fn));
      return;
    }

    // Fallback for tools not yet migrated to the plugin system (obfuscation, crop).
    if (t === 'obfuscation' || t === 'crop') {
      this.canvas.isDrawingMode = false;
      this.canvas.selection = false;
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
    const handler = this.registry.get(this.tool);
    const cancelled = handler?.cancel(this.ctx) ?? false;
    if (cancelled) this.canvas.renderAll();
    return cancelled;
  }

  /**
   * Finalize the current arrow polyline (Enter key shortcut).
   * Delegates to ArrowToolHandler.
   */
  finalizeArrowPolyline(): void {
    (this.registry.get('arrow') as ArrowToolHandler)?.finalizeArrowPolyline(this.ctx);
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
    this.clipboard = await Promise.all(active.map((obj) => obj.clone(CUSTOM_PROPS)));
  }

  /** Paste previously copied objects, centering them at the last known mouse position. */
  async pasteSelected(): Promise<void> {
    if (!this.canvas || this.clipboard.length === 0) return;
    this.canvas.discardActiveObject();
    const clones = await Promise.all(this.clipboard.map((obj) => obj.clone(CUSTOM_PROPS)));
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
    const json = this.canvas.toObject(CUSTOM_PROPS);
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
    (this.registry.get('callout') as CalloutToolHandler).recalcCalloutNumbers(this.canvas);

    // Update crop overlay if crop exists.
    if (this.cropRect) {
      this.updateCropOverlays();
    }

    // Fix up IText objects that lost their hiddenTextareaContainer during JSON
    // round-trip. Without this the hidden textarea is appended to document.body,
    // which is outside the Dialog focus trap and breaks keyboard input.
    (this.registry.get('text') as TextToolHandler).fixupContainers(this.ctx);

    // Re-attach waypoint controls to polyline-arrow groups (lost during JSON round-trip).
    (this.registry.get('arrow') as ArrowToolHandler).fixupControls(
      this.canvas,
      (id) => { this.arrowEditingId = id; },
    );

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

  private onMouseDown(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas || !e.viewportPoint) return;
    const pointer = this.canvas.getScenePoint(e.e);
    const handler = this.registry.get(this.tool);
    if (handler) {
      handler.onMouseDown(this.ctx, pointer, e);
      return;
    }
    // Fallback for tools not yet migrated (obfuscation, crop).
    this.onMouseDownFallback(pointer, e);
  }

  private onMouseMove(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas) return;
    const pointer = this.canvas.getScenePoint(e.e);
    this.lastMouseScenePos = { x: pointer.x, y: pointer.y };
    const handler = this.registry.get(this.tool);
    if (handler) {
      handler.onMouseMove(this.ctx, pointer, e);
      return;
    }
    this.onMouseMoveFallback(pointer);
  }

  private onMouseUp(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas) return;
    const pointer = this.canvas.getScenePoint(e.e);
    const handler = this.registry.get(this.tool);
    if (handler) {
      handler.onMouseUp(this.ctx, pointer, e);
      return;
    }
    this.onMouseUpFallback(pointer);
  }

  // ─── Fallback mouse handlers for non-migrated tools (obfuscation, crop) ──

  private drawState: { startX: number; startY: number; shape: Rect | null } | null = null;

  private onMouseDownFallback(
    pointer: { x: number; y: number },
    e: TPointerEventInfo<TPointerEvent>,
  ): void {
    if (!this.canvas) return;
    const tool = this.tool;
    if (e.target) return;

    this.isDrawing = true;
    this.drawState = { startX: pointer.x, startY: pointer.y, shape: null };

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
    }
  }

  private onMouseMoveFallback(pointer: { x: number; y: number }): void {
    if (!this.canvas || !this.drawState?.shape) return;
    const { startX, startY, shape } = this.drawState;
    const left = Math.min(startX, pointer.x);
    const top = Math.min(startY, pointer.y);
    const width = Math.abs(pointer.x - startX);
    const height = Math.abs(pointer.y - startY);
    shape.set({ left, top, width, height });
    this.canvas.renderAll();
  }

  private onMouseUpFallback(pointer: { x: number; y: number }): void {
    if (!this.canvas || !this.drawState) return;
    const { startX, startY, shape } = this.drawState;
    const tool = this.tool;
    const dx = Math.abs(pointer.x - startX);
    const dy = Math.abs(pointer.y - startY);

    if (dx < 3 && dy < 3) {
      if (shape) this.canvas.remove(shape);
      this.drawState = null;
      this.isDrawing = false;
      this.canvas.renderAll();
      return;
    }

    if (tool === 'crop' && shape instanceof Rect) {
      this.finalizeCrop(shape);
    } else if (tool === 'obfuscation' && shape instanceof Rect) {
      if (this.obfuscationEffect === 'blur') {
        this.finalizeGaussianBlur(shape, startX, startY, pointer.x, pointer.y);
      } else {
        this.finalizePixelate(shape, startX, startY, pointer.x, pointer.y);
      }
      this.drawState = null;
      this.canvas.renderAll();
      return;
    }

    this.isDrawing = false;
    this.pushSnapshot();
    this.updateCounts();
    this.drawState = null;
    this.canvas.renderAll();
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

    const region = clampRegion(sx, sy, ex, ey, this.imageWidth, this.imageHeight);
    if (!region) return;

    const bgImg = this.canvas.backgroundImage;
    if (!bgImg) return;
    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;

    const radius = this.blurRadius;
    const dataUrl = renderBlurRegion(bgEl, region, radius, this.imageWidth, this.imageHeight);

    FabricImage.fromURL(dataUrl).then((blurImg) => {
      if (!this.canvas) {
        this.isDrawing = false;
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

    const region = clampRegion(sx, sy, ex, ey, this.imageWidth, this.imageHeight);
    if (!region) return;

    const bgImg = this.canvas.backgroundImage;
    if (!bgImg) return;
    const bgEl = (bgImg as FabricImage).getElement() as HTMLImageElement;

    const blockSize = this.pixelateBlockSize;
    const dataUrl = renderPixelateRegion(bgEl, region, blockSize);

    FabricImage.fromURL(dataUrl).then((pixelImg) => {
      if (!this.canvas) {
        this.isDrawing = false;
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

    const region = clampOverlayRegion(left, top, width, height, this.imageWidth, this.imageHeight);
    if (!region) return;

    let dataUrl: string;

    if (wegType === 'blurOverlay') {
      const radius = this.blurRadius;
      dataUrl = renderBlurRegion(bgEl, region, radius, this.imageWidth, this.imageHeight);
      (obj as any)._wegweiserBlurRadius = radius;
    } else {
      const blockSize = this.pixelateBlockSize;
      dataUrl = renderPixelateRegion(bgEl, region, blockSize);
      (obj as any)._wegweiserBlockSize = blockSize;
    }

    // Update the overlay image source in place, then reset scale to 1 since
    // the new image already has the correct pixel dimensions.
    obj.setSrc(dataUrl).then(() => {
      if (!this.canvas) return;
      obj.set({
        left: region.left,
        top: region.top,
        scaleX: 1,
        scaleY: 1,
        width: region.width,
        height: region.height,
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

    (this.registry.get('callout') as CalloutToolHandler).recalcCalloutNumbers(this.canvas);
    // Re-attach hiddenTextareaContainer on IText objects lost during JSON round-trip.
    (this.registry.get('text') as TextToolHandler).fixupContainers(this.ctx);
    (this.registry.get('arrow') as ArrowToolHandler).fixupControls(
      this.canvas,
      (id) => { this.arrowEditingId = id; },
    );
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

}
