/**
 * The top bar: one tab per workspace (the same toggles the controls panel carried, with the same test ids) and the actions that apply
 * to the whole scene: exploded view, reset view and presentation mode. Opening a workspace here replaces whichever one was showing;
 * clicking the tab that is showing closes it.
 */

import type { KeyboardEvent } from "react";
import { demoStore, useDemo } from "@/demo/demoStore";
import { explodeStore, useExplodeOpen } from "@/scene/explode/explodeStore";
import { Icon } from "./icons";
import { WORKSPACES, openWorkspace, toggleWorkspace, useActiveWorkspace, type WorkspaceDef } from "./workspaces";
import { useWorkspaceCounts } from "./workspaceCounts";

const GROUPS: readonly { id: WorkspaceDef["group"]; label: string }[] = [
  { id: "assess", label: "Assess" },
  { id: "plan", label: "Plan" },
  { id: "circular", label: "Circular" },
];

/** Left / right arrows walk the tabs, as in any tab strip. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".sh-tab")];
  const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]!.focus();
}

interface Props {
  componentCount: number;
  onReset: () => void;
  resetDisabled: boolean;
  onPresent: () => void;
}

export function TopBar({ componentCount, onReset, resetDisabled, onPresent }: Props) {
  const active = useActiveWorkspace();
  const counts = useWorkspaceCounts();
  const explodeOpen = useExplodeOpen();
  const demo = useDemo();
  return (
    <header className="sh-top" data-testid="topbar">
      <nav className="sh-nav" aria-label="Workspaces" onKeyDown={moveFocus}>
        <div className="sh-group sh-group-solo">
          <button type="button" className="sh-tab" data-testid="nav-model" aria-pressed={active.id === null} title="The 3D model on its own" aria-label="Model" onClick={() => openWorkspace(null)}>
            <Icon name="model" />
            <span className="sh-tab-label">Model</span>
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.id} className="sh-group" role="group" aria-label={g.label}>
            {WORKSPACES.filter((w) => w.group === g.id).map((w) => {
              const n = counts[w.id];
              return (
                <button key={w.id} type="button" className="sh-tab" data-testid={w.testid} aria-pressed={active.id === w.id} title={n ? `${w.title} · ${n.label}` : w.title} aria-label={n ? `${w.label}, ${n.label}` : w.label} onClick={() => toggleWorkspace(w.id)}>
                  <Icon name={w.id} />
                  <span className="sh-tab-label">{w.label}</span>
                  {n && (
                    <span className="sh-badge" data-testid={`${w.testid}-count`} aria-hidden="true">
                      {n.count > 999 ? "999+" : n.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sh-actions">
        <span className="sh-count">{componentCount.toLocaleString("en-US")} components</span>
        {!demo.active && (
          <button type="button" className="sh-act" data-testid="load-demo" title="Fill Recovery, Removal, Scenarios, Carbon, Reuse and Tracking with illustrative demo data (your own entries are backed up; Exit demo restores them)" onClick={() => demoStore.load()}>
            <span className="sh-act-label">Load demo data</span>
          </button>
        )}
        <button type="button" className="sh-act" data-testid="explode-toggle" aria-pressed={explodeOpen} title="Pull the model apart by floor, system or assembly (a display transform only)" aria-label="Exploded view" onClick={() => explodeStore.setOpen(!explodeOpen)}>
          <Icon name="explode" />
          <span className="sh-act-label">Exploded view</span>
        </button>
        <button type="button" className="sh-act" data-testid="reset" disabled={resetDisabled} title="Show every layer and floor, clear the selection and any trace" aria-label="Reset view" onClick={onReset}>
          <Icon name="reset" />
          <span className="sh-act-label">Reset view</span>
        </button>
        <button type="button" className="sh-act primary" data-testid="present-toggle" title="Clean canvas, camera presets and a guided demonstration of the real model" aria-label="Present" onClick={onPresent}>
          <Icon name="present" />
          <span className="sh-act-label">Present</span>
        </button>
      </div>
    </header>
  );
}
