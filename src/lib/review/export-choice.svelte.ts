import { invoke } from '@tauri-apps/api/core';
import { imageStore } from '$lib/stores/image-cache.svelte';
import type { Step } from '$lib/types';
import { extraTabIndex } from '$lib/utils';

/**
 * Expand a step's export_choice to a full-length boolean array.
 *
 * - Empty array → all `totalCount` images included (legacy "All" sentinel).
 * - Short array → padded with `false` to `totalCount` entries.
 *
 * Mirrors `Step::effective_export_selection` in Rust (model.rs).
 */
export function expandExportChoice(choice: boolean[], totalCount: number): boolean[] {
  if (choice.length === 0) {
    return Array(totalCount).fill(true);
  }
  return Array.from({ length: totalCount }, (_, i) => choice[i] ?? false);
}

/**
 * createExportChoice — monitor-tab view state + export inclusion domain logic
 * for the detail panel.
 *
 * File I/O orchestration (exportMarkdown, exportHtml, openExported) lives in
 * createExportActions (export-actions.svelte.ts).
 *
 * @param getSelectedStep   Reactive getter for the currently selected Step (or null).
 * @param getSelectedStepId Reactive getter for the selected step's ID only — used to
 *                          reset the active monitor tab when the user switches steps
 *                          without also reacting to content changes (e.g. image_version).
 */
export function createExportChoice(
  getSelectedStep: () => Step | null,
  getSelectedStepId: () => number | null,
) {
  /**
   * Which monitor tab is shown in the detail view.
   * 'primary' = the annotated click-monitor image
   * 'extra_N' = the N-th extra image
   * 'all' = all images stacked (scrollable)
   */
  let activeMonitorTab = $state<string>('primary');
  /**
   * Tracks the last confirmed non-empty tab value so we can restore it when
   * the ToggleGroup tries to deselect the active item (emits "").
   */
  let lastNonEmptyMonitorTab = $state<string>('primary');
  /** Set to true while a monitor-export checkbox is being pressed; suppresses tab switching in onValueChange. */
  let checkboxInteracting = false;

  // Reset the monitor tab only when the selected step ID changes, not on every
  // content update (e.g. image_version bump after an edit).
  $effect(() => {
    // Establish a reactive dependency on selectedStepId only.
    getSelectedStepId();
    activeMonitorTab = 'primary';
    lastNonEmptyMonitorTab = 'primary';
  });

  /**
   * Which extra-image index the editor should open, derived from activeMonitorTab.
   * undefined = primary image; a number = extra_image_paths[N].
   */
  const editorExtraIndex = $derived<number | undefined>(
    activeMonitorTab.startsWith('extra_')
      ? extraTabIndex(activeMonitorTab)
      : undefined,
  );

  /** Reset the active monitor tab to primary (called on back-navigation). */
  function resetTab() {
    activeMonitorTab = 'primary';
    lastNonEmptyMonitorTab = 'primary';
  }

  /** Select a monitor tab: view-only, no export side-effect. */
  function selectMonitorTab(tab: string) {
    activeMonitorTab = tab;
    lastNonEmptyMonitorTab = tab;
  }

  /** Whether a given monitor tab is currently included in the export choice. */
  function isExportIncluded(tab: string): boolean {
    const choice = getSelectedStep()?.export_choice;
    if (!choice) return false;
    if (choice.length === 0) return true; // empty = all included
    const idx = tab === 'primary' ? 0 : extraTabIndex(tab) + 1;
    return choice[idx] ?? false;
  }

  async function setExportChoice(choice: boolean[]) {
    const step = getSelectedStep();
    if (!step) return;
    try {
      await invoke('set_step_export_choice', { stepId: step.id, choice });
    } catch (err) {
      console.error('Failed to set export choice:', err);
    }
    // No optimistic patch — the backend emits session-updated which the store handles.
  }

  /**
   * Toggle a monitor's inclusion in the export choice.
   * Builds a full boolean array, flips the relevant index, and saves it.
   */
  async function toggleExportMonitor(tab: string) {
    const step = getSelectedStep();
    if (!step) return;
    const extraCount = step.extra_image_paths?.length ?? 0;
    const totalCount = 1 + extraCount;

    const expanded = expandExportChoice(step.export_choice, totalCount);

    // Flip the toggled index.
    const idx = tab === 'primary' ? 0 : extraTabIndex(tab) + 1;
    expanded[idx] = !expanded[idx];

    await setExportChoice(expanded);
  }

  /**
   * Compute how many monitor images will be exported for a step based on its export_choice.
   * All false = 0; empty = all; otherwise count trues.
   */
  function monitorExportCount(step: Step): number {
    const choice = step.export_choice;
    const extraCount = step.extra_image_paths?.length ?? 0;
    if (choice.length === 0) return 1 + extraCount; // all
    return choice.filter(Boolean).length;
  }

  /**
   * Returns the list of { cacheKey, isExtra, extraIdx } objects for images that are included
   * in the export for a given step, in display order (primary first, then extras).
   */
  function getExportedImageKeys(
    step: Step,
  ): { cacheKey: string; isExtra: boolean; extraIdx: number }[] {
    const ver = step.image_version ?? 0;
    const extraCount = step.extra_image_paths?.length ?? 0;
    const totalCount = 1 + extraCount;
    const result: { cacheKey: string; isExtra: boolean; extraIdx: number }[] = [];

    const expanded = expandExportChoice(step.export_choice, totalCount);

    if (expanded[0]) {
      result.push({ cacheKey: imageStore.imageCacheKey(step), isExtra: false, extraIdx: -1 });
    }
    for (let i = 0; i < extraCount; i++) {
      if (expanded[i + 1]) {
        result.push({
          cacheKey: imageStore.extraImageKey(step.id, i, ver),
          isExtra: true,
          extraIdx: i,
        });
      }
    }
    return result;
  }

  return {
    get activeMonitorTab() {
      return activeMonitorTab;
    },
    set activeMonitorTab(v: string) {
      activeMonitorTab = v;
    },
    get lastNonEmptyMonitorTab() {
      return lastNonEmptyMonitorTab;
    },
    set lastNonEmptyMonitorTab(v: string) {
      lastNonEmptyMonitorTab = v;
    },
    get checkboxInteracting() {
      return checkboxInteracting;
    },
    set checkboxInteracting(v: boolean) {
      checkboxInteracting = v;
    },
    get editorExtraIndex() {
      return editorExtraIndex;
    },
    resetTab,
    selectMonitorTab,
    isExportIncluded,
    toggleExportMonitor,
    monitorExportCount,
    getExportedImageKeys,
  };
}
