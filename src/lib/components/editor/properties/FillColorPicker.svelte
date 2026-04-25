<script lang="ts">
  import { PRESET_COLORS } from '$lib/editor/constants';
  import { Pipette } from '@lucide/svelte';

  interface Props {
    fillEnabled: boolean;
    fillColor: string;
    onfillEnabledChange: (enabled: boolean) => void;
    onfillColorChange: (c: string) => void;
  }

  let { fillEnabled, fillColor, onfillEnabledChange, onfillColorChange }: Props = $props();

  const fillIsTransparent = $derived(!fillEnabled);

  let colorInputRef = $state<HTMLInputElement | null>(null);
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Fill</p>
  <div class="flex flex-wrap gap-1">
    <button
      class="color-swatch relative overflow-hidden border-2 transition-transform hover:scale-110"
      class:border-foreground={fillIsTransparent}
      class:border-transparent={!fillIsTransparent}
      onclick={() => onfillEnabledChange(false)}
      aria-label="No fill"
      title="No fill"
    >
      <span class="checker absolute inset-0"></span>
    </button>
    {#each PRESET_COLORS as c}
      <button
        class="color-swatch border-2 transition-transform hover:scale-110"
        class:border-foreground={fillEnabled && fillColor === c}
        class:border-transparent={!(fillEnabled && fillColor === c)}
        style="background: {c};"
        onclick={() => { onfillEnabledChange(true); onfillColorChange(c); }}
        aria-label="Fill color {c}"
      ></button>
    {/each}
    <button
      class="color-swatch flex items-center justify-center border-2 border-muted-foreground/40 bg-muted transition-transform hover:scale-110"
      onclick={() => colorInputRef?.click()}
      aria-label="Custom fill color"
      title="Custom fill color"
    >
      <Pipette class="size-3 text-muted-foreground" />
    </button>
    <input
      bind:this={colorInputRef}
      type="color"
      value={fillColor}
      onchange={(e) => { onfillEnabledChange(true); onfillColorChange(e.currentTarget.value); }}
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
