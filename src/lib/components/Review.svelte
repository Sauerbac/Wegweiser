<script lang="ts">
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
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
  import { createEditorSession } from "$lib/stores/editor-session.svelte";
  import type { Step } from "$lib/types";
  import { DESTRUCTIVE_DIALOG_ACTION_CLASS, pluralS } from "$lib/utils";
  import {
    ArrowLeft,
    Check,
    ChevronDown,
    ExternalLink,
    FileCode,
    FileDown,
    Pencil,
    Redo2,
    Save,
    Trash2,
    Undo2,
  } from "@lucide/svelte";
  import PageLayout from "$lib/components/PageLayout.svelte";
  import SelectableList from "$lib/components/SelectableList.svelte";
  import ImageEditor from "$lib/components/ImageEditor.svelte";
  import ThemeToggleButton from "$lib/components/ThemeToggleButton.svelte";
  import StepCard from "$lib/components/StepCard.svelte";
  import MonitorTabGroup from "$lib/components/MonitorTabGroup.svelte";
  import StepImageViewer from "$lib/components/StepImageViewer.svelte";
  import StepDescriptionPanel from "$lib/components/StepDescriptionPanel.svelte";

  /** ID of the currently selected step (null = none selected). */
  let selectedStepId = $state<number | null>(null);
  /** True while the description Textarea has focus — suppresses Ctrl+Z/Y shortcuts. */
  let isEditing = $state(false);

  /** Review-level undo/redo store (see src/lib/stores/undo.svelte.ts). */
  const reviewUndo = new ReviewUndoStore();

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

  /** Image editor session — owns open flag, tick counters, depth bindings, and keyboard shortcuts. */
  const editorSession = createEditorSession(reviewUndo, () => selectedStepId, () => isEditing);

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
          disabled={editorSession.open || !reviewUndo.canUndo}><Undo2 /></Button
        >
        <Button
          variant="outline"
          size="icon"
          aria-label="Redo"
          onclick={() => reviewUndo.redo()}
          disabled={editorSession.open || !reviewUndo.canRedo}><Redo2 /></Button
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
        <ThemeToggleButton />
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
        <StepCard
          {step}
          {idx}
          isActive={selectedStepId === step.id}
          isChecked={sel.selected.has(step.id)}
          {isBulkSelectActive}
          stepsLength={store.session?.steps.length ?? 0}
          exportedKeys={ec.getExportedImageKeys(step)}
          imageCache={store.imageCache}
          extraImageCache={store.extraImageCache}
          {drag}
          onSelect={selectStep}
          onCheck={(id) => sel.toggleOne(id)}
        />
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
            editorSession.open = true;
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
        <MonitorTabGroup step={selectedStep} monitors={store.monitors} {ec} />
      {/if}

      <!-- Image area -->
      <StepImageViewer
        step={selectedStep}
        stepDisplayNum={selectedStepDisplayNum}
        activeMonitorTab={ec.activeMonitorTab}
        monitors={store.monitors}
        imageCache={store.imageCache}
        extraImageCache={store.extraImageCache}
        imageCacheKey={store.imageCacheKey.bind(store)}
        extraImageKey={store.extraImageKey.bind(store)}
      />

      <!-- Description and keystrokes -->
      <StepDescriptionPanel
        step={selectedStep}
        bind:descriptionDraft
        onfocus={() => { isEditing = true; }}
        onblur={() => { isEditing = false; saveDescription(); }}
      />
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
        class={DESTRUCTIVE_DIALOG_ACTION_CLASS}
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
        class={DESTRUCTIVE_DIALOG_ACTION_CLASS}
      >Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

{#if selectedStep && editorSession.open}
  <ImageEditor
    step={selectedStep}
    extraIndex={ec.editorExtraIndex}
    bind:open={editorSession.open}
    bind:depth={editorSession.depth}
    bind:redoDepth={editorSession.redoDepth}
    undoTick={editorSession.undoTick}
    redoTick={editorSession.redoTick}
  />
{/if}
