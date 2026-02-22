<script lang="ts">
  let { children } = $props();
</script>

<svelte:head>
  <style>
    html, body {
      background: transparent !important;
      margin: 0;
      padding: 0;
    }
  </style>
</svelte:head>

{@render children()}
