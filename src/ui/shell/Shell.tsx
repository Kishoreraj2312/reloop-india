/**
 * The application frame: top bar, scene sidebar, 3D viewport and workspace dock side by side. The columns share the window, so the
 * viewport is exactly the space that is left: no panel floats over another or over the model, however many things are open. Only
 * one workspace shows at a time (workspaces.ts); the dock is resizable; the sidebar folds to a rail when the model needs the room.
 * The frame holds no data and no scene logic: it lays out what App hands it.
 */

import { useCallback, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MIN_DOCK, MIN_VIEWPORT, layoutStore, shellGeometry, useLayout } from "./layoutStore";
import { useExplodeOpen } from "@/scene/explode/explodeStore";
import { useWindowWidth } from "./useWindowWidth";
import { dockDefault, useActiveWorkspace, type WorkspaceId } from "./workspaces";
import "./shell.css";

interface Props {
  /** The top bar. */
  top: ReactNode;
  /** The scene sidebar; told whether it is folded to its rail. */
  sidebar: (folded: boolean) => ReactNode;
  /** A workspace's content for the dock. */
  workspace: (id: WorkspaceId) => ReactNode;
  /** The 3D canvas and whatever overlays it (the presentation layer, hints). It fills the middle column. */
  children: ReactNode;
  /** Presentation mode: the top bar and sidebar step out of the way; a workspace opened from the presentation bar still docks. */
  presenting?: boolean;
}

export function Shell({ top, sidebar, workspace, children, presenting = false }: Props) {
  const layout = useLayout();
  const active = useActiveWorkspace();
  const windowWidth = useWindowWidth();
  const [dragging, setDragging] = useState(false);

  const docked = active.id !== null && !active.folded;
  // the exploded view's controls live in the sidebar: while it runs, the dock gives way rather than the sidebar folding
  const explodeOpen = useExplodeOpen();
  const mode = explodeOpen && layout.leftMode === "auto" ? "open" : layout.leftMode;
  const geo = shellGeometry(windowWidth, mode, docked ? dockDefault(active.id!) : null, layout.dockWidth, !presenting);
  const leftWidth = presenting ? 0 : geo.leftWidth;

  const clampDock = useCallback((w: number) => Math.round(Math.max(MIN_DOCK, Math.min(w, windowWidth - geo.leftWidth - MIN_VIEWPORT))), [windowWidth, geo.leftWidth]);

  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = geo.dockWidth;
    setDragging(true);
    const move = (ev: PointerEvent) => layoutStore.setDockWidth(clampDock(startW + (startX - ev.clientX)), false);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setDragging(false);
      layoutStore.commit();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const onResizeKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 80 : 24;
    if (e.key === "ArrowLeft") (e.preventDefault(), layoutStore.setDockWidth(clampDock(geo.dockWidth + step)));
    else if (e.key === "ArrowRight") (e.preventDefault(), layoutStore.setDockWidth(clampDock(geo.dockWidth - step)));
    else if (e.key === "Home") (e.preventDefault(), layoutStore.setDockWidth(null));
  };

  return (
    <div className="sh-root" data-testid="shell" data-presenting={presenting ? "true" : "false"} data-dragging={dragging ? "true" : "false"} style={{ ["--sh-left" as string]: `${leftWidth}px` }}>
      {!presenting && top}
      <div className="sh-main">
        {!presenting && (
          <aside className="sh-left" data-testid="controls" data-folded={geo.leftFolded ? "true" : "false"} style={{ width: geo.leftWidth }}>
            {sidebar(geo.leftFolded)}
          </aside>
        )}
        <main className="sh-view" data-testid="viewport">
          {children}
          {!presenting && geo.viewportWidth >= 600 && (
            <div className="sh-hud" aria-hidden="true">
              Drag to orbit · scroll to zoom · right-drag to pan · click a component to inspect it
            </div>
          )}
        </main>
        {active.id !== null && (
          <aside className="sh-dock" data-testid="dock" data-workspace={active.id} data-folded={active.folded ? "true" : "false"} style={{ width: docked ? geo.dockWidth : 0, borderLeftWidth: docked ? 1 : 0 }}>
            {docked && (
              <div
                className="sh-resize"
                data-testid="dock-resize"
                data-drag={dragging ? "true" : "false"}
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize the workspace (arrow keys; Home resets)"
                aria-valuenow={geo.dockWidth}
                tabIndex={0}
                onPointerDown={startDrag}
                onDoubleClick={() => layoutStore.setDockWidth(null)}
                onKeyDown={onResizeKey}
              />
            )}
            {workspace(active.id)}
          </aside>
        )}
      </div>
    </div>
  );
}
