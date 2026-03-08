import { invoke } from '@tauri-apps/api/core';
import { store } from '$lib/stores/session.svelte';
import type { ReviewUndoStore } from './undo.svelte';

/**
 * createReviewNavigation — back-navigation dialog logic + browser/mouse event handling.
 *
 * Registers window `mouseup` (button-3) and `popstate` handlers via `$effect` so they
 * are automatically cleaned up when the component that called this factory is destroyed.
 *
 * @param reviewUndo      Review-level undo store; cleared on discard.
 * @param getIsDirty      Reactive getter; true when there are unsaved changes.
 * @param performNavigate Callback that does the actual navigation (reset state + invoke).
 */
export function createReviewNavigation(
  reviewUndo: ReviewUndoStore,
  getIsDirty: () => boolean,
  performNavigate: () => Promise<void>,
) {
  /** Whether the "unsaved changes" back-navigation dialog is open. */
  let showBackDialog = $state(false);

  function requestBack() {
    if (getIsDirty()) {
      showBackDialog = true;
    } else {
      performNavigate();
    }
  }

  async function discardAndNavigateBack() {
    showBackDialog = false;
    // Undo all pending changes to restore the session to its last-saved state.
    // invoke("undo_session") throws when the stack is empty — use that as the stop condition.
    while (true) {
      try {
        await invoke('undo_session');
      } catch {
        break;
      }
    }
    reviewUndo.clear();
    await performNavigate();
  }

  function saveSession() {
    store.markSaved();
  }

  // Register mouse button-3 and browser back handlers.
  // Using $effect so listeners are cleaned up automatically on component destroy.
  $effect(() => {
    function handleMouseUp(event: MouseEvent) {
      if (event.button === 3) {
        event.preventDefault();
        requestBack();
      }
    }
    function handlePopState(event: PopStateEvent) {
      event.preventDefault();
      requestBack();
    }
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('popstate', handlePopState);
    };
  });

  return {
    get showBackDialog() {
      return showBackDialog;
    },
    set showBackDialog(v: boolean) {
      showBackDialog = v;
    },
    requestBack,
    discardAndNavigateBack,
    saveSession,
  };
}
