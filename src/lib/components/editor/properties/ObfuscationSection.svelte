<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { FabricCanvasWrapper, ObfuscationEffect } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const effects: { id: ObfuscationEffect; label: string }[] = [
    { id: 'blur', label: 'Blur' },
    { id: 'pixelate', label: 'Pixelate' },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Effect</p>
  <div class="flex gap-1">
    {#each effects as effect}
      <Button
        variant={fabricCanvas.obfuscationEffect === effect.id ? 'default' : 'outline'}
        size="sm"
        class="flex-1"
        onclick={() => fabricCanvas.setObfuscationEffect(effect.id)}
      >
        {effect.label}
      </Button>
    {/each}
  </div>
</div>

{#if fabricCanvas.obfuscationEffect === 'blur'}
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Radius</p>
    <input
      type="range"
      min="2"
      max="40"
      step="1"
      value={fabricCanvas.blurRadius}
      oninput={(e) => fabricCanvas.setBlurRadius(Number(e.currentTarget.value))}
      class="w-full"
    />
    <div class="flex justify-between">
      <span class="text-[10px] tabular-nums text-muted-foreground">2</span>
      <span class="text-[10px] tabular-nums text-muted-foreground">{fabricCanvas.blurRadius} px</span>
    </div>
  </div>
{:else if fabricCanvas.obfuscationEffect === 'pixelate'}
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Block size</p>
    <input
      type="range"
      min="4"
      max="30"
      step="1"
      value={fabricCanvas.pixelateBlockSize}
      oninput={(e) => fabricCanvas.setPixelateBlockSize(Number(e.currentTarget.value))}
      class="w-full"
    />
    <div class="flex justify-between">
      <span class="text-[10px] tabular-nums text-muted-foreground">4</span>
      <span class="text-[10px] tabular-nums text-muted-foreground">{fabricCanvas.pixelateBlockSize} px</span>
    </div>
  </div>
{/if}
