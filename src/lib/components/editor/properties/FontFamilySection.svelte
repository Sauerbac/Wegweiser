<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const categories = [
    { family: 'Comic Sans MS', label: 'Hand', icon: 'A', style: 'font-family: Comic Sans MS; font-style: italic;' },
    { family: 'system-ui, -apple-system, sans-serif', label: 'Normal', icon: 'A', style: 'font-family: Arial, sans-serif;' },
    { family: 'Georgia', label: 'Serif', icon: 'A', style: 'font-family: Georgia, serif;' },
    { family: 'Courier New', label: 'Mono', icon: 'A', style: 'font-family: Courier New, monospace;' },
  ];

  const allFonts: { family: string; label: string }[] = [
    { family: 'system-ui, -apple-system, sans-serif', label: 'System Default' },
    { family: 'Arial', label: 'Arial' },
    { family: 'Calibri', label: 'Calibri' },
    { family: 'Cambria', label: 'Cambria' },
    { family: 'Comic Sans MS', label: 'Comic Sans MS' },
    { family: 'Courier New', label: 'Courier New' },
    { family: 'Georgia', label: 'Georgia' },
    { family: 'Impact', label: 'Impact' },
    { family: 'Segoe UI', label: 'Segoe UI' },
    { family: 'Tahoma', label: 'Tahoma' },
    { family: 'Times New Roman', label: 'Times New Roman' },
    { family: 'Trebuchet MS', label: 'Trebuchet MS' },
    { family: 'Verdana', label: 'Verdana' },
  ];

  const isCategoryActive = $derived(
    categories.some((c) => c.family === fabricCanvas.fontFamily),
  );
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Font</p>
  <!-- Quick category toggles -->
  <div class="flex gap-1">
    {#each categories as cat}
      <Button
        variant={fabricCanvas.fontFamily === cat.family ? 'default' : 'outline'}
        size="icon-sm"
        class="flex-1"
        aria-label={cat.label}
        title={cat.label}
        onclick={() => fabricCanvas.setFontFamily(cat.family)}
      >
        <span class="text-xs font-semibold leading-none" style={cat.style}>{cat.icon}</span>
      </Button>
    {/each}
  </div>
  <!-- Full font dropdown for advanced selection -->
  <select
    value={fabricCanvas.fontFamily}
    onchange={(e) => fabricCanvas.setFontFamily(e.currentTarget.value)}
    class="w-full rounded border bg-background px-1.5 py-1 text-xs text-foreground"
    class:text-muted-foreground={!isCategoryActive && fabricCanvas.fontFamily !== ''}
  >
    {#each allFonts as f}
      <option value={f.family} style="font-family: {f.family};">{f.label}</option>
    {/each}
  </select>
</div>
