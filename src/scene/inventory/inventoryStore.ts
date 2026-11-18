/**
 * Open / closed state of the inventory drawer (B1). It used to be local state of the controls panel; as a tiny store the
 * presentation layer can open the same drawer through the same code path. UI state only: nothing here touches the model.
 */

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export const inventoryUi = {
  get: (): boolean => open,
  set(next: boolean) {
    if (next === open) return;
    open = next;
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useInventoryOpen(): boolean {
  return useSyncExternalStore(inventoryUi.subscribe, inventoryUi.get);
}
