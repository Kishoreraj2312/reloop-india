/**
 * Component inspector (minimal panel): name, ID, type, floor, material, dimensions,
 * quantity and parent assembly of the selected component. The first two text lines are the
 * header and the ID (the browser verification script reads the ID from line 2).
 */

import { registry } from "@/building/registry";
import { hasMaterial, materialById } from "@/building/materialLibrary";
import { STRUCTURAL_MATERIAL } from "@/building/structure";

const FLOOR_NAMES: Record<number, string> = { [-1]: "Foundation", 0: "Ground (G)", 1: "F01", 2: "F02", 3: "F03", 4: "F04", 5: "Roof" };

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3);
}

export function ComponentInspector({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
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
