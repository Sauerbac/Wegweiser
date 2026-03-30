<script lang="ts">
  interface Props {
    label: string;
    value: string;
    allowTransparent?: boolean;
    onchange: (c: string) => void;
  }

  let { label, value, allowTransparent = false, onchange }: Props = $props();

  const presetColors = [
    '#ef4444', // red
    '#3b82f6', // blue
    '#22c55e', // green
    '#eab308', // yellow
    '#f97316', // orange
    '#ffffff', // white
    '#000000', // black
  ];

  const isTransparent = $derived(value === 'transparent');
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">{label}</p>
  <div class="flex flex-wrap gap-1">
    {#if allowTransparent}
      <button
        class="relative size-6 overflow-hidden rounded-full border-2 transition-transform hover:scale-110"
        class:border-foreground={isTransparent}
        class:border-muted-foreground={!isTransparent}
        onclick={() => onchange('transparent')}
        aria-label="No color"
        title="No color"
      >
        <span class="absolute inset-0 bg-white"></span>
        <span
          class="absolute inset-0"
          style="background: linear-gradient(to bottom right, transparent calc(50% - 1px), #ef4444 calc(50% - 1px), #ef4444 calc(50% + 1px), transparent calc(50% + 1px));"
        ></span>
      </button>
    {/if}
    {#each presetColors as c}
      <button
        class="size-6 rounded-full border-2 transition-transform hover:scale-110"
        class:border-foreground={value === c}
        class:border-transparent={value !== c}
        style="background: {c};"
        onclick={() => onchange(c)}
        aria-label="Color {c}"
      ></button>
    {/each}
  </div>
  <input
    type="color"
    value={isTransparent ? '#ef4444' : value}
    onchange={(e) => onchange(e.currentTarget.value)}
    class="h-7 w-full cursor-pointer rounded border bg-transparent"
  />
</div>
