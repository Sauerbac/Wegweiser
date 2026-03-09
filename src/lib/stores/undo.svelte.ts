import { invoke } from '@tauri-apps/api/core';

export type ReviewUndoEntry =
  | { type: 'editorSession'; stepId: number; depth: number }
  | { type: 'backend' };

/**
 * Manages the Review-screen undo/redo stack.
 *
 * Two kinds of entries:
 *   - 'backend'       — a single backend-tracked op (delete, rename, reorder).
 *                       Undo/redo calls invoke("undo_session") once.
 *   - 'editorSession' — a collapsed image-editor session. Undo/redo calls
 *                       invoke("undo_session"/"redo_session") `depth` times and
 *                       flashes the affected step row.
 *
 * Ctrl+Z / Ctrl+Y while the editor is open are NOT routed through this store —
 * Review.svelte dispatches custom 'editor-undo'/'editor-redo' window events that
 * ImageEditor listens for directly.
 */
export class ReviewUndoStore {
  undoStack = $state<ReviewUndoEntry[]>([]);
  redoStack = $state<ReviewUndoEntry[]>([]);
  /** Step ID to flash briefly after a Review-level undo/redo of an editor session. */
  highlightedStepId = $state<number | null>(null);
  /**
   * When a Review-level undo/redo collapses an editorSession, we record the
   * expected depth state so the editor can restore it on next open.
   *   - After Review undo of editorSession(N): { depth:0, redoDepth:N }
   *     (N entries moved to backend redo stack — editor can redo them)
   *   - After Review redo of editorSession(N): { depth:N, redoDepth:0 }
   *     (N entries moved back to backend undo stack — editor can undo them)
   */
  pendingEditorState = $state<{ stepId: number; depth: number; redoDepth: number } | null>(null);
  private _flashTimer: ReturnType<typeof setTimeout> | null = null;

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  flashStep(stepId: number) {
    if (this._flashTimer !== null) clearTimeout(this._flashTimer);
    this.highlightedStepId = stepId;
    this._flashTimer = setTimeout(() => {
      this.highlightedStepId = null;
      this._flashTimer = null;
    }, 1200);
  }

  /** Call after any invoke that the backend records on its undo stack (delete, rename, etc.). */
  pushBackend() {
    this.undoStack = [...this.undoStack, { type: 'backend' }];
    this.redoStack = [];
  }

  /**
   * Call when the image editor closes.
   * If depth > 0, collapses the editor session into a single Review-level event.
   */
  pushEditorSession(stepId: number, depth: number) {
    if (depth <= 0) return;
    this.undoStack = [...this.undoStack, { type: 'editorSession', stepId, depth }];
    this.redoStack = [];
  }

  async undo() {
    const entry = this.undoStack.at(-1);
    if (!entry) return;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, entry];

    if (entry.type === 'editorSession') {
      for (let i = 0; i < entry.depth; i++) {
        try { await invoke('undo_session'); } catch { break; }
      }
      // After undoing N edits, the backend redo stack has N entries.
      // If the editor is opened next for this step, it can redo them.
      this.pendingEditorState = { stepId: entry.stepId, depth: 0, redoDepth: entry.depth };
      this.flashStep(entry.stepId);
    } else {
      try { await invoke('undo_session'); } catch { /* nothing to undo */ }
    }
  }

  async redo() {
    const entry = this.redoStack.at(-1);
    if (!entry) return;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, entry];

    if (entry.type === 'editorSession') {
      for (let i = 0; i < entry.depth; i++) {
        try { await invoke('redo_session'); } catch { break; }
      }
      // After redoing N edits, the backend undo stack has N entries.
      // If the editor is opened next for this step, it can undo them.
      this.pendingEditorState = { stepId: entry.stepId, depth: entry.depth, redoDepth: 0 };
      this.flashStep(entry.stepId);
    } else {
      try { await invoke('redo_session'); } catch { /* nothing to redo */ }
    }
  }

  /**
   * Consume the pending editor state for the given step (call when the editor opens).
   * Returns the depth/redoDepth the editor should start with, then clears the pending state.
   * Returns {depth:0, redoDepth:0} if no pending state exists or it's for a different step.
   */
  consumePendingEditorState(stepId: number): { depth: number; redoDepth: number } {
    if (this.pendingEditorState?.stepId === stepId) {
      const { depth, redoDepth } = this.pendingEditorState;
      this.pendingEditorState = null;
      return { depth, redoDepth };
    }
    return { depth: 0, redoDepth: 0 };
  }

  /**
   * If the top of the undo stack is an editorSession for the given step, removes it and
   * returns its depth so the editor can resume where it left off on reopen.
   * Returns null if the top entry does not match.
   *
   * Called when the editor opens after a normal close (no Review-level undo/redo in
   * between). This lets the editor continue the same session rather than starting at 0.
   */
  popTopEditorSession(stepId: number): number | null {
    const top = this.undoStack.at(-1);
    if (top?.type === 'editorSession' && top.stepId === stepId) {
      this.undoStack = this.undoStack.slice(0, -1);
      return top.depth;
    }
    return null;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.pendingEditorState = null;
    if (this._flashTimer !== null) {
      clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    this.highlightedStepId = null;
  }
}
