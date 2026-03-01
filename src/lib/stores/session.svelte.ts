import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { MonitorInfo, RecordingState, Session, SessionMeta, Step } from '$lib/types';

const VALID_STATES: RecordingState[] = ['idle', 'recording', 'paused', 'reviewing'];

// Svelte 5 class-based reactive store (class properties are writable from outside)
class AppStore {
  private _unlisteners: UnlistenFn[] = [];

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

    this._unlisteners = await Promise.all([
      listen<string>('recording-state-changed', (event) => {
        if (VALID_STATES.includes(event.payload as RecordingState)) {
          this.recordingState = event.payload as RecordingState;
        } else {
          console.error('Unknown recording state:', event.payload);
        }
      }),

      listen<Step>('step-captured', (event) => {
        if (this.session) {
          const alreadyExists = this.session.steps.some(s => s.id === event.payload.id);
          if (!alreadyExists) {
            this.session = {
              ...this.session,
              steps: [...this.session.steps, event.payload],
            };
          }
        }
      }),

      listen<Session>('session-updated', (event) => {
        this.session = event.payload;
      }),

      listen<number>('export-progress', (event) => {
        // Payload is in the 0–1 range; multiply by 100 when displaying as a percentage.
        this.exportProgress = event.payload;
      }),

      listen<string>('export-done', (event) => {
        this.exportProgress = null;
        this.exportedPath = event.payload;
      }),

      listen<string>('export-error', (event) => {
        this.exportProgress = null;
        this.exportError = event.payload;
      }),
    ]);
  }

  destroy() {
    for (const unlisten of this._unlisteners) {
      unlisten();
    }
    this._unlisteners = [];
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
