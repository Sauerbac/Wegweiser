<script lang="ts" generics="T, K extends string | number">
  import type { Snippet } from 'svelte';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import { Trash2 } from '@lucide/svelte';

  let {
    title,
    items,
    selectedIds,
    getKey,
    onToggleAll,
    onDeleteSelected,
    actions,
    row,
  }: {
    title: string;
    items: T[];
    selectedIds: Set<K>;
    getKey: (item: T) => K;
    onToggleAll: () => void;
    onDeleteSelected: () => void;
    actions?: Snippet;
    row: Snippet<[item: T, idx: number]>;
  } = $props();

  // Derive checkbox state internally from items + selectedIds
  let selectAllChecked = $derived(
    items.length > 0 && selectedIds.size === items.length
  );
  let selectAllIndeterminate = $derived(
    selectedIds.size > 0 && selectedIds.size < items.length
  );

  // Count label: "N of M selected" / "All N" / "Select all"
  let countLabel = $derived<string>(
    selectedIds.size > 0 && selectedIds.size < items.length
      ? `${selectedIds.size} of ${items.length} selected`
      : selectedIds.size === items.length && selectedIds.size > 0
        ? `All ${items.length}`
        : 'Select all'
  );
</script>

<!-- Heading row: title left, delete button + optional extra actions right -->
<div class="mb-3 flex items-center justify-between">
  <h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
  <div class="flex items-center gap-2">
    <Button
      variant="destructive"
      size="sm"
      onclick={onDeleteSelected}
      class={selectedIds.size > 0 && items.length > 0 ? '' : 'invisible'}
    >
      <Trash2 />Delete Selected
    </Button>
    {@render actions?.()}
  </div>
</div>

<!-- Select-all row + count label (only when list is non-empty) -->
{#if items.length > 0}
  <div class="mb-2 flex items-center gap-2">
    <Checkbox
      checked={selectAllChecked}
      indeterminate={selectAllIndeterminate}
      onCheckedChange={onToggleAll}
      class="cursor-pointer"
    />
    <span class="text-xs text-muted-foreground">{countLabel}</span>
  </div>
{/if}

<!-- Scrollable row container -->
<div class="flex flex-col gap-2 overflow-y-auto pr-2">
  {#each items as item, idx (getKey(item))}
    {@render row(item, idx)}
  {/each}
</div>
