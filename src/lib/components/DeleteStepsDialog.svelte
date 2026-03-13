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
    /** Number of steps to delete. 1 = single-step mode, >1 = bulk mode. */
    count: number;
    open: boolean;
    onconfirm: () => void;
    oncancel?: () => void;
  }

  let { count, open = $bindable(), onconfirm, oncancel }: Props = $props();
</script>

<AlertDialog bind:open>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{count > 1 ? `Delete ${count} steps?` : "Delete step?"}</AlertDialogTitle>
      <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <Button
        variant="outline"
        onclick={() => {
          open = false;
          oncancel?.();
        }}>Cancel</Button
      >
      <Button
        variant="destructive"
        onclick={() => {
          open = false;
          onconfirm();
        }}>Delete</Button
      >
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
