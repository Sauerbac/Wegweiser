<script lang="ts">
  import { PRESET_COLORS } from '$lib/editor/constants';
  import { Pipette } from '@lucide/svelte';

  interface Props {
    label: string;
    value: string;
    allowTransparent?: boolean;
    onchange: (c: string) => void;
  }

  let { label, value, allowTransparent = false, onchange }: Props = $props();

  const isTransparent = $derived(value === 'transparent');

  let colorInputRef = $state<HTMLInputElement | null>(null);
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">{label}</p>
  <div class="flex flex-wrap gap-1">
    {#if allowTransparent}
      <button
        class="color-swatch relative overflow-hidden border-2 transition-transform hover:scale-110"
        class:border-foreground={isTransparent}
        class:border-transparent={!isTransparent}
        onclick={() => onchange('transparent')}
        aria-label="No color"
        title="No color"
      >
        <span class="checker absolute inset-0"></span>
      </button>
    {/if}
    {#each PRESET_COLORS as c}
      <button
        class="color-swatch border-2 transition-transform hover:scale-110"
        class:border-foreground={value === c}
        class:border-transparent={value !== c}
        style="background: {c};"
        onclick={() => onchange(c)}
        aria-label="Color {c}"
      ></button>
    {/each}
    <button
      class="color-swatch flex items-center justify-center border-2 border-muted-foreground/40 bg-muted transition-transform hover:scale-110"
      onclick={() => colorInputRef?.click()}
      aria-label="Custom color"
      title="Custom color"
    >
      <Pipette class="size-3 text-muted-foreground" />
    </button>
    <input
      bind:this={colorInputRef}
      type="color"
      value={isTransparent ? '#ef4444' : value}
      onchange={(e) => onchange(e.currentTarget.value)}
      class="invisible absolute size-0"
    />
  </div>
</div>

<style>
  .color-swatch {
    width: 1.375rem;
    height: 1.375rem;
    border-radius: 4px;
    flex-shrink: 0;
  }

  /* Checkerboard pattern for "no color" / transparent swatch */
  .checker {
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 6px 6px;
    background-position: 0 0, 0 3px, 3px -3px, -3px 0px;
    background-color: white;
  }
</style>
