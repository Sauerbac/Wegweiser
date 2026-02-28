# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`Wegweiser` is a Windows step recorder (modern replacement for the deprecated `psr.exe`). It captures screenshots on mouse clicks, annotates them with an orange click indicator, and exports annotated tutorials as Markdown or self-contained HTML.

### User-facing description

> **Wegweiser** is a Windows tool for recording step-by-step guides. As you click through a workflow, it automatically captures a screenshot at each step and marks the click location with an orange indicator. When you're done, you export the result as a Markdown file or a self-contained HTML page — ready to share with colleagues as a polished, visual Anleitung. It replaces the long-deprecated Windows Step Recorder (psr.exe) with a modern, lightweight alternative.

## Architecture

The app is built with **Tauri 2** — a Rust backend exposed via commands and events, and a **SvelteKit + shadcn-svelte + Tailwind CSS v4** frontend.

```
src/                              ← SvelteKit frontend (TypeScript)
  routes/
    +layout.svelte                ← root layout, imports layout.css
    +page.svelte                  ← state-machine shell (Idle / Recording / Reviewing)
    layout.css                    ← Tailwind + shadcn CSS variables
    identify/
      +layout.svelte              ← transparent layout for monitor-badge windows
      +page.svelte                ← monitor number badge (shown via identify_monitors command)
  lib/
    components/
      Idle.svelte                 ← home screen: monitor picker + session library
      Recording.svelte            ← 380×64 mini-bar shown while recording
      Review.svelte               ← step list, detail view, export panel
      PageLayout.svelte           ← shared two-column layout shell
      SelectableList.svelte       ← generic list with select-all + bulk-delete header
      ui/                         ← shadcn-svelte components
    stores/
      session.svelte.ts           ← reactive store: session, monitors, recording state
    types.ts                      ← TypeScript types mirroring Rust model
    utils.ts                      ← cn() helper

src-tauri/                        ← Rust backend
  src/
    lib.rs                        ← tauri::Builder setup, command registration
    main.rs                       ← entry point (#[cfg_attr] windows_subsystem)
    commands.rs                   ← all #[tauri::command] handlers
    state.rs                      ← AppState, RecordingState, shared state behind Mutex
    model.rs                      ← Session, Step, ClickPoint, MonitorInfo (serde types)
    hooks.rs                      ← rdev::listen() hook thread, filters clicks + keystrokes
    capture.rs                    ← xcap monitor listing + per-click capture thread
    annotate.rs                   ← draw_click_indicator() on RgbaImage
    session.rs                    ← save/load/list/delete session.json + SessionMeta
    platform.rs                   ← Windows-specific: GetWindowPlacement, WDA_EXCLUDEFROMCAPTURE
    export/
      mod.rs
      markdown.rs
      html.rs
  Cargo.toml
  tauri.conf.json                 ← window config, identifier, frontendDist

egui-reference/                   ← original egui/eframe implementation (read-only reference)
  src/
  Cargo.toml

.github/workflows/
  release.yml                     ← builds + publishes Windows installer/exe on v* tags
```

### State machine

```
Idle → [Start] → Recording ⇄ Paused → [Stop] → Reviewing → [Export]
                                                           → [New Recording] → Idle
```

The recording state is held in `AppState.recording_state` (Rust) and mirrored in `store.recordingState` (frontend). The root `+page.svelte` switches between `<Idle>`, `<Recording>`, and `<Review>` based on this value.

### Communication model

| Mechanism | Direction | Purpose |
|---|---|---|
| `invoke('command_name', args)` | Frontend → Backend | Trigger actions (start, stop, delete step…) |
| `listen('event_name', handler)` | Backend → Frontend | Push state (new step captured, recording state changed…) |

Key events emitted by the backend:

| Event | Payload | When |
|---|---|---|
| `recording-state-changed` | `RecordingState` string | On start / pause / resume / stop |
| `session-updated` | `Session` | After any mutation (new step, rename, delete step) |
| `step-captured` | `Step` | After each screenshot is processed |
| `export-done` | `string` (path) | HTML export finished |
| `export-error` | `string` (message) | HTML export failed |
| `export-progress` | `number` (0–100) | HTML export progress |

### xcap 0.8 notes

- `monitor.capture_image()` returns `XCapResult<RgbaImage>` — not `DynamicImage`.
- All monitor methods (`name()`, `x()`, `y()`, `width()`, `height()`) return `Result<T, XCapError>`; use `.unwrap_or_default()` for non-critical fields.

### Key coordinate rule

**All screen coordinates are physical pixels.** `rdev` and `xcap` both work in physical pixels. The frontend receives physical pixel coordinates in events and must not apply any DPI scaling itself.

### Session storage

Sessions live in `%LOCALAPPDATA%\Wegweiser\sessions\<8-char-uuid>\`. Each session directory contains:
- `session.json` — auto-saved after every new step and on stop
- `step_NNNN.png` — annotated screenshot for step with id NNNN
- `step_NNNN_extra_M.png` — extra monitor screenshots (only present for "All Monitors" recordings)

Empty sessions (0 steps) are deleted automatically when recording stops.

### Window morphing (mini-bar)

When recording starts the window shrinks to 380×64, borderless, always-on-top, and positions at top-center of the selected monitor. The pre-recording geometry (position + inner size, or maximized state) is saved via `GetWindowPlacement` and restored exactly when recording stops. The mini-bar is hidden from screen-capture APIs via `WDA_EXCLUDEFROMCAPTURE` (Windows 10 2004+) so it never appears in recorded screenshots.

**Drag handle**: Left side of mini-bar has `<GripVertical>` (lucide) with `data-tauri-drag-region` for window dragging; buttons are outside the region so they remain clickable.

### Monitor identification

`identify_monitors` command creates small 120×76px transparent windows on each monitor (bottom-left corner) showing a large number badge. Windows start hidden and show once rendered to avoid white flash. Auto-closes after 3 seconds. Triggered via the "Identify" button in the monitor selection panel.

### Multi-monitor capture (`StepExportChoice`)

When "All Monitors" is selected, each click captures:
1. The monitor where the click occurred → annotated PNG → `step.image_path`
2. All other monitors → plain PNGs → `step.extra_image_paths`

The review screen shows per-monitor tabs. `StepExportChoice` (`Primary` / `Extra(i)` / `All`) controls which images are written to the export.

## Commands

```bash
# Development
npx tauri dev           # start Vite dev server + Tauri window with hot-reload
                        # (runs `npm run dev` + `cargo run` in parallel)

# Production
npx tauri build         # build SvelteKit (npm run build → build/) then compile
                        # Rust in release mode → src-tauri/target/release/
                        # outputs installer in src-tauri/target/release/bundle/

# Frontend only
npm run dev             # Vite dev server on http://localhost:5173 (no Tauri window)
npm run build           # build SvelteKit to build/ (required before tauri build)
npm run check           # svelte-kit sync + TypeScript type-check

# shadcn components
npx shadcn-svelte@latest add <component>   # add a new shadcn-svelte component

# Rust backend only
cd src-tauri && cargo check               # fast type-check without linking
cd src-tauri && cargo build               # debug build
```

No tests exist yet.

## Styling rules

- **Always use Tailwind utility classes** for all frontend styling. Do not write raw CSS in `<style>` blocks unless it is genuinely impossible with Tailwind (e.g. `:global()` overrides targeting child components, or per-route `html`/`body` resets).
- Use **shadcn CSS variables** (`--primary`, `--muted`, `--border`, etc.) via their Tailwind token equivalents (`bg-primary`, `text-muted-foreground`, `border-border`, etc.) — never hardcode color hex/hsl values in components.
- `src/routes/layout.css` is the theme foundation (shadcn variable definitions + `@import` directives) — do not add utility-style rules there.
- **Icons**: always use `@lucide/svelte` — no hand-authored SVGs. Do not set explicit `size` props on icons inside `<Button>` — the button component sizes them automatically via `[&_svg:not([class*='size-'])]:size-4`. Destructive actions use `Trash2`; navigation uses `ArrowLeft`; exports use `FileDown`/`FileCode`.
- **Button conventions** — only set `variant`, `size`, event handlers, and pure layout classes (e.g. `mt-auto`, `w-full`, `shrink-0`). Never add custom styling classes (hover overrides, gap, color, etc.) to a `<Button>`:
  - Gap between icon and label is automatic — never add `gap-*` to a `<Button class>`.
  - Icon-only buttons use `size="icon"` / `size="icon-sm"` / `size="icon-lg"` with an `aria-label`.
  - All destructive actions (delete, confirm-delete) use `variant="destructive"`.
  - Navigation and export buttons in toolbars use `variant="outline"`.
  - The minibar (Recording.svelte) is the only exception: its buttons carry compact overrides (`h-7 gap-1 text-xs`) required by the 64 px height constraint.
- **shadcn-svelte component mapping** — always use the designated component, never a raw HTML element:
  | Element | Component |
  |---|---|
  | Buttons | `Button` (with correct `variant`) |
  | Checkboxes | `Checkbox` (supports `indeterminate` prop) |
  | Selects | `Select` |
  | Confirmation dialogs | `AlertDialog` |
  | Tabs | `Tabs` / `TabsList` / `TabsTrigger` / `TabsContent` |
  | Scrollable areas | `ScrollArea` |
  | Text inputs / textareas | `Textarea` |
  | Metadata labels | `Badge` |
  | Dropdown menus | `DropdownMenu` |

  `<input type="radio">` is acceptable when no `RadioGroup` component is installed. Add missing components with `npx shadcn-svelte@latest add <name>` before using them.
- **Intentional semantic colors** (do not replace with theme tokens): Stop button `bg-red-600 hover:bg-red-700`; recording status dot `bg-red-500 animate-pulse`; paused status dot `bg-yellow-400`.

## Workflow

- Only commit once the user has confirmed that the changes work as expected.
- Commit messages should describe what changed and why.
- The egui reference implementation lives in `egui-reference/` — consult it when porting logic but do not modify it.
