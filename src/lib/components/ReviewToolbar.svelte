<script lang="ts">
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
  import type { createReviewNavigation } from "$lib/stores/review-navigation.svelte";
  import type { ReviewUndoStore } from "$lib/stores/undo.svelte";
  import type { createExportChoice } from "$lib/stores/export-choice.svelte";

  interface Props {
    nav: ReturnType<typeof createReviewNavigation>;
    reviewUndo: ReviewUndoStore;
    ec: ReturnType<typeof createExportChoice>;
    isDirty: boolean;
    editorSessionOpen: boolean;
    sessionNameDraft: string;
    onsaveSessionName: () => void;
    exportError: string | null;
  }

  let {
    nav,
    reviewUndo,
    ec,
    isDirty,
    editorSessionOpen,
    sessionNameDraft = $bindable(),
    onsaveSessionName,
    exportError,
  }: Props = $props();
</script>

<!-- Toolbar: three-zone grid (left | center | right) -->
<div class="grid grid-cols-3 items-center gap-2 border-b px-4 py-2">
  <!-- Left: back button -->
  <div class="flex items-center">
    <Button variant="outline" size="sm" onclick={nav.requestBack}
      ><ArrowLeft />Back</Button
    >
  </div>

  <!-- Center: editable session name -->
  <div class="flex items-center justify-center gap-1.5">
    <Input
      bind:value={sessionNameDraft}
      class="h-8 max-w-64 text-center text-sm font-semibold"
      aria-label="Session name"
      onblur={onsaveSessionName}
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
    />
    <Pencil class="size-4 shrink-0 text-muted-foreground" />
  </div>

  <!-- Right: undo/redo + export buttons + theme toggle -->
  <div class="flex items-center justify-end gap-2">
    <Button
      variant="outline"
      size="icon"
      aria-label="Undo"
      onclick={() => reviewUndo.undo()}
      disabled={editorSessionOpen || !reviewUndo.canUndo}><Undo2 /></Button
    >
    <Button
      variant="outline"
      size="icon"
      aria-label="Redo"
      onclick={() => reviewUndo.redo()}
      disabled={editorSessionOpen || !reviewUndo.canRedo}><Redo2 /></Button
    >
    <Button
      variant="outline"
      size="icon"
      aria-label="Save"
      onclick={nav.saveSession}
      disabled={!isDirty}><Save /></Button
    >
    <DropdownMenu bind:open={ec.exportOpen}>
      <DropdownMenuTrigger>
        {#snippet child({ props })}
          <Button variant="outline" size="sm" {...props}>
            Export<ChevronDown
              class="size-4 transition-transform duration-200 {ec.exportOpen
                ? 'rotate-180'
                : ''}"
            />
          </Button>
        {/snippet}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onclick={ec.exportMarkdown}>
          <FileDown class="text-foreground" />Markdown (.md)
        </DropdownMenuItem>
        <DropdownMenuItem onclick={ec.exportHtml}>
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
