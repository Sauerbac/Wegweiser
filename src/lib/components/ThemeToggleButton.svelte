<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Moon, Sun } from '@lucide/svelte';
  import { toggleMode } from 'mode-watcher';
</script>

<Button onclick={toggleMode} variant="outline" size="icon-sm" aria-label="Toggle theme">
  <Sun class="dark:hidden" />
  <Moon class="hidden dark:block" />
</Button>
