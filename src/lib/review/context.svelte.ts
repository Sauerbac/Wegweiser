import { setContext, getContext } from 'svelte';
import type { AppStore } from '$lib/stores/session.svelte';
import type { ImageCacheStore } from '$lib/stores/image-cache.svelte';
import type { createDragReorder } from '$lib/review/drag-reorder.svelte';
import type { createExportChoice } from '$lib/review/export-choice.svelte';
import type { createExportActions } from '$lib/review/export-actions.svelte';
import type { ReviewUndoStore } from '$lib/review/undo.svelte';
import type { createEditorSession } from '$lib/review/editor-session.svelte';

const REVIEW_CTX_KEY = Symbol('review-context');

export interface ReviewContext {
  store: AppStore;
  imageStore: ImageCacheStore;
  drag: ReturnType<typeof createDragReorder>;
  ec: ReturnType<typeof createExportChoice>;
  exportActions: ReturnType<typeof createExportActions>;
  reviewUndo: ReviewUndoStore;
  editorSession: ReturnType<typeof createEditorSession>;
  readonly isBulkSelectActive: boolean;
}

export function setReviewContext(ctx: ReviewContext) {
  setContext(REVIEW_CTX_KEY, ctx);
}

export function getReviewContext(): ReviewContext {
  return getContext<ReviewContext>(REVIEW_CTX_KEY);
}
