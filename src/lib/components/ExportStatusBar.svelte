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

{#if exportProgress !== null}
  <span class="shrink-0 text-xs text-muted-foreground">Exporting…</span>
  <Progress value={exportProgress * 100} class="h-1.5 flex-1" />
  <span class="shrink-0 text-xs text-muted-foreground"
    >{Math.round(exportProgress * 100)}%</span
  >
{:else}
  {#if exportedPath}
    <Check class="size-4 shrink-0 text-primary" />
  {/if}
  <span
    class="flex-1 truncate text-xs {exportedPath
      ? 'text-card-foreground'
      : 'text-muted-foreground'}"
  >
    {exportedPath ? `Exported to: ${exportedPath}` : "Ready"}
  </span>
  {#if exportedPath}
    <Button variant="outline" size="sm" onclick={onOpen} class="shrink-0">
      <ExternalLink />Open
    </Button>
  {/if}
{/if}
