# Wegweiser

A modern Windows step recorder — the lightweight replacement for the long-deprecated `psr.exe`.

As you click through any workflow, Wegweiser automatically captures a screenshot at each step and marks the click location with an orange indicator. When you're done, export the result as a Markdown file or a self-contained HTML page, ready to share as a polished visual guide.

## Features

- **Automatic capture** — every mouse click triggers a screenshot; no manual step needed
- **Click annotation** — each screenshot is annotated with an orange circle marking the exact click position
- **Keystroke recording** — keyboard input between clicks is captured and shown alongside the step
- **Multi-monitor support** — record a single monitor or all monitors simultaneously; per-step tabs let you choose which monitor view to include in the export
- **Session library** — past recordings are saved and can be re-opened, edited, and re-exported at any time
- **Editable steps** — add descriptions, delete unwanted steps, and reorder the narrative before exporting
- **Export to Markdown** — produces a `.md` file with embedded image paths, ready for wikis and docs tools
- **Export to HTML** — produces a single self-contained `.html` file with all images base64-encoded; no external files needed
- **Compact recording bar** — while recording, the window shrinks to a 380×64 borderless mini-bar at the top of the screen so it stays out of the way
- **Light / dark / system theme**

## Download

Grab the latest release from the [Releases page](../../releases):

| File | Description |
|------|-------------|
| `Wegweiser_*_x64-setup.exe` | Windows installer (recommended) |
| `Wegweiser_*_x64_en-US.msi` | Windows MSI package |
| `Wegweiser.exe` | Portable executable — no install needed |

**Requirements:** Windows 10 (2004 or later) or Windows 11, 64-bit.

## Usage

1. **Select a monitor** (or keep "All Monitors") and click **Start Recording**.
2. Click through your workflow — a screenshot is captured at every click.
3. Press **Stop** in the mini-bar when done.
4. On the review screen, add descriptions to steps, delete unwanted ones, and rename the session.
5. Click **Export Markdown** or **Export HTML** and choose a save location.

**Tips:**
- Use **Pause** in the mini-bar to temporarily suspend capture without ending the session.
- Use the **Identify** button to flash numbered badges on each monitor so you can tell them apart.
- Empty recordings (0 steps) are discarded automatically on Stop.
- Sessions are auto-saved to `%LOCALAPPDATA%\Wegweiser\sessions\` after every step.

## Building from source

**Prerequisites:** [Node.js](https://nodejs.org) 18+, [Rust](https://rustup.rs) (stable), Windows SDK (ships with Visual Studio Build Tools).

```bash
# Clone and install frontend dependencies
git clone https://github.com/Sauerbac/Wegweiser.git
cd Wegweiser
npm install

# Development — hot-reload Tauri window
npx tauri dev

# Production build — outputs installer + exe to src-tauri/target/release/bundle/
npx tauri build
```

## Tech stack

- **[Tauri 2](https://tauri.app)** — Rust backend + native WebView frontend shell
- **[SvelteKit](https://kit.svelte.dev) + TypeScript** — frontend framework
- **[shadcn-svelte](https://www.shadcn-svelte.com) + [Tailwind CSS v4](https://tailwindcss.com)** — UI components and styling
- **[xcap](https://github.com/nashaofu/xcap)** — cross-platform screen capture
- **[rdev](https://github.com/Narsil/rdev)** — global mouse and keyboard hook

## License

MIT
