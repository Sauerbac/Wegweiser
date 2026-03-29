<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Separator from '$lib/components/ui/separator';
  import {
    MousePointer2,
    MoveRight,
    Square,
    Circle,
    Pencil,
    Type,
    Highlighter,
    Hash,
    Grid3X3,
    Crop,
    AppWindow,
  } from '@lucide/svelte';
  import type { AnnotationTool } from '$lib/fabric-canvas.svelte';

  interface Props {
    tool: AnnotationTool;
    hasWindowRects: boolean;
    onsetTool: (t: AnnotationTool) => void;
  }

  let { tool, hasWindowRects, onsetTool }: Props = $props();

  const tools: { id: AnnotationTool; icon: typeof MousePointer2; label: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'arrow', icon: MoveRight, label: 'Arrow' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse' },
    { id: 'freehand', icon: Pencil, label: 'Freehand' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight' },
    { id: 'callout', icon: Hash, label: 'Callout' },
    { id: 'blur', icon: Grid3X3, label: 'Blur' },
    { id: 'crop', icon: Crop, label: 'Crop' },
  ];
</script>

<div class="flex shrink-0 flex-col items-center gap-1 border-r bg-muted/30 p-1.5">
  {#each tools as t}
    <Button
      variant={tool === t.id ? 'default' : 'ghost'}
      size="icon-sm"
      aria-label={t.label}
      title={t.label}
      onclick={() => onsetTool(t.id)}
    >
      <t.icon />
    </Button>
  {/each}

  {#if hasWindowRects}
    <Separator.Root class="my-0.5" />
    <Button
      variant={tool === 'window' ? 'default' : 'ghost'}
      size="icon-sm"
      aria-label="Select Window"
      title="Select Window"
      onclick={() => onsetTool('window')}
    >
      <AppWindow />
    </Button>
  {/if}
</div>
