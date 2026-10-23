/**
 * Component inspector (minimal panel): name, ID, type, floor, material, dimensions,
 * quantity and parent assembly of the selected component. The first two text lines are the
 * header and the ID (the browser verification script reads the ID from line 2).
 */

import { registry } from "@/building/registry";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import { STRUCTURAL_MATERIAL } from "@/building/structure";
import { QuantityInfo, usePrewarmInventory } from "./QuantityInfo";
import { RecoveryInfo } from "./recovery/RecoveryInfo";

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

export function ComponentInspector({ selectedId, onSelect, onTrace, traced = 0 }: { selectedId: string | null; onSelect: (id: string | null) => void; onTrace?: (ids: string[]) => void; traced?: number }) {
  usePrewarmInventory();
  const c = selectedId ? registry.getById(selectedId) : undefined;
  const material = c ? (hasMaterial(c.materialId) ? materialById(c.materialId).name : c.materialId === STRUCTURAL_MATERIAL.id ? STRUCTURAL_MATERIAL.name : c.materialId) : "";
  const parent = c?.parentId ? registry.getById(c.parentId) : undefined;
  const children = c?.componentType.endsWith("_assembly") ? registry.getChildren(c.id).length : 0;
  const dims = c ? Object.entries(c.dimensions).filter(([, v]) => v !== undefined) : [];
  return (
    <div data-testid="id-inspector" style={panelStyle}>
      <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: 0.4 }}>INSPECTOR · {registry.size} components</div>
      {c ? (
        <>
          <div style={{ fontWeight: 700, wordBreak: "break-all" }}>{c.id}</div>
          <div>{c.name}</div>
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
        <div style={{ opacity: 0.6 }}>click a member</div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span style={{ opacity: 0.55 }}>{k}: </span>
      {v}
    </div>
  );
}

const panelStyle = {
  position: "absolute",
  top: 12,
  left: 12,
  padding: "8px 12px",
  font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#1f2933",
  background: "rgba(255,255,255,0.9)",
  border: "1px solid #c3c8cd",
  borderRadius: 6,
  maxWidth: 440,
} as const;

const linkStyle = { font: "inherit", color: "#b4461b", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" } as const;
