<script lang="ts">
  import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "$lib/components/ui/alert-dialog";
  import { Button } from "$lib/components/ui/button";
  import type { createReviewNavigation } from "$lib/stores/review-navigation.svelte";

  interface Props {
    nav: ReturnType<typeof createReviewNavigation>;
    onSaveAndBack: () => void;
  }

  let { nav, onSaveAndBack }: Props = $props();
</script>

<AlertDialog bind:open={nav.showBackDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
      <AlertDialogDescription>
        You have unsaved changes. Do you want to save before going back?
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <Button
        variant="outline"
        onclick={() => {
          nav.showBackDialog = false;
        }}>Cancel</Button
      >
      <Button variant="destructive" onclick={nav.discardAndNavigateBack}>Discard</Button>
      <Button
        onclick={() => {
          nav.saveSession();
          nav.showBackDialog = false;
          onSaveAndBack();
        }}>Save</Button
      >
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
