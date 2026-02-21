export interface ClickPoint {
  x: number;
  y: number;
}

export interface Step {
  id: number;
  order: number;
  image_path: string;
  click: ClickPoint | null;
  description: string;
  timestamp: string;
  keystrokes: string | null;
}

export interface Session {
  id: string;
  name: string;
  created_at: string;
  monitor_index: number | null;
  steps: Step[];
  session_dir: string;
  exported: boolean;
}

export interface MonitorInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionMeta {
  id: string;
  name: string;
  step_count: number;
  session_dir: string;
}

export type RecordingState = 'idle' | 'recording' | 'paused' | 'reviewing';
