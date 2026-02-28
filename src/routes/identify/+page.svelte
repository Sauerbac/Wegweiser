<script lang="ts">
  import { page } from '$app/state';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';

  let monitorIndex = $derived.by(() => {
    const param = page.url.searchParams.get('monitor');
    if (!param) return 0;
    const parsed = parseInt(param, 10);
    return isNaN(parsed) ? 0 : parsed;
  });

  let displayNumber = $derived(monitorIndex + 1);

  onMount(async () => {
    // Show the window only once our content is painted — avoids white flash
    const win = getCurrentWindow();
    await win.show();
  });
</script>

<div class="fixed inset-0 flex items-center justify-center bg-background text-foreground text-[2.5rem] font-black tracking-[-0.02em]">
  {displayNumber}
</div>
