<script lang="ts">
  import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
  } from "$lib/components/ui/alert-dialog";
  import { DESTRUCTIVE_DIALOG_ACTION_CLASS } from "$lib/utils";

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
      <AlertDialogCancel onclick={oncancel}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onclick={() => {
          open = false;
          onconfirm();
        }}
        class={DESTRUCTIVE_DIALOG_ACTION_CLASS}
      >Delete</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
