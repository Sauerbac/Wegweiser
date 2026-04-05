<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { AppWindow } from '@lucide/svelte';

  interface Props {
    hasWindowRects: boolean;
    onselectWindow: () => void;
  }

  let { hasWindowRects, onselectWindow }: Props = $props();
</script>

{#if hasWindowRects}
  <Button variant="outline" onclick={onselectWindow}>
    <AppWindow />
    Select Window
  </Button>
{/if}
