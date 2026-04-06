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
}
