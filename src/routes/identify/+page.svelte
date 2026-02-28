<script lang="ts">
  import { page } from '$app/state';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { onMount } from 'svelte';

  let monitorIndex = $derived.by(() => {
    const param = page.url.searchParams.get('monitor');
    return param ? parseInt(param, 10) : 0;
  });

  let displayNumber = $derived(monitorIndex + 1);

  onMount(async () => {
    // Show the window only once our content is painted — avoids white flash
    const win = getCurrentWindow();
    await win.show();
  });
</script>

<div class="w-full h-full flex items-center justify-center bg-transparent">
  <div
    class="w-full h-full flex items-center justify-center bg-primary rounded-none text-[2.5rem] font-black text-primary-foreground shadow-2xl tracking-[-0.02em]"
  >
    {displayNumber}
  </div>
</div>
