/**
 * createConfirmAction — tiny state helper for "pending item + open dialog" pattern.
 *
 * Replaces the recurring 2–3 `$state` variables (open flag + pending item)
 * used by delete-confirmation dialogs in Review and Idle.
 */
export function createConfirmAction<T = void>() {
  let open = $state(false);
  let pending = $state<T | undefined>(undefined);
  return {
    get open() { return open; },
    set open(v: boolean) { open = v; },
    get pending() { return pending; },
    request(item?: T) { pending = item as T; open = true; },
    reset() { open = false; pending = undefined; },
  };
}
