<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Progress } from "$lib/components/ui/progress";
  import { Check, ExternalLink } from "@lucide/svelte";

  interface Props {
    exportProgress: number | null;
    exportedPath: string | null;
    onOpen: () => void;
  }

  let { exportProgress, exportedPath, onOpen }: Props = $props();
</script>

<!--
  Use a stable DOM structure to prevent layout shifts that cause window repaints.
  The Check icon and Open button are hidden via `invisible` (visibility: hidden)
  rather than conditionally removed, so the footer height stays constant in all states.
-->
<Check
  class="size-4 shrink-0 text-primary {exportedPath && exportProgress === null
    ? ''
    : 'invisible'}"
/>

{#if exportProgress !== null}
  <span class="shrink-0 text-xs text-muted-foreground">Exporting…</span>
  <Progress value={exportProgress * 100} class="h-1.5 flex-1" />
  <span class="shrink-0 text-xs text-muted-foreground"
    >{Math.round(exportProgress * 100)}%</span
  >
{:else}
  <span
    class="flex-1 truncate text-xs {exportedPath
      ? 'text-card-foreground'
      : 'text-muted-foreground'}"
  >
    {exportedPath ? `Exported to: ${exportedPath}` : ""}
  </span>
{/if}

<div
  class="shrink-0 {exportedPath && exportProgress === null ? '' : 'invisible'}"
>
  <Button variant="outline" size="sm" onclick={onOpen}>
    <ExternalLink />Open
  </Button>
</div>
