/**
 * Font size lookup for the text tool's S/M/L size buttons.
 * Key = strokeWidth bucket value; value = font size in canvas px.
 */
export const STROKE_TO_FONT_SIZE: Record<number, number> = { 2: 16, 4: 28, 8: 48 };

/** Convert a strokeWidth bucket to the corresponding font size. */
export function strokeWidthToFontSize(sw: number): number {
  return STROKE_TO_FONT_SIZE[sw] ?? 24;
}

/** Reverse-map a font size to the nearest strokeWidth bucket. */
export function fontSizeToStrokeWidth(fs: number): number {
  if (fs >= 48) return 8;
  if (fs >= 28) return 4;
  return 2;
}

/**
 * Custom Fabric.js property names that must be included in serialization,
 * clone(), and toObject() calls. Defined once here to avoid silent data loss
 * when the list is copy-pasted across multiple call sites.
 */
export const CUSTOM_PROPS: string[] = [
  '_wegweiserType',
  '_calloutNumber',
  '_calloutColor',
  '_wegweiserEffect',
  '_wegweiserBlurRadius',
  '_wegweiserBlockSize',
  'customType',
  'arrowColor',
  'arrowStartHead',
  'arrowEndHead',
  'waypointData',
  '_arrowUid',
  '_waypointOriginLeft',
  '_waypointOriginTop',
  '_highlightColor',
  '_highlightOpacity',
  '_highlightWidth',
  '_highlightPoints',
];
