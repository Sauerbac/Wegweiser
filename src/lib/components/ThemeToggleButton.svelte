<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Moon, Sun } from '@lucide/svelte';
  import { toggleMode } from 'mode-watcher';
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button {...props} onclick={toggleMode} variant="outline" size="icon-sm" aria-label="Toggle theme">
        <Sun class="dark:hidden" />
        <Moon class="hidden dark:block" />
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content>Toggle theme</Tooltip.Content>
</Tooltip.Root>
