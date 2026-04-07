<script lang="ts">
  import { PRESET_COLORS } from '$lib/editor/constants';

  interface Props {
    fillEnabled: boolean;
    fillColor: string;
    onfillEnabledChange: (enabled: boolean) => void;
    onfillColorChange: (c: string) => void;
  }

  let { fillEnabled, fillColor, onfillEnabledChange, onfillColorChange }: Props = $props();

  const fillIsTransparent = $derived(!fillEnabled);
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Fill</p>
  <div class="flex flex-wrap gap-1">
    <button
      class="relative size-6 overflow-hidden rounded-full border-2 transition-transform hover:scale-110"
      class:border-foreground={fillIsTransparent}
      class:border-muted-foreground={!fillIsTransparent}
      onclick={() => onfillEnabledChange(false)}
      aria-label="No fill"
      title="No fill"
    >
      <span class="absolute inset-0 bg-white"></span>
      <span
        class="absolute inset-0"
        style="background: linear-gradient(to bottom right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px));"
      ></span>
    </button>
    {#each PRESET_COLORS as c}
      <button
        class="size-6 rounded-full border-2 transition-transform hover:scale-110"
        class:border-foreground={fillEnabled && fillColor === c}
        class:border-transparent={!(fillEnabled && fillColor === c)}
        style="background: {c};"
        onclick={() => { onfillEnabledChange(true); onfillColorChange(c); }}
        aria-label="Fill color {c}"
      ></button>
    {/each}
  </div>
  <input
    type="color"
    value={fillColor}
    onchange={(e) => { onfillEnabledChange(true); onfillColorChange(e.currentTarget.value); }}
    class="h-7 w-full cursor-pointer rounded border bg-transparent"
  />
</div>
