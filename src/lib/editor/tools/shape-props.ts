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
  shared.strokeDashArray = obj.strokeDashArray ?? null;
  if (typeof obj.opacity === 'number') shared.opacity = obj.opacity;
  const fill = obj.fill;
  if (fill && fill !== 'transparent') {
    shared.fillEnabled = true;
    if (typeof fill === 'string') shared.fillColor = fill;
  } else {
    shared.fillEnabled = false;
  }
}

export function applyShapeProperties(obj: FabricObject, shared: SharedDefaults, changedProperty: keyof SharedDefaults): void {
  switch (changedProperty) {
    case 'color':
      obj.set({ stroke: shared.color, strokeUniform: true });
      break;
    case 'strokeWidth':
      obj.set({ strokeWidth: shared.strokeWidth, strokeUniform: true });
      break;
    case 'strokeDashArray':
      obj.set({ strokeDashArray: shared.strokeDashArray ?? undefined });
      break;
    case 'fillEnabled':
    case 'fillColor':
      obj.set({ fill: shared.fillEnabled ? shared.fillColor : 'transparent' });
      break;
    case 'opacity':
      obj.set({ opacity: shared.opacity });
      break;
  }
}
