/**
 * Exploded-view panel (A4): the Explode tab of the scene sidebar. Every control changes the real model
 * display; a control that cannot apply is disabled and says why in one line. The explosion is a display transform:
 * nothing here edits records, quantities, assessments or removal plans.
 */

import { useMemo, useState, type CSSProperties } from "react";
import type { BuildingSystem } from "@/building/types";
import {
  EXPLODE_MODES,
  LAYOUT_LABELS,
  MODE_LABELS,
  SYSTEM_LAYOUTS,
  floorKeyOf,
  type Cell,
  type ExplodeMode,
  type SystemLayout,
  ASSEMBLY_RULES,
  STRUCTURE_REASON,
} from "@/engine/explode";
import { PALETTE } from "../inventory/ui";
import { CATEGORY_LAYER, LAYERS, groupVisibility, type LayerKey, type ViewState } from "../viewState";
import { ARCH_CATEGORIES } from "@/building/structure";
import { explodeBridge } from "./bridge";
import { explodeStore, useExplode } from "./explodeStore";
import { getExplodeModel } from "./model";
import { btn, btnAccent, btnOff, field, linkBtn } from "../removal/ui";

const SYSTEM_LABEL: Record<BuildingSystem, string> = { structure: "Structure", architecture: "Architecture", plumbing: "Plumbing", electrical: "Electrical" };
const ARCH_LAYERS = new Set<LayerKey>(Object.values(CATEGORY_LAYER));
const muted: CSSProperties = { color: PALETTE.muted, fontSize: 11 };
const label: CSSProperties = { ...muted, flexBasis: "100%", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" };

function Slider({ testid, value, min, max, step, disabled, onChange, width = 150 }: { testid: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (v: number) => void; width?: number }) {
  return <input data-testid={testid} type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: `1 1 ${width}px`, minWidth: 80, maxWidth: "100%", accentColor: PALETTE.accent, opacity: disabled ? 0.4 : 1 }} />;
}

/** What the model says about the selected component and decomposition. */
function explain(id: string | null): { assembly: string | null; supported: boolean; line: string; members?: number; type?: string } {
  const m = getExplodeModel();
  if (!id) return { assembly: null, supported: false, line: "Select a component to see whether its assembly can be decomposed." };
  const rec = m.byId.get(id);
  if (!rec) return { assembly: null, supported: false, line: `${id} is not a component of this model.` };
  const asmId = rec.geometry.kind === "group" ? rec.id : rec.parentId !== undefined && m.byId.get(rec.parentId)?.geometry.kind === "group" ? rec.parentId : null;
  if (asmId === null) return { assembly: null, supported: false, line: rec.system === "structure" ? STRUCTURE_REASON : "not contained in an assembly record" };
  const asm = m.byId.get(asmId)!;
  const idx = m.assemblyIndex.get(asmId);
  if (idx !== undefined) {
    const plan = m.assemblies[idx]!;
    return { assembly: asmId, supported: true, members: plan.members.length, type: asm.componentType, line: `${plan.layerCount} ${plan.strategy === "layers" ? "layers" : "directions"} · ${ASSEMBLY_RULES[asm.componentType]?.why ?? ""}` };
  }
  const u = m.unsupported.find((x) => x.id === asmId);
  return { assembly: asmId, supported: false, members: m.assemblyMembers.get(asmId)?.length, type: asm.componentType, line: u?.reason ?? "unsupported" };
}

export function ExplodePanel({ view, onViewChange, selectedId, onSelect }: { view: ViewState; onViewChange: (v: ViewState) => void; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const s = useExplode();
  const model = useMemo(() => getExplodeModel(), []);
  const [more, setMore] = useState(false);
  /** The panel lives in the sidebar, beside the viewport, so nothing covers the canvas: framing only keeps a small margin. */
  const inset = () => ({ bottomInset: 16, rightInset: 16, leftInset: 16, topInset: 16 });
  const p = s.params;
  const t = explodeStore.liveT();
  const mode = p.mode;
  const exploding = mode !== "assembled";
  const usesFloors = mode === "floors" || mode === "cinematic";
  const usesSystems = mode === "systems" || mode === "cinematic";
  const usesAssembly = mode === "assembly" || mode === "cinematic";
  const sel = useMemo(() => explain(selectedId), [selectedId]);
  const focus = p.focus ? explain(p.focus) : null;
  const focusPlan = p.focus ? model.assemblies[model.assemblyIndex.get(p.focus) ?? -1] : undefined;
  const sectionActive = useMemo(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("view") === "section" || q.get("view") === "stair" || q.has("clip");
  }, []);

  const needFocus = mode === "assembly" && !focusPlan;
  const traceOff = !usesAssembly || (!focusPlan && !sel.supported);
  const scrubOff = !exploding || needFocus;
  const scrubWhy = !exploding ? "Choose Floors, Systems, Assembly focus or Cinematic to explode." : needFocus ? "Choose an assembly first: select one of its members, then “Focus this assembly”." : "";
  const noGrouping = (why: string, used: boolean) => (!exploding ? "Choose a mode first." : used ? "" : why);

  const visible = (c: Cell): boolean => {
    const vis = groupVisibility(view, ARCH_CATEGORIES);
    return vis.get(`Floor_${c.floor}`) !== false && vis.get(`${c.floor}_${c.system}`) !== false && vis.get(`${c.floor}_${c.system}_${c.category}`) !== false;
  };

  const isolateFloor = () => {
    const rec = selectedId ? model.byId.get(selectedId) : undefined;
    if (rec) onViewChange({ ...view, isolate: floorKeyOf(rec.floor) });
  };
  const isolateSystem = () => {
    const rec = selectedId ? model.byId.get(selectedId) : undefined;
    if (!rec) return;
    const on = (l: LayerKey) => (rec.system === "architecture" ? ARCH_LAYERS.has(l) : l === rec.system || (rec.system === "structure" && l === "structure"));
    onViewChange({ ...view, layers: Object.fromEntries(LAYERS.map((l) => [l, on(l)])) as ViewState["layers"] });
  };
  const showAll = () => onViewChange({ ...view, isolate: null, layers: Object.fromEntries(LAYERS.map((l) => [l, true])) as ViewState["layers"] });
  const isolated = view.isolate !== null || LAYERS.some((l) => view.layers[l] === false);

  const unsupportedByType = useMemo(() => {
    const m = new Map<string, { type: string; count: number; reason: string }>();
    for (const u of model.unsupported) {
      const k = `${u.type}|${u.reason}`;
      const e = m.get(k) ?? m.set(k, { type: u.type, count: 0, reason: u.reason }).get(k)!;
      e.count++;
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [model]);

  return (
    <div data-testid="explode-panel" className="rm-panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ ...row, justifyContent: "space-between", flexWrap: "nowrap" }}>
        <div>
          <b style={{ fontSize: 13 }}>Exploded view</b>{" "}
          <span style={muted}>a display transform: model, quantities, assessments and plans are unchanged</span>
        </div>
        <button type="button" data-testid="explode-close" onClick={() => explodeStore.setOpen(false)} title="Close: back to the assembled view" style={{ font: "inherit", fontSize: 15, border: "none", background: "none", cursor: "pointer", color: PALETTE.muted }}>
          ✕
        </button>
      </div>

      <div style={row} role="group" aria-label="Mode">
        {EXPLODE_MODES.map((m: ExplodeMode) => (
          <button key={m} type="button" data-testid={`explode-mode-${m}`} aria-pressed={mode === m} style={mode === m ? btnAccent : btn} onClick={() => explodeStore.setMode(m)}>
            {MODE_LABELS[m]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" data-testid="explode-reset" style={btn} onClick={() => explodeStore.reset()} title="Back to assembled with default distances">
          Reset
        </button>
      </div>

      <div style={row}>
        <span style={label}>Progress</span>
        <Slider testid="explode-progress" value={Math.round(t * 1000)} min={0} max={1000} step={1} disabled={scrubOff} onChange={(v) => explodeStore.setT(v / 1000)} width={260} />
        <b data-testid="explode-progress-label" style={{ minWidth: 38, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(t * 100)}%
        </b>
        <button type="button" data-testid="explode-play" style={scrubOff ? btnOff : s.playing ? btnAccent : btn} disabled={scrubOff} onClick={() => explodeStore.togglePlay()} title={scrubWhy || "Animate the progress (it reverses when you play from the end)"}>
          {s.playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <label style={{ display: "flex", gap: 4, alignItems: "center", cursor: scrubOff ? "not-allowed" : "pointer", opacity: scrubOff ? 0.45 : 1 }}>
          <input type="checkbox" data-testid="explode-loop" checked={s.loop} disabled={scrubOff} onChange={(e) => explodeStore.setLoop(e.target.checked)} />
          loop
        </label>
        {(["assembled", "partial", "full"] as const).map((pr) => (
          <button key={pr} type="button" data-testid={`explode-preset-${pr}`} style={scrubOff ? btnOff : btn} disabled={scrubOff} onClick={() => explodeStore.glidePreset(pr)} title="Moves smoothly (about a second); the progress slider and Play still act immediately">
            {pr[0]!.toUpperCase() + pr.slice(1)}
          </button>
        ))}
      </div>
      {scrubWhy && (
        <div data-testid="explode-why" style={muted}>
          {scrubWhy}
        </div>
      )}

      <div style={row}>
        <span style={label}>Distances</span>
        {(
          [
            ["floor", "Floor gap", p.floorGap, 0, 12, 0.5, usesFloors, "Not used in this mode.", explodeStore.setFloorGap, "m"],
            ["system", "System gap", p.systemGap, 0, 30, 1, usesSystems, "Not used in this mode.", explodeStore.setSystemGap, "m"],
            ["assembly", "Layer gap", p.assemblyGap, 0, 1, 0.05, usesAssembly, "Not used in this mode.", explodeStore.setAssemblyGap, "m"],
          ] as const
        ).map(([key, name, val, lo, hi, step, used, why, set, unit]) => {
          const off = !exploding || !used;
          return (
            <label key={key} title={noGrouping(why, used)} style={{ display: "flex", gap: 4, alignItems: "center", opacity: off ? 0.45 : 1 }}>
              <span style={muted}>{name}</span>
              <Slider testid={`explode-${key}-gap`} value={val} min={lo} max={hi} step={step} disabled={off} onChange={(v) => set(v)} width={92} />
              <span style={{ minWidth: 42, fontVariantNumeric: "tabular-nums" }}>
                {val.toFixed(key === "assembly" ? 2 : 1)} {unit}
              </span>
            </label>
          );
        })}
      </div>

      <div style={row}>
        <span style={label}>Systems</span>
        <select data-testid="explode-layout" style={{ ...field, opacity: !exploding || !usesSystems ? 0.45 : 1 }} value={p.layout} disabled={!exploding || !usesSystems} title={noGrouping("Not used in this mode.", usesSystems)} onChange={(e) => explodeStore.setLayout(e.target.value as SystemLayout)}>
          {SYSTEM_LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {LAYOUT_LABELS[l]}
            </option>
          ))}
        </select>
        {explodeStore.config.systemOrder.map((sys) => {
          const count = model.cells.filter((c) => c.system === sys).reduce((n, c) => n + c.count, 0);
          const absent = count === 0;
          const off = !exploding || !usesSystems || absent;
          return (
            <label key={sys} style={{ display: "flex", gap: 3, alignItems: "center", opacity: off ? 0.45 : 1 }} title={absent ? `No ${sys} components in this model: nothing to separate.` : `${count.toLocaleString("en-US")} components`}>
              <input type="checkbox" data-testid={`explode-system-${sys}`} checked={!absent && p.systems.includes(sys)} disabled={off} onChange={() => explodeStore.toggleSystem(sys)} />
              {SYSTEM_LABEL[sys]}
            </label>
          );
        })}
      </div>

      <div style={{ ...row, alignItems: "flex-start" }} data-testid="explode-assembly">
        <span style={label}>Assembly</span>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div data-testid="explode-selection-note" style={{ color: sel.supported ? PALETTE.text : PALETTE.muted }}>
            {selectedId ? (
              <>
                <b style={{ wordBreak: "break-all" }}>{sel.assembly ?? selectedId}</b>
                {sel.type ? <span style={muted}> · {sel.type.replace(/_/g, " ")}</span> : null}
                {sel.members !== undefined ? <span style={muted}> · {sel.members} members</span> : null} · {sel.supported ? "can be decomposed: " : "not decomposed: "}
                {sel.line}
              </>
            ) : (
              sel.line
            )}
          </div>
          <div style={{ ...row, marginTop: 3 }}>
            <button
              type="button"
              data-testid="explode-focus-assembly"
              style={sel.supported ? btn : btnOff}
              disabled={!sel.supported}
              title={sel.supported ? "Decompose this assembly and inspect its members" : sel.line}
              onClick={() => {
                explodeStore.setFocus(sel.assembly);
                if (explodeStore.get().params.mode !== "assembly" && explodeStore.get().params.mode !== "cinematic") explodeStore.setMode("assembly");
              }}
            >
              Focus this assembly
            </button>
            {p.focus && (
              <button type="button" data-testid="explode-frame-assembly" style={btn} title="Frame the focused assembly where it is displayed now" onClick={() => p.focus && explodeBridge.focus?.(p.focus, inset())}>
                Frame assembly
              </button>
            )}
            {p.focus && (
              <span data-testid="explode-focus" style={muted}>
                focused: <b style={{ color: PALETTE.text, wordBreak: "break-all" }}>{p.focus}</b> ({focus?.type?.replace(/_/g, " ")}, {focusPlan?.members.length ?? 0} members){" "}
                <button type="button" data-testid="explode-focus-clear" style={{ ...linkBtn, fontSize: 11 }} onClick={() => explodeStore.setFocus(null)}>
                  clear
                </button>
              </span>
            )}
          </div>
          {focusPlan && (
            <details style={{ marginTop: 2 }}>
              <summary style={{ ...muted, cursor: "pointer" }}>members ({focusPlan.members.length}) · {focusPlan.axisSource}</summary>
              <div data-testid="explode-members" style={{ maxHeight: 96, overflowY: "auto", fontSize: 11, marginTop: 2 }}>
                {focusPlan.members.slice(0, 200).map((id) => (
                  <button key={id} type="button" onClick={() => onSelect(id)} style={{ ...linkBtn, display: "block", wordBreak: "break-all", color: selectedId === id ? PALETTE.accent : PALETTE.text }}>
                    {id}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>

      <div style={row}>
        <span style={label}>View</span>
        <button type="button" data-testid="explode-fit" style={btn} onClick={() => explodeBridge.fit?.(visible, inset())} title="Frame the visible exploded model (keeps the view direction)">
          Fit to exploded view
        </button>
        <button type="button" data-testid="explode-focus-selection" style={selectedId ? btn : btnOff} disabled={!selectedId} title={selectedId ? "Frame the selection where it is displayed now" : "Select a component first."} onClick={() => selectedId && explodeBridge.focus?.(selectedId, inset())}>
          Focus selection
        </button>
        <button type="button" data-testid="explode-isolate-floor" style={selectedId ? btn : btnOff} disabled={!selectedId} title={selectedId ? "Show only the floor of the selection (existing floor isolation)" : "Select a component first."} onClick={isolateFloor}>
          Isolate its floor
        </button>
        <button type="button" data-testid="explode-isolate-system" style={selectedId ? btn : btnOff} disabled={!selectedId} title={selectedId ? "Show only the layers of the selection's system (existing layer toggles)" : "Select a component first."} onClick={isolateSystem}>
          Isolate its system
        </button>
        <button type="button" data-testid="explode-show-all" style={isolated ? btn : btnOff} disabled={!isolated} title={isolated ? "Show every floor and layer again" : "Nothing is isolated."} onClick={showAll}>
          Show all
        </button>
      </div>

      <div style={row}>
        <label style={{ display: "flex", gap: 4, alignItems: "center", opacity: traceOff ? 0.5 : 1 }} title={traceOff ? "Trace lines need a decomposed assembly: choose Assembly focus or Cinematic and a supported assembly." : "A line from each member of the inspected assembly to where it sits when the assembly is assembled"}>
          <input type="checkbox" data-testid="explode-traces" checked={s.connectors} disabled={traceOff} onChange={(e) => explodeStore.setConnectors(e.target.checked)} />
          trace lines for the inspected assembly <span style={muted}>(position only; no relationship is implied)</span>
        </label>
      </div>

      {sectionActive && (
        <div data-testid="explode-section-note" style={{ ...muted, color: "#8a5a00" }}>
          A section plane is active. It stays fixed in world space and cuts the displayed (exploded) geometry, so it is no longer a building-relative section. Return to Assembled for that.
        </div>
      )}

      <div style={row}>
        <button type="button" data-testid="explode-more" style={{ ...linkBtn, fontSize: 11 }} onClick={() => setMore(!more)}>
          {more ? "hide" : "show"} what can be decomposed
        </button>
      </div>
      {more && (
        <div data-testid="explode-support" style={{ fontSize: 11, maxHeight: 150, overflowY: "auto", border: `1px solid ${PALETTE.line}`, padding: "4px 6px", background: "#fff" }}>
          <div>
            <b>{model.assemblies.length.toLocaleString("en-US")}</b> of {(model.assemblies.length + model.unsupported.length).toLocaleString("en-US")} assemblies ({model.memberAssembly.size.toLocaleString("en-US")} members) can be decomposed. Floors and systems always apply (every component has a floor and a system).
          </div>
          <div style={{ ...muted, marginTop: 3 }}>Not decomposed:</div>
          {Object.entries(model.unassembled).map(([sys, u]) => (
            <div key={sys}>
              · {u.count.toLocaleString("en-US")} {sys} components: {u.reason}
            </div>
          ))}
          {unsupportedByType.map((u) => (
            <div key={`${u.type}|${u.reason}`}>
              · {u.count} {u.type.replace(/_/g, " ")}: {u.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
