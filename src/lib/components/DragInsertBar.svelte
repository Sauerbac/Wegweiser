<script lang="ts">
  import { createDragReorder } from '$lib/stores/drag-reorder.svelte';

  interface Props {
    /** Which slot this bar represents (0 = before first card, steps.length = after last). */
    insertIndex: number;
    /** The drag-reorder store instance. */
    drag: ReturnType<typeof createDragReorder>;
  }

  let { insertIndex, drag }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="relative flex h-2 items-center"
  ondragenter={(e) => drag.handleInsertBarDragEnter(e, insertIndex)}
  ondragover={(e) => drag.handleInsertBarDragOver(e, insertIndex)}
  ondragleave={undefined}
  ondrop={(e) => drag.handleDrop(e)}
>
  <div
    class="h-0.5 w-full rounded-full {drag.dragInsertIndex === insertIndex && drag.isUsefulInsert(insertIndex)
      ? 'bg-primary'
      : 'bg-transparent'}"
  ></div>
</div>
