import type { Canvas, FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';

/**
 * Context object passed to every ToolHandler call.
 * Provides read access to reactive state and write-back callbacks into FabricCanvasWrapper.
 * Constructed once in init() using getter accessors so values are always current.
 */
export interface ToolContext {
  readonly canvas: Canvas;
  readonly color: string;
  readonly strokeWidth: number;
  readonly opacity: number;
  readonly fillEnabled: boolean;
  readonly fillColor: string;
  readonly blurRadius: number;
  readonly pixelateBlockSize: number;
  pushSnapshot(): void;
  updateCounts(): void;
  setDrawing(active: boolean): void;
  setArrowPolylineMode(active: boolean): void;
  setArrowEditingId(id: string | null): void;
  getArrowEditingId(): string | null;
  getCurrentTool(): string;
}

/**
 * Interface every annotation tool handler must implement.
 * Adding a new tool = create a new file implementing this interface + one register() call.
 */
export interface ToolHandler {
  /** Unique string ID matching the AnnotationTool union member. */
  readonly toolId: string;

  /**
   * Called when this tool is activated via setTool().
   * Should configure canvas.isDrawingMode, canvas.selection, object evented/selectable flags.
   */
  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void;

  /**
   * Called when switching away from this tool (before the new tool's onActivate).
   * Should clean up any in-progress state without finalizing.
   */
  onDeactivate(ctx: ToolContext): void;

  /**
   * Cancel any in-progress draw operation without adding it to the canvas.
   * Returns true if something was cancelled, false if nothing was in progress.
   */
  cancel(ctx: ToolContext): boolean;

  /** Returns true if this tool is currently mid-draw (suppresses intermediate snapshots). */
  isDrawing(): boolean;

  onMouseDown(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void;
  onMouseMove(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void;
  onMouseUp(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void;
}
