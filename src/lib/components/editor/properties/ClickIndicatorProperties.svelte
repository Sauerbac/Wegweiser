<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox';

  interface Props {
    visible: boolean;
    ontoggle: () => void;
  }

  let { visible, ontoggle }: Props = $props();
</script>

<div class="flex items-center justify-between gap-2">
  <span class="text-xs text-muted-foreground">Show indicator</span>
  <Checkbox checked={visible} onCheckedChange={ontoggle} />
</div>
