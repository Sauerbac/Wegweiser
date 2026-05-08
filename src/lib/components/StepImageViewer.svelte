<script lang="ts">
  import { MousePointer2 } from '@lucide/svelte';
  import { monitorLabel, extraTabIndex } from '$lib/utils';
  import type { Step } from '$lib/types';
  import { getReviewContext } from '$lib/review/context.svelte';
  import { CLICK_INDICATOR_COLOR } from '$lib/editor/constants';

  interface Props {
    step: Step;
    stepDisplayNum: number | null;
  }

  let { step, stepDisplayNum }: Props = $props();

  const ctx = getReviewContext();

  /**
   * Overlay data for the click indicator on fresh (never-edited) steps.
   * Null when the indicator should not be shown (step already edited, or no click_relative).
   */
  const indicatorOverlay = $derived.by(() => {
    if (!step.click_relative || step.image_version !== 0) return null;
    const monitor = ctx.store.monitors[step.click_monitor_index];
    if (!monitor || monitor.width === 0 || monitor.height === 0) return null;
    return {
      x: step.click_relative.x,
      y: step.click_relative.y,
      w: monitor.width,
      h: monitor.height,
    };
  });
</script>

{#snippet detailImg(src: string | undefined, alt: string, showOverlay = false)}
  {#if src}
    <div class="relative h-full w-full">
      <img {src} {alt} class="h-full w-full object-contain" draggable={false} />
      {#if showOverlay && indicatorOverlay}
        <svg
          viewBox="0 0 {indicatorOverlay.w} {indicatorOverlay.h}"
          preserveAspectRatio="xMidYMid meet"
          class="pointer-events-none absolute inset-0 h-full w-full"
        >
          <circle
            cx={indicatorOverlay.x}
            cy={indicatorOverlay.y}
            r="28"
            fill="{CLICK_INDICATOR_COLOR}2e"
            stroke="{CLICK_INDICATOR_COLOR}73"
            stroke-width="2"
          />
          <circle
            cx={indicatorOverlay.x}
            cy={indicatorOverlay.y}
            r="6"
            fill="{CLICK_INDICATOR_COLOR}d9"
          />
        </svg>
      {/if}
    </div>
  {:else}
    <div class="h-24 w-full animate-pulse rounded bg-muted"></div>
  {/if}
{/snippet}

<div class="mb-3 min-h-0 flex-1 overflow-hidden rounded border bg-muted/20">
  {#if ctx.ec.activeMonitorTab === 'all'}
    <!-- All monitors: stacked scrollable view -->
    <div class="flex h-full flex-col gap-4 overflow-y-auto p-3">
      <div class="flex flex-col gap-1">
        <span class="flex items-center gap-1 text-xs text-muted-foreground">
          <MousePointer2 class="size-4" />
          {monitorLabel(ctx.store.monitors, step.click_monitor_index)}
        </span>
        {#if ctx.imageStore.stepDisplayUri[step.id]}
          <div class="relative">
            <img
              src={ctx.imageStore.stepDisplayUri[step.id]}
              alt="Step {stepDisplayNum}"
              class="max-w-full rounded"
            />
            {#if indicatorOverlay}
              <svg
                viewBox="0 0 {indicatorOverlay.w} {indicatorOverlay.h}"
                preserveAspectRatio="xMidYMid meet"
                class="pointer-events-none absolute inset-0 h-full w-full"
              >
                <circle
                  cx={indicatorOverlay.x}
                  cy={indicatorOverlay.y}
                  r="28"
                  fill="{CLICK_INDICATOR_COLOR}2e"
                  stroke="{CLICK_INDICATOR_COLOR}73"
                  stroke-width="2"
                />
                <circle
                  cx={indicatorOverlay.x}
                  cy={indicatorOverlay.y}
                  r="6"
                  fill="{CLICK_INDICATOR_COLOR}d9"
                />
              </svg>
            {/if}
          </div>
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
    <div class="h-full w-full p-2">
      {@render detailImg(ctx.imageStore.stepDisplayUri[step.id], `Step ${stepDisplayNum}`, true)}
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
