/**
 * Component inspector (minimal panel): name, ID, type, floor, material, dimensions,
 * quantity and parent assembly of the selected component. The first two text lines are the
 * header and the ID (the browser verification script reads the ID from line 2).
 */

import type { CSSProperties } from "react";
import { registry } from "@/building/registry";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import { STRUCTURAL_MATERIAL } from "@/building/structure";
import { QuantityInfo, usePrewarmInventory } from "./QuantityInfo";
import { RecoveryInfo } from "./recovery/RecoveryInfo";
import { ExplodeInfo } from "./explode/ExplodeInfo";
import { RemovalInfo, usePrewarmRemoval } from "./removal/RemovalInfo";
import { ScenarioInfo } from "./scenarios/ScenarioInfo";
import { CarbonInfo } from "./carbon/CarbonInfo";
import { ReuseInfo } from "./reuse/ReuseInfo";
import { TrackingInfo } from "./tracking/TrackingInfo";

const FLOOR_NAMES: Record<number, string> = { [-1]: "Foundation", 0: "Ground (G)", 1: "F01", 2: "F02", 3: "F03", 4: "F04", 5: "Roof" };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

/** Components of the selected component's network, reached through physical joints (connectedTo). */
export function traceNetwork(id: string): string[] {
  const start = registry.getById(id);
  if (!start) return [];
  const net = start.networkId ?? (start.connectedTo ?? []).map((c) => registry.getById(c)?.networkId).find(Boolean);
  if (!net) return [];
  const out = new Set<string>([id]);
  const queue = [id];
  while (queue.length) {
    const c = registry.getById(queue.pop()!);
    for (const n of c?.connectedTo ?? []) {
      if (out.has(n)) continue;
      const r = registry.getById(n);
      if (!r) continue;
      out.add(n); // boundary endpoints (other networks, A2 fittings) are shown but not expanded
      if (r.networkId === net) queue.push(n);
    }
  }
  return [...out];
}

export function ComponentInspector({ selectedId, onSelect, onTrace, traced = 0, style, className }: { selectedId: string | null; onSelect: (id: string | null) => void; onTrace?: (ids: string[]) => void; traced?: number; style?: CSSProperties; className?: string }) {
  usePrewarmInventory();
  usePrewarmRemoval();
  const c = selectedId ? registry.getById(selectedId) : undefined;
  const material = c ? (hasMaterial(c.materialId) ? materialById(c.materialId).name : c.materialId === STRUCTURAL_MATERIAL.id ? STRUCTURAL_MATERIAL.name : c.materialId) : "";
  const parent = c?.parentId ? registry.getById(c.parentId) : undefined;
  const children = c?.componentType.endsWith("_assembly") ? registry.getChildren(c.id).length : 0;
  const dims = c ? Object.entries(c.dimensions).filter(([, v]) => v !== undefined) : [];
  return (
    <div data-testid="id-inspector" className={className ? `rm-panel ${className}` : "rm-panel"} style={{ ...panelStyle, ...style }}>
      <div className="rm-heading" style={{ marginBottom: 2 }}>Inspector · {registry.size} components</div>
      {c ? (
        <>
          <div className="ci-id" style={{ fontWeight: 650, wordBreak: "break-all", fontFamily: "var(--rm-mono)", fontSize: 11.5 }}>{c.id}</div>
          <div className="ci-name">{c.name}</div>
          <Row k="type" v={`${c.componentType}${c.assemblyType ? ` (${c.assemblyType})` : ""}`} />
          <Row k="system" v={c.system} />
          <Row k="floor" v={FLOOR_NAMES[c.floor] ?? String(c.floor)} />
          {c.apartmentId && <Row k="location" v={[c.apartmentId, c.roomId].filter(Boolean).join(" · ")} />}
          <Row k="material" v={material} />
          <Row k="dimensions" v={dims.map(([k, v]) => `${k} ${fmt(v as number)}`).join(", ")} />
          <Row k="quantity" v={`${fmt(c.quantity)} ${c.unit}`} />
          <Row k="confidence" v={c.confidence} />
          <QuantityInfo id={c.id} />
          <RecoveryInfo id={c.id} />
          <RemovalInfo id={c.id} />
          <ScenarioInfo id={c.id} />
          <CarbonInfo id={c.id} />
          <ReuseInfo id={c.id} />
          <TrackingInfo id={c.id} />
          <ExplodeInfo id={c.id} />
          {c.networkId && <Row k="network" v={c.networkId} />}
          {c.nominalSize && <Row k="size" v={c.nominalSize} />}
          {c.gradient !== undefined && <Row k="fall" v={`1 in ${Math.round(1 / c.gradient)}`} />}
          {c.connectedTo && <Row k="connections" v={`${c.connectedTo.length}: ${c.connectedTo.slice(0, 3).join(", ")}${c.connectedTo.length > 3 ? " ..." : ""}`} />}
          {onTrace && (c.networkId || c.connectedTo?.length) ? (
            <div style={{ marginTop: 4 }}>
              <button data-testid="trace" onClick={() => onTrace(traceNetwork(c.id))} style={linkStyle}>
                trace network
              </button>
              {traced > 0 && (
                <>
                  {" "}· {traced} traced ·{" "}
                  <button data-testid="clear-trace" onClick={() => onTrace([])} style={linkStyle}>
                    clear
                  </button>
                </>
              )}
            </div>
          ) : null}
          {parent && (
            <div style={{ marginTop: 4 }}>
              parent:{" "}
              <button data-testid="select-parent" onClick={() => onSelect(parent.id)} style={linkStyle}>
                {parent.id}
              </button>
            </div>
          )}
          {children > 0 && <div style={{ opacity: 0.6 }}>assembly of {children} components</div>}
        </>
      ) : (
        <div style={{ opacity: 0.7, marginTop: 4 }}>click a member of the model (or pick a row in a workspace) to see its details and material passport</div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="ci-row">
      <span className="ci-k" style={{ opacity: 0.55 }}>{k}: </span>
      {v}
    </div>
  );
}

const panelStyle = {
  position: "absolute",
  top: 12,
  left: 12,
  padding: "8px 12px",
  maxWidth: 440,
} as const;

const linkStyle = { font: "inherit", color: "var(--rm-accent)", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" } as const;
