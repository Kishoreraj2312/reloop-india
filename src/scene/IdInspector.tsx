/**
 * Dev-only ID inspector overlay: shows the ID of the clicked member (identity check
 * only — this is not a data panel).
 */

import { registry } from "@/building/registry";

export function IdInspector({ selectedId }: { selectedId: string | null }) {
  const c = selectedId ? registry.getById(selectedId) : undefined;
  return (
    <div
      data-testid="id-inspector"
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        padding: "8px 12px",
        font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#1f2933",
        background: "rgba(255,255,255,0.88)",
        border: "1px solid #c3c8cd",
        borderRadius: 6,
        pointerEvents: "none",
        maxWidth: 420,
      }}
    >
      <div style={{ opacity: 0.55, fontSize: 10, letterSpacing: 0.4 }}>DEV · ID INSPECTOR · {registry.size} components</div>
      {c ? (
        <>
          <div style={{ fontWeight: 700 }}>{c.id}</div>
          <div>{c.name}</div>
          {c.parentId && <div style={{ opacity: 0.6 }}>parent: {c.parentId}</div>}
        </>
      ) : (
        <div style={{ opacity: 0.6 }}>click a member</div>
      )}
    </div>
  );
}
