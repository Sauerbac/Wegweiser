import { Group, Path, Polygon } from 'fabric';
import type { Canvas, FabricObject, TPointerEvent, TPointerEventInfo } from 'fabric';
import {
  attachWaypointControls,
  detachWaypointControls,
  rebuildGroupContents,
  syncWaypointDataWithGroupPosition,
  waypointsToSmoothPath,
} from '../arrow-polyline.js';
import type { ToolContext, ToolHandler } from './tool-handler.js';

interface ArrowDrawState {
  startX: number;
  startY: number;
  previewPath: Path | null;
}

interface ArrowPolylineState {
  points: { x: number; y: number }[];
  previewPath: Path | null;
  color: string;
  strokeWidth: number;
}

export class ArrowToolHandler implements ToolHandler {
  readonly toolId = 'arrow';

  private drawState: ArrowDrawState | null = null;
  private polylineState: ArrowPolylineState | null = null;
  private _lastClickTime = 0;
  private _isDrawing = false;

  onActivate(ctx: ToolContext, forEachAnnotation: (fn: (obj: FabricObject) => void) => void): void {
    ctx.canvas.isDrawingMode = false;
    ctx.canvas.selection = false;
    ctx.canvas.discardActiveObject();
    forEachAnnotation((obj) => obj.set({ selectable: false, evented: false }));
    ctx.canvas.renderAll();
  }

  onDeactivate(ctx: ToolContext): void {
    this.cancelPolyline(ctx);
    this.drawState = null;
    this._isDrawing = false;
  }

  cancel(ctx: ToolContext): boolean {
    let cancelled = false;
    if (this.drawState) {
      if (this.drawState.previewPath) ctx.canvas.remove(this.drawState.previewPath);
      this.drawState = null;
      this._isDrawing = false;
      ctx.setDrawing(false);
      cancelled = true;
    }
    if (this.polylineState) {
      this.cancelPolyline(ctx);
      cancelled = true;
    }
    return cancelled;
  }

  isDrawing(): boolean { return this._isDrawing; }

  onMouseDown(ctx: ToolContext, pointer: { x: number; y: number }, e: TPointerEventInfo<TPointerEvent>): void {
    // In polyline mode: each click adds a waypoint or finalizes.
    if (this.polylineState) {
      const now = Date.now();
      const isDoubleClick = now - this._lastClickTime < 400;
      this._lastClickTime = now;
      if (isDoubleClick) {
        this.finalizeArrowPolyline(ctx);
      } else {
        this.addPolylinePoint(ctx, pointer.x, pointer.y);
      }
      return;
    }

    if (e.target) return;

    // Start drag preview.
    this._isDrawing = true;
    ctx.setDrawing(true);
    const previewPath = new Path(
      `M ${pointer.x},${pointer.y} L ${pointer.x},${pointer.y}`,
      {
        stroke: ctx.color,
        strokeWidth: ctx.strokeWidth,
        strokeUniform: true,
        fill: '',
        opacity: ctx.opacity,
        selectable: false,
        evented: false,
      },
    );
    ctx.canvas.add(previewPath);
    this.drawState = { startX: pointer.x, startY: pointer.y, previewPath };
  }

  onMouseMove(ctx: ToolContext, pointer: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {
    // Update polyline preview.
    if (this.polylineState) {
      const state = this.polylineState;
      const previewPts = [...state.points, { x: pointer.x, y: pointer.y }];
      const d = waypointsToSmoothPath(previewPts);
      if (state.previewPath) ctx.canvas.remove(state.previewPath);
      state.previewPath = new Path(d, {
        stroke: state.color,
        strokeWidth: state.strokeWidth,
        strokeUniform: true,
        fill: '',
        opacity: ctx.opacity,
        selectable: false,
        evented: false,
      });
      ctx.canvas.add(state.previewPath);
      ctx.canvas.renderAll();
      return;
    }

    if (!this.drawState?.previewPath) return;
    const { startX, startY, previewPath } = this.drawState;
    const previewPts = [{ x: startX, y: startY }, { x: pointer.x, y: pointer.y }];
    const newD = waypointsToSmoothPath(previewPts);
    ctx.canvas.remove(previewPath);
    const updatedPath = new Path(newD, {
      stroke: previewPath.stroke as string,
      strokeWidth: previewPath.strokeWidth,
      strokeUniform: true,
      fill: '',
      opacity: previewPath.opacity,
      selectable: false,
      evented: false,
    });
    ctx.canvas.add(updatedPath);
    this.drawState.previewPath = updatedPath;
    ctx.canvas.renderAll();
  }

  onMouseUp(ctx: ToolContext, pointer: { x: number; y: number }, _e: TPointerEventInfo<TPointerEvent>): void {
    if (!this.drawState) return;
    const { startX, startY, previewPath } = this.drawState;

    const dx = Math.abs(pointer.x - startX);
    const dy = Math.abs(pointer.y - startY);

    if (dx < 3 && dy < 3) {
      // Tiny click → enter polyline mode.
      if (previewPath) ctx.canvas.remove(previewPath);
      this.drawState = null;
      this._isDrawing = false;
      ctx.setDrawing(false);
      this._lastClickTime = Date.now();
      this.startPolyline(ctx, startX, startY);
      return;
    }

    // Finalize drag arrow.
    if (previewPath) ctx.canvas.remove(previewPath);
    this.drawState = null;
    const pts = [{ x: startX, y: startY }, { x: pointer.x, y: pointer.y }];
    const group = this.buildArrowGroup(ctx, pts);
    ctx.canvas.add(group);
    this.enterEditMode(ctx, group);
    this._isDrawing = false;
    ctx.setDrawing(false);
    ctx.pushSnapshot();
    ctx.updateCounts();
    ctx.canvas.renderAll();
  }

  // ─── Polyline mode ───────────────────────────────────────────────────────

  private startPolyline(ctx: ToolContext, x: number, y: number): void {
    this.polylineState = {
      points: [{ x, y }],
      previewPath: null,
      color: ctx.color,
      strokeWidth: ctx.strokeWidth,
    };
    ctx.setArrowPolylineMode(true);
    this._isDrawing = true;
    ctx.setDrawing(true);
  }

  private addPolylinePoint(ctx: ToolContext, x: number, y: number): void {
    if (!this.polylineState) return;
    this.polylineState.points.push({ x, y });
    ctx.canvas.renderAll();
  }

  /** Finalize the polyline. Also callable as a public method from the god class delegate. */
  finalizeArrowPolyline(ctx: ToolContext): void {
    if (!this.polylineState) return;
    const state = this.polylineState;

    if (state.points.length < 2) {
      this.cancelPolyline(ctx);
      return;
    }

    if (state.previewPath) {
      ctx.canvas.remove(state.previewPath);
      state.previewPath = null;
    }

    const group = this.buildArrowGroup(ctx, state.points);
    ctx.canvas.add(group);
    this.enterEditMode(ctx, group);

    this.polylineState = null;
    ctx.setArrowPolylineMode(false);
    this._isDrawing = false;
    ctx.setDrawing(false);
    ctx.pushSnapshot();
    ctx.updateCounts();
    ctx.canvas.renderAll();
  }

  private cancelPolyline(ctx: ToolContext): void {
    if (!this.polylineState) {
      ctx.setArrowPolylineMode(false);
      this._isDrawing = false;
      ctx.setDrawing(false);
      return;
    }
    if (this.polylineState.previewPath) ctx.canvas.remove(this.polylineState.previewPath);
    this.polylineState = null;
    ctx.setArrowPolylineMode(false);
    this._isDrawing = false;
    ctx.setDrawing(false);
  }

  // ─── Arrow group helpers ─────────────────────────────────────────────────

  private buildArrowGroup(ctx: ToolContext, pts: { x: number; y: number }[]): Group {
    const group = new Group([], {
      selectable: true,
      evented: true,
      opacity: ctx.opacity,
      customType: 'polyline-arrow',
      arrowColor: ctx.color,
      strokeWidth: ctx.strokeWidth,
      _arrowUid: Math.random().toString(36).slice(2, 10),
    } as any);

    (group as any).waypointData = pts.map((p) => ({ ...p }));
    rebuildGroupContents(group, pts, ctx.color, ctx.strokeWidth);
    (group as any)._waypointOriginLeft = group.left ?? 0;
    (group as any)._waypointOriginTop = group.top ?? 0;
    detachWaypointControls(group);
    return group;
  }

  private updateArrow(ctx: ToolContext, group: Group, newPoints: { x: number; y: number }[]): void {
    const old = group.getObjects();
    old.forEach((o) => group.remove(o));
    rebuildGroupContents(group, newPoints, ctx.color, ctx.strokeWidth);
    (group as any).waypointData = newPoints.map((p) => ({ ...p }));
    (group as any)._waypointOriginLeft = group.left ?? 0;
    (group as any)._waypointOriginTop = group.top ?? 0;

    const arrowUid = (group as any)._arrowUid;
    if (arrowUid && arrowUid === ctx.getArrowEditingId()) {
      attachWaypointControls(
        group,
        newPoints,
        ctx.canvas,
        (g, pts) => this.updateArrow(ctx, g, pts),
        (g) => syncWaypointDataWithGroupPosition(g),
      );
    } else {
      detachWaypointControls(group);
    }
    ctx.canvas.requestRenderAll();
  }

  // ─── Edit mode ───────────────────────────────────────────────────────────

  enterEditMode(ctx: ToolContext, group: Group): void {
    const waypoints: { x: number; y: number }[] | undefined = (group as any).waypointData;
    if (!waypoints || waypoints.length < 2) return;
    ctx.setArrowEditingId((group as any)._arrowUid ?? null);
    group.set({ evented: true });
    syncWaypointDataWithGroupPosition(group);
    attachWaypointControls(
      group,
      (group as any).waypointData,
      ctx.canvas,
      (g, pts) => this.updateArrow(ctx, g, pts),
      (g) => syncWaypointDataWithGroupPosition(g),
    );
    if (ctx.canvas.getActiveObject() !== group) {
      ctx.canvas.setActiveObject(group);
    }
    ctx.canvas.renderAll();
  }

  exitEditMode(ctx: ToolContext, currentTool: string): void {
    const editingId = ctx.getArrowEditingId();
    if (editingId === null) return;
    ctx.setArrowEditingId(null);

    const obj = ctx.canvas.getObjects().find((o) => (o as any)._arrowUid === editingId);
    if (obj && (obj as any).customType === 'polyline-arrow') {
      detachWaypointControls(obj as Group);
      if (currentTool !== 'select') {
        obj.set({ evented: false });
      }
      ctx.canvas.requestRenderAll();
    }
  }

  /**
   * After loadFromJSON, polyline-arrow groups lose their custom Controls.
   * Re-attach them in the default non-edit state.
   */
  fixupControls(canvas: Canvas, setArrowEditingId: (id: string | null) => void): void {
    canvas.getObjects().forEach((obj) => {
      if ((obj as any).customType === 'polyline-arrow') {
        if (!(obj as any)._arrowUid) {
          (obj as any)._arrowUid = Math.random().toString(36).slice(2, 10);
        }
        if ((obj as any)._waypointOriginLeft == null) {
          (obj as any)._waypointOriginLeft = obj.left ?? 0;
        }
        if ((obj as any)._waypointOriginTop == null) {
          (obj as any)._waypointOriginTop = obj.top ?? 0;
        }
        detachWaypointControls(obj as Group);
      }
    });
    setArrowEditingId(null);
  }
}
