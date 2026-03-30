<script lang="ts">
  interface Props {
    value: number;
    onchange: (o: number) => void;
  }

  let { value, onchange }: Props = $props();
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Opacity</p>
  <input
    type="range"
    min="0"
    max="1"
    step="0.05"
    {value}
    oninput={(e) => onchange(Number(e.currentTarget.value))}
    class="w-full"
  />
  <p class="text-center text-xs text-muted-foreground">{Math.round(value * 100)}%</p>
</div>
