/**
 * The scene sidebar: what is shown (Layers, Floors), how it is shown (Exploded view) and what is picked (Selection: the inspector
 * and the material passport). One tab at a time, so the controls never stack into a long list and never cover the model; the sidebar
 * folds to a rail when the model needs the room. The tab follows what the user just did: picking a component shows its details,
 * starting the exploded view shows its controls.
 */

import { useEffect, useRef, useState } from "react";
import { ComponentInspector } from "@/scene/ComponentInspector";
import { PassportPanel } from "@/scene/passport/PassportPanel";
import { ExplodePanel } from "@/scene/explode/ExplodePanel";
import { explodeStore, useExplodeOpen } from "@/scene/explode/explodeStore";
import type { ViewState } from "@/scene/viewState";
import { FloorsPanel, LayersPanel } from "./SceneControls";
import { Icon, type IconName } from "./icons";
import { LEFT_TABS, layoutStore, useLayout, type LeftTab } from "./layoutStore";

const TAB_LABEL: Record<LeftTab, string> = { layers: "Layers", floors: "Floors", explode: "Explode", selection: "Selection" };
const TAB_ICON: Record<LeftTab, IconName> = { layers: "layers", floors: "floors", explode: "explode", selection: "selection" };

interface Props {
  view: ViewState;
  onChange: (v: ViewState) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTrace: (ids: string[]) => void;
  traced: number;
  /** Folded to the rail (the window is tight, or the user folded it). */
  folded: boolean;
}

type Sub = "details" | "passport";

export function SceneSidebar({ view, onChange, selectedId, onSelect, onTrace, traced, folded }: Props) {
  const { tab } = useLayout();
  const explodeOpen = useExplodeOpen();
  const [sub, setSub] = useState<Sub>("details");
  const foldedRef = useRef(folded);
  foldedRef.current = folded;
  const subShown: Sub = selectedId ? sub : "details";

  // Follow the user: a new selection shows its details (unless the exploded view is up: its controls already read the selection),
  // and starting the exploded view shows its controls.
  useEffect(() => {
    if (selectedId && layoutStore.get().tab !== "explode") layoutStore.setTab("selection");
  }, [selectedId]);
  const wasExploding = useRef(explodeOpen);
  useEffect(() => {
    if (explodeOpen) layoutStore.setTab("explode");
    else if (wasExploding.current && layoutStore.get().tab === "explode") layoutStore.setTab(selectedId ? "selection" : "layers"); // closed (from the top bar or its own ✕): leave the now-empty tab
    wasExploding.current = explodeOpen;
  }, [explodeOpen]);

  // test seam (dev only): make the pane that holds an element visible, as a click on its tab would
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as { __shell?: unknown }).__shell = {
      reveal(selector: string): boolean {
        const el = document.querySelector(selector);
        const pane = el?.closest<HTMLElement>("[data-ltab]");
        if (!pane) return !!el;
        if (foldedRef.current) layoutStore.setLeftMode("open");
        layoutStore.setTab(pane.dataset.ltab as LeftTab);
        const subPane = el?.closest<HTMLElement>("[data-sub]");
        if (subPane) setSub(subPane.dataset.sub as Sub);
        return true;
      },
    };
    return () => {
      delete (window as { __shell?: unknown }).__shell;
    };
  }, []);

  const dot = (t: LeftTab) => t === "selection" && selectedId !== null;

  return (
    <>
      <nav className="sh-rail" aria-label="Scene tools" data-testid="sidebar-rail" hidden={!folded}>
        <button type="button" className="sh-rail-btn" data-testid="sidebar-expand" title="Show the sidebar" aria-label="Show the sidebar" onClick={() => layoutStore.setLeftMode("open")}>
          <Icon name="chevronRight" />
        </button>
        <span className="sh-rail-sep" />
        {LEFT_TABS.map((t) => (
          <button
            key={t}
            type="button"
            className="sh-rail-btn"
            data-testid={`rail-${t}`}
            title={TAB_LABEL[t]}
            aria-label={TAB_LABEL[t]}
            aria-pressed={tab === t}
            onClick={() => {
              layoutStore.setTab(t);
              layoutStore.setLeftMode("open");
            }}
          >
            <Icon name={TAB_ICON[t]} />
            {dot(t) && <span className="sh-dot" />}
          </button>
        ))}
      </nav>
      <div className="sh-ltabs" role="tablist" aria-label="Scene tools" hidden={folded}>
        {LEFT_TABS.map((t) => (
          <button key={t} type="button" role="tab" className="sh-ltab" data-testid={`ltab-${t}`} aria-selected={tab === t} onClick={() => layoutStore.setTab(t)}>
            {TAB_LABEL[t]}
            {dot(t) && <span className="sh-dot" aria-label="a component is selected" />}
          </button>
        ))}
        <button type="button" className="sh-iconbtn" data-testid="sidebar-collapse" title="Fold the sidebar" aria-label="Fold the sidebar" onClick={() => layoutStore.setLeftMode("closed")}>
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div className="sh-lbody" hidden={folded}>
        <div className="sh-pane" data-ltab="layers" hidden={tab !== "layers"}>
          <LayersPanel view={view} onChange={onChange} />
        </div>
        <div className="sh-pane" data-ltab="floors" hidden={tab !== "floors"}>
          <FloorsPanel view={view} onChange={onChange} />
        </div>
        <div className="sh-pane" data-ltab="explode" hidden={tab !== "explode"}>
          {explodeOpen ? (
            <ExplodePanel view={view} onViewChange={onChange} selectedId={selectedId} onSelect={onSelect} />
          ) : (
            <div className="sh-empty sh-explode-off">
              <b>Exploded view</b>
              Pull the model apart by floor, by system or by assembly to see how it is built. It is a display transform only: the model, quantities, assessments and plans are unchanged.
              <div>
                <button type="button" className="rm-btn accent" data-testid="explode-start" onClick={() => explodeStore.setOpen(true)}>
                  Start exploded view
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="sh-pane" data-ltab="selection" hidden={tab !== "selection"}>
          <div className="sh-seg" role="tablist" aria-label="Selection views">
            <button type="button" role="tab" data-testid="sel-details" aria-selected={subShown === "details"} onClick={() => setSub("details")}>
              Details
            </button>
            <button type="button" role="tab" data-testid="sel-passport" aria-selected={subShown === "passport"} disabled={!selectedId} title={selectedId ? "Material passport of the selected component" : "Select a component to see its material passport"} onClick={() => setSub("passport")}>
              Passport
            </button>
          </div>
          <div data-sub="details" hidden={subShown !== "details"}>
            <ComponentInspector selectedId={selectedId} onSelect={onSelect} onTrace={onTrace} traced={traced} className="sh-bare" style={{ position: "static" }} />
          </div>
          <div data-sub="passport" hidden={subShown !== "passport"}>
            {selectedId && <PassportPanel selectedId={selectedId} onSelect={onSelect} className="sh-bare" />}
          </div>
        </div>
      </div>
    </>
  );
}
