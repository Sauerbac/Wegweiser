<script lang="ts">
  import { untrack } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from "$lib/components/ui/dropdown-menu";
  import {
    ArrowLeft,
    ChevronDown,
    FileCode,
    FileDown,
    Pencil,
    Redo2,
    Save,
    Undo2,
  } from "@lucide/svelte";
  import ThemeToggleButton from "$lib/components/ThemeToggleButton.svelte";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { getReviewContext } from "$lib/review/context.svelte";

  interface Props {
    onRequestBack: () => void;
    isDirty: boolean;
    editorSessionOpen: boolean;
    exportError: string | null;
  }

  let {
    onRequestBack,
    isDirty,
    editorSessionOpen,
    exportError,
  }: Props = $props();

  const ctx = getReviewContext();
  const { reviewUndo, ec, exportActions } = ctx;

  // ── Session name draft ─────────────────────────────────────────────────────
  // Draft value for the session name input. Synced from the store when the
  // session changes externally, but not reset while the user is typing.

  let sessionNameDraft = $state("");

  // Sync draft from store when the session name changes externally (e.g. after
  // undo/redo or a load). The draft read is wrapped in untrack so that typing
  // in the input does not re-trigger this effect — only external name changes
  // (which update store.session?.name) cause a reset.
  $effect(() => {
    const name = ctx.store.session?.name ?? "";
    untrack(() => {
      if (name !== sessionNameDraft) sessionNameDraft = name;
    });
  });

  async function saveSessionName() {
    const trimmed = sessionNameDraft.trim();
    if (!trimmed || trimmed === ctx.store.session?.name) return;
    try {
      await invoke("rename_session", { name: trimmed });
      reviewUndo.pushBackend();
    } catch (err) {
      console.error("Failed to rename session:", err);
    }
    sessionNameDraft = trimmed;
  }
</script>

<!-- Toolbar: three-zone grid (left | center | right) -->
<div class="grid grid-cols-3 items-center gap-2 border-b px-6 py-4">
  <!-- Left: back button -->
  <div class="flex items-center gap-2">
    <Button variant="outline" size="sm" onclick={onRequestBack}
      ><ArrowLeft />Back</Button
    >
  </div>

  <!-- Center: editable session name -->
  <div class="flex items-center justify-center gap-1.5">
    <Input
      bind:value={sessionNameDraft}
      class="h-8 max-w-64 text-center text-sm font-semibold"
      aria-label="Session name"
      onblur={saveSessionName}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
    <Pencil class="size-4 shrink-0 text-muted-foreground" />
  </div>

  <!-- Right: undo/redo + export buttons + theme toggle -->
  <div class="flex items-center justify-end gap-2">
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="icon-sm"
            aria-label="Undo"
            onclick={() => reviewUndo.undo()}
            disabled={editorSessionOpen || !reviewUndo.canUndo}
          ><Undo2 /></Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Undo<span data-slot="kbd">Ctrl+Z</span></Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="icon-sm"
            aria-label="Redo"
            onclick={() => reviewUndo.redo()}
            disabled={editorSessionOpen || !reviewUndo.canRedo}
          ><Redo2 /></Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Redo<span data-slot="kbd">Ctrl+Y</span></Tooltip.Content>
    </Tooltip.Root>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="outline"
            size="icon-sm"
            aria-label="Save"
            onclick={() => ctx.store.markSaved()}
            disabled={!isDirty}
          ><Save /></Button>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content>Save</Tooltip.Content>
    </Tooltip.Root>
    <DropdownMenu>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" {...props}>
            Export<ChevronDown />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onclick={exportActions.exportMarkdown}>
          <FileDown class="text-foreground" />Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem onclick={exportActions.exportHtml}>
          <FileCode class="text-foreground" />HTML (.html)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ThemeToggleButton />
  </div>
</div>

{#if exportError}
  <div class="border-b bg-destructive/10 px-4 py-2">
    <p class="text-sm text-destructive">
      Export error: {exportError}
    </p>
  </div>
{/if}
