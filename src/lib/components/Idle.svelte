<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from '$lib/components/ui/alert-dialog';
  import { store } from '$lib/stores/session.svelte';
  import { createSelectableList } from '$lib/stores/selectable.svelte';
  import { DESTRUCTIVE_DIALOG_ACTION_CLASS, monitorLabel, pluralS } from '$lib/utils';
  import { Circle, FolderOpen, Monitor, RefreshCw, Trash2 } from '@lucide/svelte';
  import PageLayout from '$lib/components/PageLayout.svelte';
  import SelectableList from '$lib/components/SelectableList.svelte';
  import ThemeToggleButton from '$lib/components/ThemeToggleButton.svelte';

  /** Whether the "delete session" confirmation dialog is open. */
  let showDeleteSessionDialog = $state(false);
  /** Session dir pending deletion (set when the delete session dialog is opened). */
  let pendingDeleteSessionDir = $state<string | null>(null);
  /** Whether the "bulk delete sessions" confirmation dialog is open. */
  let showBulkDeleteDialog = $state(false);

  const sel = createSelectableList(
    () => store.sessions,
    (s) => s.session_dir,
  );

  async function startRecording() {
    try {
      await invoke('start_recording', {
        monitorIndex: store.selectedMonitor,
      });
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }

  async function loadSession(sessionDir: string) {
    try {
      await invoke('load_session_cmd', { sessionDir });
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  }

  async function confirmDelete(sessionDir: string) {
    try {
      await invoke('delete_session_cmd', { sessionDir });
    } catch (err) {
      console.error('Failed to delete session:', err);
      return;
    }
    sel.removeOne(sessionDir);
    await store.refreshSessions();
  }

  async function deleteSelected() {
    for (const sessionDir of sel.selected) {
      try {
        await invoke('delete_session_cmd', { sessionDir: sessionDir as string });
      } catch (err) {
        console.error('Failed to delete session:', sessionDir, err);
      }
    }
    sel.clear();
    await store.refreshSessions();
  }

  async function identifyMonitors() {
    try {
      await invoke('identify_monitors');
    } catch (err) {
      console.error('Failed to identify monitors:', err);
    }
  }


</script>

<PageLayout
  headerClass="flex items-center justify-between border-b px-4 py-2"
  leftClass="flex w-80 flex-col gap-4 border-r p-6"
  rightClass="flex flex-1 flex-col overflow-hidden p-6"
>
  {#snippet header()}
    <div class="flex items-center gap-3">
      <h1 class="text-lg font-semibold">Wegweiser</h1>
      <p class="text-sm text-muted-foreground">Windows step recorder</p>
    </div>
    <ThemeToggleButton />
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
            <span class="text-sm">{monitorLabel(store.monitors, idx)}</span>
          </label>
        {/each}
      </div>
    </div>

    <Button onclick={startRecording} class="mt-auto w-full">
      <Circle class="fill-current" />Start Recording
    </Button>
    <p class="text-center text-xs text-muted-foreground">
      Keystrokes from all applications are captured while recording.
    </p>
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
        selectedIds={sel.selected}
        getKey={(meta) => meta.session_dir}
        onToggleAll={sel.toggleAll}
        onDeleteSelected={() => { showBulkDeleteDialog = true; }}
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
                  checked={sel.selected.has(meta.session_dir)}
                  onCheckedChange={() => sel.toggleOne(meta.session_dir)}
                  class="shrink-0 cursor-pointer"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{meta.name}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {meta.step_count} step{pluralS(meta.step_count)}
                  </p>
                </div>
              </div>
              <div class="ml-3 flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onclick={() => loadSession(meta.session_dir)}>
                  <FolderOpen />Load
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  aria-label="Delete session"
                  onclick={() => {
                    pendingDeleteSessionDir = meta.session_dir;
                    showDeleteSessionDialog = true;
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          </div>
        {/snippet}
      </SelectableList>
    {/if}
  {/snippet}
</PageLayout>

<AlertDialog bind:open={showDeleteSessionDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete recording?</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={() => {
          showDeleteSessionDialog = false;
          if (pendingDeleteSessionDir !== null) confirmDelete(pendingDeleteSessionDir);
          pendingDeleteSessionDir = null;
        }}
        class={DESTRUCTIVE_DIALOG_ACTION_CLASS}
      >Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>

<AlertDialog bind:open={showBulkDeleteDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete {sel.selected.size} recording{pluralS(sel.selected.size)}?</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={() => { showBulkDeleteDialog = false; deleteSelected(); }}
        class={DESTRUCTIVE_DIALOG_ACTION_CLASS}
      >Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
