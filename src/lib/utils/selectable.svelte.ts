/**
 * createSelectableList — reusable Svelte 5 rune-based multi-selection helper.
 *
 * @param getItems  Reactive getter that returns the current list of items.
 *                  Must be called inside a reactive context (derived / effect)
 *                  to track dependencies automatically.
 * @param getId     Extracts the stable, comparable key from each item.
 *
 * Reactivity note: `getItems` is intentionally called lazily inside each
 * derived expression rather than stored once, so that any $state read inside
 * it (e.g. `store.sessions` or `store.session?.steps`) is tracked by Svelte's
 * fine-grained reactivity and `isAllSelected` / `isIndeterminate` update
 * whenever the list changes.
 */
export function createSelectableList<T>(
  getItems: () => T[],
  getId: (item: T) => unknown,
) {
  let selected = $state<Set<unknown>>(new Set());

  const isAllSelected = $derived.by(() => {
    const items = getItems();
    return items.length > 0 && selected.size === items.length;
  });

  const isIndeterminate = $derived.by(() => {
    const items = getItems();
    return selected.size > 0 && selected.size < items.length;
  });

  function toggleOne(id: unknown): void {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    selected = next;
  }

  function toggleAll(): void {
    const items = getItems();
    if (selected.size === items.length) {
      selected = new Set();
    } else {
      selected = new Set(items.map(getId));
    }
  }

  function clear(): void {
    selected = new Set();
  }

  function removeOne(id: unknown): void {
    const next = new Set(selected);
    next.delete(id);
    selected = next;
  }

  return {
    get selected() {
      return selected;
    },
    get isAllSelected() {
      return isAllSelected;
    },
    get isIndeterminate() {
      return isIndeterminate;
    },
    toggleOne,
    toggleAll,
    clear,
    removeOne,
  };
}
