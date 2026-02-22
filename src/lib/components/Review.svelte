<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { save } from '@tauri-apps/plugin-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Progress } from '$lib/components/ui/progress';
  import { store } from '$lib/stores/session.svelte';
  import type { Step } from '$lib/types';
  import { MousePointer2 } from '@lucide/svelte';

  let selectedStepIdx = $state<number | null>(null);
  let imageCache = $state<Record<number, string>>({});
  /** Cache for extra (non-primary) monitor images. Key: `${step.id}_extra_${i}` */
  let extraImageCache = $state<Record<string, string>>({});
  /**
   * Which monitor tab is shown in the detail view.
   * 'primary' = the annotated click-monitor image; 'extra_N' = the N-th extra image.
   */
  let activeMonitorTab = $state<string>('primary');
  let descriptionDraft = $state('');

  let selectedStep = $derived<Step | null>(
    selectedStepIdx !== null ? (store.session?.steps[selectedStepIdx] ?? null) : null
  );

  // 1-based display number for the currently selected step (tracks array position, not step.order)
  let selectedStepDisplayNum = $derived<number | null>(
    selectedStepIdx !== null ? selectedStepIdx + 1 : null
  );

  // Load image when selection changes; reset the monitor tab to primary.
  $effect(() => {
    const step = selectedStep;
    if (step && !imageCache[step.id]) {
      invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
        imageCache = { ...imageCache, [step.id]: uri };
      });
    }
    descriptionDraft = step?.description ?? '';
    // Always start on the primary (annotated) image when a new step is selected.
    activeMonitorTab = 'primary';
  });

  // Pre-select first step when session loads
  $effect(() => {
    if (store.session && store.session.steps.length > 0 && selectedStepIdx === null) {
      selectedStepIdx = 0;
    }
  });

  // Eagerly pre-load images for all steps not yet in the cache (bug-006).
  // Also pre-load extra monitor images for "All monitors" sessions.
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

  async function deleteStep(stepId: number) {
    await invoke('delete_step', { stepId });
    if (selectedStepIdx !== null && store.session) {
      const newLen = (store.session.steps.length ?? 1) - 1;
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
    const parts = filePath.replace(/\\/g, '/').split('/');
    parts.pop();
    const outputDir = parts.join('/') || '.';
    const outPath = await invoke<string>('export_markdown', { outputDir });
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
    activeMonitorTab = 'primary';
    const step = store.session?.steps[idx];
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

  // Handle back mouse button (button 3 / XButton1) and browser history back (popstate)
  // so that the back navigation gesture returns the user to the idle screen.
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
  <!-- Toolbar -->
  <div class="flex items-center gap-2 border-b px-4 py-2">
    <span class="mr-2 text-sm font-semibold">{store.session?.name ?? 'Review'}</span>
    <div class="flex-1"></div>
    <Button variant="outline" size="sm" onclick={exportMarkdown}>Export MD</Button>
    <Button variant="outline" size="sm" onclick={exportHtml}>Export HTML</Button>
    <Button size="sm" onclick={newRecording}>Back to Home</Button>
  </div>

  <!-- Export progress / result -->
  {#if store.exportProgress !== null}
    <div class="border-b px-4 py-2">
      <p class="mb-1 text-xs text-muted-foreground">Exporting…</p>
      <Progress value={store.exportProgress * 100} class="h-1.5" />
    </div>
  {/if}

  {#if store.exportedPath}
    <div class="flex items-center gap-2 border-b bg-green-50 px-4 py-2 dark:bg-green-950">
      <span class="flex-1 truncate text-xs text-green-700 dark:text-green-300">
        Exported: {store.exportedPath}
      </span>
      <Button variant="outline" size="sm" onclick={openExported}>Open</Button>
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
        <button
          class="flex w-full items-center gap-2 border-b px-3 py-2 text-left transition-colors hover:bg-accent {selectedStepIdx === idx ? 'bg-accent' : ''}"
          onclick={() => selectStep(idx)}
        >
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-200 text-xs font-bold dark:bg-zinc-700">
            {idx + 1}
          </div>
          <div class="min-w-0 flex-1">
            {#if imageCache[step.id]}
              <img
                src={imageCache[step.id]}
                alt="Step {idx + 1}"
                class="h-10 w-full rounded object-cover"
              />
            {:else}
              <div class="h-10 w-full animate-pulse rounded bg-zinc-300 dark:bg-zinc-600"></div>
            {/if}
            {#if step.description}
              <p class="mt-1 truncate text-xs text-muted-foreground">{step.description}</p>
            {/if}
          </div>
        </button>
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
            class="text-destructive hover:text-destructive"
          >
            Delete Step
          </Button>
        </div>

        <!-- Monitor tabs (only visible when extra monitor images exist) -->
        {#if (selectedStep.extra_image_paths?.length ?? 0) > 0}
          <div class="mb-2 flex flex-wrap gap-1">
            <button
              class="flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors {activeMonitorTab === 'primary' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
              onclick={() => (activeMonitorTab = 'primary')}
            >
              <MousePointer2 size={12} class="shrink-0" />
              {store.monitors[selectedStep.click_monitor_index]?.name ?? `Monitor ${selectedStep.click_monitor_index + 1}`}
            </button>
            {#each selectedStep.extra_image_paths as _path, i (i)}
              {@const monIdx = selectedStep.extra_monitor_indices[i] ?? i}
              <button
                class="rounded px-2 py-0.5 text-xs font-medium transition-colors {activeMonitorTab === `extra_${i}` ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
                onclick={() => (activeMonitorTab = `extra_${i}`)}
              >
                {store.monitors[monIdx]?.name ?? `Monitor ${monIdx + 1}`}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Image -->
        <div class="mb-3 flex-1 overflow-auto rounded border bg-black/5 dark:bg-white/5">
          {#if activeMonitorTab === 'primary'}
            {#if imageCache[selectedStep.id]}
              <img
                src={imageCache[selectedStep.id]}
                alt="Step {selectedStepDisplayNum}"
                class="max-h-full max-w-full object-contain"
              />
            {:else}
              <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            {/if}
          {:else}
            {@const extraIdx = parseInt(activeMonitorTab.replace('extra_', ''), 10)}
            {@const extraKey = `${selectedStep.id}_extra_${extraIdx}`}
            {#if extraImageCache[extraKey]}
              <img
                src={extraImageCache[extraKey]}
                alt="Step {selectedStepDisplayNum} — Monitor {extraIdx + 2}"
                class="max-h-full max-w-full object-contain"
              />
            {:else}
              <div class="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading…
              </div>
            {/if}
          {/if}
        </div>

        <!-- Description -->
        <div class="flex flex-col gap-2">
          <Textarea
            bind:value={descriptionDraft}
            placeholder="Add a description…"
            class="resize-none text-sm"
            rows={3}
            onblur={saveDescription}
          />
          {#if selectedStep.keystrokes}
            <p class="text-xs text-muted-foreground">
              Typed: <code class="rounded bg-muted px-1 py-0.5">{selectedStep.keystrokes}</code>
            </p>
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
</div>
