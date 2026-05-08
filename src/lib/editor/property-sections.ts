import type { PropertySection } from './tools/tool-handler.js';

/**
 * Canonical rendering order for property sections in the properties panel.
 * The panel iterates this array and renders only sections that the active
 * tool handler(s) declare in their propertySections list.
 */
export const SECTION_ORDER: PropertySection[] = [
  'stroke-color',
  'fill-color',
  'stroke-width',
  'stroke-style',
  'arrow-heads',
  'corner-radius',
  'highlight-width',
  'highlight-opacity',
  'font-family',
  'text-style',
  'font-size',
  'text-align',
  'callout-groups',
  'obfuscation',
  'crop',
  'click-indicator',
  'opacity',
];
