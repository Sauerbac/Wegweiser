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
        if (obj.stroke !== 'transparent') {
          // In Fabric.js 7, left/top = top-left of bounding box including stroke.
          // Hiding stroke (sw → 0) shrinks the bbox; shift left/top to keep fill center fixed.
          const oldSW = obj.strokeWidth ?? 0;
          (obj as any)._intendedStrokeWidth = oldSW;
          const delta = oldSW / 2;
          obj.set({
            stroke: 'transparent',
            strokeWidth: 0,
            strokeUniform: true,
            left: (obj.left ?? 0) + delta,
            top: (obj.top ?? 0) + delta,
          });
        } else {
          obj.set({ stroke: 'transparent', strokeWidth: 0, strokeUniform: true });
        }
      } else {
        const intended = (obj as any)._intendedStrokeWidth;
        const newSW = (typeof intended === 'number' && intended > 0) ? intended : shared.strokeWidth;
        const oldSW = obj.strokeWidth ?? 0;
        const delta = (oldSW - newSW) / 2;
        obj.set({
          stroke: shared.color,
          strokeWidth: newSW,
          strokeUniform: true,
          left: (obj.left ?? 0) + delta,
          top: (obj.top ?? 0) + delta,
        });
      }
      obj.setCoords();
      break;
    case 'strokeWidth':
      // Only write to the object when stroke is actually visible; when it is
      // transparent we keep strokeWidth=0 on the object so the selection
      // outline hugs the fill area rather than the invisible stroke area.
      if (obj.stroke !== 'transparent') {
        // Adjust left/top so the visual center stays fixed as the bbox grows/shrinks.
        const oldSW = obj.strokeWidth ?? 0;
        const newSW = shared.strokeWidth;
        const delta = (oldSW - newSW) / 2;
        obj.set({
          strokeWidth: newSW,
          strokeUniform: true,
          left: (obj.left ?? 0) + delta,
          top: (obj.top ?? 0) + delta,
        });
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
