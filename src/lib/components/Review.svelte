<script lang="ts">
  import { onMount, onDestroy, untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import { Input } from "$lib/components/ui/input";
  import { Textarea } from "$lib/components/ui/textarea";
  import { Progress } from "$lib/components/ui/progress";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "$lib/components/ui/dropdown-menu";
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "$lib/components/ui/alert-dialog";
  import { store } from "$lib/stores/session.svelte";
  import { ReviewUndoStore } from "$lib/stores/undo.svelte";
  import { createSelectableList } from "$lib/stores/selectable.svelte";
  import { createDragReorder } from "$lib/stores/drag-reorder.svelte";
  import { createExportChoice } from "$lib/stores/export-choice.svelte";
  import { createReviewNavigation } from "$lib/stores/review-navigation.svelte";
  import type { Step } from "$lib/types";
  import { countKeystrokes, extraTabIndex, monitorLabel, parseKeystrokes, pluralS } from "$lib/utils";
  import {
    AlignLeft,
    ArrowLeft,
    Check,
    ChevronDown,
    ExternalLink,
    FileCode,
    FileDown,
    GripVertical,
    Keyboard,
    Moon,
    MousePointer2,
    Pencil,
    Redo2,
    Save,
    Sun,
    Trash2,
    Undo2,
  } from "@lucide/svelte";
  import { toggleMode } from "mode-watcher";
  import PageLayout from "$lib/components/PageLayout.svelte";
  import SelectableList from "$lib/components/SelectableList.svelte";
  import ImageEditor from "$lib/components/ImageEditor.svelte";

  /** ID of the currently selected step (null = none selected). */
  let selectedStepId = $state<number | null>(null);
  /** Whether the image editor modal is open. */
  let editorOpen = $state(false);
  /** True while the description Textarea has focus — suppresses Ctrl+Z/Y shortcuts. */
  let isEditing = $state(false);

  /** Review-level undo/redo store (see src/lib/stores/undo.svelte.ts). */
  const reviewUndo = new ReviewUndoStore();

  /**
   * Undo depth of the current/most-recent editor session — bound from ImageEditor.
   * Read on close to push a collapsed editorSession entry onto the Review undo stack.
   * Set on open to restore state after a Review-level undo/redo.
   */
  let currentEditorDepth = $state(0);
  /**
   * Redo depth of the current/most-recent editor session — bound from ImageEditor.
   * Set on open to restore redo state after a Review-level undo.
   */
  let currentEditorRedoDepth = $state(0);
  /** Plain variable (not $state) — tracks previous value of editorOpen. */
  let editorWasOpen = false;

  // Detect editor open/close transitions.
  // On open: restore depth/redoDepth from any pending state (set by Review-level undo/redo).
  // On close: push a collapsed editorSession entry onto the Review undo stack.
  // Uses untrack for the editorWasOpen update to avoid a reactive loop.
  $effect(() => {
    const isOpen = editorOpen; // reactive dep
    untrack(() => {
      if (isOpen && !editorWasOpen) {
        // Editor just opened — restore depth from pending state (defaults to 0/0).
        const pending = reviewUndo.consumePendingEditorState(selectedStepId ?? -1);
        currentEditorDepth = pending.depth;
        currentEditorRedoDepth = pending.redoDepth;
      } else if (!isOpen && editorWasOpen && selectedStepId !== null) {
        // Editor just closed — collapse this session into a Review undo entry.
        reviewUndo.pushEditorSession(selectedStepId, currentEditorDepth);
      }
      editorWasOpen = isOpen;
    });
  });

  let descriptionDraft = $state("");
  /** Draft value for the session name input — synced from store on load, editable locally. */
  let sessionNameDraft = $state("");

  /** Whether the "delete step" confirmation dialog is open. */
  let showDeleteStepDialog = $state(false);
  /** Step ID pending deletion (set when the delete step dialog is opened). */
  let pendingDeleteStepId = $state<number | null>(null);
  /** Whether the "bulk delete steps" confirmation dialog is open. */
  let showBulkDeleteDialog = $state(false);

  /** Multi-selection state for bulk step operations. */
  const sel = createSelectableList(
    () => store.session?.steps ?? [],
    (s) => s.id,
  );

  /** Whether bulk-select mode is active (any checkboxes checked). Drag is disabled in this mode. */
  let isBulkSelectActive = $derived(sel.selected.size > 0);

  /** Derive the selected step by ID lookup — safe against array reordering and deletions. */
  let selectedStep = $derived<Step | null>(
    selectedStepId !== null
      ? (store.session?.steps.find((s) => s.id === selectedStepId) ?? null)
      : null,
  );

  // 1-based display number for the currently selected step
  let selectedStepDisplayNum = $derived.by<number | null>(() => {
    if (selectedStepId === null) return null;
    const steps = store.session?.steps ?? [];
    const idx = steps.findIndex((s) => s.id === selectedStepId);
    return idx >= 0 ? idx + 1 : null;
  });

  // ── Factory stores ──────────────────────────────────────────────────────────

  const drag = createDragReorder(
    () => store.session?.steps ?? [],
    () => isBulkSelectActive,
    reviewUndo,
  );

  const ec = createExportChoice(
    () => selectedStep,
    () => selectedStepId,
  );

  async function navigateBack() {
    selectedStepId = null;
    store.clearImageCache();
    ec.resetTab();
    reviewUndo.clear();
    store.clearExportState();
    try {
      await invoke("new_recording");
    } catch (err) {
      console.error("Failed to start new recording:", err);
    }
    await store.refreshSessions();
  }

  const nav = createReviewNavigation(reviewUndo, () => store.isDirty, navigateBack);

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Sync session name draft when session changes (e.g. on load)
  $effect(() => {
    const name = store.session?.name ?? "";
    // Only reset if name actually changed externally (avoid clobbering user typing).
    // untrack the draft read so typing doesn't re-trigger this effect.
    untrack(() => {
      if (name !== sessionNameDraft) sessionNameDraft = name;
    });
  });

  // Restore description draft when the selected step changes.
  // NOTE: activeMonitorTab reset is handled by createExportChoice's internal $effect.
  $effect(() => {
    descriptionDraft = selectedStep?.description ?? "";
  });

  // Eagerly pre-load images for all steps not yet in the cache.
  $effect(() => {
    store.preloadStepImages(store.session?.steps ?? []);
  });

  // Pre-select first step only when a genuinely new session is loaded.
  // lastInitializedSessionId is a plain JS variable (not $state) so writing to it
  // doesn't trigger reactive updates — this prevents the effect from re-running
  // every time setExportChoice replaces store.session with the same session ID.
  // Intentionally NOT $state: we want a write-only guard, not a reactive dependency.
  let lastInitializedSessionId = "";
  $effect(() => {
    const sessionId = store.session?.id ?? "";
    if (sessionId && sessionId !== lastInitializedSessionId) {
      lastInitializedSessionId = sessionId;
      untrack(() => {
        reviewUndo.clear();
        const steps = store.session?.steps ?? [];
        selectedStepId = steps.length > 0 ? (steps[0]?.id ?? null) : null;
      });
    }
  });

  // ── Session / step mutations ─────────────────────────────────────────────────

  async function saveDescription() {
    if (!selectedStep) return;
    try {
      await invoke("update_step_description", {
        stepId: selectedStep.id,
        description: descriptionDraft,
      });
      reviewUndo.pushBackend();
    } catch (err) {
      console.error("Failed to save description:", err);
    }
    // No optimistic patch — the backend emits session-updated which the store handles.
  }

  async function saveSessionName() {
    const trimmed = sessionNameDraft.trim();
    if (!trimmed || trimmed === store.session?.name) return;
    try {
      await invoke("rename_session", { name: trimmed });
      reviewUndo.pushBackend();
    } catch (err) {
      console.error("Failed to rename session:", err);
    }
    sessionNameDraft = trimmed;
  }

  async function deleteStep(stepId: number) {
    // Capture position BEFORE the invoke — store.session is updated by session-updated
    // event after the await, so the deleted step will no longer be in the array by then.
    const deletedIdx = (store.session?.steps ?? []).findIndex(
      (s) => s.id === stepId,
    );
    try {
      await invoke("delete_step", { stepId });
    } catch (err) {
      console.error("Failed to delete step:", err);
      return;
    }
    reviewUndo.pushBackend();
    // If the deleted step was selected, move selection to an adjacent step
    if (selectedStepId === stepId) {
      const remaining = store.session?.steps ?? [];
      if (remaining.length === 0) {
        selectedStepId = null;
      } else {
        // Pick the step that slid into the same position, or the new last step
        const nextIdx = Math.min(Math.max(deletedIdx, 0), remaining.length - 1);
        selectedStepId = remaining[nextIdx]?.id ?? null;
      }
    }
    // Remove from bulk selection if present
    if (sel.selected.has(stepId)) {
      sel.toggleOne(stepId);
    }
  }

  async function deleteSelectedSteps() {
    const ids = [...sel.selected] as number[];
    if (ids.length === 0) return;
    try {
      await invoke("delete_steps", { stepIds: ids });
    } catch (err) {
      console.error("Failed to bulk delete steps:", err);
      return;
    }
    reviewUndo.pushBackend();
    sel.clear();
    // If the selected step was among the deleted ones, update selection
    if (selectedStepId !== null && ids.includes(selectedStepId)) {
      const remaining = store.session?.steps ?? [];
      selectedStepId = remaining.length > 0 ? (remaining[0]?.id ?? null) : null;
    }
  }

  function selectStep(stepId: number) {
    selectedStepId = stepId;
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  function handleKeydown(event: KeyboardEvent) {
    if (isEditing) return;
    if (event.ctrlKey && !event.shiftKey && event.key === "z") {
      event.preventDefault();
      if (editorOpen) {
        // Delegate to editor — dispatched via custom event so ImageEditor can handle it.
        window.dispatchEvent(new CustomEvent("editor-undo"));
      } else {
        reviewUndo.undo();
      }
    } else if (
      event.ctrlKey &&
      (event.key === "y" || (event.shiftKey && event.key === "Z"))
    ) {
      event.preventDefault();
      if (editorOpen) {
        window.dispatchEvent(new CustomEvent("editor-redo"));
      } else {
        reviewUndo.redo();
      }
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown);
  });
</script>

<PageLayout
  leftClass="flex w-80 shrink-0 flex-col overflow-hidden border-r p-6"
  rightClass="flex flex-1 flex-col overflow-hidden p-4"
  footerClass="flex shrink-0 items-center gap-3 border-t bg-card px-4 py-2"
>
  {#snippet header()}
    <!-- Toolbar: three-zone grid (left | center | right) -->
    <div class="grid grid-cols-3 items-center gap-2 border-b px-4 py-2">
      <!-- Left: back button -->
      <div class="flex items-center">
        <Button variant="outline" size="sm" onclick={nav.requestBack}
          ><ArrowLeft />Back</Button
        >
      </div>

      <!-- Center: editable session name -->
      <div class="flex items-center justify-center gap-1.5">
        <Input
          bind:value={sessionNameDraft}
          class="h-8 max-w-64 text-center text-sm font-semibold"
          aria-label="Session name"
          onblur={saveSessionName}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
          }}
        />
        <Pencil class="size-4 shrink-0 text-muted-foreground" />
      </div>

      <!-- Right: undo/redo + export buttons + theme toggle -->
      <div class="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Undo"
          onclick={() => reviewUndo.undo()}
          disabled={editorOpen || !reviewUndo.canUndo}><Undo2 /></Button
        >
        <Button
          variant="outline"
          size="icon"
          aria-label="Redo"
          onclick={() => reviewUndo.redo()}
          disabled={editorOpen || !reviewUndo.canRedo}><Redo2 /></Button
        >
        <Button
          variant="outline"
          size="icon"
          aria-label="Save"
          onclick={nav.saveSession}
          disabled={!store.isDirty}><Save /></Button
        >
        <DropdownMenu bind:open={ec.exportOpen}>
          <DropdownMenuTrigger>
            {#snippet child({ props })}
              <Button variant="outline" size="sm" {...props}>
                Export<ChevronDown
                  class="size-4 transition-transform duration-200 {ec.exportOpen
                    ? 'rotate-180'
                    : ''}"
                />
              </Button>
            {/snippet}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onclick={ec.exportMarkdown}>
              <FileDown class="text-foreground" />Markdown (.md)
            </DropdownMenuItem>
            <DropdownMenuItem onclick={ec.exportHtml}>
              <FileCode class="text-foreground" />HTML (.html)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          onclick={toggleMode}
          variant="outline"
          size="icon"
          aria-label="Toggle theme"
        >
          <Sun class="dark:hidden" />
          <Moon class="hidden dark:block" />
        </Button>
      </div>
    </div>

    {#if store.exportError}
      <div class="border-b bg-destructive/10 px-4 py-2">
        <p class="text-sm text-destructive">
          Export error: {store.exportError}
        </p>
      </div>
    {/if}
  {/snippet}

  {#snippet left()}
    <!-- Heading + select-all + card list -->
    <SelectableList
      title="Steps"
      items={store.session?.steps ?? []}
      selectedIds={sel.selected}
      getKey={(step) => step.id}
      onToggleAll={sel.toggleAll}
      onDeleteSelected={() => { showBulkDeleteDialog = true; }}
    >
      {#snippet row(step, idx)}
        {@const isActive = selectedStepId === step.id}
        {@const isChecked = sel.selected.has(step.id)}
        {@const keystrokeCount = countKeystrokes(step.keystrokes)}
        {@const exportedKeys = ec.getExportedImageKeys(step)}
        {@const steps = store.session?.steps ?? []}
        <!-- Insertion bar / spacer before this card — h-2 provides the gap and serves as drop target -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="relative flex h-2 items-center"
          ondragenter={(e) => { if (!isBulkSelectActive) { e.preventDefault(); drag.dragInsertIndex = idx; } }}
          ondragover={(e) => { if (!isBulkSelectActive) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; drag.dragInsertIndex = idx; } }}
          ondragleave={undefined}
          ondrop={(e) => drag.handleDrop(e)}
        >
          <div class="h-0.5 w-full rounded-full {drag.dragInsertIndex === idx && drag.isUsefulInsert(idx) ? 'bg-primary' : 'bg-transparent'}"></div>
        </div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          role="button"
          tabindex="0"
          class="select-none cursor-pointer rounded-lg border p-3 transition-colors {isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40'} {reviewUndo.highlightedStepId === step.id ? 'ring-2 ring-orange-400 animate-pulse' : ''} {drag.draggedStepId === step.id ? 'opacity-50' : ''}"
          ondragenter={(e) => drag.handleDragEnter(e)}
          ondragover={(e) => drag.handleDragOver(e, step.id, idx)}
          ondragleave={(e) => drag.handleDragLeave(e)}
          ondrop={(e) => drag.handleDrop(e)}
          ondragend={drag.handleDragEnd}
          onclick={(e) => {
            if ((e.target as HTMLElement).closest("[data-checkbox]")) return;
            if ((e.target as HTMLElement).closest("[data-drag-handle]")) return;
            selectStep(step.id);
          }}
          onkeydown={(e) => {
            if (e.key === "Enter" || e.key === " ") selectStep(step.id);
          }}
        >
          <!-- Inline row: drag handle + checkbox + step number + thumbnails (centered) + indicators -->
          <div class="flex items-center gap-2">
            <!-- Drag handle (hidden in bulk-select mode) -->
            <div
              data-drag-handle
              draggable={!isBulkSelectActive}
              ondragstart={(e) => drag.handleDragStart(e, step.id)}
              class="shrink-0 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing {isBulkSelectActive ? 'invisible' : ''}"
              aria-hidden="true"
            >
              <GripVertical class="size-4" />
            </div>
            <!-- Checkbox -->
            <div data-checkbox class="shrink-0">
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => sel.toggleOne(step.id)}
                class="cursor-pointer"
              />
            </div>
            <!-- Step number -->
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground"
            >
              {idx + 1}
            </span>
            <!-- Thumbnails centered in the available space -->
            <div class="flex flex-1 items-center justify-center overflow-hidden">
              {#if exportedKeys.length === 1}
                {@const imgKey = exportedKeys[0]}
                {@const src = imgKey.isExtra
                  ? store.extraImageCache[imgKey.cacheKey]
                  : store.imageCache[imgKey.cacheKey]}
                {#if src}
                  <img
                    src={src}
                    alt="Step {idx + 1} thumbnail"
                    class="h-10 w-auto rounded shadow-sm ring-1 ring-border"
                    draggable={false}
                  />
                {:else}
                  <div class="h-10 w-16 animate-pulse rounded bg-muted"></div>
                {/if}
              {:else if exportedKeys.length > 1}
                <div class="flex items-center">
                  {#each exportedKeys as imgKey, cardIdx (imgKey.cacheKey)}
                    {@const src = imgKey.isExtra
                      ? store.extraImageCache[imgKey.cacheKey]
                      : store.imageCache[imgKey.cacheKey]}
                    <div
                      class="relative overflow-hidden rounded shadow-sm ring-1 ring-border {cardIdx > 0 ? '-ml-4' : ''}"
                      style="z-index: {exportedKeys.length - cardIdx};"
                    >
                      {#if src}
                        <img
                          src={src}
                          alt="Step {idx + 1} thumbnail {cardIdx + 1}"
                          class="h-10 w-auto"
                          draggable={false}
                        />
                      {:else}
                        <div class="h-10 w-16 animate-pulse bg-muted"></div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
            <!-- Indicators: description + keystroke icons -->
            <span
              class="shrink-0 {step.description
                ? 'text-foreground'
                : 'text-muted-foreground/25'}"
              title={step.description ?? "No description"}
            >
              <AlignLeft class="size-4" />
            </span>
            <span
              class="shrink-0 text-muted-foreground {keystrokeCount > 0
                ? ''
                : 'invisible'}"
            >
              <Keyboard class="size-4" />
            </span>
          </div>
        </div>
        <!-- Insertion bar / spacer after last card -->
        {#if idx === steps.length - 1}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="relative flex h-2 items-center"
            ondragenter={(e) => { if (!isBulkSelectActive) { e.preventDefault(); drag.dragInsertIndex = steps.length; } }}
            ondragover={(e) => { if (!isBulkSelectActive) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; drag.dragInsertIndex = steps.length; } }}
            ondragleave={undefined}
            ondrop={(e) => drag.handleDrop(e)}
          >
            <div class="h-0.5 w-full rounded-full {drag.dragInsertIndex === steps.length && drag.isUsefulInsert(steps.length) ? 'bg-primary' : 'bg-transparent'}"></div>
          </div>
        {/if}
      {/snippet}
    </SelectableList>
  {/snippet}

  {#snippet right()}
    {#if selectedStep}
      <div class="mb-3 flex items-center gap-2">
        <span class="text-sm font-semibold">Step {selectedStepDisplayNum}</span>
        <div class="flex-1"></div>
        <Button
          variant="outline"
          size="sm"
          onclick={() => {
            editorOpen = true;
          }}
        >
          <Pencil />Edit Image
        </Button>
        <Button
          variant="destructive"
          size="icon"
          aria-label="Delete step"
          onclick={(e: MouseEvent) => {
            e.stopPropagation();
            pendingDeleteStepId = selectedStep!.id;
            showDeleteStepDialog = true;
          }}
        >
          <Trash2 />
        </Button>
      </div>

      <!-- Monitor toggle group: item click = preview; checkbox inside = export inclusion -->
      {#if (selectedStep.extra_image_paths?.length ?? 0) > 0}
        <div class="mb-3 flex flex-col items-center gap-1">
          <ToggleGroup.Root
            type="single"
            bind:value={ec.activeMonitorTab}
            onValueChange={(v) => {
              if (ec.checkboxInteracting) {
                // The value change was triggered by a checkbox click — restore
                // the current tab so the preview doesn't switch.
                ec.activeMonitorTab = ec.lastNonEmptyMonitorTab;
                return;
              }
              if (v) {
                ec.lastNonEmptyMonitorTab = v;
              } else {
                // ToggleGroup deselected the active item — restore the previous
                // selection so the preview never goes blank.
                ec.activeMonitorTab = ec.lastNonEmptyMonitorTab;
              }
            }}
            variant="outline"
            spacing={0}
            size="sm"
          >
            <ToggleGroup.Item value="primary">
              <div
                onclick={(e) => e.stopPropagation()}
                onpointerdown={(e) => { ec.checkboxInteracting = true; e.stopPropagation(); }}
                onpointerup={() => { ec.checkboxInteracting = false; }}
                role="presentation"
                class="shrink-0"
              >
                <Checkbox
                  checked={ec.isExportIncluded("primary")}
                  onCheckedChange={() => ec.toggleExportMonitor("primary")}
                />
              </div>
              <MousePointer2 />
              {monitorLabel(store.monitors, selectedStep.click_monitor_index)}
            </ToggleGroup.Item>
            {#each selectedStep.extra_image_paths as _path, i (i)}
              {@const monIdx = selectedStep.extra_monitor_indices[i] ?? i}
              <ToggleGroup.Item value="extra_{i}">
                <div
                  onclick={(e) => e.stopPropagation()}
                  onpointerdown={(e) => { ec.checkboxInteracting = true; e.stopPropagation(); }}
                  onpointerup={() => { ec.checkboxInteracting = false; }}
                  role="presentation"
                  class="shrink-0"
                >
                  <Checkbox
                    checked={ec.isExportIncluded(`extra_${i}`)}
                    onCheckedChange={() => ec.toggleExportMonitor(`extra_${i}`)}
                  />
                </div>
                {monitorLabel(store.monitors, monIdx)}
              </ToggleGroup.Item>
            {/each}
          </ToggleGroup.Root>
          <p class="text-xs text-muted-foreground">
            Click to preview · checkbox to include in export
          </p>
        </div>
      {/if}

      <!-- Image area: consistent container, inner wrapper handles centering vs stacking -->
      <div class="mb-3 min-h-0 flex-1 overflow-hidden rounded border bg-muted/20">
        {#if ec.activeMonitorTab === "all"}
          {@const imgKey = store.imageCacheKey(selectedStep)}
          <!-- All monitors: stacked scrollable view -->
          <div class="flex h-full flex-col gap-4 overflow-y-auto p-3">
            <div class="flex flex-col gap-1">
              <span
                class="flex items-center gap-1 text-xs text-muted-foreground"
              >
                <MousePointer2 class="size-4" />
                {monitorLabel(store.monitors, selectedStep.click_monitor_index)}
              </span>
              {#if store.imageCache[imgKey]}
                <img
                  src={store.imageCache[imgKey]}
                  alt="Step {selectedStepDisplayNum}"
                  class="max-w-full rounded"
                />
              {:else}
                <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
              {/if}
            </div>
            {#each selectedStep.extra_image_paths as _path, i (i)}
              {@const monIdx = selectedStep.extra_monitor_indices[i] ?? i}
              {@const key = store.extraImageKey(
                selectedStep.id,
                i,
                selectedStep.image_version ?? 0,
              )}
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">
                  {monitorLabel(store.monitors, monIdx)}
                </span>
                {#if store.extraImageCache[key]}
                  <img
                    src={store.extraImageCache[key]}
                    alt="Step {selectedStepDisplayNum} — Monitor {monIdx + 1}"
                    class="max-w-full rounded"
                  />
                {:else}
                  <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
                {/if}
              </div>
            {/each}
          </div>
        {:else if ec.activeMonitorTab === "primary"}
          {@const imgKey = store.imageCacheKey(selectedStep)}
          <div class="h-full w-full p-2">
            {#if store.imageCache[imgKey]}
              <img
                src={store.imageCache[imgKey]}
                alt="Step {selectedStepDisplayNum}"
                class="h-full w-full object-contain"
              />
            {:else}
              <span class="text-sm text-muted-foreground">Loading…</span>
            {/if}
          </div>
        {:else}
          {@const extraIdx = extraTabIndex(ec.activeMonitorTab)}
          {#if !isNaN(extraIdx)}
            {@const extraKey = store.extraImageKey(
              selectedStep.id,
              extraIdx,
              selectedStep.image_version ?? 0,
            )}
            <div class="h-full w-full p-2">
              {#if store.extraImageCache[extraKey]}
                <img
                  src={store.extraImageCache[extraKey]}
                  alt="Step {selectedStepDisplayNum} — Monitor {extraIdx + 2}"
                  class="h-full w-full object-contain"
                />
              {:else}
                <span class="text-sm text-muted-foreground">Loading…</span>
              {/if}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Description and keystrokes -->
      <div class="flex flex-col gap-2">
        <Textarea
          bind:value={descriptionDraft}
          placeholder="Add a description…"
          class="resize-none text-sm"
          rows={3}
          onfocus={() => {
            isEditing = true;
          }}
          onblur={() => {
            isEditing = false;
            saveDescription();
          }}
        />
        {#if selectedStep.keystrokes}
          <div class="rounded bg-muted px-3 py-2 text-xs font-mono">
            <span class="text-muted-foreground">Typed: </span>
            {#each parseKeystrokes(selectedStep.keystrokes) as segment}
              {#if segment.kind === "shortcut"}
                <kbd
                  class="inline-flex items-center rounded border border-border px-1 py-0.5 font-mono text-xs"
                  >{segment.key}</kbd
                >
              {:else}
                {segment.value}
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div
        class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
      >
        {#if (store.session?.steps.length ?? 0) === 0}
          No steps recorded yet.
        {:else}
          Select a step on the left.
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet footer()}
    {#if store.exportProgress !== null}
      <span class="text-xs text-muted-foreground shrink-0">Exporting…</span>
      <Progress value={store.exportProgress * 100} class="h-1.5 flex-1" />
      <span class="text-xs text-muted-foreground shrink-0"
        >{Math.round(store.exportProgress * 100)}%</span
      >
    {:else}
      <Check
        class="size-4 shrink-0 {store.exportedPath
          ? 'text-primary'
          : 'text-transparent'}"
      />
      <span
        class="flex-1 truncate text-xs {store.exportedPath
          ? 'text-card-foreground'
          : 'text-muted-foreground'}"
      >
        {store.exportedPath ? `Exported to: ${store.exportedPath}` : "Ready"}
      </span>
      <Button
        variant="outline"
        size="sm"
        onclick={ec.openExported}
        class="shrink-0 {store.exportedPath ? '' : 'invisible'}"
      >
        <ExternalLink />Open
      </Button>
    {/if}
  {/snippet}
</PageLayout>

<AlertDialog bind:open={nav.showBackDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
      <AlertDialogDescription>
        You have unsaved changes. Do you want to save before going back?
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <Button
        variant="outline"
        onclick={() => {
          nav.showBackDialog = false;
        }}>Cancel</Button
      >
      <Button
        variant="destructive"
        onclick={nav.discardAndNavigateBack}>Discard</Button
      >
      <Button
        onclick={() => {
          nav.saveSession();
          nav.showBackDialog = false;
          navigateBack();
        }}>Save</Button
      >
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

<AlertDialog bind:open={showDeleteStepDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete step?</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={() => {
          showDeleteStepDialog = false;
          if (pendingDeleteStepId !== null) deleteStep(pendingDeleteStepId);
          pendingDeleteStepId = null;
        }}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

<AlertDialog bind:open={showBulkDeleteDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete {sel.selected.size} step{pluralS(sel.selected.size)}?</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={() => { showBulkDeleteDialog = false; deleteSelectedSteps(); }}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

{#if selectedStep && editorOpen}
  <ImageEditor
    step={selectedStep}
    extraIndex={ec.editorExtraIndex}
    bind:open={editorOpen}
    bind:depth={currentEditorDepth}
    bind:redoDepth={currentEditorRedoDepth}
  />
{/if}
