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

<div class="flex h-screen items-center bg-zinc-900 text-white select-none">
  <!-- Drag handle: fills all space between dots and buttons, covers most of the bar -->
  <div
    class="flex flex-1 items-center gap-2 h-full px-3 cursor-move"
    data-tauri-drag-region
  >
    <!-- Grip dots -->
    <svg
      width="10" height="16"
      viewBox="0 0 10 16"
      class="text-zinc-500 shrink-0 pointer-events-none"
      aria-hidden="true"
    >
      <circle cx="2" cy="2" r="1.5" fill="currentColor"/>
      <circle cx="2" cy="8" r="1.5" fill="currentColor"/>
      <circle cx="2" cy="14" r="1.5" fill="currentColor"/>
      <circle cx="8" cy="2" r="1.5" fill="currentColor"/>
      <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
      <circle cx="8" cy="14" r="1.5" fill="currentColor"/>
    </svg>
    <!-- Status info sits inside drag region; pointer-events:none so it doesn't block dragging -->
    <div class="flex items-center gap-2 pointer-events-none">
      <div class="h-2.5 w-2.5 rounded-full {isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}"></div>
      <span class="text-sm font-medium">{isPaused ? 'Paused' : 'Recording'}</span>
      <span class="rounded bg-zinc-700 px-2 py-0.5 text-xs tabular-nums">
        {stepCount} step{stepCount !== 1 ? 's' : ''}
      </span>
    </div>
  </div>

  <!-- Controls — NOT part of drag region so clicks reach the buttons -->
  <div class="flex items-center gap-1 pr-2 shrink-0">
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
