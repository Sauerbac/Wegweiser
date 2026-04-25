import { IText, Textbox } from 'fabric';
import type { FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ToolContext, ToolHandler, SharedDefaults } from './tool-handler.js';
import { strokeWidthToFontSize, fontSizeToStrokeWidth } from '../canvas-props.js';

/** Default wrap width (px in canvas coordinates) for new textboxes. */
const DEFAULT_TEXTBOX_WIDTH = 200;

/** Hide corner and vertical-scale handles — only ml/mr (wrap width) and mtr (rotate) remain. */
const HIDDEN_TEXTBOX_CONTROLS = { tl: false, tr: false, bl: false, br: false, mt: false, mb: false };

export class TextToolHandler implements ToolHandler {
  readonly toolId = 'text';
  readonly propertySections = ['stroke-color', 'font-family', 'font-size', 'opacity'] as const;

  /** Tracks which textbox is a candidate for entering editing on mouseUp. */
  private _pendingEditTarget: IText | null = null;
  /** Viewport-coordinate position of the mousedown, for drag detection. */
  private _mouseDownClientPos: { x: number; y: number } | null = null;

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.discardActiveObject();
    // IText/Textbox: selectable so resize handles work; evented for events.
    // Other objects: not interactable while text tool is active.
    forEachAnnotation((obj) => {
      if (obj instanceof IText) {
        obj.set({ selectable: true, evented: true });
      } else {
        obj.set({ selectable: false, evented: false });
      }
    });
    ctx.canvas.renderAll();
  }

  onDeactivate(_ctx: ToolContext): void {
    this._pendingEditTarget = null;
    this._mouseDownClientPos = null;
  }

  cancel(_ctx: ToolContext): boolean { return false; }

  isDrawing(): boolean { return false; }

  onMouseDown(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    if (e.target instanceof IText) {
      // First click: Fabric handles selection naturally (selectable: true).
      // Track so onMouseUp can decide whether to enter editing (click vs drag).
      if (ctx.canvas.getActiveObject() === e.target) {
        this._pendingEditTarget = e.target;
        this._mouseDownClientPos = { x: (e.e as MouseEvent).clientX, y: (e.e as MouseEvent).clientY };
      }
      return;
    }
    this._pendingEditTarget = null;
    this._mouseDownClientPos = null;
    if (e.target) return; // Clicked some other annotation — ignore.
    this.placeText(ctx, pointer.x, pointer.y);
  }

  onMouseMove(_ctx: ToolContext, _p: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {}

  onMouseUp(ctx: ToolContext, _p: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    const target = this._pendingEditTarget;
    const downPos = this._mouseDownClientPos;
    this._pendingEditTarget = null;
    this._mouseDownClientPos = null;

    if (!target || !downPos || e.target !== target) return;
    if (ctx.canvas.getActiveObject() !== target) return;

    // Only enter editing if the mouse didn't move significantly (click, not drag).
    const dx = (e.e as MouseEvent).clientX - downPos.x;
    const dy = (e.e as MouseEvent).clientY - downPos.y;
    if (Math.hypot(dx, dy) < 5) {
      this.enterTextEditing(ctx, target);
    }
  }

  /**
   * After loadFromJSON, IText/Textbox objects lose their hiddenTextareaContainer.
   * Re-attach it and re-register the editing-entered handler.
   */
  fixupContainers(ctx: ToolContext): void {
    const container = ctx.canvas.getElement().parentElement;
    if (!container) return;
    ctx.canvas.getObjects().forEach((obj) => {
      if (obj instanceof IText) {
        (obj as any).hiddenTextareaContainer = container;
        obj.set({ cursorWidth: 2, hoverCursor: 'move' });
        if (typeof obj.fill === 'string') (obj as any).cursorColor = obj.fill;
        if (obj instanceof Textbox) (obj as any).setControlsVisibility(HIDDEN_TEXTBOX_CONTROLS);
        this.attachEditingEnteredHandler(ctx, obj as unknown as IText);
      }
    });
  }

  private placeText(ctx: ToolContext, x: number, y: number): void {
    const canvasContainer = ctx.canvas.getElement().parentElement;
    const fontSize = strokeWidthToFontSize(ctx.strokeWidth);
    const text = new Textbox('', {
      left: x,
      top: y,
      width: DEFAULT_TEXTBOX_WIDTH,
      originX: 'left',
      originY: 'top',
      fill: ctx.color,
      fontSize,
      fontFamily: ctx.fontFamily,
      opacity: ctx.opacity,
      selectable: true,
      evented: true,
      hiddenTextareaContainer: canvasContainer,
      cursorColor: ctx.color,
      cursorWidth: 2,
      splitByGrapheme: false,
      // Show move cursor on hover when not editing; Fabric restores 'text' cursor
      // automatically via _setEditingProps / _restoreEditingProps during editing.
      hoverCursor: 'move',
    });

    if (text instanceof Textbox) text.setControlsVisibility(HIDDEN_TEXTBOX_CONTROLS);
    const textAsIText = text as unknown as IText;
    this.attachEditingEnteredHandler(ctx, textAsIText);

    ctx.canvas.add(text);
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.renderAll();
    ctx.canvas.setActiveObject(text);

    this.attachTextEditingExitedHandler(ctx, textAsIText);

    requestAnimationFrame(() => {
      if (!ctx.canvas) return;
      ctx.canvas.setActiveObject(text);
      text.enterEditing();
      ctx.canvas.renderAll();
    });
  }

  private enterTextEditing(ctx: ToolContext, text: IText): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.setActiveObject(text);
    // Sync cursor color to the current text fill before entering editing.
    if (typeof text.fill === 'string') (text as any).cursorColor = text.fill;

    this.attachTextEditingExitedHandler(ctx, text);

    requestAnimationFrame(() => {
      if (!ctx.canvas) return;
      ctx.canvas.setActiveObject(text);
      text.enterEditing();
      ctx.canvas.renderAll();
    });
  }

  /**
   * Override the properties Fabric disables during editing so that:
   * - All resize/rotation handles remain visible.
   * - The textbox can still be dragged by its border/handles while editing.
   *
   * Fires every time editing is entered (Fabric fires 'editing:entered' after
   * _setEditingProps() has already hidden controls and locked movement).
   */
  private attachEditingEnteredHandler(ctx: ToolContext, text: IText): void {
    if ((text as any)._wegweiserEditingEnteredAttached) return;
    (text as any)._wegweiserEditingEnteredAttached = true;

    text.on('editing:entered', () => {
      // Re-enable what Fabric's _setEditingProps() disabled.
      (text as any).hasControls = true;
      (text as any).lockMovementX = false;
      (text as any).lockMovementY = false;
      text.set({ selectable: true });
      if (text instanceof Textbox) text.setControlsVisibility(HIDDEN_TEXTBOX_CONTROLS);
      ctx.canvas.renderAll();
    });
  }

  private attachTextEditingExitedHandler(ctx: ToolContext, text: IText): void {
    const onEditingExited = () => {
      text.off('editing:exited', onEditingExited);

      // Auto-delete textboxes that were left empty.
      if ((text.text ?? '').trim() === '') {
        ctx.canvas.remove(text);
        ctx.canvas.renderAll();
        return;
      }

      // Guard: only apply post-edit state if still in text mode.
      if (ctx.getCurrentTool() !== 'text') return;

      // Ensure the textbox remains fully interactive after editing.
      text.set({ selectable: true });
      (text as any).hasControls = true;
      (text as any).lockMovementX = false;
      (text as any).lockMovementY = false;
      ctx.canvas.isDrawingMode = false;
      ctx.canvas.selection = false;
      ctx.canvas.renderAll();
    };
    text.on('editing:exited', onEditingExited);
  }

  identifiesObject(obj: FabricObject): boolean {
    return obj instanceof IText;
  }

  syncFromObject(obj: FabricObject, shared: SharedDefaults): void {
    if (!(obj instanceof IText)) return;
    if (typeof obj.fill === 'string') shared.color = obj.fill;
    if (typeof obj.fontFamily === 'string') shared.fontFamily = obj.fontFamily;
    shared.strokeWidth = fontSizeToStrokeWidth(obj.fontSize ?? 24);
    if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  }

  applyProperties(_ctx: ToolContext, obj: FabricObject, shared: SharedDefaults): void {
    if (!(obj instanceof IText)) return;
    obj.set({
      fill: shared.color,
      fontFamily: shared.fontFamily,
      fontSize: strokeWidthToFontSize(shared.strokeWidth),
      opacity: shared.opacity,
    });
    (obj as any).cursorColor = shared.color;
  }
}
