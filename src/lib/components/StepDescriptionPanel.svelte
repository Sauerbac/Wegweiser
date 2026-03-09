<script lang="ts">
  import { Textarea } from '$lib/components/ui/textarea';
  import { parseKeystrokes } from '$lib/utils';
  import type { Step } from '$lib/types';

  interface Props {
    step: Step;
    descriptionDraft: string;
    onfocus: () => void;
    onblur: () => void;
  }

  let {
    step,
    descriptionDraft = $bindable(),
    onfocus,
    onblur,
  }: Props = $props();
</script>

<div class="flex flex-col gap-2">
  <Textarea
    bind:value={descriptionDraft}
    placeholder="Add a description…"
    class="resize-none text-sm"
    rows={3}
    {onfocus}
    {onblur}
  />
  {#if step.keystrokes}
    <div class="rounded bg-muted px-3 py-2 text-xs font-mono">
      <span class="text-muted-foreground">Typed: </span>
      {#each parseKeystrokes(step.keystrokes) as segment}
        {#if segment.kind === 'shortcut'}
          <kbd
            class="inline-flex items-center rounded border border-border px-1 py-0.5 font-mono text-xs"
            >{segment.key}</kbd
          >
        {:else}
          {segment.value}
        {/if}
      {/each}
    </div>
  {/if}
</div>
