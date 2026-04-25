<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
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

  const tools: { id: AnnotationTool; icon: typeof MousePointer2; label: string; shortcut?: string }[] = [
    { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
    { id: 'arrow', icon: MoveRight, label: 'Arrow', shortcut: 'A' },
    { id: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'R' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse', shortcut: 'E' },
    { id: 'freehand', icon: Pencil, label: 'Freehand', shortcut: 'P' },
    { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
    { id: 'highlight', icon: Highlighter, label: 'Highlight', shortcut: 'H' },
    { id: 'callout', icon: Hash, label: 'Callout' },
    { id: 'obfuscation', icon: EyeOff, label: 'Obfuscation', shortcut: 'O' },
    { id: 'crop', icon: Crop, label: 'Crop', shortcut: 'C' },
    { id: 'click-indicator', icon: Crosshair, label: 'Click Indicator' },
  ];
</script>

<div class="flex shrink-0 flex-col items-center gap-1 border-r bg-muted/30 p-1.5">
  {#each tools as t}
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant={tool === t.id ? 'default' : 'ghost'}
            size="icon-sm"
            aria-label={t.label}
            onclick={() => onsetTool(t.id)}
          >
            <t.icon />
          </Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content side="right">
        {t.label}
        {#if t.shortcut}
          <span data-slot="kbd">{t.shortcut}</span>
        {/if}
      </Tooltip.Content>
    </Tooltip.Root>
  {/each}
</div>
