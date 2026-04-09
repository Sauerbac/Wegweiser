import type { FabricObject } from 'fabric';
import type { SharedDefaults } from './tool-handler.js';

/**
 * Shared sync/apply helpers for stroke+fill shapes (rectangle, ellipse).
 * Both tools use identical logic for reading and writing shape properties,
 * so the code lives here instead of being duplicated per handler.
 */

export function syncShapeFromObject(obj: FabricObject, shared: SharedDefaults): void {
  if (typeof obj.stroke === 'string' && obj.stroke) shared.color = obj.stroke;
  if (typeof obj.strokeWidth === 'number') shared.strokeWidth = obj.strokeWidth;
  if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  const fill = obj.fill;
  if (fill && fill !== 'transparent') {
    shared.fillEnabled = true;
    if (typeof fill === 'string') shared.fillColor = fill;
  } else {
    shared.fillEnabled = false;
  }
}

export function applyShapeProperties(obj: FabricObject, shared: SharedDefaults): void {
  obj.set({
    stroke: shared.color,
    strokeWidth: shared.strokeWidth,
    strokeUniform: true,
    fill: shared.fillEnabled ? shared.fillColor : 'transparent',
    opacity: shared.opacity,
  });
}
