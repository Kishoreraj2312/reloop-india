import { shellGeometry, useLayout } from "./layoutStore";
import { useWindowWidth } from "./useWindowWidth";
import { dockDefault, useActiveWorkspace } from "./workspaces";

/** The width the dock gives the workspace showing now (0 when none is, or when it is folded into its card). */
export function useDockWidth(): number {
  const layout = useLayout();
  const active = useActiveWorkspace();
  const windowWidth = useWindowWidth();
  const docked = active.id !== null && !active.folded;
  return shellGeometry(windowWidth, layout.leftMode, docked ? dockDefault(active.id!) : null, layout.dockWidth).dockWidth;
}
