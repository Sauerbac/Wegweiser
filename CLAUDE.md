# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`rec` is a Windows step recorder (modern replacement for the deprecated `psr.exe`). It captures screenshots on mouse clicks, annotates them with an orange click indicator, and exports annotated tutorials as Markdown or self-contained HTML.

## Architecture

The app is built with **Tauri 2** — a Rust backend exposed via commands and events, and a **SvelteKit + shadcn-svelte + Tailwind CSS v4** frontend.

```
src/                        ← SvelteKit frontend (TypeScript)
  routes/
    +layout.svelte          ← root layout, imports layout.css
    layout.css              ← Tailwind + shadcn CSS variables
    +page.svelte            ← home/router (will become the state-machine shell)
  lib/
    components/ui/          ← shadcn-svelte components
    utils.ts                ← cn() helper

src-tauri/                  ← Rust backend
  src/
    lib.rs                  ← tauri::Builder setup, command registration
    main.rs                 ← entry point (#[cfg_attr] windows_subsystem)
  Cargo.toml
  tauri.conf.json           ← window config, identifier, frontendDist

egui-reference/             ← original egui/eframe implementation (read-only reference)
  src/                      ← all original Rust source files
  Cargo.toml
```

### State machine (unchanged from egui version)

```
Idle → [Start] → Recording ⇄ Paused → [Stop] → Reviewing → [Export]
                                                           → [New Recording] → Idle
```

The recording state drives which SvelteKit route/component is shown and whether the window is in mini-bar or full mode.

### Communication model

Instead of egui's polling loop, the port uses **Tauri commands and events**:

| Mechanism | Direction | Purpose |
|---|---|---|
| `invoke('command_name', args)` | Frontend → Backend | Trigger actions (start, stop, delete step…) |
| `listen('event_name', handler)` | Backend → Frontend | Push state (new step captured, recording state changed…) |

The hook thread and capture thread still live in Rust. Instead of sending to mpsc channels polled by egui, they emit Tauri events to the frontend.

### Key Rust modules (to be built in src-tauri/src/)

| File | Role |
|---|---|
| `state.rs` | `AppState`, `RecordingState`, shared state behind `Mutex` |
| `hooks.rs` | `rdev::listen()` hook thread, filters clicks, emits events |
| `capture.rs` | xcap monitor listing + per-click capture thread |
| `annotate.rs` | draw_click_indicator() on RgbaImage |
| `session.rs` | save/load session.json |
| `model.rs` | Session, Step, ClickPoint (serde types) |
| `commands.rs` | all `#[tauri::command]` handlers |
| `export/` | markdown.rs, html.rs |

### xcap 0.8 notes

- `monitor.capture_image()` returns `XCapResult<RgbaImage>` — not `DynamicImage`.
- All monitor methods (`name()`, `x()`, `y()`, `width()`, `height()`) return `Result<T, XCapError>`; use `.unwrap_or_default()` for non-critical fields.

### Key coordinate rule

**All screen coordinates are physical pixels.** `rdev` and `xcap` both work in physical pixels. The frontend receives physical pixel coordinates in events and must not apply any DPI scaling itself.

### Session storage

A session lives in `%LOCALAPPDATA%\rec\sessions\<uuid>\`. `session.json` is auto-saved after every new step and on stop. PNG files are named `step_NNNN.png` by step ID.

### Window morphing (mini-bar)

When recording starts the window shrinks to ~380×64, borderless, always-on-top, and positions at top-center of the selected monitor. On stop it restores to 900×650 with decorations. This is done via `tauri::WebviewWindow` methods called from Rust commands.

**Drag handle**: Left side of mini-bar has visible grip-dot icon (SVG) with `data-tauri-drag-region` for window dragging; buttons are outside the region so they remain clickable.

### Monitor identification

`identify_monitors` command creates small 120×76px transparent windows on each monitor (bottom-left corner) showing a large number badge. Windows start hidden and show once rendered to avoid white flash. Auto-closes after 3 seconds. Triggered via "ID" button in monitor selection screen.

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
                                            # e.g. add badge, dialog, scroll-area

# Rust backend only
cd src-tauri && cargo check               # fast type-check without linking
cd src-tauri && cargo build               # debug build
```

No tests exist yet.

## Styling rules

- **Always use Tailwind utility classes** for all frontend styling. Do not write raw CSS in `<style>` blocks unless it is genuinely impossible with Tailwind (e.g. `:global()` overrides targeting child components, or per-route `html`/`body` resets).
- Use **shadcn CSS variables** (`--primary`, `--muted`, `--border`, etc.) via their Tailwind token equivalents (`bg-primary`, `text-muted-foreground`, `border-border`, etc.) — never hardcode color hex/hsl values in components.
- `src/routes/layout.css` is the theme foundation (shadcn variable definitions + `@import` directives) — do not add utility-style rules there.

## Workflow

- Only commit once the user has confirmed that the changes work as expected.
- Commit messages should describe what changed and why.
- The egui reference implementation lives in `egui-reference/` — consult it when porting logic but do not modify it.

## Port status

| Area | Status |
|------|--------|
| Project skeleton (Tauri + SvelteKit + shadcn + Tailwind) | ✅ done |
| Rust model types (Session, Step, ClickPoint) | pending |
| Hook thread + click capture | pending |
| Tauri commands (start/stop/pause/delete) | pending |
| Frontend state machine UI | pending |
| Idle screen (monitor picker, session library) | pending |
| Recording mini-bar | pending |
| Review screen (step list, preview, editor) | pending |
| Markdown export | pending |
| HTML export | pending |
