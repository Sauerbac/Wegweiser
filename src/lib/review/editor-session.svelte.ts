import { untrack } from 'svelte';
import type { ReviewUndoStore } from './undo.svelte';

/**
 * createEditorSession — encapsulates all ImageEditor modal lifecycle state.
 *
 * Owns:
 *   - `open`           — modal visibility flag (bindable to ImageEditor).
 *   - `undoTick`       — tick counter incremented to trigger in-editor undo.
 *   - `redoTick`       — tick counter incremented to trigger in-editor redo.
 *   - `depth`          — number of editor ops that can be undone (bindable to ImageEditor).
 *   - `redoDepth`      — number of editor ops that can be redone (bindable to ImageEditor).
 *   - `fabricUndoSnapshots` / `fabricRedoSnapshots` — per-step Fabric.js undo/redo stacks,
 *     preserved across editor open/close so individual annotation ops are undoable on reopen.
 *
 * Handles:
 *   - Open transition: restores depth/redoDepth from any pending state in reviewUndo,
 *     and restores the per-step Fabric.js snapshot stacks.
 *   - Close transition: pushes a collapsed editorSession entry onto the Review undo stack,
 *     and persists the Fabric.js snapshot stacks for next open.
 *   - Keyboard shortcuts: Ctrl+Z/Y while editor is open increment the tick counters;
 *     while editor is closed they delegate to reviewUndo.undo()/redo(). The `isEditing`
 *     getter suppresses shortcuts while a text field has focus.
 *
 * @param reviewUndo   Review-level undo store — queried for pending state on open,
 *                     pushed to on close, delegated to for keyboard shortcuts.
 * @param getSelectedStepId  Reactive getter for the currently selected step ID.
 * @param getIsEditing       Reactive getter; true when a textarea has focus.
 */
export function createEditorSession(
  reviewUndo: ReviewUndoStore,
  getSelectedStepId: () => number | null,
  getIsEditing: () => boolean,
) {
  let open = $state(false);
  let undoTick = $state(0);
  let redoTick = $state(0);
  /**
   * Number of image edits that can be undone in the current editor session.
   * Bound to ImageEditor so the editor can increment/decrement it on apply/undo/redo.
   * Set on open to restore state after a Review-level undo/redo.
   */
  let depth = $state(0);
  /**
   * Number of image edits that can be redone in the current editor session.
   * Bound to ImageEditor so the editor can update it on apply/undo/redo.
   * Set on open to restore redo state after a Review-level undo.
   */
  let redoDepth = $state(0);

  /**
   * Per-step Fabric.js undo snapshot stacks, keyed by step ID.
   * Preserved across editor open/close so individual annotation operations
   * (e.g. add shape, move shape) are undoable when the editor is reopened for
   * the same step. Each entry is the JSON snapshot string that FabricCanvasWrapper
   * pushes on every canvas modification.
   */
  const fabricUndoSnapshots = new Map<number, string[]>();
  const fabricRedoSnapshots = new Map<number, string[]>();

  /**
   * The Fabric.js undo/redo stacks the editor should start with on this open.
   * Set when the editor opens, consumed by the editor via the getter.
   * Cleared to empty arrays after the editor reads them once (in initCanvas).
   */
  let pendingFabricUndo = $state<string[]>([]);
  let pendingFabricRedo = $state<string[]>([]);

  // Plain (non-reactive) guard — tracks previous value of `open` to detect transitions.
  let wasOpen = false;

  // Detect the editor open transition to restore depth/redoDepth.
  // The close transition is handled explicitly by onEditorClosed() — not here —
  // because the Dialog component sets open=false before handleClose() increments
  // depth, so reading depth inside this effect would always see the stale value.
  $effect(() => {
    const isOpen = open; // reactive dep — re-runs on every toggle
    untrack(() => {
      if (isOpen === wasOpen) return; // guard against double-runs in dev mode
      wasOpen = isOpen;
      if (!isOpen) return; // close path handled by onEditorClosed()

      // Editor just opened.
      const stepId = getSelectedStepId();
      const pending = reviewUndo.consumePendingEditorState(stepId ?? -1);

      // Each open/close cycle is its own Review-level undo unit — never
      // collapse with a prior session. depth tracks save count for *this*
      // session only.
      depth = 0;
      redoDepth = 0;

      // After a Review-level undo of an editorSession, the backend has been
      // rolled back to the pre-session state but the saved Fabric snapshots
      // end at the post-session state — they no longer match the canvas.
      // Don't restore them. Keep the snapshots in the map so a subsequent
      // Review redo (which puts the backend back to post-session state) can
      // restore them.
      const isAfterReviewUndo = pending.depth === 0 && pending.redoDepth > 0;
      if (isAfterReviewUndo || stepId === null) {
        pendingFabricUndo = [];
        pendingFabricRedo = [];
      } else {
        // Regular open or open after a Review redo — snapshots match the
        // backend state. Restore them so per-shape undo/redo continues working.
        pendingFabricUndo = fabricUndoSnapshots.get(stepId) ?? [];
        pendingFabricRedo = fabricRedoSnapshots.get(stepId) ?? [];
      }
    });
  });

  // Register Ctrl+Z / Ctrl+Y keyboard shortcuts via $effect so the listeners are
  // cleaned up automatically when the calling component is destroyed.
  $effect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (getIsEditing()) return;
      if (event.ctrlKey && !event.shiftKey && event.key === 'z') {
        event.preventDefault();
        if (open) {
          undoTick++;
        } else {
          reviewUndo.undo();
        }
      } else if (event.ctrlKey && (event.key === 'y' || (event.shiftKey && event.key === 'Z'))) {
        event.preventDefault();
        if (open) {
          redoTick++;
        } else {
          reviewUndo.redo();
        }
      }
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  return {
    get open() {
      return open;
    },
    set open(v: boolean) {
      open = v;
    },
    get undoTick() {
      return undoTick;
    },
    get redoTick() {
      return redoTick;
    },
    get depth() {
      return depth;
    },
    set depth(v: number) {
      depth = v;
    },
    get redoDepth() {
      return redoDepth;
    },
    set redoDepth(v: number) {
      redoDepth = v;
    },
    /** The Fabric.js undo snapshots the editor should start with (consumed once on open). */
    get pendingFabricUndo() {
      return pendingFabricUndo;
    },
    /** The Fabric.js redo snapshots the editor should start with (consumed once on open). */
    get pendingFabricRedo() {
      return pendingFabricRedo;
    },
    /**
     * Called by the editor after it has consumed the pending snapshot stacks.
     * Clears pendingFabricUndo/Redo so they are not re-applied on subsequent renders.
     */
    clearPendingFabricSnapshots() {
      pendingFabricUndo = [];
      pendingFabricRedo = [];
    },
    /**
     * Called by AnnotationEditor (via prop) after it finishes saving annotations
     * and incrementing its internal depth counter. Collapses the editor session
     * into a single Review-level undo entry.
     *
     * This must be called AFTER depth has been incremented and BEFORE open is set
     * to false — i.e. explicitly from handleClose(), not inferred from the open
     * binding — because the Dialog component sets open=false before handleClose()
     * finishes, which would otherwise race with the depth update.
     */
    onEditorClosed(finalDepth: number) {
      const stepId = getSelectedStepId();
      if (stepId !== null) {
        reviewUndo.pushEditorSession(stepId, finalDepth);
      }
    },

    /**
     * Called by the editor when it closes, to persist the current Fabric.js
     * undo/redo stacks for the given step so they survive across open/close cycles.
     */
    saveFabricSnapshots(stepId: number, undoStack: string[], redoStack: string[]) {
      if (undoStack.length > 0 || redoStack.length > 0) {
        fabricUndoSnapshots.set(stepId, undoStack);
        fabricRedoSnapshots.set(stepId, redoStack);
      } else {
        fabricUndoSnapshots.delete(stepId);
        fabricRedoSnapshots.delete(stepId);
      }
    },
    /**
     * Clear all preserved Fabric.js snapshot stacks (e.g. when a new session is loaded).
     */
    clearAllFabricSnapshots() {
      fabricUndoSnapshots.clear();
      fabricRedoSnapshots.clear();
    },
  };
}
