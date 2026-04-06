import { ToolRegistry } from './registry.js';
import { SelectToolHandler } from './select.js';
import { FreehandToolHandler } from './freehand.js';
import { RectangleToolHandler } from './rectangle.js';
import { EllipseToolHandler } from './ellipse.js';
import { HighlightToolHandler } from './highlight.js';
import { TextToolHandler } from './text.js';
import { CalloutToolHandler } from './callout.js';
import { ArrowToolHandler } from './arrow.js';
import { ObfuscationToolHandler } from './obfuscation-tool.js';
import { CropToolHandler } from './crop.js';

export { ToolRegistry } from './registry.js';
export type { ToolContext, ToolHandler } from './tool-handler.js';
export { ArrowToolHandler } from './arrow.js';
export { TextToolHandler } from './text.js';
export { CalloutToolHandler } from './callout.js';
export { ObfuscationToolHandler } from './obfuscation-tool.js';
export { CropToolHandler } from './crop.js';

/**
 * Register all annotation tool handlers.
 * To add a new tool: create a new file implementing ToolHandler, then add one .register() call here.
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
    .register(new SelectToolHandler())
    .register(new FreehandToolHandler())
    .register(new RectangleToolHandler())
    .register(new EllipseToolHandler())
    .register(new HighlightToolHandler())
    .register(new TextToolHandler())
    .register(new CalloutToolHandler())
    .register(new ArrowToolHandler())
    .register(new ObfuscationToolHandler())
    .register(new CropToolHandler());
}
