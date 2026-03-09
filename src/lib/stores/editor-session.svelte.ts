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
 *
 * Handles:
 *   - Open transition: restores depth/redoDepth from any pending state in reviewUndo.
 *   - Close transition: pushes a collapsed editorSession entry onto the Review undo stack.
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

  // Plain (non-reactive) guard — tracks previous value of `open` to detect transitions.
  let wasOpen = false;

  // Detect editor open/close transitions.
  // On open: restore depth/redoDepth from any pending state set by Review-level undo/redo.
  // On close: push a collapsed editorSession entry onto the Review undo stack.
  // The `open` reactive read is outside untrack so the effect re-runs on each toggle;
  // the write to `wasOpen` is inside untrack so it does not create a dependency.
  $effect(() => {
    const isOpen = open; // reactive dep — re-runs on every open/close toggle
    untrack(() => {
      const stepId = getSelectedStepId();
      if (isOpen && !wasOpen) {
        // Editor just opened.
        // Priority 1: pending state from a Review-level undo/redo (explicit depth override).
        const pending = reviewUndo.consumePendingEditorState(stepId ?? -1);
        if (pending.depth !== 0 || pending.redoDepth !== 0) {
          depth = pending.depth;
          redoDepth = pending.redoDepth;
        } else {
          // Priority 2: collapsed session from a prior close — restore depth so the user
          // can still undo edits made in the previous open of the same step.
          const prevDepth = reviewUndo.popTopEditorSession(stepId ?? -1);
          depth = prevDepth ?? 0;
          redoDepth = 0;
        }
      } else if (!isOpen && wasOpen && stepId !== null) {
        // Editor just closed — collapse this session into a Review undo entry.
        reviewUndo.pushEditorSession(stepId, depth);
      }
      wasOpen = isOpen;
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
  };
}
