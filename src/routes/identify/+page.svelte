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
  <div class="badge">
    {displayNumber}
  </div>
</div>

<style>
  :global(html), :global(body) {
    background: transparent !important;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
  }

  .badge {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--primary);
    border-radius: 0;
    font-size: 2.5rem;
    font-weight: 900;
    color: var(--primary-foreground);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    letter-spacing: -0.02em;
  }
</style>
