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
  'waypointData',
  '_arrowUid',
  '_waypointOriginLeft',
  '_waypointOriginTop',
];
