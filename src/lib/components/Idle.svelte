<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$lib/stores/session.svelte';
  import { Circle, FolderOpen, Monitor, RefreshCw, Trash2 } from '@lucide/svelte';

  let pendingDelete = $state<string | null>(null);

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

<div class="flex h-screen flex-col bg-background text-foreground">
  <!-- Header -->
  <div class="border-b px-6 py-4">
    <h1 class="text-xl font-semibold">rec</h1>
    <p class="text-sm text-muted-foreground">Windows step recorder</p>
  </div>

  <div class="flex flex-1 gap-0 overflow-hidden">
    <!-- Left: Monitor picker + Start -->
    <div class="flex w-80 flex-col gap-4 border-r p-6">
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

      <Button onclick={startRecording} class="mt-auto w-full gap-2">
        <Circle size={14} class="fill-current" />Start Recording
      </Button>
    </div>

    <!-- Right: Session library -->
    <div class="flex flex-1 flex-col overflow-hidden p-6">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Past Recordings
        </h2>
        <Button variant="outline" size="sm" onclick={() => store.refreshSessions()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>

      {#if store.sessions.length === 0}
        <div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No recordings yet. Start one on the left.
        </div>
      {:else}
        <div class="flex flex-col gap-2 overflow-y-auto">
          {#each store.sessions as meta (meta.session_dir)}
            <div class="rounded-lg border p-4 transition-colors hover:bg-accent/40">
              <div class="flex items-start justify-between">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{meta.name}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {meta.step_count} step{meta.step_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <div class="ml-3 flex shrink-0 items-center gap-2">
                  {#if pendingDelete === meta.session_dir}
                    <span class="text-xs font-medium text-destructive">Delete?</span>
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
                    <Button variant="outline" size="sm" onclick={() => loadSession(meta.session_dir)} class="gap-1.5">
                      <FolderOpen size={13} />Load
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => (pendingDelete = meta.session_dir)}
                      class="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Trash2 size={13} />Delete
                    </Button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
