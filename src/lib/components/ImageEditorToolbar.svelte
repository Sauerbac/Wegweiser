<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Blend, Crop, MousePointer2, Redo2, RotateCcw, Undo2, X } from '@lucide/svelte';

  type Tool = 'blur' | 'crop' | 'window';

  interface Props {
    tool: Tool;
    hasSelection: boolean;
    canUndo: boolean;
    canRedo: boolean;
    applying: boolean;
    hasWindowRects: boolean;
    onsetTool: (t: Tool) => void;
    onundo: () => void;
    onredo: () => void;
    onresetSelection: () => void;
    onapplyBlur: () => void;
    onapplyCrop: () => void;
    onclose: () => void;
  }

  let {
    tool,
    hasSelection,
    canUndo,
    canRedo,
    applying,
    hasWindowRects,
    onsetTool,
    onundo,
    onredo,
    onresetSelection,
    onapplyBlur,
    onapplyCrop,
    onclose,
  }: Props = $props();
</script>

<div class="flex shrink-0 items-center gap-2">
  <Button
    variant={tool === 'blur' ? 'default' : 'outline'}
    size="sm"
    onclick={() => onsetTool('blur')}
  >
    <Blend />Blur
  </Button>
  <Button
    variant={tool === 'crop' ? 'default' : 'outline'}
    size="sm"
    onclick={() => onsetTool('crop')}
  >
    <Crop />Crop
  </Button>
  {#if hasWindowRects}
    <Button
      variant={tool === 'window' ? 'default' : 'outline'}
      size="sm"
      onclick={() => onsetTool('window')}
    >
      <MousePointer2 />Select Window
    </Button>
  {/if}

  <div class="flex-1"></div>

  <Button
    variant="outline"
    size="icon"
    aria-label="Undo"
    onclick={onundo}
    disabled={!canUndo || applying}
  >
    <Undo2 />
  </Button>
  <Button
    variant="outline"
    size="icon"
    aria-label="Redo"
    onclick={onredo}
    disabled={!canRedo || applying}
  >
    <Redo2 />
  </Button>

  {#if hasSelection}
    <Button variant="ghost" size="sm" onclick={onresetSelection}>
      <RotateCcw />Reset
    </Button>
    {#if tool === 'blur'}
      <Button size="sm" onclick={onapplyBlur} disabled={applying}>
        {applying ? 'Applying…' : 'Apply Blur'}
      </Button>
    {/if}
    {#if tool === 'crop' || tool === 'window'}
      <Button size="sm" onclick={onapplyCrop} disabled={applying}>
        {applying ? 'Applying…' : 'Apply Crop'}
      </Button>
    {/if}
  {/if}

  <Button variant="ghost" size="icon" aria-label="Close" onclick={onclose}>
    <X />
  </Button>
</div>
