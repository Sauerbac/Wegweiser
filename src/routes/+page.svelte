<script lang="ts">
  import { onMount } from 'svelte';
  import Idle from '$lib/components/Idle.svelte';
  import Recording from '$lib/components/Recording.svelte';
  import Review from '$lib/components/Review.svelte';
  import { store } from '$lib/stores/session.svelte';

  onMount(async () => {
    try {
      await store.init();
    } catch (err) {
      console.error('Failed to initialize app store:', err);
    }
  });
</script>

{#if store.recordingState === 'idle'}
  <Idle />
{:else if store.recordingState === 'recording' || store.recordingState === 'paused'}
  <Recording />
{:else if store.recordingState === 'reviewing'}
  <Review />
{/if}
