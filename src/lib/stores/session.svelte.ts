import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MonitorInfo, RecordingState, Session, SessionMeta, Step } from '$lib/types';

const VALID_STATES: RecordingState[] = ['idle', 'recording', 'paused', 'reviewing'];

// Svelte 5 class-based reactive store (class properties are writable from outside)
class AppStore {
  recordingState = $state<RecordingState>('idle');
  session = $state<Session | null>(null);
  monitors = $state<MonitorInfo[]>([]);
  selectedMonitor = $state<number | null>(null); // null = all monitors
  sessions = $state<SessionMeta[]>([]);
  /**
   * Export progress received from the backend via the 'export-progress' event.
   * Range: 0–1 (multiply by 100 for a percentage value).
   * null when no export is in progress.
   */
  exportProgress = $state<number | null>(null);
  exportedPath = $state<string | null>(null);
  exportError = $state<string | null>(null);

  async init() {
    this.monitors = await invoke<MonitorInfo[]>('list_monitors');
    await this.refreshSessions();

    await listen<string>('recording-state-changed', (event) => {
      if (VALID_STATES.includes(event.payload as RecordingState)) {
        this.recordingState = event.payload as RecordingState;
      } else {
        console.error('Unknown recording state:', event.payload);
      }
    });

    await listen<Step>('step-captured', (event) => {
      if (this.session) {
        const alreadyExists = this.session.steps.some(s => s.id === event.payload.id);
        if (!alreadyExists) {
          this.session = {
            ...this.session,
            steps: [...this.session.steps, event.payload],
          };
        }
      }
    });

    await listen<Session>('session-updated', (event) => {
      this.session = event.payload;
    });

    await listen<number>('export-progress', (event) => {
      // Payload is in the 0–1 range; multiply by 100 when displaying as a percentage.
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
    try {
      this.sessions = await invoke<SessionMeta[]>('list_sessions');
    } catch (err) {
      console.error('Failed to refresh sessions:', err);
    }
  }
}

export const store = new AppStore();
