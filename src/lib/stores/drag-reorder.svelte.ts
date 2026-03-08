import { invoke } from '@tauri-apps/api/core';
import type { Step } from '$lib/types';
import type { ReviewUndoStore } from './undo.svelte';

/**
 * createDragReorder — drag-to-reorder logic for the step list.
 *
 * @param getSteps              Reactive getter returning the current step array.
 * @param getIsBulkSelectActive Reactive getter; drag is disabled during bulk select.
 * @param reviewUndo            Review-level undo store; receives a 'backend' entry on reorder.
 */
export function createDragReorder(
  getSteps: () => Step[],
  getIsBulkSelectActive: () => boolean,
  reviewUndo: ReviewUndoStore,
) {
  /** ID of the step being dragged, or null when no drag is active. */
  let draggedStepId = $state<number | null>(null);
  /**
   * Insertion index into the steps array (0 = before first, steps.length = after last).
   * The bar is drawn before the card at this index.
   */
  let dragInsertIndex = $state<number | null>(null);

  /** Index of the dragged step in the steps array (-1 when none). */
  const draggedStepIdx = $derived(
    draggedStepId !== null
      ? getSteps().findIndex((s) => s.id === draggedStepId)
      : -1,
  );

  /** True when an insert at `insertIdx` would actually move the dragged step. */
  function isUsefulInsert(insertIdx: number): boolean {
    return (
      draggedStepId !== null &&
      insertIdx !== draggedStepIdx &&
      insertIdx !== draggedStepIdx + 1
    );
  }

  async function reorderSteps(orderedIds: number[]) {
    try {
      await invoke('reorder_steps', { stepIds: orderedIds });
      reviewUndo.pushBackend();
    } catch (err) {
      console.error('Failed to reorder steps:', err);
    }
  }

  function handleDragStart(event: DragEvent, stepId: number) {
    if (getIsBulkSelectActive()) {
      event.preventDefault();
      return;
    }
    draggedStepId = stepId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(stepId));
    }
  }

  function handleDragEnter(event: DragEvent) {
    if (getIsBulkSelectActive()) return;
    event.preventDefault();
  }

  function handleDragOver(event: DragEvent, _stepId: number, idx: number) {
    if (getIsBulkSelectActive()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    // Determine insert before or after this card based on cursor position.
    const card = event.currentTarget as HTMLElement;
    const { top, height } = card.getBoundingClientRect();
    dragInsertIndex = event.clientY < top + height / 2 ? idx : idx + 1;
  }

  function handleDragLeave(_event: DragEvent) {
    // Intentionally no-op: clearing dragInsertIndex here causes flicker when
    // the cursor transitions from a card into the adjacent bar. dragEnd cleans up.
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (draggedStepId === null || dragInsertIndex === null) {
      draggedStepId = null;
      dragInsertIndex = null;
      return;
    }
    const steps = getSteps();
    const ids = steps.map((s) => s.id);
    const fromIdx = ids.indexOf(draggedStepId);
    if (fromIdx === -1) {
      draggedStepId = null;
      dragInsertIndex = null;
      return;
    }
    // Adjust insert index for the removed element.
    const toIdx = dragInsertIndex > fromIdx ? dragInsertIndex - 1 : dragInsertIndex;
    if (toIdx === fromIdx) {
      draggedStepId = null;
      dragInsertIndex = null;
      return;
    }
    const newIds = [...ids];
    newIds.splice(fromIdx, 1);
    newIds.splice(toIdx, 0, draggedStepId);
    draggedStepId = null;
    dragInsertIndex = null;
    reorderSteps(newIds);
  }

  function handleDragEnd() {
    draggedStepId = null;
    dragInsertIndex = null;
  }

  return {
    get draggedStepId() {
      return draggedStepId;
    },
    get dragInsertIndex() {
      return dragInsertIndex;
    },
    set dragInsertIndex(v: number | null) {
      dragInsertIndex = v;
    },
    isUsefulInsert,
    handleDragStart,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  };
}
