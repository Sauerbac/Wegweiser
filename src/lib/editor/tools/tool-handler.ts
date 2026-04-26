import type { Canvas, FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import type { ObfuscationEffect } from '../obfuscation.js';

/**
 * Property sections that can appear in the properties panel.
 * Each tool handler declares which sections it supports via propertySections.
 * The panel renders only those sections in a fixed canonical order.
 */
export type PropertySection =
  | 'stroke-color'
  | 'fill-color'
  | 'stroke-width'
  | 'stroke-style'
  | 'corner-radius'
  | 'font-family'
  | 'font-size'
  | 'opacity'
  | 'obfuscation'
  | 'crop'
  | 'click-indicator'
  | 'callout-groups'
  | 'highlight-width'
  | 'highlight-opacity';

/**
 * Shared property defaults that persist across tool switches.
 * When the user sets color to red on rectangle, then switches to arrow, arrow also uses red.
 * Backed by a reactive proxy over FabricCanvasWrapper's $state fields.
 */
export interface SharedDefaults {
  color: string;
  strokeWidth: number;
  strokeDashArray: number[] | null;
  opacity: number;
  fillEnabled: boolean;
  fillColor: string;
  fontFamily: string;
  obfuscationEffect: ObfuscationEffect;
  blurRadius: number;
  pixelateBlockSize: number;
  /** Highlight-tool-exclusive opacity — never read or written by other tools. */
  highlightOpacity: number;
  /** Highlight-tool-exclusive stroke width — never read or written by other tools. */
  highlightWidth: number;
  /** Corner radius for rectangles (0 = sharp, 12 = rounded). */
  cornerRadius: number;
}

/**
 * Context object passed to every ToolHandler call.
 * Provides read access to reactive state and write-back callbacks into FabricCanvasWrapper.
 * Constructed once in init() using getter accessors so values are always current.
 */
export interface ToolContext {
  readonly canvas: Canvas;
  readonly color: string;
  readonly fontFamily: string;
  readonly strokeWidth: number;
  readonly strokeDashArray: number[] | null;
  readonly opacity: number;
  readonly fillEnabled: boolean;
  readonly fillColor: string;
  readonly blurRadius: number;
  readonly pixelateBlockSize: number;
  readonly obfuscationEffect: ObfuscationEffect;
  readonly highlightOpacity: number;
  readonly highlightWidth: number;
  readonly cornerRadius: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  pushSnapshot(): void;
  updateCounts(): void;
  setDrawing(active: boolean): void;
  setArrowPolylineMode(active: boolean): void;
  setArrowEditingId(id: string | null): void;
  getArrowEditingId(): string | null;
  getCurrentTool(): string;
  /** Directly set the shared color (no selected-object side effects). Used by tools that maintain per-tool color memory. */
  overrideColor(c: string): void;
  /** Directly set the shared opacity (no selected-object side effects). */
  overrideOpacity(o: number): void;
  /** Directly set the shared strokeWidth (no selected-object side effects). */
  overrideStrokeWidth(w: number): void;
}

/**
 * Interface every annotation tool handler must implement.
 * Adding a new tool = create a new file implementing this interface + one register() call.
 */
export interface ToolHandler {
  /** Unique string ID matching the AnnotationTool union member. */
  readonly toolId: string;

  /**
   * Property sections this tool supports, rendered in the canonical order
   * defined by SECTION_ORDER. The panel shows only sections declared here.
   * Empty array means no properties (e.g. select tool delegates to selected objects).
   */
  readonly propertySections: readonly PropertySection[];

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

  /**
   * Returns true if this handler created/owns the given Fabric object.
   * Used to map selected objects back to their tool handler.
   */
  identifiesObject(obj: FabricObject): boolean;

  /**
   * Read properties from a selected Fabric object back into shared/tool state.
   * Called when an object of this handler's type is selected.
   */
  syncFromObject(obj: FabricObject, shared: SharedDefaults): void;

  /**
   * Apply the current property state to a Fabric object of this handler's type.
   * Called when the user changes a property in the properties panel while the object is selected.
   * `changedProperty` names exactly which SharedDefaults field was modified — handlers must
   * only update the matching object property and leave everything else untouched.
   */
  applyProperties(ctx: ToolContext, obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void;
}
