import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { store } from '$lib/stores/session.svelte';
import { imageStore } from '$lib/stores/image-cache.svelte';
import type { Step, StepExportChoice } from '$lib/types';
import { extraTabIndex } from '$lib/utils';

/**
 * createExportChoice — monitor-tab view + export inclusion logic for the detail panel.
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
  /** Whether the export dropdown is open. */
  let exportOpen = $state(false);

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
    if (choice.type === 'All') return true;
    if (tab === 'primary') return choice.type === 'Primary';
    const idx = extraTabIndex(tab);
    return choice.type === 'Extra' && choice.value === idx;
  }

  async function setExportChoice(choice: StepExportChoice) {
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
   *   only primary checked   → Primary
   *   only extra N checked   → Extra(N)
   *   all checked            → All
   *   partial subset (3+)    → All (current model limitation)
   * Unchecking the last included monitor is a no-op.
   */
  async function toggleExportMonitor(tab: string) {
    const step = getSelectedStep();
    if (!step) return;
    const extraCount = step.extra_image_paths?.length ?? 0;
    const primaryChecked = isExportIncluded('primary');
    const extrasChecked = Array.from({ length: extraCount }, (_, i) =>
      isExportIncluded(`extra_${i}`),
    );

    const newPrimary = tab === 'primary' ? !primaryChecked : primaryChecked;
    const newExtras =
      tab === 'primary'
        ? [...extrasChecked]
        : extrasChecked.map((v, i) =>
            i === extraTabIndex(tab) ? !v : v,
          );

    if ((newPrimary ? 1 : 0) + newExtras.filter(Boolean).length === 0) return;

    if (newPrimary && newExtras.every(Boolean)) {
      await setExportChoice({ type: 'All' });
      return;
    }
    if (newPrimary && newExtras.every((v) => !v)) {
      await setExportChoice({ type: 'Primary' });
      return;
    }
    const checkedExtras = newExtras
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);
    if (!newPrimary && checkedExtras.length === 1) {
      await setExportChoice({ type: 'Extra', value: checkedExtras[0] });
      return;
    }
    await setExportChoice({ type: 'All' });
  }

  /**
   * Compute how many monitor images will be exported for a step based on its export_choice.
   * Primary / Extra = 1 monitor; All = primary + all extra images.
   */
  function monitorExportCount(step: Step): number {
    const choice = step.export_choice;
    if (!choice || choice.type === 'Primary' || choice.type === 'Extra') return 1;
    // 'All': primary image + all extra images
    return 1 + (step.extra_image_paths?.length ?? 0);
  }

  /**
   * Returns the list of { cacheKey, isExtra, extraIdx } objects for images that are included
   * in the export for a given step, in display order (primary first, then extras).
   */
  function getExportedImageKeys(
    step: Step,
  ): { cacheKey: string; isExtra: boolean; extraIdx: number }[] {
    const choice = step.export_choice;
    const ver = step.image_version ?? 0;
    const result: { cacheKey: string; isExtra: boolean; extraIdx: number }[] = [];
    if (!choice) return result;

    const includePrimary = choice.type === 'Primary' || choice.type === 'All';
    const extraCount = step.extra_image_paths?.length ?? 0;

    if (includePrimary) {
      result.push({ cacheKey: imageStore.imageCacheKey(step), isExtra: false, extraIdx: -1 });
    }

    for (let i = 0; i < extraCount; i++) {
      const includeExtra =
        choice.type === 'All' || (choice.type === 'Extra' && choice.value === i);
      if (includeExtra) {
        result.push({
          cacheKey: imageStore.extraImageKey(step.id, i, ver),
          isExtra: true,
          extraIdx: i,
        });
      }
    }
    return result;
  }

  async function exportMarkdown() {
    const filePath = await save({
      title: 'Export Markdown',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: `${store.session?.name ?? 'tutorial'}.md`,
    });
    if (!filePath) return;
    store.clearExportState();
    try {
      const outPath = await invoke<string>('export_markdown', { outputPath: filePath });
      store.exportedPath = outPath;
    } catch (err) {
      console.error('Failed to export Markdown:', err);
    }
  }

  async function exportHtml() {
    const path = await save({
      title: 'Export HTML',
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: `${store.session?.name ?? 'tutorial'}.html`,
    });
    if (!path) return;
    store.clearExportState();
    try {
      await invoke('export_html', { outputPath: path });
    } catch (err) {
      console.error('Failed to export HTML:', err);
    }
  }

  async function openExported() {
    if (store.exportedPath) {
      try {
        await invoke('open_path', { path: store.exportedPath });
      } catch (err) {
        console.error('Failed to open exported file:', err);
      }
    }
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
    get exportOpen() {
      return exportOpen;
    },
    set exportOpen(v: boolean) {
      exportOpen = v;
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
    exportMarkdown,
    exportHtml,
    openExported,
  };
}
