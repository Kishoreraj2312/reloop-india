/**
 * Open / closed state of the Recycle workspace. UI state only: the guide is static text, so nothing here touches the model or any
 * module's entries. Same shape as the inventory's store so the shell's one-at-a-time rule drives it like the other workspaces.
 */

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export const recycleUi = {
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

export function useRecycleOpen(): boolean {
  return useSyncExternalStore(recycleUi.subscribe, recycleUi.get);
}
