<script lang="ts">
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  let displayValue = $derived(Math.round(fabricCanvas.highlightOpacity * 100));
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Highlight opacity</p>
  <div class="opacity-track relative w-full rounded-sm">
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={fabricCanvas.highlightOpacity}
      oninput={(e) => fabricCanvas.setHighlightOpacity(Number(e.currentTarget.value))}
      class="opacity-slider relative w-full"
    />
  </div>
  <div class="flex justify-between">
    <span class="text-[10px] tabular-nums text-muted-foreground">0</span>
    <span class="text-[10px] tabular-nums text-muted-foreground">{displayValue}</span>
  </div>
</div>

<style>
  .opacity-track {
    background: linear-gradient(to right, transparent, hsl(var(--foreground)));
    border-radius: 4px;
    height: 6px;
    display: flex;
    align-items: center;
  }

  .opacity-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 6px;
    background: transparent;
    cursor: pointer;
    margin: 0;
    padding: 0;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    border: 2px solid hsl(var(--border));
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .opacity-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    border: 2px solid hsl(var(--border));
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    cursor: pointer;
  }
  .opacity-slider:focus-visible::-webkit-slider-thumb {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
  .opacity-slider::-webkit-slider-runnable-track { background: transparent; }
  .opacity-slider::-moz-range-track { background: transparent; }
</style>
