<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
  import { MousePointer2 } from '@lucide/svelte';
  import { monitorLabel } from '$lib/utils';
  import type { Step } from '$lib/types';
  import { getReviewContext } from '$lib/stores/review-context.svelte';

  interface Props {
    step: Step;
  }

  let { step }: Props = $props();

  const { ec, store } = getReviewContext();
</script>

{#snippet checkboxGuard(tab: string, label: string, isClickMonitor = false)}
  <ToggleGroup.Item value={tab}>
    <div
      onclick={(e) => e.stopPropagation()}
      onpointerdown={(e) => { ec.checkboxInteracting = true; e.stopPropagation(); }}
      onpointerup={() => { ec.checkboxInteracting = false; }}
      role="presentation"
      class="shrink-0"
    >
      <Checkbox
        checked={ec.isExportIncluded(tab)}
        onCheckedChange={() => ec.toggleExportMonitor(tab)}
      />
    </div>
    {#if isClickMonitor}
      <MousePointer2 />
    {/if}
    {label}
  </ToggleGroup.Item>
{/snippet}

<div class="mb-3 flex flex-col items-center gap-1">
  <ToggleGroup.Root
    type="single"
    bind:value={ec.activeMonitorTab}
    onValueChange={(v) => {
      if (ec.checkboxInteracting) {
        // The value change was triggered by a checkbox click — restore
        // the current tab so the preview doesn't switch.
        ec.activeMonitorTab = ec.lastNonEmptyMonitorTab;
        return;
      }
      if (v) {
        ec.lastNonEmptyMonitorTab = v;
      } else {
        // ToggleGroup deselected the active item — restore the previous
        // selection so the preview never goes blank.
        ec.activeMonitorTab = ec.lastNonEmptyMonitorTab;
      }
    }}
    variant="outline"
    spacing={0}
    size="sm"
  >
    {@render checkboxGuard('primary', monitorLabel(store.monitors, step.click_monitor_index), true)}
    {#each step.extra_image_paths as _path, i (i)}
      {@const monIdx = step.extra_monitor_indices[i] ?? i}
      {@render checkboxGuard(`extra_${i}`, monitorLabel(store.monitors, monIdx))}
    {/each}
  </ToggleGroup.Root>
  <p class="text-xs text-muted-foreground">
    Click to preview · checkbox to include in export
  </p>
</div>
