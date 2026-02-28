<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { store } from '$lib/stores/session.svelte';
  import { Circle, FolderOpen, Moon, Monitor, RefreshCw, Sun, Trash2 } from '@lucide/svelte';
  import { toggleMode } from 'mode-watcher';
  import PageLayout from '$lib/components/PageLayout.svelte';
  import SelectableList from '$lib/components/SelectableList.svelte';

  let pendingDelete = $state<string | null>(null);
  let selectedRecordings = $state<Set<string>>(new Set());

  async function startRecording() {
    await invoke('start_recording', {
      monitorIndex: store.selectedMonitor,
    });
  }

  async function loadSession(sessionDir: string) {
    await invoke('load_session_cmd', { sessionDir });
  }

  async function confirmDelete(sessionDir: string) {
    await invoke('delete_session_cmd', { sessionDir });
    pendingDelete = null;
    const next = new Set(selectedRecordings);
    next.delete(sessionDir);
    selectedRecordings = next;
    await store.refreshSessions();
  }

  function toggleSelection(sessionDir: string) {
    const next = new Set(selectedRecordings);
    if (next.has(sessionDir)) {
      next.delete(sessionDir);
    } else {
      next.add(sessionDir);
    }
    selectedRecordings = next;
  }

  function selectAll() {
    selectedRecordings = new Set(store.sessions.map((s) => s.session_dir));
  }

  function deselectAll() {
    selectedRecordings = new Set();
  }

  function toggleSelectAll() {
    if (selectedRecordings.size === store.sessions.length) {
      deselectAll();
    } else {
      selectAll();
    }
  }

  async function deleteSelected() {
    for (const sessionDir of selectedRecordings) {
      await invoke('delete_session_cmd', { sessionDir });
    }
    selectedRecordings = new Set();
    await store.refreshSessions();
  }

  function monitorLabel(idx: number): string {
    const m = store.monitors[idx];
    if (!m) return `Monitor ${idx + 1}`;
    return `${idx + 1}: ${m.name} (${m.width}×${m.height})`;
  }

  async function identifyMonitors() {
    await invoke('identify_monitors');
  }


</script>

<PageLayout
  headerClass="flex items-center justify-between border-b px-6 py-4"
  leftClass="flex w-80 flex-col gap-4 border-r p-6"
  rightClass="flex flex-1 flex-col overflow-hidden p-6"
>
  {#snippet header()}
    <div>
      <h1 class="text-lg font-semibold">rec</h1>
      <p class="text-sm text-muted-foreground">Windows step recorder</p>
    </div>
    <Button onclick={toggleMode} variant="outline" size="icon" aria-label="Toggle theme">
      <Sun class="dark:hidden" />
      <Moon class="hidden dark:block" />
    </Button>
  {/snippet}

  {#snippet left()}
    <div>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Monitor
        </h2>
        <Button
          variant="outline"
          size="sm"
          onclick={identifyMonitors}
          title="Identify monitors on screen"
        >
          <Monitor />
          Identify
        </Button>
      </div>
      <div class="flex flex-col gap-2">
        <!-- All monitors option -->
        <label class="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition-colors hover:bg-accent {store.selectedMonitor === null ? 'border-primary bg-accent' : ''}">
          <input
            type="radio"
            name="monitor"
            class="accent-primary"
            checked={store.selectedMonitor === null}
            onchange={() => (store.selectedMonitor = null)}
          />
          <span class="text-sm font-medium">All Monitors</span>
        </label>
        <!-- Individual monitors -->
        {#each store.monitors as _mon, idx}
          <label class="flex cursor-pointer items-center gap-2 rounded-md border p-3 transition-colors hover:bg-accent {store.selectedMonitor === idx ? 'border-primary bg-accent' : ''}">
            <input
              type="radio"
              name="monitor"
              class="accent-primary"
              checked={store.selectedMonitor === idx}
              onchange={() => (store.selectedMonitor = idx)}
            />
            <span class="text-sm">{monitorLabel(idx)}</span>
          </label>
        {/each}
      </div>
    </div>

    <Button onclick={startRecording} class="mt-auto w-full">
      <Circle class="fill-current" />Start Recording
    </Button>
  {/snippet}

  {#snippet right()}
    {#if store.sessions.length === 0}
      <div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No recordings yet. Start one on the left.
      </div>
    {:else}
      <SelectableList
        title="Past Recordings"
        items={store.sessions}
        selectedIds={selectedRecordings}
        getKey={(meta) => meta.session_dir}
        onToggleAll={toggleSelectAll}
        onDeleteSelected={deleteSelected}
      >
        {#snippet actions()}
          <Button variant="outline" size="sm" onclick={() => store.refreshSessions()}>
            <RefreshCw />Refresh
          </Button>
        {/snippet}
        {#snippet row(meta)}
          <div class="rounded-lg border p-4 transition-colors hover:bg-accent/40">
            <div class="flex items-center justify-between">
              <div class="flex min-w-0 flex-1 items-center gap-3">
                <Checkbox
                  checked={selectedRecordings.has(meta.session_dir)}
                  onCheckedChange={() => toggleSelection(meta.session_dir)}
                  class="shrink-0 cursor-pointer"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{meta.name}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {meta.step_count} step{meta.step_count !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div class="ml-3 flex shrink-0 items-center gap-2">
                {#if pendingDelete === meta.session_dir}
                  <span class="text-sm font-medium text-destructive">Delete?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onclick={() => confirmDelete(meta.session_dir)}
                  >
                    Yes
                  </Button>
                  <Button variant="ghost" size="sm" onclick={() => (pendingDelete = null)}>
                    No
                  </Button>
                {:else}
                  <Button variant="outline" size="sm" onclick={() => loadSession(meta.session_dir)}>
                    <FolderOpen />Load
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onclick={() => (pendingDelete = meta.session_dir)}
                  >
                    <Trash2 />Delete
                  </Button>
                {/if}
              </div>
            </div>
          </div>
        {/snippet}
      </SelectableList>
    {/if}
  {/snippet}
</PageLayout>
