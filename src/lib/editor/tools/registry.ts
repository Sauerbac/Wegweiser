import type { FabricObject } from 'fabric';
import type { ToolHandler } from './tool-handler.js';

export class ToolRegistry {
  private handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): this {
    this.handlers.set(handler.toolId, handler);
    return this;
  }

  get(toolId: string): ToolHandler | undefined {
    return this.handlers.get(toolId);
  }

  getAll(): ToolHandler[] {
    return [...this.handlers.values()];
  }

  /** Find the tool handler that created/owns the given Fabric object. */
  identifyTool(obj: FabricObject): ToolHandler | undefined {
    for (const handler of this.handlers.values()) {
      if (handler.identifiesObject(obj)) return handler;
    }
    return undefined;
  }
}
