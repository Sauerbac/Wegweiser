<script lang="ts">
  import '../layout.css';
  import { ModeWatcher } from 'mode-watcher';

  let { children } = $props();
</script>

<ModeWatcher />

<svelte:head>
  <style>
    html, body {
      background: transparent !important;
      margin: 0;
      padding: 0;
      height: 100%;
    }
  </style>
</svelte:head>

{@render children()}
