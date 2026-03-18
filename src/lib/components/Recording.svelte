<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { Button } from '$lib/components/ui/button';
  import { store } from '$lib/stores/session.svelte';
  import { pluralS } from '$lib/utils';
  import { GripVertical, Pause, Play, Square } from '@lucide/svelte';

  let stepCount = $derived(store.session?.steps.length ?? 0);
  let isPaused = $derived(store.recordingState === 'paused');

  async function togglePause() {
    try {
      if (isPaused) {
        await invoke('resume_recording');
      } else {
        await invoke('pause_recording');
      }
    } catch (err) {
      console.error('Failed to toggle pause:', err);
    }
  }

  async function stopRecording() {
    try {
      await invoke('stop_recording');
    } catch (err) {
      console.error('Failed to stop recording:', err);
    }
  }
</script>

<div class="flex h-screen items-center bg-card text-card-foreground select-none">
  <!-- Drag handle: fills all space between dots and buttons, covers most of the bar -->
  <div
    class="flex flex-1 items-center gap-2 h-full px-3 cursor-move"
    data-tauri-drag-region
    title="Keystrokes from all applications are being captured while recording"
  >
    <!-- Grip dots -->
    <GripVertical
      class="size-4 text-muted-foreground shrink-0 pointer-events-none"
      aria-hidden="true"
    />
    <!-- Status info sits inside drag region; pointer-events:none so it doesn't block dragging -->
    <div class="flex items-center gap-2 pointer-events-none">
      <div class="h-2.5 w-2.5 rounded-full {isPaused ? 'bg-yellow-400' : 'bg-red-500 animate-pulse'}"></div>
      <span class="text-sm font-medium">{isPaused ? 'Paused' : 'Recording'}</span>
      <span class="rounded bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
        {stepCount} step{pluralS(stepCount)}
      </span>
    </div>
  </div>

  <!-- Controls — NOT part of drag region so clicks reach the buttons -->
  <div class="flex items-center gap-1 pr-3 shrink-0">
    <Button
      variant="ghost"
      size="sm"
      onclick={togglePause}
      class="h-7 gap-1 text-sm"
    >
      {#if isPaused}
        <Play />{' '}Resume
      {:else}
        <Pause />{' '}Pause
      {/if}
    </Button>
    <Button
      size="sm"
      onclick={stopRecording}
      class="h-7 gap-1 bg-red-600 text-sm hover:bg-red-700 text-white"
    >
      <Square />Stop
    </Button>
  </div>
</div>
