/**
 * Arrow polyline helpers: waypoint-based arrow construction and edit-mode controls.
 *
 * Extracted from FabricCanvasWrapper to keep shape-creation logic separate
 * from canvas lifecycle and tool-state concerns.
 */

import {
  Canvas,
  Group,
  Path,
  Polygon,
  Control,
  Point,
  util,
} from 'fabric';

// ─── Path geometry ─────────────────────────────────────────────────────────

/**
 * Convert an array of waypoints to a smooth SVG path string using
 * Catmull-Rom → Cubic Bézier conversion.
 * 2-point paths use a straight line; 3+ points use smooth curves.
 */
export function waypointsToSmoothPath(points: { x: number; y: number }[]): string {
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

// ─── Group construction ────────────────────────────────────────────────────

/**
 * Create the Path and Polygon children and add them to an existing group.
 * Does NOT update waypointData or controls — callers do that.
 */
export function rebuildGroupContents(
  group: Group,
  pts: { x: number; y: number }[],
  fallbackColor: string,
  fallbackStrokeWidth: number,
): void {
  const color = (group as any).arrowColor ?? fallbackColor;
  const strokeW = (group as any).strokeWidth ?? fallbackStrokeWidth;

  const d = waypointsToSmoothPath(pts);

  const pathObj = new Path(d, {
    stroke: color,
    strokeWidth: strokeW,
    fill: '',
    strokeUniform: true,
    selectable: false,
    evented: false,
  });

  // Arrowhead direction: last segment tangent (P[N-2] → P[N-1]).
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

// ─── Controls ─────────────────────────────────────────────────────────────

/**
 * Attach custom Control instances (one per waypoint) to the group.
 * Hides all default corner/edge/rotation handles.
 * Called when entering edit mode on an arrow.
 */
export function attachWaypointControls(
  group: Group,
  pts: { x: number; y: number }[],
  canvas: Canvas,
  onWaypointDrag: (group: Group, newPoints: { x: number; y: number }[]) => void,
  syncOrigin: (group: Group) => void,
): void {
  const controls: Record<string, Control> = {};

  pts.forEach((_, idx) => {
    controls[`wp_${idx}`] = new Control({
      x: 0,
      y: 0,
      cursorStyle: 'crosshair',
      actionName: 'moveWaypoint',
      positionHandler(_dim, _finalMatrix, obj) {
        const waypoints: { x: number; y: number }[] = (obj as any).waypointData;
        if (!waypoints || !waypoints[idx]) return new Point(0, 0);
        const dx = (obj.left ?? 0) - ((obj as any)._waypointOriginLeft ?? 0);
        const dy = (obj.top ?? 0) - ((obj as any)._waypointOriginTop ?? 0);
        const pt = { x: waypoints[idx].x + dx, y: waypoints[idx].y + dy };
        const vpt = canvas.viewportTransform;
        if (!vpt) return new Point(pt.x, pt.y);
        return util.transformPoint(new Point(pt.x, pt.y), vpt);
      },
      actionHandler(_eventData, transform, x, y) {
        const obj = transform.target as Group;
        syncOrigin(obj);
        const waypoints: { x: number; y: number }[] = [
          ...((obj as any).waypointData as { x: number; y: number }[]),
        ];
        const vpt = canvas.viewportTransform;
        const invVpt = vpt ? util.invertTransform(vpt) : ([1, 0, 0, 1, 0, 0] as any);
        const scene = util.transformPoint(new Point(x, y), invVpt);
        waypoints[idx] = { x: scene.x, y: scene.y };
        onWaypointDrag(obj, waypoints);
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
 * Restore the default Fabric.js transform controls on a polyline-arrow group.
 * Removes all custom waypoint controls by deleting instance-level overrides.
 */
export function detachWaypointControls(group: Group): void {
  if (Object.prototype.hasOwnProperty.call(group, 'controls')) {
    delete (group as any).controls;
  }
  if (Object.prototype.hasOwnProperty.call(group, '_controlsVisibility')) {
    delete (group as any)._controlsVisibility;
  }
}

// ─── Waypoint origin sync ──────────────────────────────────────────────────

/**
 * Bake the accumulated group drag delta into waypointData so that
 * waypoint coordinates match the group's current scene position.
 */
export function syncWaypointDataWithGroupPosition(group: Group): void {
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
