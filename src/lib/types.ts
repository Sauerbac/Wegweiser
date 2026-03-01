export interface ClickPoint {
  /** Physical pixel X coordinate (Rust: u32, always non-negative) */
  x: number;
  /** Physical pixel Y coordinate (Rust: u32, always non-negative) */
  y: number;
}

/** Mirrors the Rust StepExportChoice enum (serde tag+content). */
export type StepExportChoice =
  | { type: 'Primary' }
  | { type: 'Extra'; value: number }
  | { type: 'All' };

export interface WindowRect {
  title: string;
  /** X position in monitor-relative physical pixels. */
  x: number;
  /** Y position in monitor-relative physical pixels. */
  y: number;
  w: number;
  h: number;
}

export interface Step {
  id: number;
  order: number;
  /** Windows absolute path serialized from Rust PathBuf. */
  image_path: string;
  /** Paths to unannotated screenshots of the other monitors captured when
   *  "All monitors" is selected.  Empty for single-monitor sessions.
   *  Each entry is a Windows absolute path serialized from Rust PathBuf. */
  extra_image_paths: string[];
  /** Monitor list index for the primary (annotated) image. */
  click_monitor_index: number;
  /** Monitor list indices parallel to extra_image_paths. */
  extra_monitor_indices: number[];
  click: ClickPoint | null;
  description: string;
  /** ISO 8601 UTC datetime string serialized from Rust DateTime<Utc>. */
  timestamp: string;
  keystrokes: string | null;
  /** Which monitor image(s) to include when exporting this step. */
  export_choice: StepExportChoice;
  /** Visible window rects at capture time (monitor-relative pixels). */
  window_rects: WindowRect[];
  /** Incremented on each image edit; used as a cache-busting key. */
  image_version: number;
}

export interface UndoState {
  can_undo: boolean;
  can_redo: boolean;
}

export interface Session {
  id: string;
  name: string;
  /** ISO 8601 UTC datetime string serialized from Rust DateTime<Utc>. */
  created_at: string;
  monitor_index: number | null;
  steps: Step[];
  /** Windows absolute path serialized from Rust PathBuf. */
  session_dir: string;
  exported: boolean;
}

export interface MonitorInfo {
  name: string;
  /** Horizontal screen position in physical pixels (Rust: i32, can be negative for non-primary monitors). */
  x: number;
  /** Vertical screen position in physical pixels (Rust: i32, can be negative for non-primary monitors). */
  y: number;
  /** Monitor width in physical pixels (Rust: u32, always non-negative). */
  width: number;
  /** Monitor height in physical pixels (Rust: u32, always non-negative). */
  height: number;
}

export interface SessionMeta {
  id: string;
  name: string;
  step_count: number;
  /** Windows absolute path serialized from Rust PathBuf. */
  session_dir: string;
}

export type RecordingState = 'idle' | 'recording' | 'paused' | 'reviewing';

/**
 * A parsed segment from a keystroke string.
 *   { kind: 'shortcut', key: 'Ctrl+Shift+Left' }  — rendered as <kbd>
 *   { kind: 'text', value: 'hello world' }          — rendered as plain text
 */
export type KeystrokeSegment =
  | { kind: 'shortcut'; key: string }
  | { kind: 'text'; value: string };
