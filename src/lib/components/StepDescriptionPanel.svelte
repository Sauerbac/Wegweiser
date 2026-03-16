<script lang="ts">
  import { Textarea } from '$lib/components/ui/textarea';
  import { parseKeystrokes } from '$lib/utils';

  interface Props {
    descriptionDraft: string;
    keystrokesDraft: string;
    onfocus: () => void;
    onblur: () => void;
    onkeystrokesblur: () => void;
  }

  let {
    descriptionDraft = $bindable(),
    keystrokesDraft = $bindable(),
    onfocus,
    onblur,
    onkeystrokesblur,
  }: Props = $props();

  let keystrokesFocused = $state(false);

  function enterEdit() {
    keystrokesFocused = true;
    onfocus();
  }
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
  <!-- Keystroke section: always rendered; click to edit -->
  <div class="rounded bg-muted px-3 py-2 text-xs">
    <div class="mb-1 font-medium text-muted-foreground">Keystrokes</div>
    {#if keystrokesFocused}
      <Textarea
        bind:value={keystrokesDraft}
        placeholder="Type keystrokes here. To indicate key combos, enclose them in square brackets, e.g. [Ctrl+C]."
        class="resize-none font-mono text-xs"
        rows={2}
        autofocus
        onblur={() => {
          keystrokesFocused = false;
          onblur();
          onkeystrokesblur();
        }}
      />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="min-h-[2.5rem] cursor-text font-mono"
        onclick={enterEdit}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') enterEdit(); }}
        role="textbox"
        tabindex="0"
        aria-label="Edit keystrokes"
        onfocus={enterEdit}
      >
        {#if keystrokesDraft}
          {#each parseKeystrokes(keystrokesDraft) as segment}
            {#if segment.kind === 'shortcut'}
              <kbd class="inline-flex items-center rounded border border-border px-1 py-0.5 font-mono text-xs">{segment.key}</kbd>
            {:else}
              {segment.value}
            {/if}
          {/each}
        {:else}
          <span class="text-muted-foreground/50">Click to add keystrokes and key combos…</span>
        {/if}
      </div>
    {/if}
  </div>
</div>
