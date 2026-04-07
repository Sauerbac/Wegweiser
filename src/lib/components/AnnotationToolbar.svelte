<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import {
    MousePointer2,
    MoveRight,
    Square,
    Circle,
    Pencil,
    Type,
    Highlighter,
    Hash,
    EyeOff,
    Crop,
    Crosshair,
  } from '@lucide/svelte';
  import type { AnnotationTool } from '$lib/fabric-canvas.svelte';

  interface Props {
    tool: AnnotationTool;
    onsetTool: (t: AnnotationTool) => void;
  }

  let { tool, onsetTool }: Props = $props();

  const tools: { id: AnnotationTool; icon: typeof MousePointer2; label: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select' },
    { id: 'arrow', icon: MoveRight, label: 'Arrow' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse' },
    { id: 'freehand', icon: Pencil, label: 'Freehand' },
    { id: 'text', icon: Type, label: 'Text' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight' },
    { id: 'callout', icon: Hash, label: 'Callout' },
    { id: 'obfuscation', icon: EyeOff, label: 'Obfuscation' },
    { id: 'crop', icon: Crop, label: 'Crop' },
    { id: 'click-indicator', icon: Crosshair, label: 'Click Indicator' },
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
</div>
