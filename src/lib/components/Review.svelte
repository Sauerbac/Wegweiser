<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Progress } from '$lib/components/ui/progress';
  import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs';
  import { store } from '$lib/stores/session.svelte';
  import type { Step, StepExportChoice } from '$lib/types';
  import { ArrowLeft, Check, ExternalLink, FileCode, FileDown, MousePointer2, Trash2 } from '@lucide/svelte';

  let selectedStepIdx = $state<number | null>(null);
  let imageCache = $state<Record<number, string>>({});
  /** Cache for extra (non-primary) monitor images. Key: `${step.id}_extra_${i}` */
  let extraImageCache = $state<Record<string, string>>({});
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

  let selectedStep = $derived<Step | null>(
    selectedStepIdx !== null ? ((store.session?.steps ?? [])[selectedStepIdx] ?? null) : null
  );

  // 1-based display number for the currently selected step
  let selectedStepDisplayNum = $derived<number | null>(
    selectedStepIdx !== null ? selectedStepIdx + 1 : null
  );

  /** Derive activeMonitorTab from a step's persisted export_choice. */
  function tabFromExportChoice(choice: StepExportChoice | undefined): string {
    if (!choice || choice.type === 'Primary') return 'primary';
    if (choice.type === 'All') return 'all';
    return `extra_${(choice as { type: 'Extra'; value: number }).value}`;
  }

  /** Map a tab value back to a StepExportChoice. */
  function choiceFromTab(tab: string): StepExportChoice {
    if (tab === 'primary') return { type: 'Primary' };
    if (tab === 'all') return { type: 'All' };
    const idx = parseInt(tab.replace('extra_', ''), 10);
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

  // Load image when selection changes; restore monitor tab from the step's export_choice.
  $effect(() => {
    const step = selectedStep;
    if (step && !imageCache[step.id]) {
      invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
        imageCache = { ...imageCache, [step.id]: uri };
      });
    }
    descriptionDraft = step?.description ?? '';
    activeMonitorTab = step ? tabFromExportChoice(step.export_choice) : 'primary';
  });

  // Pre-select first step when session loads.
  $effect(() => {
    const steps = store.session?.steps ?? [];
    if (steps.length > 0) {
      selectedStepIdx = 0;
    } else {
      selectedStepIdx = null;
    }
  });

  // Eagerly pre-load images for all steps not yet in the cache.
  $effect(() => {
    const steps = store.session?.steps ?? [];
    for (const step of steps) {
      if (!imageCache[step.id]) {
        invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
          imageCache = { ...imageCache, [step.id]: uri };
        });
      }
      for (let i = 0; i < (step.extra_image_paths?.length ?? 0); i++) {
        const key = `${step.id}_extra_${i}`;
        if (!extraImageCache[key]) {
          invoke<string>('get_step_image', { imagePath: step.extra_image_paths[i] }).then((uri) => {
            extraImageCache = { ...extraImageCache, [key]: uri };
          });
        }
      }
    }
  });

  async function saveDescription() {
    if (!selectedStep) return;
    await invoke('update_step_description', {
      stepId: selectedStep.id,
      description: descriptionDraft,
    });
    if (store.session) {
      const steps = store.session.steps.map((s) =>
        s.id === selectedStep!.id ? { ...s, description: descriptionDraft } : s
      );
      store.session = { ...store.session, steps };
    }
  }

  async function saveSessionName() {
    const trimmed = sessionNameDraft.trim();
    if (!trimmed || trimmed === store.session?.name) return;
    await invoke('rename_session', { name: trimmed });
    sessionNameDraft = trimmed;
  }

  async function deleteStep(stepId: number) {
    await invoke('delete_step', { stepId });
    if (selectedStepIdx !== null) {
      const newLen = (store.session?.steps.length ?? 0) - 1;
      if (selectedStepIdx >= newLen) {
        selectedStepIdx = newLen > 0 ? newLen - 1 : null;
      }
    }
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
    const outPath = await invoke<string>('export_markdown', { outputPath: filePath });
    store.exportedPath = outPath;
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
    await invoke('export_html', { outputPath: path });
  }

  async function openExported() {
    if (store.exportedPath) {
      await invoke('open_path', { path: store.exportedPath });
    }
  }

  async function newRecording() {
    selectedStepIdx = null;
    imageCache = {};
    extraImageCache = {};
    activeMonitorTab = 'primary';
    store.exportedPath = null;
    store.exportError = null;
    await invoke('new_recording');
    await store.refreshSessions();
  }

  function selectStep(idx: number) {
    selectedStepIdx = idx;
    const step = (store.session?.steps ?? [])[idx];
    if (!step) return;
    if (!imageCache[step.id]) {
      invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
        imageCache = { ...imageCache, [step.id]: uri };
      });
    }
    for (let i = 0; i < (step.extra_image_paths?.length ?? 0); i++) {
      const key = `${step.id}_extra_${i}`;
      if (!extraImageCache[key]) {
        invoke<string>('get_step_image', { imagePath: step.extra_image_paths[i] }).then((uri) => {
          extraImageCache = { ...extraImageCache, [key]: uri };
        });
      }
    }
  }

  async function setExportChoice(choice: StepExportChoice) {
    if (!selectedStep) return;
    await invoke('set_step_export_choice', { stepId: selectedStep.id, choice });
    if (store.session) {
      const steps = store.session.steps.map((s) =>
        s.id === selectedStep!.id ? { ...s, export_choice: choice } : s
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

<div class="flex h-screen flex-col bg-background text-foreground">
  <!-- Toolbar: three-zone grid (left | center | right) -->
  <div class="grid grid-cols-3 items-center gap-2 border-b px-4 py-2">
    <!-- Left: back button -->
    <div class="flex items-center">
      <Button size="sm" onclick={newRecording} class="gap-1.5"><ArrowLeft size={14} />Back</Button>
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

    <!-- Right: export buttons -->
    <div class="flex items-center justify-end gap-2">
      <Button variant="outline" size="sm" onclick={exportMarkdown} class="gap-1.5"><FileDown size={14} />Export MD</Button>
      <Button variant="outline" size="sm" onclick={exportHtml} class="gap-1.5"><FileCode size={14} />Export HTML</Button>
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
      <p class="text-xs text-destructive">Export error: {store.exportError}</p>
    </div>
  {/if}

  <!-- Main content -->
  <div class="flex flex-1 overflow-hidden">
    <!-- Step list -->
    <div class="w-56 overflow-y-auto border-r bg-muted/30">
      {#each store.session?.steps ?? [] as step, idx (step.id)}
        <Button
          variant="ghost"
          class="flex h-auto w-full items-center gap-2 rounded-none border-b px-3 py-2 text-left transition-colors hover:bg-accent {selectedStepIdx === idx ? 'bg-accent' : ''}"
          onclick={() => selectStep(idx)}
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground">
            {idx + 1}
          </div>
          <div class="min-w-0 flex-1">
            {#if imageCache[step.id]}
              <img
                src={imageCache[step.id]}
                alt="Step {idx + 1}"
                class="h-10 w-full rounded object-contain"
              />
            {:else}
              <div class="h-10 w-full animate-pulse rounded bg-muted"></div>
            {/if}
            {#if step.description}
              <p class="mt-1 truncate text-xs text-muted-foreground">{step.description}</p>
            {/if}
          </div>
        </Button>
      {/each}
    </div>

    <!-- Step detail -->
    <div class="flex flex-1 flex-col overflow-hidden p-4">
      {#if selectedStep}
        <div class="mb-3 flex items-center gap-2">
          <span class="text-sm font-semibold">Step {selectedStepDisplayNum}</span>
          <div class="flex-1"></div>
          <Button
            variant="ghost"
            size="sm"
            onclick={() => deleteStep(selectedStep!.id)}
            class="gap-1.5 text-destructive hover:text-destructive"
            title="Delete step"
          >
            <Trash2 size={13} />Delete
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
                {#if imageCache[selectedStep.id]}
                  <img src={imageCache[selectedStep.id]} alt="Step {selectedStepDisplayNum}" class="max-w-full rounded" />
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
                  {#if extraImageCache[key]}
                    <img src={extraImageCache[key]} alt="Step {selectedStepDisplayNum} — Monitor {monIdx + 1}" class="max-w-full rounded" />
                  {:else}
                    <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
                  {/if}
                </div>
              {/each}
            </div>
          {:else if activeMonitorTab === 'primary'}
            <div class="flex h-full items-center justify-center p-2">
              {#if imageCache[selectedStep.id]}
                <img
                  src={imageCache[selectedStep.id]}
                  alt="Step {selectedStepDisplayNum}"
                  class="max-h-full max-w-full object-contain"
                />
              {:else}
                <span class="text-sm text-muted-foreground">Loading…</span>
              {/if}
            </div>
          {:else}
            {@const extraIdx = parseInt(activeMonitorTab.replace('extra_', ''), 10)}
            {@const extraKey = `${selectedStep.id}_extra_${extraIdx}`}
            <div class="flex h-full items-center justify-center p-2">
              {#if extraImageCache[extraKey]}
                <img
                  src={extraImageCache[extraKey]}
                  alt="Step {selectedStepDisplayNum} — Monitor {extraIdx + 2}"
                  class="max-h-full max-w-full object-contain"
                />
              {:else}
                <span class="text-sm text-muted-foreground">Loading…</span>
              {/if}
            </div>
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
    </div>
  </div>

  <!-- Status bar (always visible, fixed height) -->
  <div class="flex shrink-0 items-center gap-3 border-t bg-card px-4 py-2">
    <Check size={13} class="shrink-0 {store.exportedPath ? 'text-primary' : 'text-transparent'}" />
    <span class="flex-1 truncate text-xs {store.exportedPath ? 'text-card-foreground' : 'text-muted-foreground'}">
      {store.exportedPath ? `Exported to: ${store.exportedPath}` : 'Ready'}
    </span>
    <Button variant="outline" size="sm" onclick={openExported} class="gap-1.5 shrink-0 {store.exportedPath ? '' : 'invisible'}">
      <ExternalLink size={13} />Open
    </Button>
  </div>
</div>
