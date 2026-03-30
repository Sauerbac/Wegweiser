<script lang="ts">
  import { Button } from '$lib/components/ui/button';

  interface Props {
    value: number;
    onchange: (w: number) => void;
  }

  let { value, onchange }: Props = $props();

  const presets = [
    { label: 'S', value: 2 },
    { label: 'M', value: 4 },
    { label: 'L', value: 8 },
  ];
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Stroke</p>
  <div class="flex gap-1">
    {#each presets as s}
      <Button
        variant={value === s.value ? 'default' : 'outline'}
        size="sm"
        class="flex-1"
        onclick={() => onchange(s.value)}
      >
        {s.label}
      </Button>
    {/each}
  </div>
</div>
