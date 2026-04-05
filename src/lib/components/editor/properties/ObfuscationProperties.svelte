<script lang="ts">
  import type { ObfuscationEffect } from '$lib/fabric-canvas.svelte';

  interface Props {
    obfuscationEffect: ObfuscationEffect;
    blurRadius: number;
    pixelateBlockSize: number;
    onobfuscationEffectChange: (effect: ObfuscationEffect) => void;
    onblurRadiusChange: (r: number) => void;
    onpixelateBlockSizeChange: (s: number) => void;
  }

  let {
    obfuscationEffect,
    blurRadius,
    pixelateBlockSize,
    onobfuscationEffectChange,
    onblurRadiusChange,
    onpixelateBlockSizeChange,
  }: Props = $props();

  const effects: { id: ObfuscationEffect; label: string }[] = [
    { id: 'blur', label: 'Blur' },
    { id: 'pixelate', label: 'Pixelate' },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Effect</p>
  <div class="flex flex-col gap-1">
    {#each effects as effect}
      <label class="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="radio"
          name="obfuscation-effect"
          value={effect.id}
          checked={obfuscationEffect === effect.id}
          onchange={() => onobfuscationEffectChange(effect.id)}
          class="accent-primary"
        />
        {effect.label}
      </label>
    {/each}
  </div>
</div>

{#if obfuscationEffect === 'blur'}
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Radius</p>
    <input
      type="range"
      min="2"
      max="40"
      step="1"
      value={blurRadius}
      oninput={(e) => onblurRadiusChange(Number(e.currentTarget.value))}
      class="w-full"
    />
    <p class="text-center text-xs text-muted-foreground">{blurRadius} px</p>
  </div>
{:else if obfuscationEffect === 'pixelate'}
  <div class="space-y-1.5">
    <p class="text-xs font-medium text-muted-foreground">Block size</p>
    <input
      type="range"
      min="4"
      max="30"
      step="1"
      value={pixelateBlockSize}
      oninput={(e) => onpixelateBlockSizeChange(Number(e.currentTarget.value))}
      class="w-full"
    />
    <p class="text-center text-xs text-muted-foreground">{pixelateBlockSize} px</p>
  </div>
{/if}
