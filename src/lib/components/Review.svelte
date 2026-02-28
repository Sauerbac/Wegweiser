<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Progress } from '$lib/components/ui/progress';
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { store } from '$lib/stores/session.svelte';
  import type { Step, StepExportChoice } from '$lib/types';
  import { AlignLeft, ArrowLeft, Check, ExternalLink, FileCode, FileDown, Keyboard, Monitor, Moon, MousePointer2, Sun, Trash2 } from '@lucide/svelte';
  import { toggleMode } from 'mode-watcher';
  import PageLayout from '$lib/components/PageLayout.svelte';
  import SelectableList from '$lib/components/SelectableList.svelte';

  /** ID of the currently selected step (null = none selected). */
  let selectedStepId = $state<number | null>(null);
  /** Cache for primary step images. Uses Map to avoid O(N²) object spreads on update. */
  let imageCache = $state(new Map<number, string>());
  /** Cache for extra monitor images. Key: `${step.id}_extra_${i}` */
  let extraImageCache = $state(new Map<string, string>());
  /**
   * Which monitor tab is shown in the detail view.
   * 'primary' = the annotated click-monitor image
   * 'extra_N' = the N-th extra image
   * 'all' = all images stacked (scrollable)
   */
  let activeMonitorTab = $state<string>('primary');
  let descriptionDraft = $state('');
  /** Draft value for the session name input — synced from store on load, editable locally. */
  let sessionNameDraft = $state('');

  /** IDs of steps selected via checkboxes for bulk operations. */
  let selectedStepIds = $state<Set<number>>(new Set());

  /** Derive the selected step by ID lookup — safe against array reordering and deletions. */
  let selectedStep = $derived<Step | null>(
    selectedStepId !== null
      ? (store.session?.steps.find(s => s.id === selectedStepId) ?? null)
      : null
  );

  // 1-based display number for the currently selected step
  let selectedStepDisplayNum = $derived.by<number | null>(() => {
    if (selectedStepId === null) return null;
    const steps = store.session?.steps ?? [];
    const idx = steps.findIndex(s => s.id === selectedStepId);
    return idx >= 0 ? idx + 1 : null;
  });

  /** Derive activeMonitorTab from a step's persisted export_choice. */
  function tabFromExportChoice(choice: StepExportChoice | undefined): string {
    if (!choice || choice.type === 'Primary') return 'primary';
    if (choice.type === 'All') return 'all';
    if (choice.type === 'Extra') return `extra_${choice.value}`;
    // exhaustiveness check
    const _exhaustive: never = choice;
    return 'primary';
  }

  /** Map a tab value back to a StepExportChoice. */
  function choiceFromTab(tab: string): StepExportChoice {
    if (tab === 'primary') return { type: 'Primary' };
    if (tab === 'all') return { type: 'All' };
    const idx = parseInt(tab.replace('extra_', ''), 10);
    if (isNaN(idx)) return { type: 'Primary' };
    return { type: 'Extra', value: idx };
  }

  // Sync session name draft when session changes (e.g. on load)
  $effect(() => {
    const name = store.session?.name ?? '';
    // Only reset if name actually changed externally (avoid clobbering user typing).
    // untrack the draft read so typing doesn't re-trigger this effect.
    untrack(() => {
      if (name !== sessionNameDraft) sessionNameDraft = name;
    });
  });

  // Load image when selection changes; restore description draft and monitor tab.
  $effect(() => {
    const step = selectedStep;
    if (step && !imageCache.has(step.id)) {
      invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
        imageCache.set(step.id, uri);
      }).catch(err => console.error('Failed to load image:', err));
    }
    descriptionDraft = step?.description ?? '';
    activeMonitorTab = step ? tabFromExportChoice(step.export_choice) : 'primary';
  });

  // Eagerly pre-load images for all steps not yet in the cache.
  $effect(() => {
    const steps = store.session?.steps ?? [];
    for (const step of steps) {
      if (!imageCache.has(step.id)) {
        invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
          imageCache.set(step.id, uri);
        }).catch(err => console.error('Failed to load image:', err));
      }
      for (let i = 0; i < (step.extra_image_paths?.length ?? 0); i++) {
        const key = `${step.id}_extra_${i}`;
        if (!extraImageCache.has(key)) {
          const path = step.extra_image_paths[i] ?? null;
          if (path !== null) {
            invoke<string>('get_step_image', { imagePath: path }).then((uri) => {
              extraImageCache.set(key, uri);
            }).catch(err => console.error('Failed to load extra image:', err));
          }
        }
      }
    }
  });

  // Pre-select first step only when a genuinely new session is loaded.
  // _initializedSessionId is a plain JS variable (not $state) so writing to it
  // doesn't trigger reactive updates — this prevents the effect from re-running
  // every time setExportChoice replaces store.session with the same session ID.
  let _initializedSessionId = '';
  $effect(() => {
    const sessionId = store.session?.id ?? '';
    if (sessionId && sessionId !== _initializedSessionId) {
      _initializedSessionId = sessionId;
      untrack(() => {
        const steps = store.session?.steps ?? [];
        selectedStepId = steps.length > 0 ? (steps[0]?.id ?? null) : null;
      });
    }
  });

  async function saveDescription() {
    if (!selectedStep) return;
    try {
      await invoke('update_step_description', {
        stepId: selectedStep.id,
        description: descriptionDraft,
      });
    } catch (err) {
      console.error('Failed to save description:', err);
    }
    if (store.session) {
      const id = selectedStep.id;
      const steps = store.session.steps.map((s) =>
        s.id === id ? { ...s, description: descriptionDraft } : s
      );
      store.session = { ...store.session, steps };
    }
  }

  async function saveSessionName() {
    const trimmed = sessionNameDraft.trim();
    if (!trimmed || trimmed === store.session?.name) return;
    try {
      await invoke('rename_session', { name: trimmed });
    } catch (err) {
      console.error('Failed to rename session:', err);
    }
    sessionNameDraft = trimmed;
  }

  async function deleteStep(stepId: number) {
    // Capture position BEFORE the invoke — store.session is updated by session-updated
    // event after the await, so the deleted step will no longer be in the array by then.
    const deletedIdx = (store.session?.steps ?? []).findIndex(s => s.id === stepId);
    try {
      await invoke('delete_step', { stepId });
    } catch (err) {
      console.error('Failed to delete step:', err);
      return;
    }
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
    if (selectedStepIds.has(stepId)) {
      const next = new Set(selectedStepIds);
      next.delete(stepId);
      selectedStepIds = next;
    }
  }

  function toggleStepSelection(stepId: number) {
    const next = new Set(selectedStepIds);
    if (next.has(stepId)) {
      next.delete(stepId);
    } else {
      next.add(stepId);
    }
    selectedStepIds = next;
  }

  function toggleSelectAll() {
    const steps = store.session?.steps ?? [];
    if (selectedStepIds.size === steps.length) {
      selectedStepIds = new Set();
    } else {
      selectedStepIds = new Set(steps.map((s) => s.id));
    }
  }

  async function deleteSelectedSteps() {
    const ids = [...selectedStepIds];
    if (ids.length === 0) return;
    try {
      await invoke('delete_steps', { stepIds: ids });
    } catch (err) {
      console.error('Failed to bulk delete steps:', err);
      return;
    }
    selectedStepIds = new Set();
    // If the selected step was among the deleted ones, update selection
    if (selectedStepId !== null && ids.includes(selectedStepId)) {
      const remaining = store.session?.steps ?? [];
      selectedStepId = remaining.length > 0 ? (remaining[0]?.id ?? null) : null;
    }
  }

  /**
   * Count keystrokes in a keystroke string.
   * Bracket tokens [Ctrl+C] count as 1 shortcut each;
   * non-bracket plain character runs each count as their character length.
   */
  function countKeystrokes(raw: string | null): number {
    if (!raw) return 0;
    let count = 0;
    const parts = raw.split(/(\[[^\]]+\])/);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('[') && part.endsWith(']')) {
        count += 1;
      } else {
        count += part.length;
      }
    }
    return count;
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

  async function exportMarkdown() {
    const filePath = await save({
      title: 'Export Markdown',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: `${store.session?.name ?? 'tutorial'}.md`,
    });
    if (!filePath) return;
    store.exportedPath = null;
    store.exportError = null;
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
    store.exportedPath = null;
    store.exportError = null;
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

  async function newRecording() {
    selectedStepId = null;
    imageCache = new Map();
    extraImageCache = new Map();
    activeMonitorTab = 'primary';
    store.exportedPath = null;
    store.exportError = null;
    try {
      await invoke('new_recording');
    } catch (err) {
      console.error('Failed to start new recording:', err);
    }
    await store.refreshSessions();
  }

  function selectStep(stepId: number) {
    selectedStepId = stepId;
  }

  async function setExportChoice(choice: StepExportChoice) {
    if (!selectedStep) return;
    const id = selectedStep.id;
    try {
      await invoke('set_step_export_choice', { stepId: id, choice });
    } catch (err) {
      console.error('Failed to set export choice:', err);
    }
    if (store.session) {
      const steps = store.session.steps.map((s) =>
        s.id === id ? { ...s, export_choice: choice } : s
      );
      store.session = { ...store.session, steps };
    }
  }

  /** Select a monitor tab: updates the view AND persists the export choice for this step. */
  async function selectMonitorTab(tab: string) {
    activeMonitorTab = tab;
    await setExportChoice(choiceFromTab(tab));
  }

  /**
   * Parse a keystroke string into an array of segments.
   * Each segment is either:
   *   { kind: 'shortcut', key: 'Ctrl+Shift+Left' }  — rendered as <kbd>
   *   { kind: 'text', value: 'hello world' }          — rendered as plain text
   */
  type KeystrokeSegment =
    | { kind: 'shortcut'; key: string }
    | { kind: 'text'; value: string };

  function parseKeystrokes(raw: string): KeystrokeSegment[] {
    const segments: KeystrokeSegment[] = [];
    const parts = raw.split(/(\[[^\]]+\])/);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('[') && part.endsWith(']')) {
        const inner = part.slice(1, -1);
        const isSingleChar = inner.length === 1;
        if (!isSingleChar || inner === '+') {
          segments.push({ kind: 'shortcut', key: inner });
        } else {
          segments.push({ kind: 'text', value: inner });
        }
      } else {
        segments.push({ kind: 'text', value: part });
      }
    }
    return segments;
  }

  function handleMouseUp(event: MouseEvent) {
    if (event.button === 3) {
      event.preventDefault();
      newRecording();
    }
  }

  function handlePopState(event: PopStateEvent) {
    event.preventDefault();
    newRecording();
  }

  onMount(() => {
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('popstate', handlePopState);
  });

  onDestroy(() => {
    window.removeEventListener('mouseup', handleMouseUp);
    window.removeEventListener('popstate', handlePopState);
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
        <Button variant="outline" size="sm" onclick={newRecording}><ArrowLeft />Back</Button>
      </div>

      <!-- Center: editable session name -->
      <div class="flex justify-center">
        <Input
          bind:value={sessionNameDraft}
          class="h-8 max-w-64 text-center text-sm font-semibold"
          aria-label="Session name"
          onblur={saveSessionName}
          onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
        />
      </div>

      <!-- Right: export buttons + theme toggle -->
      <div class="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onclick={exportMarkdown}><FileDown />Export MD</Button>
        <Button variant="outline" size="sm" onclick={exportHtml}><FileCode />Export HTML</Button>
        <Button onclick={toggleMode} variant="outline" size="icon" aria-label="Toggle theme">
          <Sun class="dark:hidden" />
          <Moon class="hidden dark:block" />
        </Button>
      </div>
    </div>

    <!-- Export progress -->
    {#if store.exportProgress !== null}
      <div class="border-b px-4 py-2">
        <p class="mb-1 text-xs text-muted-foreground">Exporting…</p>
        <Progress value={store.exportProgress * 100} class="h-1.5" />
      </div>
    {/if}

    {#if store.exportError}
      <div class="border-b bg-destructive/10 px-4 py-2">
        <p class="text-sm text-destructive">Export error: {store.exportError}</p>
      </div>
    {/if}
  {/snippet}

  {#snippet left()}
    <!-- Heading + select-all + card list -->
    <SelectableList
      title="Steps"
      items={store.session?.steps ?? []}
      selectedIds={selectedStepIds}
      getKey={(step) => step.id}
      onToggleAll={toggleSelectAll}
      onDeleteSelected={deleteSelectedSteps}
    >
      {#snippet row(step, idx)}
        {@const isActive = selectedStepId === step.id}
        {@const isChecked = selectedStepIds.has(step.id)}
        {@const keystrokeCount = countKeystrokes(step.keystrokes)}
        {@const monCount = monitorExportCount(step)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          role="button"
          tabindex="0"
          class="cursor-pointer rounded-lg border p-3 transition-colors hover:bg-accent/40"
          onclick={(e) => {
            if ((e.target as HTMLElement).closest('[data-checkbox]')) return;
            selectStep(step.id);
          }}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectStep(step.id); }}
        >
          <div class="flex items-center gap-2">
            <!-- Checkbox -->
            <div data-checkbox class="shrink-0">
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => toggleStepSelection(step.id)}
                class="cursor-pointer"
              />
            </div>
            <!-- Step number -->
            <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
              {idx + 1}
            </span>
            <!-- Spacer -->
            <div class="flex-1"></div>
            <!-- Indicators: all three icons together, consistently sized and spaced -->
            <span class="shrink-0 {step.description ? 'text-foreground' : 'text-muted-foreground/25'}" title={step.description ?? 'No description'}>
              <AlignLeft size={13} />
            </span>
            <span class="shrink-0 text-muted-foreground {keystrokeCount > 0 ? '' : 'invisible'}">
              <Keyboard size={13} />
            </span>
            <span class="shrink-0 text-muted-foreground {monCount > 1 ? '' : 'invisible'}">
              <Monitor size={13} />
            </span>
          </div>
        </div>
      {/snippet}
    </SelectableList>
  {/snippet}

  {#snippet right()}
    {#if selectedStep}
      <div class="mb-3 flex items-center gap-2">
        <span class="text-sm font-semibold">Step {selectedStepDisplayNum}</span>
        <div class="flex-1"></div>
        <Button
          variant="destructive"
          size="sm"
          onclick={() => deleteStep(selectedStep!.id)}
          title="Delete step"
        >
          <Trash2 />Delete
        </Button>
      </div>

      <!-- Per-step monitor tabs (only when extra monitor images exist) -->
      {#if (selectedStep.extra_image_paths?.length ?? 0) > 0}
        <div class="mb-2 flex justify-center">
          <Tabs value={activeMonitorTab} onValueChange={selectMonitorTab}>
            <TabsList class="h-auto gap-1 bg-transparent p-0">
              <TabsTrigger value="primary" class="gap-1 border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary">
                <MousePointer2 size={12} />
                {store.monitors[selectedStep.click_monitor_index]?.name ?? `Monitor ${selectedStep.click_monitor_index + 1}`}
              </TabsTrigger>
              {#each selectedStep.extra_image_paths as _path, i (i)}
                {@const monIdx = selectedStep.extra_monitor_indices[i] ?? i}
                <TabsTrigger value="extra_{i}" class="border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary">
                  {store.monitors[monIdx]?.name ?? `Monitor ${monIdx + 1}`}
                </TabsTrigger>
              {/each}
              <TabsTrigger value="all" class="border data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      {/if}

      <!-- Image area: consistent container, inner wrapper handles centering vs stacking -->
      <div class="mb-3 flex-1 overflow-y-auto rounded border bg-muted/20">
        {#if activeMonitorTab === 'all'}
          <!-- All monitors: stacked scrollable view -->
          <div class="flex flex-col gap-4 p-3">
            <div class="flex flex-col gap-1">
              <span class="flex items-center gap-1 text-xs text-muted-foreground">
                <MousePointer2 size={11} />
                {store.monitors[selectedStep.click_monitor_index]?.name ?? `Monitor ${selectedStep.click_monitor_index + 1}`}
              </span>
              {#if imageCache.get(selectedStep.id)}
                <img src={imageCache.get(selectedStep.id)} alt="Step {selectedStepDisplayNum}" class="max-w-full rounded" />
              {:else}
                <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
              {/if}
            </div>
            {#each selectedStep.extra_image_paths as _path, i (i)}
              {@const monIdx = selectedStep.extra_monitor_indices[i] ?? i}
              {@const key = `${selectedStep.id}_extra_${i}`}
              <div class="flex flex-col gap-1">
                <span class="text-xs text-muted-foreground">
                  {store.monitors[monIdx]?.name ?? `Monitor ${monIdx + 1}`}
                </span>
                {#if extraImageCache.get(key)}
                  <img src={extraImageCache.get(key)} alt="Step {selectedStepDisplayNum} — Monitor {monIdx + 1}" class="max-w-full rounded" />
                {:else}
                  <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
                {/if}
              </div>
            {/each}
          </div>
        {:else if activeMonitorTab === 'primary'}
          <div class="flex h-full items-center justify-center p-2">
            {#if imageCache.get(selectedStep.id)}
              <img
                src={imageCache.get(selectedStep.id)}
                alt="Step {selectedStepDisplayNum}"
                class="max-h-full max-w-full object-contain"
              />
            {:else}
              <span class="text-sm text-muted-foreground">Loading…</span>
            {/if}
          </div>
        {:else}
          {@const extraIdx = parseInt(activeMonitorTab.replace('extra_', ''), 10)}
          {#if !isNaN(extraIdx)}
            {@const extraKey = `${selectedStep.id}_extra_${extraIdx}`}
            <div class="flex h-full items-center justify-center p-2">
              {#if extraImageCache.get(extraKey)}
                <img
                  src={extraImageCache.get(extraKey)}
                  alt="Step {selectedStepDisplayNum} — Monitor {extraIdx + 2}"
                  class="max-h-full max-w-full object-contain"
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
          onblur={saveDescription}
        />
        {#if selectedStep.keystrokes}
          <div class="rounded bg-muted px-3 py-2 text-xs font-mono">
            <span class="text-muted-foreground">Typed: </span>
            {#each parseKeystrokes(selectedStep.keystrokes) as segment}
              {#if segment.kind === 'shortcut'}
                <kbd class="inline-flex items-center rounded border border-border px-1 py-0.5 font-mono text-xs">{segment.key}</kbd>
              {:else}
                {segment.value}
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {#if (store.session?.steps.length ?? 0) === 0}
          No steps recorded yet.
        {:else}
          Select a step on the left.
        {/if}
      </div>
    {/if}
  {/snippet}

  {#snippet footer()}
    <Check size={13} class="shrink-0 {store.exportedPath ? 'text-primary' : 'text-transparent'}" />
    <span class="flex-1 truncate text-xs {store.exportedPath ? 'text-card-foreground' : 'text-muted-foreground'}">
      {store.exportedPath ? `Exported to: ${store.exportedPath}` : 'Ready'}
    </span>
    <Button variant="outline" size="sm" onclick={openExported} class="shrink-0 {store.exportedPath ? '' : 'invisible'}">
      <ExternalLink />Open
    </Button>
  {/snippet}
</PageLayout>
