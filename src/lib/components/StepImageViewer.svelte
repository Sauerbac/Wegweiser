<script lang="ts">
  import { MousePointer2 } from '@lucide/svelte';
  import { monitorLabel, extraTabIndex } from '$lib/utils';
  import type { Step } from '$lib/types';
  import { getReviewContext } from '$lib/stores/review-context.svelte';

  interface Props {
    step: Step;
    stepDisplayNum: number | null;
  }

  let { step, stepDisplayNum }: Props = $props();

  const ctx = getReviewContext();
</script>

{#snippet detailImg(src: string | undefined, alt: string)}
  {#if src}
    <img {src} {alt} class="h-full w-full object-contain" draggable={false} />
  {:else}
    <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
  {/if}
{/snippet}

<div class="mb-3 min-h-0 flex-1 overflow-hidden rounded border bg-muted/20">
  {#if ctx.ec.activeMonitorTab === 'all'}
    {@const imgKey = ctx.imageStore.imageCacheKey(step)}
    <!-- All monitors: stacked scrollable view -->
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div class="flex flex-col gap-1">
        <span class="flex items-center gap-1 text-xs text-muted-foreground">
          <MousePointer2 class="size-4" />
          {monitorLabel(ctx.store.monitors, step.click_monitor_index)}
        </span>
        {#if ctx.imageStore.imageCache[imgKey]}
          <img
            src={ctx.imageStore.imageCache[imgKey]}
            alt="Step {stepDisplayNum}"
            class="max-w-full rounded"
          />
        {:else}
          <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
        {/if}
      </div>
      {#each step.extra_image_paths as _path, i (i)}
        {@const monIdx = step.extra_monitor_indices[i] ?? i}
        {@const key = ctx.imageStore.extraImageKey(step.id, i, step.image_version ?? 0)}
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">
            {monitorLabel(ctx.store.monitors, monIdx)}
          </span>
          {#if ctx.imageStore.extraImageCache[key]}
            <img
              src={ctx.imageStore.extraImageCache[key]}
              alt="Step {stepDisplayNum} — Monitor {monIdx + 1}"
              class="max-w-full rounded"
            />
          {:else}
            <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if ctx.ec.activeMonitorTab === 'primary'}
    {@const imgKey = ctx.imageStore.imageCacheKey(step)}
    <div class="h-full w-full p-2">
      {@render detailImg(ctx.imageStore.imageCache[imgKey], `Step ${stepDisplayNum}`)}
    </div>
  {:else}
    {@const extraIdx = extraTabIndex(ctx.ec.activeMonitorTab)}
    {#if !isNaN(extraIdx)}
      {@const extraKey = ctx.imageStore.extraImageKey(step.id, extraIdx, step.image_version ?? 0)}
      <div class="h-full w-full p-2">
        {@render detailImg(ctx.imageStore.extraImageCache[extraKey], `Step ${stepDisplayNum} — Monitor ${extraIdx + 2}`)}
      </div>
    {/if}
  {/if}
</div>
