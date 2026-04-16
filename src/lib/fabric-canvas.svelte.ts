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
  FabricImage,
  Group,
  IText,
  type TPointerEventInfo,
  type TPointerEvent,
} from 'fabric';
import { CUSTOM_PROPS } from './editor/canvas-props.js';
import type { ObfuscationEffect } from './editor/obfuscation.js';
import {
  createToolRegistry,
  type ToolContext,
  type ToolHandler,
  type ToolRegistry,
  type SharedDefaults,
  ArrowToolHandler,
  TextToolHandler,
  CalloutToolHandler,
  ObfuscationToolHandler,
  CropToolHandler,
  ClickIndicatorToolHandler,
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
  | 'crop'
  | 'click-indicator';

export type { ObfuscationEffect } from './editor/obfuscation.js';

/** Maximum annotation-editor undo steps. **Must match `UNDO_HISTORY_CAP` in `src-tauri/src/commands/mod.rs`** — both caps must be equal so that an `editorSession(depth)` entry on the Review undo stack always corresponds to exactly `depth` entries on the backend undo stack. */
const UNDO_CAP = 50;

export class FabricCanvasWrapper {
  /** The Fabric.js canvas instance. */
  private canvas: Canvas | null = null;

  /** Current active tool. */
  tool = $state<AnnotationTool>('select');

  /** Current annotation color. */
  color = $state('#ef4444');

  /** Current font family for the text tool. */
  fontFamily = $state('system-ui, -apple-system, sans-serif');

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

  /**
   * SharedDefaults proxy that delegates to this wrapper's $state fields.
   * Passed to tool handlers in applyProperties() and syncFromObject() calls.
   */
  private _sharedDefaults: SharedDefaults | null = null;
  get sharedDefaults(): SharedDefaults {
    if (!this._sharedDefaults) {
      const w = this;
      this._sharedDefaults = {
        get color() { return w.color; },
        set color(v) { w.color = v; },
        get strokeWidth() { return w.strokeWidth; },
        set strokeWidth(v) { w.strokeWidth = v; },
        get opacity() { return w.opacity; },
        set opacity(v) { w.opacity = v; },
        get fillEnabled() { return w.fillEnabled; },
        set fillEnabled(v) { w.fillEnabled = v; },
        get fillColor() { return w.fillColor; },
        set fillColor(v) { w.fillColor = v; },
        get fontFamily() { return w.fontFamily; },
        set fontFamily(v) { w.fontFamily = v; },
        get obfuscationEffect() { return w.obfuscationEffect; },
        set obfuscationEffect(v) { w.obfuscationEffect = v; },
        get blurRadius() { return w.blurRadius; },
        set blurRadius(v) { w.blurRadius = v; },
        get pixelateBlockSize() { return w.pixelateBlockSize; },
        set pixelateBlockSize(v) { w.pixelateBlockSize = v; },
      };
    }
    return this._sharedDefaults;
  }

  /** The currently active tool handler (derived from tool ID). */
  get activeToolHandler(): ToolHandler | undefined {
    return this.registry.get(this.tool);
  }

  /**
   * Deduplicated tool handlers for all currently selected objects.
   * Used by PropertiesPanel to render stacked panels for multi-select.
   */
  get selectedObjectHandlers(): ToolHandler[] {
    if (!this.canvas) return [];
    const objs = this.canvas.getActiveObjects();
    if (objs.length === 0) return [];
    const seen = new Set<string>();
    const handlers: ToolHandler[] = [];
    for (const obj of objs) {
      const handler = this.registry.identifyTool(obj);
      if (handler && !seen.has(handler.toolId)) {
        seen.add(handler.toolId);
        handlers.push(handler);
      }
    }
    return handlers;
  }

  /** Internal undo stack of JSON snapshots. */
  private undoStack: string[] = [];
  /** Internal redo stack. */
  private redoStack: string[] = [];
  /** Whether we're currently loading from undo/redo (suppress snapshot). */
  private isRestoring = false;
  /**
   * Reentry guard for `reRenderAllObfuscationOverlays`. Re-rendering an
   * overlay eventually calls `pushSnapshot`/`updateCounts`, which must not
   * trigger another refresh pass.
   */
  private _rerenderingObfuscation = false;
  /** Whether the user is currently dragging to create a shape (suppress intermediate snapshots). */
  isDrawing = $state(false);
  /** Debounce timer for coalescing rapid canvas-modification events (e.g. freehand path:created). */
  private _modifiedTimer: ReturnType<typeof setTimeout> | null = null;

  /** Reactive undo/redo availability. */
  canUndo = $state(false);
  canRedo = $state(false);

  /** Whether the canvas has any annotation objects. */
  hasAnnotations = $state(false);

  /** Whether the click indicator object is currently on the canvas. */
  clickIndicatorVisible = $state(false);

  /** Distinct callout group colors currently on the canvas (for the group picker in properties). */
  calloutGroups = $state<string[]>([]);

  /** Count of objects on canvas (excluding crop mask internals). */
  objectCount = $state(0);

  /** Count of currently selected objects. */
  selectedCount = $state(0);

  /** Natural dimensions of the background image. */
  imageWidth = $state(0);
  imageHeight = $state(0);

  /** Current zoom/fit scale factor. */
  private fitScale = 1;

  /** Last container dimensions for re-calling updateFit from setTool. */
  private _lastContainerW = 0;
  private _lastContainerH = 0;

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

  /** Clipboard buffer for copy/paste. */
  private clipboard: any[] = [];

  /** Last known mouse position in scene (canvas) coordinates, updated on every mouse:move. */
  private lastMouseScenePos: { x: number; y: number } | null = null;

  /** Keydown listener for re-anchoring uniform scaling when Shift is pressed mid-drag. */
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;

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
      get fontFamily() { return wrapper.fontFamily; },
      get strokeWidth() { return wrapper.strokeWidth; },
      get opacity() { return wrapper.opacity; },
      get fillEnabled() { return wrapper.fillEnabled; },
      get fillColor() { return wrapper.fillColor; },
      get blurRadius() { return wrapper.blurRadius; },
      get pixelateBlockSize() { return wrapper.pixelateBlockSize; },
      get obfuscationEffect() { return wrapper.obfuscationEffect; },
      get imageWidth() { return wrapper.imageWidth; },
      get imageHeight() { return wrapper.imageHeight; },
      pushSnapshot: () => wrapper.pushSnapshot(),
      updateCounts: () => wrapper.updateCounts(),
      setDrawing: (v) => { wrapper.isDrawing = v; },
      setArrowPolylineMode: (v) => { wrapper.arrowPolylineMode = v; },
      setArrowEditingId: (id) => { wrapper.arrowEditingId = id; },
      getArrowEditingId: () => wrapper.arrowEditingId,
      getCurrentTool: () => wrapper.tool,
    };

    // When Shift is pressed mid-drag, re-anchor the transform's original state to the
    // current scale so uniform scaling locks to the aspect ratio at the moment Shift
    // is pressed, not the pre-drag ratio.
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && this.canvas) {
        const transform = (this.canvas as any)._currentTransform;
        if (transform?.target) {
          transform.original.scaleX = transform.target.scaleX;
          transform.original.scaleY = transform.target.scaleY;
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown);

    // Wire up event handlers.
    this.canvas.on('mouse:down', (e) => this.onMouseDown(e));
    this.canvas.on('mouse:move', (e) => this.onMouseMove(e));
    this.canvas.on('mouse:up', (e) => this.onMouseUp(e));

    // Track modifications for undo.
    this.canvas.on('object:added', () => {
      // A new shape/arrow/text may be sitting behind an existing obfuscation
      // overlay — refresh any overlays so they pick up the new content.
      if (!this.isRestoring && !this._rerenderingObfuscation) {
        this.reRenderAllObfuscationOverlays();
      }
      this.onCanvasModified();
    });
    this.canvas.on('object:modified', (e) => {
      if (this._rerenderingObfuscation) return;
      // Re-render blur/pixelate overlays when they are moved or scaled.
      const obj = e.target as any;
      if (obj && (obj._wegweiserType === 'blurOverlay' || obj._wegweiserType === 'pixelateOverlay')) {
        // Refresh every overlay: the moved/resized overlay itself plus any
        // overlays stacked on top of it (their composite-below changed).
        this.reRenderAllObfuscationOverlays();
        // Don't call onCanvasModified here — reRenderOverlay will handle it
        // after the async image update completes.
        return;
      }
      // A non-overlay shape was edited: refresh every overlay so any blur
      // sitting above the edited shape re-samples the updated pixels.
      this.reRenderAllObfuscationOverlays();
      this.onCanvasModified();
    });
    // Live crop overlay updates during interactive move/resize.
    const onCropInteraction = (e: any) => {
      const target = e.target as any;
      if (!target || target._wegweiserType !== 'cropMask') return;
      const ch = this.registry.get('crop') as CropToolHandler;
      this.isRestoring = true;
      ch.updateCropOverlays(this.ctx);
      this.isRestoring = false;
    };
    this.canvas.on('object:moving', onCropInteraction);
    this.canvas.on('object:scaling', onCropInteraction);

    this.canvas.on('object:removed', (e) => {
      if (!this.isRestoring) {
        const obj = (e as any).target as any;
        if (obj?._wegweiserType === 'callout' && typeof obj._calloutColor === 'string') {
          // Recalculate from remaining canvas objects so the counter always
          // reflects max-on-screen + 1 (handles cascading deletes like 5 then 6).
          (this.registry.get('callout') as CalloutToolHandler).recalcColorCounter(this.canvas!, obj._calloutColor);
        }
        if (!this._rerenderingObfuscation) {
          this.reRenderAllObfuscationOverlays();
        }
      }
      this.onCanvasModified();
    });

    // Track selection changes. Arrow edit-mode transitions are delegated to ArrowToolHandler.
    const arrowHandler = this.registry.get('arrow') as ArrowToolHandler;
    this.canvas.on('selection:created', (e) => {
      this.updateSelectedCount();
      const target = (e as any).selected?.[0];
      if (target && (target as any).customType === 'polyline-arrow') {
        arrowHandler.enterEditMode(this.ctx, target as Group);
      }
      if (target && (target as any)._wegweiserType === 'clickIndicator') {
        this.setTool('click-indicator');
      }
      // Sync properties from the selected object back into shared/tool state.
      if (target) {
        const handler = this.registry.identifyTool(target);
        if (handler) handler.syncFromObject(target, this.sharedDefaults);
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
      if (newTarget && (newTarget as any)._wegweiserType === 'clickIndicator') {
        this.setTool('click-indicator');
      }
      // Sync properties from the newly selected object back into shared/tool state.
      if (newTarget) {
        const handler = this.registry.identifyTool(newTarget);
        if (handler) handler.syncFromObject(newTarget, this.sharedDefaults);
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

    this._lastContainerW = containerW;
    this._lastContainerH = containerH;

    // Check if we should fit to a crop area instead of the full image.
    const cropHandler = this.registry.get('crop') as CropToolHandler;
    const cropRect = cropHandler.getCropRect();
    const fitToCrop = cropRect && this.tool !== 'crop';

    let targetW = this.imageWidth;
    let targetH = this.imageHeight;
    let cropX = 0;
    let cropY = 0;

    if (fitToCrop) {
      targetW = cropRect.width! * (cropRect.scaleX ?? 1);
      targetH = cropRect.height! * (cropRect.scaleY ?? 1);
      cropX = cropRect.left!;
      cropY = cropRect.top!;
    }

    // Always compute CSS dimensions from the full image.
    const normalScale = Math.min(containerW / this.imageWidth, containerH / this.imageHeight);
    this.fitScale = normalScale;

    // Resize only the CSS display size; the backing pixel buffer stays at the
    // natural image dimensions (imageWidth × imageHeight) so that:
    //   - the background image fills the buffer exactly at 1:1
    //   - all shape/mouse coordinates stay in natural image space (0..imageWidth, 0..imageHeight)
    //   - Fabric's getScenePoint auto-corrects for the CSS-to-buffer ratio
    this.canvas.setDimensions(
      { width: Math.round(this.imageWidth * normalScale), height: Math.round(this.imageHeight * normalScale) },
      { cssOnly: true },
    );

    // When fitting to crop, use Fabric's viewport transform to zoom/pan so the
    // crop area fills the canvas. Fabric's getScenePoint automatically inverts
    // the transform, so mouse interactions remain correct.
    if (fitToCrop) {
      const vptZoom = Math.min(this.imageWidth / targetW, this.imageHeight / targetH);
      const panX = (this.imageWidth - targetW * vptZoom) / 2 - cropX * vptZoom;
      const panY = (this.imageHeight - targetH * vptZoom) / 2 - cropY * vptZoom;
      this.canvas.setViewportTransform([vptZoom, 0, 0, vptZoom, panX, panY]);
    } else {
      this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    }

    this.canvas.renderAll();
  }

  /** Re-run updateFit with last known container dimensions. */
  private reFit(): void {
    if (this._lastContainerW > 0 && this._lastContainerH > 0) {
      this.updateFit(this._lastContainerW, this._lastContainerH);
    }
  }

  /** Clean up the Fabric.js canvas. */
  dispose(): void {
    if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
    this._onKeyDown = null;
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
    this.undoStack = [];
    this.redoStack = [];
    this.clipboard = [];
    this.arrowPolylineMode = false;
    this.arrowEditingId = null;
    (this.registry.get('crop') as CropToolHandler).resetState();
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
    const wasCrop = this.tool === 'crop';
    const prev = this.registry.get(this.tool);
    prev?.onDeactivate(this.ctx);
    this.tool = t;

    const next = this.registry.get(t);
    if (next) {
      next.onActivate(this.ctx, (fn) => this.forEachAnnotation(fn));
    }

    // Callouts are always selectable regardless of the active tool so the user
    // can click them to switch to the callout tool from any other tool.
    if (t !== 'callout') {
      this.canvas.getObjects().forEach((obj) => {
        if ((obj as any)._wegweiserType === 'callout') {
          obj.set({ selectable: true, evented: true });
        }
      });
      this.canvas.renderAll();
    }

    // When switching to/from the crop tool, update overlay opacity and refit
    // so the viewport zooms into/out of the crop area.
    const isCrop = t === 'crop';
    if ((wasCrop || isCrop) && wasCrop !== isCrop) {
      const cropHandler = this.registry.get('crop') as CropToolHandler;
      if (cropHandler.getCropRect()) {
        this.isRestoring = true;
        cropHandler.updateCropOverlays(this.ctx);
        this.isRestoring = false;
      }
      this.reFit();
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

  /** Update the font family for the text tool. Also updates the selected object if any. */
  setFontFamily(f: string): void {
    this.fontFamily = f;
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
      (this.registry.get('obfuscation') as ObfuscationToolHandler).reRenderOverlay(this.ctx, active as FabricImage);
    }
  }

  /** Set the blur radius for the gaussian blur effect. */
  setBlurRadius(r: number): void {
    this.blurRadius = r;
    // Re-render any currently selected blur overlay with the new radius.
    const active = this.canvas?.getActiveObject();
    if (active && (active as any)._wegweiserType === 'blurOverlay') {
      (this.registry.get('obfuscation') as ObfuscationToolHandler).reRenderOverlay(this.ctx, active as FabricImage);
    }
  }

  /** Set the block size for the pixelate effect. */
  setPixelateBlockSize(size: number): void {
    this.pixelateBlockSize = size;
    // Re-render any currently selected pixelate overlay with the new block size.
    const active = this.canvas?.getActiveObject();
    if (active && (active as any)._wegweiserType === 'pixelateOverlay') {
      (this.registry.get('obfuscation') as ObfuscationToolHandler).reRenderOverlay(this.ctx, active as FabricImage);
    }
  }

  /**
   * Re-render every blur/pixelate overlay on the canvas so they pick up
   * changes to the objects beneath them (z-order change, shape edit, new
   * object added below, etc.). Bottom-up so stacked overlays cascade
   * correctly (an upper blur re-samples the already-refreshed lower blur).
   */
  reRenderAllObfuscationOverlays(): void {
    if (!this.canvas || this._rerenderingObfuscation) return;
    const overlays = this.canvas.getObjects().filter((obj) => {
      const t = (obj as any)._wegweiserType;
      return t === 'blurOverlay' || t === 'pixelateOverlay';
    });
    if (overlays.length === 0) return;
    this._rerenderingObfuscation = true;
    const handler = this.registry.get('obfuscation') as ObfuscationToolHandler;
    try {
      for (const overlay of overlays) {
        handler.reRenderOverlay(this.ctx, overlay as FabricImage);
      }
    } finally {
      this._rerenderingObfuscation = false;
    }
  }

  /**
   * Change the z-order of the currently selected objects.
   * `direction` = 'front' | 'back' | 'forward' | 'backward'.
   * Skips the background and the crop rect. Records an undo snapshot and
   * refreshes obfuscation overlays whose stack below has changed.
   */
  private moveSelection(direction: 'front' | 'back' | 'forward' | 'backward'): void {
    if (!this.canvas) return;
    const active = this.canvas.getActiveObjects();
    if (active.length === 0) return;

    const cropRect = (this.registry.get('crop') as CropToolHandler).getCropRect();
    const movable = active.filter((obj) => {
      if (obj === cropRect) return false;
      const t = (obj as any)._wegweiserType;
      return t !== 'cropOverlay' && t !== 'cropMask' && t !== 'cropDrawOverlay';
    });
    if (movable.length === 0) return;

    // For 'front'/'forward', iterate back-to-front on canvas z-order so the
    // relative order of the selection is preserved after the move. For
    // 'back'/'backward', iterate front-to-back.
    const all = this.canvas.getObjects();
    const sorted = [...movable].sort((a, b) => all.indexOf(a) - all.indexOf(b));
    const ordered = direction === 'front' || direction === 'forward' ? sorted.reverse() : sorted;

    for (const obj of ordered) {
      switch (direction) {
        case 'front':
          this.canvas.bringObjectToFront(obj);
          break;
        case 'back':
          this.canvas.sendObjectToBack(obj);
          break;
        case 'forward':
          this.canvas.bringObjectForward(obj);
          break;
        case 'backward':
          this.canvas.sendObjectBackwards(obj);
          break;
      }
    }

    this.canvas.renderAll();
    this.reRenderAllObfuscationOverlays();
    this.onCanvasModified();
  }

  /** Bring the currently selected object(s) to the top of the z-stack. */
  bringToFront(): void { this.moveSelection('front'); }

  /** Send the currently selected object(s) to the bottom of the z-stack. */
  sendToBack(): void { this.moveSelection('back'); }

  /** Move the currently selected object(s) one step up in z-order. */
  bringForward(): void { this.moveSelection('forward'); }

  /** Move the currently selected object(s) one step down in z-order. */
  sendBackwards(): void { this.moveSelection('backward'); }

  /** Delete the currently selected object(s). */
  deleteSelected(): void {
    if (!this.canvas) return;
    const active = this.canvas.getActiveObjects();
    if (active.length === 0) return;
    const cropHandler = this.registry.get('crop') as CropToolHandler;
    let cropDeleted = false;
    for (const obj of active) {
      // If deleting the crop rect, clear crop state.
      if (obj === cropHandler.getCropRect()) {
        cropHandler.clearCrop(this.ctx);
        cropDeleted = true;
        continue;
      }
      this.canvas.remove(obj);
    }
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    if (cropDeleted) this.reFit();
  }

  /** Select all annotation objects on the canvas. */
  selectAll(): void {
    if (!this.canvas || this.tool !== 'select') return;
    const cropRect = (this.registry.get('crop') as CropToolHandler).getCropRect();
    const objs = this.canvas.getObjects().filter(
      (obj) => {
        const t = (obj as any)._wegweiserType;
        return t !== 'cropOverlay' && t !== 'cropDrawOverlay' && obj !== cropRect;
      },
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
    // Strip viewportTransform — it's managed by updateFit/reFit, not by snapshots.
    delete (json as Record<string, unknown>).viewportTransform;
    // Exclude crop overlays — they're purely visual and are always rebuilt from
    // the crop mask rect on deserialize, so including them causes duplicates.
    (json as any).objects = ((json as any).objects as any[]).filter(
      (o: any) => o._wegweiserType !== 'cropOverlay' && o._wegweiserType !== 'cropDrawOverlay',
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

    // Recalculate callout numbering.
    (this.registry.get('callout') as CalloutToolHandler).recalcCalloutNumbers(this.canvas);

    // Rescan for cropMask and rebuild dim overlays.
    (this.registry.get('crop') as CropToolHandler).updateCropOverlays(this.ctx);

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

    // If a click indicator was restored from JSON, sync its current canvas
    // position back into the handler so toggleClickIndicator() places it
    // where the user last left it, not at the original click_relative.
    const indicator = this.canvas.getObjects().find(
      (o) => (o as any)._wegweiserType === 'clickIndicator',
    );
    if (indicator && indicator.left !== undefined && indicator.top !== undefined) {
      (this.registry.get('click-indicator') as ClickIndicatorToolHandler).setPosition(
        indicator.left,
        indicator.top,
      );
    }

    // Refit in case a crop rect was loaded.
    this.reFit();

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

    const cropHandler = this.registry.get('crop') as CropToolHandler;
    const cropRect = cropHandler.getCropRect();

    // Reset VPT to identity for export (crop centering may have set a non-identity transform).
    const savedVpt = [...this.canvas.viewportTransform] as [number, number, number, number, number, number];
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Temporarily hide crop visuals for export.
    cropHandler.hideCropVisuals();

    let dataUrl: string;
    if (cropRect) {
      const left = cropRect.left!;
      const top = cropRect.top!;
      const width = cropRect.width! * (cropRect.scaleX ?? 1);
      const height = cropRect.height! * (cropRect.scaleY ?? 1);
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

    cropHandler.showCropVisuals();
    this.canvas.setViewportTransform(savedVpt);
    this.canvas.renderAll();

    return dataUrl;
  }

  /**
   * Store the click position on the handler so toggleClickIndicator() always
   * knows where to place the indicator. Must be called before initClickIndicator()
   * or toggleClickIndicator(), including when re-opening a step that already has
   * annotations_json (the position isn't stored in the JSON).
   */
  setClickIndicatorPosition(x: number, y: number): void {
    (this.registry.get('click-indicator') as ClickIndicatorToolHandler).setPosition(x, y);
  }

  /**
   * Place the click indicator at the previously set position.
   * Called once from AnnotationEditor when opening a fresh step (no saved annotations).
   */
  initClickIndicator(x: number, y: number): void {
    const handler = this.registry.get('click-indicator') as ClickIndicatorToolHandler;
    handler.setPosition(x, y);
    handler.placeIndicator(this.ctx);
  }

  /** Toggle the click indicator on/off. Delegates to ClickIndicatorToolHandler. */
  toggleClickIndicator(): void {
    if (!this.canvas) return;
    (this.registry.get('click-indicator') as ClickIndicatorToolHandler).toggleIndicator(this.ctx);
  }

  /** Get the underlying Fabric.js canvas (for advanced use). */
  getCanvas(): Canvas | null {
    return this.canvas;
  }

  // ─── Private helpers ──────────────────────────────────────────

  private onMouseDown(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas || !e.viewportPoint) return;
    const pointer = this.canvas.getScenePoint(e.e);
    // A direct click on a callout switches to the callout tool and syncs its group color.
    if (this.tool !== 'callout' && e.target && (e.target as any)._wegweiserType === 'callout') {
      this.setTool('callout');
      const handler = this.registry.identifyTool(e.target);
      if (handler) handler.syncFromObject(e.target, this.sharedDefaults);
    }
    // A direct click on an IText/Textbox from any non-text tool auto-switches to the text tool.
    if (this.tool !== 'text' && e.target instanceof IText) {
      const clickedText = e.target;
      const handler = this.registry.identifyTool(clickedText);
      if (handler) handler.syncFromObject(clickedText, this.sharedDefaults);
      this.setTool('text'); // onActivate calls discardActiveObject internally
      // Re-select the textbox after onActivate discarded it.
      requestAnimationFrame(() => {
        if (!this.canvas) return;
        this.canvas.setActiveObject(clickedText);
        this.canvas.renderAll();
      });
      return;
    }
    this.registry.get(this.tool)?.onMouseDown(this.ctx, pointer, e);
  }

  private onMouseMove(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas) return;
    const pointer = this.canvas.getScenePoint(e.e);
    this.lastMouseScenePos = { x: pointer.x, y: pointer.y };
    this.registry.get(this.tool)?.onMouseMove(this.ctx, pointer, e);
  }

  private onMouseUp(e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.canvas) return;
    const pointer = this.canvas.getScenePoint(e.e);
    this.registry.get(this.tool)?.onMouseUp(this.ctx, pointer, e);
  }

  /** Set the crop rect from external coordinates (used by Window Select). */
  setCropFromRect(x: number, y: number, w: number, h: number): void {
    if (!this.canvas) return;
    (this.registry.get('crop') as CropToolHandler).setCropFromRect(this.ctx, x, y, w, h);
  }

  /** Clear the crop rect and overlays. */
  clearCrop(): void {
    if (!this.canvas) return;
    (this.registry.get('crop') as CropToolHandler).clearCrop(this.ctx);
    this.reFit();
  }

  /** Iterate over all annotation objects (excluding crop overlays). */
  private forEachAnnotation(fn: (obj: any) => void): void {
    if (!this.canvas) return;
    this.canvas.getObjects().forEach((obj) => {
      const t = (obj as any)._wegweiserType;
      if (t !== 'cropOverlay' && t !== 'cropDrawOverlay') {
        fn(obj);
      }
    });
  }

  /** Update style of the currently selected object(s) via their tool handler. */
  private updateSelectedObjectStyle(): void {
    if (!this.canvas) return;
    const active = this.canvas.getActiveObject();
    if (!active) return;

    // For multi-select (ActiveSelection), apply to each object individually.
    const objects = active instanceof ActiveSelection ? active.getObjects() : [active];
    for (const obj of objects) {
      const handler = this.registry.identifyTool(obj);
      if (handler) {
        handler.applyProperties(this.ctx, obj, this.sharedDefaults);
      }
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

    // Rescan for cropMask and rebuild dim overlays.
    (this.registry.get('crop') as CropToolHandler).updateCropOverlays(this.ctx);

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
    // Refit in case the crop state changed (added/removed by undo/redo).
    this.reFit();
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
      const cropHandler = this.registry.get('crop') as CropToolHandler;
      if (cropHandler.getCropRect()) {
        this.isRestoring = true;
        cropHandler.updateCropOverlays(this.ctx);
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
      this.clickIndicatorVisible = false;
      this.calloutGroups = [];
      return;
    }
    let count = 0;
    let hasIndicator = false;
    const calloutColorsSeen = new Set<string>();
    this.canvas.getObjects().forEach((obj) => {
      const type = (obj as any)._wegweiserType;
      if (type !== 'cropOverlay' && type !== 'cropDrawOverlay') {
        count++;
      }
      if (type === 'clickIndicator') {
        hasIndicator = true;
      }
      if (type === 'callout') {
        const c = (obj as any)._calloutColor;
        if (typeof c === 'string') calloutColorsSeen.add(c);
      }
    });
    this.objectCount = count;
    this.hasAnnotations = count > 0;
    this.clickIndicatorVisible = hasIndicator;
    this.calloutGroups = Array.from(calloutColorsSeen);
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
