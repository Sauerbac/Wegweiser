import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MonitorInfo, RecordingState, Session, SessionMeta, Step } from '$lib/types';

// Svelte 5 class-based reactive store (class properties are writable from outside)
class AppStore {
  recordingState = $state<RecordingState>('idle');
  session = $state<Session | null>(null);
  monitors = $state<MonitorInfo[]>([]);
  selectedMonitor = $state<number | null>(null); // null = all monitors
  sessions = $state<SessionMeta[]>([]);
  exportProgress = $state<number | null>(null);
  exportedPath = $state<string | null>(null);
  exportError = $state<string | null>(null);

  async init() {
    this.monitors = await invoke<MonitorInfo[]>('list_monitors');
    await this.refreshSessions();

    await listen<RecordingState>('recording-state-changed', (event) => {
      this.recordingState = event.payload;
    });

    await listen<Step>('step-captured', (event) => {
      if (this.session) {
        this.session = {
          ...this.session,
          steps: [...this.session.steps, event.payload],
        };
      }
    });

    await listen<Session>('session-updated', (event) => {
      this.session = event.payload;
    });

    await listen<number>('export-progress', (event) => {
      this.exportProgress = event.payload;
    });

    await listen<string>('export-done', (event) => {
      this.exportProgress = null;
      this.exportedPath = event.payload;
    });

    await listen<string>('export-error', (event) => {
      this.exportProgress = null;
      this.exportError = event.payload;
    });
  }

  async refreshSessions() {
    this.sessions = await invoke<SessionMeta[]>('list_sessions');
  }
}

export const store = new AppStore();
