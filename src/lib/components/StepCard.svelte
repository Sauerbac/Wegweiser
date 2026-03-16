<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { AlignLeft, EyeOff, GripVertical, Keyboard } from '@lucide/svelte';
  import type { Step } from '$lib/types';
  import { countKeystrokes } from '$lib/utils';
  import { getReviewContext } from '$lib/stores/review-context.svelte';
  import DragInsertBar from './DragInsertBar.svelte';

  interface Props {
    step: Step;
    idx: number;
    isActive: boolean;
    isChecked: boolean;
    onSelect: (stepId: number) => void;
    onCheck: (stepId: number) => void;
  }

  let {
    step,
    idx,
    isActive,
    isChecked,
    onSelect,
    onCheck,
  }: Props = $props();

  const ctx = getReviewContext();
  const { drag } = ctx;

  const keystrokeCount = $derived(countKeystrokes(step.keystrokes));
  const exportedKeys = $derived(ctx.ec.getExportedImageKeys(step));
  const stepsLength = $derived(ctx.store.session?.steps.length ?? 0);
  const isHighlighted = $derived(ctx.reviewUndo.highlightedStepId === step.id);

  let cardEl: HTMLDivElement | undefined = $state();
</script>

{#snippet thumbImg(src: string | undefined, alt: string, extraClass = '')}
  {#if src}
    <img {src} {alt} class="h-10 w-auto rounded shadow-sm ring-1 ring-border {extraClass}" draggable={false} />
  {:else}
    <div class="h-10 w-16 animate-pulse rounded bg-muted"></div>
  {/if}
{/snippet}

<DragInsertBar insertIndex={idx} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={cardEl}
  role="button"
  tabindex="0"
  class="select-none cursor-pointer rounded-lg border p-3 transition-[border-color] ease-out {isHighlighted ? 'border-primary duration-0' : 'border-border duration-500'} {isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40'} {drag.draggedStepId === step.id ? 'opacity-50' : ''}"
  ondragenter={(e) => drag.handleDragEnter(e)}
  ondragover={(e) => drag.handleDragOver(e, step.id, idx)}
  ondragleave={(e) => drag.handleDragLeave(e)}
  ondrop={(e) => drag.handleDrop(e)}
  onclick={(e) => {
    if ((e.target as HTMLElement).closest('[data-checkbox]')) return;
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) return;
    onSelect(step.id);
  }}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') onSelect(step.id);
  }}
>
  <!-- Inline row: drag handle + checkbox + step number + thumbnails (centered) + indicators -->
  <div class="flex items-center gap-2">
    <!-- Drag handle (hidden in bulk-select mode) -->
    <div
      data-drag-handle
      draggable={!ctx.isBulkSelectActive}
      class="shrink-0 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing {ctx.isBulkSelectActive ? 'invisible' : ''}"
      aria-hidden="true"
      ondragstart={(e) => {
        drag.handleDragStart(e, step.id);
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          e.dataTransfer?.setDragImage(cardEl, e.clientX - rect.left, e.clientY - rect.top);
        }
      }}
      ondragend={drag.handleDragEnd}
    >
      <GripVertical class="size-4" />
    </div>
    <!-- Checkbox -->
    <div data-checkbox class="shrink-0">
      <Checkbox
        checked={isChecked}
        onCheckedChange={() => onCheck(step.id)}
        class="cursor-pointer"
      />
    </div>
    <!-- Step number -->
    <span
      class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-muted-foreground"
    >
      {idx + 1}
    </span>
    <!-- Thumbnails centered in the available space -->
    <div class="flex flex-1 items-center justify-center overflow-hidden">
      {#if step.export_choice.length > 0 && step.export_choice.every((b) => !b)}
        <div
          class="flex h-10 w-16 items-center justify-center rounded border border-dashed border-muted-foreground/25"
          title="Excluded from export"
        >
          <EyeOff class="size-4 text-muted-foreground/50" />
        </div>
      {:else if exportedKeys.length === 1}
        {@const imgKey = exportedKeys[0]}
        {@const src = imgKey.isExtra
          ? ctx.imageStore.extraImageCache[imgKey.cacheKey]
          : ctx.imageStore.imageCache[imgKey.cacheKey]}
        {@render thumbImg(src, `Step ${idx + 1} thumbnail`)}
      {:else if exportedKeys.length > 1}
        <div class="flex items-center">
          {#each exportedKeys as imgKey, cardIdx (imgKey.cacheKey)}
            {@const src = imgKey.isExtra
              ? ctx.imageStore.extraImageCache[imgKey.cacheKey]
              : ctx.imageStore.imageCache[imgKey.cacheKey]}
            <div
              class="relative overflow-hidden rounded shadow-sm ring-1 ring-border {cardIdx > 0 ? '-ml-4' : ''}"
              style="z-index: {exportedKeys.length - cardIdx};"
            >
              {@render thumbImg(src, `Step ${idx + 1} thumbnail ${cardIdx + 1}`, '')}
            </div>
          {/each}
        </div>
      {/if}
    </div>
    <!-- Indicators: description + keystroke icons -->
    <span
      class="shrink-0 {step.description
        ? 'text-foreground'
        : 'text-muted-foreground/25'}"
      title={step.description ?? 'No description'}
    >
      <AlignLeft class="size-4" />
    </span>
    <span
      class="shrink-0 {keystrokeCount > 0
        ? 'text-foreground'
        : 'text-muted-foreground/25'}"
      title={keystrokeCount > 0 ? `${keystrokeCount} keystroke${keystrokeCount !== 1 ? 's' : ''}` : 'No keystrokes'}
    >
      <Keyboard class="size-4" />
    </span>
  </div>
</div>

{#if idx === stepsLength - 1}
  <DragInsertBar insertIndex={stepsLength} />
{/if}
