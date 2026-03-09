import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { MonitorInfo, RecordingState, Session, SessionMeta, Step, UndoState } from '$lib/types';

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
  canUndo = $state(false);
  canRedo = $state(false);
  isDirty = $state(false);
  private _lastKnownSessionId = '';
  /**
   * Cache for primary step images.
   * Key: `${step.id}_v${step.image_version}` → asset URI.
   * The image_version suffix ensures the cache is busted after each image edit.
   */
  imageCache = $state<Record<string, string>>({});
  /** Cache for extra monitor images. Key: `${step.id}_extra_${monitorIndex}_v${ver}` → asset URI. */
  extraImageCache = $state<Record<string, string>>({});

  /** Build the versioned primary image cache key for a step. */
  imageCacheKey(step: Step): string {
    return `${step.id}_v${step.image_version ?? 0}`;
  }

  /** Build the cache key for an extra monitor image. */
  extraImageKey(stepId: number, monitorIndex: number, version = 0): string {
    return `${stepId}_extra_${monitorIndex}_v${version}`;
  }

  /** Remove all cache entries for a given step ID (all versions). */
  clearStepImageCache(stepId: number) {
    const prefix = `${stepId}_`;
    for (const key of Object.keys(this.imageCache)) {
      if (key.startsWith(prefix)) delete this.imageCache[key];
    }
    for (const key of Object.keys(this.extraImageCache)) {
      if (key.startsWith(prefix)) delete this.extraImageCache[key];
    }
  }

  /** Reset both image caches (call when starting a new recording). */
  clearImageCache() {
    this.imageCache = {};
    this.extraImageCache = {};
  }

  /**
   * Eagerly pre-load images for all steps not yet in either cache.
   * Safe to call on every session-updated event — skips already-cached entries.
   */
  preloadStepImages(steps: Step[]) {
    for (const step of steps) {
      const key = this.imageCacheKey(step);
      if (!this.imageCache[key]) {
        invoke<string>('get_step_image', { imagePath: step.image_path }).then((uri) => {
          this.imageCache[key] = uri;
        }).catch(err => console.error('Failed to load image:', err));
      }
      for (let i = 0; i < (step.extra_image_paths?.length ?? 0); i++) {
        const eKey = this.extraImageKey(step.id, i, step.image_version ?? 0);
        if (!this.extraImageCache[eKey]) {
          const path = step.extra_image_paths[i] ?? null;
          if (path !== null) {
            invoke<string>('get_step_image', { imagePath: path }).then((uri) => {
              this.extraImageCache[eKey] = uri;
            }).catch(err => console.error('Failed to load extra image:', err));
          }
        }
      }
    }
  }

  async init() {
    this.monitors = await invoke<MonitorInfo[]>('list_monitors');
    await this.refreshSessions();

    this._unlisteners = await Promise.all([
      listen<string>('recording-state-changed', (event) => {
        if (VALID_STATES.includes(event.payload as RecordingState)) {
          this.recordingState = event.payload as RecordingState;
          // Clear undo/redo availability and dirty state when leaving Reviewing state.
          if (event.payload === 'idle') {
            this.canUndo = false;
            this.canRedo = false;
            this.isDirty = false;
            this._lastKnownSessionId = '';
          }
        } else {
          console.error('Unknown recording state:', event.payload);
        }
      }),

      listen<UndoState>('undo-state-changed', (event) => {
        this.canUndo = event.payload.can_undo;
        this.canRedo = event.payload.can_redo;
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
        const isNewSession = event.payload.id !== this._lastKnownSessionId;
        this._lastKnownSessionId = event.payload.id;
        this.session = event.payload;
        this.preloadStepImages(event.payload.steps);
        // Only mark dirty for real user mutations in the Review screen.
        // - isNewSession: first delivery of a session (from start/stop/load) → not a mutation.
        // - recordingState !== 'reviewing': session-updated fired during recording
        //   (e.g. the final snapshot emitted by stop_recording before the state
        //   transitions to 'reviewing') → not a user edit in the Review screen.
        if (!isNewSession && this.recordingState === 'reviewing') {
          this.isDirty = true;
        }
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

  markSaved() {
    this.isDirty = false;
  }

  clearExportState() {
    this.exportedPath = null;
    this.exportError = null;
  }

  async refreshSessions() {
    try {
      this.sessions = await invoke<SessionMeta[]>('list_sessions');
    } catch (err) {
      console.error('Failed to refresh sessions:', err);
    }
  }

  /** Delete a single session and refresh the session list. */
  async deleteSession(sessionDir: string): Promise<void> {
    await invoke('delete_session_cmd', { sessionDir });
    await this.refreshSessions();
  }

  /** Delete multiple sessions and refresh the session list. */
  async deleteSessions(sessionDirs: Iterable<string>): Promise<void> {
    for (const sessionDir of sessionDirs) {
      await invoke('delete_session_cmd', { sessionDir });
    }
    await this.refreshSessions();
  }
}

export const store = new AppStore();
