/**
 * Keyboard shortcut handling for the annotation editor.
 *
 * Provides a single `handleEditorKeyDown` function that maps key combos to
 * canvas actions. Import this in AnnotationEditor.svelte's keydown handler.
 */

import type { FabricCanvasWrapper, AnnotationTool, ObfuscationEffect } from '$lib/fabric-canvas.svelte';

/** Map of single-key shortcuts to tool names. */
const TOOL_KEYS: Record<string, AnnotationTool> = {
  v: 'select',
  r: 'rectangle',
  e: 'ellipse',
  a: 'arrow',
  t: 'text',
  p: 'freehand',
  h: 'highlight',
  o: 'obfuscation',
  c: 'crop',
};

/** Map of single-key shortcuts to obfuscation effects (only for keys that open the obfuscation tool). */
const OBFUSCATION_EFFECT_KEYS: Record<string, ObfuscationEffect> = {
  o: 'blur',
};

export interface KeyboardShortcutContext {
  canvas: FabricCanvasWrapper;
  initialized: boolean;
  setTool: (t: AnnotationTool) => void;
}

/**
 * Handle a keydown event for the annotation editor.
 *
 * Returns `true` if the event was consumed (caller should call
 * `e.preventDefault()` and `e.stopPropagation()`).
 */
export async function handleEditorKeyDown(
  e: KeyboardEvent,
  ctx: KeyboardShortcutContext,
): Promise<boolean> {
  if (!ctx.initialized) return false;

  // When Fabric.js IText is in editing mode it focuses a hidden <textarea>.
  // Let the browser (and Fabric.js) handle ALL keys natively in that case;
  // shortcuts should not fire while the user is typing annotation text.
  if (document.activeElement instanceof HTMLTextAreaElement) return false;

  const { canvas, setTool } = ctx;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key;

  // ── Ctrl combos ──────────────────────────────────────────────────────────

  if (ctrl) {
    switch (key.toLowerCase()) {
      case 'a':
        // Switch to select tool first if needed, then select all.
        if (canvas.tool !== 'select') setTool('select');
        canvas.selectAll();
        return true;
      case 'c':
        await canvas.copySelected();
        return true;
      case 'x':
        await canvas.cutSelected();
        return true;
      case 'v':
        await canvas.pasteSelected();
        return true;
      case 'd':
        await canvas.duplicateSelected();
        return true;
      // Ctrl+Z and Ctrl+Y are handled by the editor-session store via undoTick/redoTick.
      // Do not handle them here to avoid double-firing.
      case 'z':
      case 'y':
        return false;
    }
  }

  // ── Delete / Backspace ───────────────────────────────────────────────────

  if (key === 'Delete' || key === 'Backspace') {
    // Only handle Backspace when no text input is focused to avoid
    // interfering with IText editing.
    if (key === 'Backspace') {
      const target = document.activeElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return false;
      }
    }
    canvas.deleteSelected();
    return true;
  }

  // ── Tool shortcuts (no modifier, single letter) ──────────────────────────

  if (!ctrl && !e.altKey && key.length === 1) {
    const lk = key.toLowerCase();
    const tool = TOOL_KEYS[lk];
    if (tool) {
      // For keys that activate the obfuscation tool, apply the default effect
      // so the Properties panel and drawing behavior are correct.
      const effect = OBFUSCATION_EFFECT_KEYS[lk];
      if (effect) {
        canvas.setObfuscationEffect(effect);
      }
      setTool(tool);
      return true;
    }
  }

  return false;
}
