import { setContext, getContext } from 'svelte';
import type { AppStore } from '$lib/stores/session.svelte';
import type { ImageCacheStore } from '$lib/stores/image-cache.svelte';
import type { createDragReorder } from '$lib/stores/drag-reorder.svelte';
import type { createExportChoice } from '$lib/stores/export-choice.svelte';
import type { ReviewUndoStore } from '$lib/stores/undo.svelte';
import type { createEditorSession } from '$lib/stores/editor-session.svelte';

const REVIEW_CTX_KEY = Symbol('review-context');

export interface ReviewContext {
  store: AppStore;
  imageStore: ImageCacheStore;
  drag: ReturnType<typeof createDragReorder>;
  ec: ReturnType<typeof createExportChoice>;
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
