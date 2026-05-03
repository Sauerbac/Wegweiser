import type { FabricObject } from 'fabric';
import type { SharedDefaults } from './tool-handler.js';

/**
 * Shared sync/apply helpers for stroke+fill shapes (rectangle, ellipse).
 * Both tools use identical logic for reading and writing shape properties,
 * so the code lives here instead of being duplicated per handler.
 */

export function syncShapeFromObject(obj: FabricObject, shared: SharedDefaults): void {
  if (typeof obj.stroke === 'string' && obj.stroke) shared.color = obj.stroke;
  if (typeof obj.strokeWidth === 'number') {
    if (obj.stroke === 'transparent') {
      // Stroke is hidden — show the user-chosen width stored in the custom property,
      // falling back to the raw strokeWidth for shapes saved before this logic existed.
      const intended = (obj as any)._intendedStrokeWidth;
      if (typeof intended === 'number' && intended > 0) {
        shared.strokeWidth = intended;
      } else if (obj.strokeWidth > 0) {
        shared.strokeWidth = obj.strokeWidth;
      }
    } else {
      shared.strokeWidth = obj.strokeWidth;
    }
  }
  shared.strokeDashArray = obj.strokeDashArray ?? null;
  if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  const fill = obj.fill;
  const fillEnabled = !!(fill && fill !== 'transparent');
  if (fillEnabled) {
    shared.fillEnabled = true;
    if (typeof fill === 'string') shared.fillColor = fill;
  } else {
    shared.fillEnabled = false;
  }
  obj.set({ perPixelTargetFind: !fillEnabled });
}

export function applyShapeProperties(obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void {
  switch (changedProperty) {
    case 'color':
      if (shared.color === 'transparent') {
        // Save the visible stroke width before hiding, so it can be restored.
        if (obj.stroke !== 'transparent') {
          (obj as any)._intendedStrokeWidth = obj.strokeWidth;
        }
        obj.set({ stroke: 'transparent', strokeWidth: 0, strokeUniform: true });
      } else {
        // Restore the saved width, or fall back to the current shared width.
        const intended = (obj as any)._intendedStrokeWidth;
        const sw = (typeof intended === 'number' && intended > 0) ? intended : shared.strokeWidth;
        obj.set({ stroke: shared.color, strokeWidth: sw, strokeUniform: true });
      }
      // Stroke-width change affects bounding box; oCoords must be refreshed.
      obj.setCoords();
      break;
    case 'strokeWidth':
      // Only write to the object when stroke is actually visible; when it is
      // transparent we keep strokeWidth=0 on the object so the selection
      // outline hugs the fill area rather than the invisible stroke area.
      if (obj.stroke !== 'transparent') {
        obj.set({ strokeWidth: shared.strokeWidth, strokeUniform: true });
        obj.setCoords();
      }
      break;
    case 'strokeDashArray':
      obj.set({ strokeDashArray: shared.strokeDashArray ?? undefined });
      break;
    case 'fillEnabled':
    case 'fillColor':
      obj.set({ fill: shared.fillEnabled ? shared.fillColor : 'transparent', perPixelTargetFind: !shared.fillEnabled });
      break;
    case 'opacity':
      obj.set({ opacity: shared.opacity });
      break;
    case 'cornerRadius':
      obj.set({ rx: shared.cornerRadius, ry: shared.cornerRadius });
      break;
  }
}
