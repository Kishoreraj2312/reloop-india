/**
 * "Locate in 3D" (C2): select the component, fold the workspace into its card so the model gets the dock's room, and frame the camera
 * on the component. The camera only moves on this user request. The workspace is folded, not closed, so its filters, scroll and the
 * selected requirement are exactly where they were when the user returns with "Show workspace".
 */

import { explodeBridge } from "../explode/bridge";
import { reuseStore } from "./reuseStore";

/** The viewport is the space the sidebar and dock leave free, so framing only keeps a small margin round the component. */
const INSETS = { rightInset: 24, leftInset: 24, bottomInset: 24, topInset: 24 } as const;

export function locateInModel(id: string, select: (id: string | null) => void, collapse: () => void = () => reuseStore.setCollapsed(true)): void {
  select(id);
  collapse();
  // The dock folds away, so the canvas grows: frame once its new size has reached the camera bridge (it reads the canvas size) and
  // the selection outline exists.
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(() => explodeBridge.focus?.(id, INSETS), 90)));
}
