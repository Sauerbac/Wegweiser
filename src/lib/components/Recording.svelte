<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$lib/stores/session.svelte';

  let stepCount = $derived(store.session?.steps.length ?? 0);
  let isPaused = $derived(store.recordingState === 'paused');

  async function togglePause() {
    if (isPaused) {
      await invoke('resume_recording');
    } else {
      await invoke('pause_recording');
    }
  }

  async function stopRecording() {
    await invoke('stop_recording');
  }
</script>

<div
  class="flex h-screen items-center justify-between bg-zinc-900 px-4 text-white select-none"
  data-tauri-drag-region
>
  <!-- Step counter -->
  <div class="flex items-center gap-2">
    <div class="h-2.5 w-2.5 rounded-full {isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}"></div>
    <span class="text-sm font-medium">
      {isPaused ? 'Paused' : 'Recording'}
    </span>
    <span class="rounded bg-zinc-700 px-2 py-0.5 text-xs tabular-nums">
      {stepCount} step{stepCount !== 1 ? 's' : ''}
    </span>
  </div>

  <!-- Controls -->
  <div class="flex items-center gap-2">
    <Button
      variant="ghost"
      size="sm"
      onclick={togglePause}
      class="h-7 text-xs text-white hover:bg-zinc-700 hover:text-white"
    >
      {isPaused ? 'Resume' : 'Pause'}
    </Button>
    <Button
      size="sm"
      onclick={stopRecording}
      class="h-7 bg-red-600 text-xs hover:bg-red-700 text-white"
    >
      Stop
    </Button>
  </div>
</div>
