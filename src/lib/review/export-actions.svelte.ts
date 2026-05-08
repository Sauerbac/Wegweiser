import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { store } from '$lib/stores/session.svelte';

/**
 * createExportActions — file I/O orchestration for Markdown/HTML export.
 *
 * Owns the export-dropdown open state and the three export action functions.
 * Kept separate from createExportChoice so that export file logic changes
 * do not require touching the monitor-tab view-state code, and vice versa.
 */
export function createExportActions() {
  async function exportMarkdown() {
    const filePath = await save({
      title: 'Export Markdown',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: `${store.session?.name ?? 'tutorial'}.md`,
    });
    if (!filePath) return;
    store.clearExportState();
    try {
      const outPath = await invoke<string>('export_markdown', { outputPath: filePath });
      store.exportedPath = outPath;
    } catch (err) {
      console.error('Failed to export Markdown:', err);
    }
  }

  async function exportHtml() {
    const path = await save({
      title: 'Export HTML',
      filters: [{ name: 'HTML', extensions: ['html'] }],
      defaultPath: `${store.session?.name ?? 'tutorial'}.html`,
    });
    if (!path) return;
    store.clearExportState();
    try {
      await invoke('export_html', { outputPath: path });
    } catch (err) {
      console.error('Failed to export HTML:', err);
    }
  }

  async function openExported() {
    if (store.exportedPath) {
      try {
        await invoke('open_path', { path: store.exportedPath });
      } catch (err) {
        console.error('Failed to open exported file:', err);
      }
    }
  }

  return {
    exportMarkdown,
    exportHtml,
    openExported,
  };
}
