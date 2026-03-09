<script lang="ts">
  import { MousePointer2 } from '@lucide/svelte';
  import { monitorLabel, extraTabIndex } from '$lib/utils';
  import type { MonitorInfo, Step } from '$lib/types';

  interface Props {
    step: Step;
    stepDisplayNum: number | null;
    activeMonitorTab: string;
    monitors: MonitorInfo[];
    imageCache: Record<string, string>;
    extraImageCache: Record<string, string>;
    imageCacheKey: (step: Step) => string;
    extraImageKey: (stepId: number, monitorIndex: number, version?: number) => string;
  }

  let {
    step,
    stepDisplayNum,
    activeMonitorTab,
    monitors,
    imageCache,
    extraImageCache,
    imageCacheKey,
    extraImageKey,
  }: Props = $props();
</script>

{#snippet detailImg(src: string | undefined, alt: string)}
  {#if src}
    <img {src} {alt} class="h-full w-full object-contain" draggable={false} />
  {:else}
    <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
  {/if}
{/snippet}

<div class="mb-3 min-h-0 flex-1 overflow-hidden rounded border bg-muted/20">
  {#if activeMonitorTab === 'all'}
    {@const imgKey = imageCacheKey(step)}
    <!-- All monitors: stacked scrollable view -->
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div class="flex flex-col gap-1">
        <span class="flex items-center gap-1 text-xs text-muted-foreground">
          <MousePointer2 class="size-4" />
          {monitorLabel(monitors, step.click_monitor_index)}
        </span>
        {#if imageCache[imgKey]}
          <img
            src={imageCache[imgKey]}
            alt="Step {stepDisplayNum}"
            class="max-w-full rounded"
          />
        {:else}
          <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
        {/if}
      </div>
      {#each step.extra_image_paths as _path, i (i)}
        {@const monIdx = step.extra_monitor_indices[i] ?? i}
        {@const key = extraImageKey(step.id, i, step.image_version ?? 0)}
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">
            {monitorLabel(monitors, monIdx)}
          </span>
          {#if extraImageCache[key]}
            <img
              src={extraImageCache[key]}
              alt="Step {stepDisplayNum} — Monitor {monIdx + 1}"
              class="max-w-full rounded"
            />
          {:else}
            <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if activeMonitorTab === 'primary'}
    {@const imgKey = imageCacheKey(step)}
    <div class="h-full w-full p-2">
      {@render detailImg(imageCache[imgKey], `Step ${stepDisplayNum}`)}
    </div>
  {:else}
    {@const extraIdx = extraTabIndex(activeMonitorTab)}
    {#if !isNaN(extraIdx)}
      {@const extraKey = extraImageKey(step.id, extraIdx, step.image_version ?? 0)}
      <div class="h-full w-full p-2">
        {@render detailImg(extraImageCache[extraKey], `Step ${stepDisplayNum} — Monitor ${extraIdx + 2}`)}
      </div>
    {/if}
  {/if}
</div>
