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

  interface Props {
    open: boolean;
    onDiscard: () => void;
    onSave: () => void;
  }

  let { open = $bindable(false), onDiscard, onSave }: Props = $props();
</script>

<AlertDialog bind:open>
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
          open = false;
        }}>Cancel</Button
      >
      <Button variant="destructive" onclick={onDiscard}>Discard</Button>
      <Button onclick={onSave}>Save</Button>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
