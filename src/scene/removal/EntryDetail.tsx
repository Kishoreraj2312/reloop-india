/**
 * Selected-component panel of the removal drawer (B3): what the model and the plan say about the component.
 * B1 quantity and B2 classification are read from their own engines/stores (never recomputed here); findings come
 * from the plan analysis; relationships from the relationship graph, each with its source and reason.
 */

import { useEffect, useMemo, useState } from "react";
import { FLOOR_LABEL, formatValue, getModelInventory, UNIT_LABEL } from "@/engine/quantities";
import { CLASSIFICATION_SHORT } from "@/engine/recovery";
import { getModelGraph, RELATIONSHIP_LABELS, requiredBefore, STATE_LABELS, type DependencyEdge, type Finding, type PlanAnalysis, type RemovalPlan } from "@/engine/removal";
import { PALETTE } from "../inventory/ui";
import { useRecovery } from "../recovery/recoveryStore";
import { removalStore } from "./removalStore";
import { btn, btnAccent, btnOff, field, LEVEL_COLOUR, linkBtn, SOURCE_LABEL } from "./ui";

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div>
    <span style={{ color: PALETTE.muted }}>{k}: </span>
    {children}
  </div>
);

const chip = (text: string, colour: string, testid?: string) => (
  <span data-testid={testid} style={{ display: "inline-block", padding: "0 6px", borderRadius: 8, border: `1px solid ${colour}`, color: colour, fontSize: 10, lineHeight: "14px", marginRight: 4, whiteSpace: "nowrap" }}>
    {text}
  </span>
);

function EdgeLine({ e, focus, onSelect }: { e: DependencyEdge; focus?: string; onSelect: (id: string) => void }) {
  const other = e.prerequisiteId === focus ? e.dependentId : e.prerequisiteId;
  return (
    <div data-edge={e.id} style={{ margin: "2px 0 2px 10px", fontSize: 11, color: PALETTE.muted }}>
      {chip(SOURCE_LABEL[e.source], PALETTE.muted)}
      {chip(e.severity, e.severity === "blocking" ? LEVEL_COLOUR.error : e.severity === "advisory" ? LEVEL_COLOUR.warning : LEVEL_COLOUR.review)}
      {RELATIONSHIP_LABELS[e.relationship]} ·{" "}
      <button type="button" onClick={() => onSelect(other)} style={{ ...linkBtn, wordBreak: "break-all" }}>
        {other}
      </button>
      <div style={{ color: PALETTE.text }}>{e.reason}</div>
    </div>
  );
}

function FindingBlock({ f, onSelect }: { f: Finding; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="removal-finding" data-code={f.code} data-level={f.level} style={{ borderLeft: `3px solid ${LEVEL_COLOUR[f.level]}`, padding: "1px 0 1px 7px", margin: "3px 0" }}>
      <span style={{ color: LEVEL_COLOUR[f.level], fontWeight: 600, fontSize: 10.5 }}>
        {f.level === "error" ? "BLOCKING" : f.level === "warning" ? "ADVISORY" : f.level === "review" ? "NEEDS REVIEW" : "NOTE"}
        {f.count > 1 ? ` ×${f.count}` : ""}
      </span>{" "}
      {chip(SOURCE_LABEL[f.source], PALETTE.muted)}
      <div style={{ fontSize: 11.5 }}>{f.message}</div>
      {f.edges.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen(!open)} style={{ ...linkBtn, fontSize: 11 }}>
            {open ? "hide" : "show"} relationship{f.edges.length > 1 ? "s" : ""}
            {f.count > f.edges.length ? ` (${f.edges.length} of ${f.count})` : ""}
          </button>
          {open && f.edges.map((e) => <EdgeLine key={e.id} e={e} onSelect={onSelect} />)}
        </>
      )}
    </div>
  );
}

function UserDependencies({ plan, anchor, onSelect, selectedId }: { plan: RemovalPlan; anchor: string; onSelect: (id: string | null) => void; selectedId: string | null }) {
  const [dir, setDir] = useState<"before" | "after">("after");
  const [other, setOther] = useState("");
  const [severity, setSeverity] = useState<"blocking" | "advisory">("blocking");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<string | null>(null); // the component being edited while we wait for the other end

  // "Pick in model": the next component clicked in the model (or list) becomes the other end.
  useEffect(() => {
    if (!pick || !selectedId || selectedId === pick) return;
    setOther(selectedId);
    setPick(null);
    onSelect(pick); // back to the component being edited
  }, [pick, selectedId, onSelect]);

  const add = () => {
    const input = dir === "before" ? { prerequisiteId: anchor, dependentId: other.trim(), severity, reason } : { prerequisiteId: other.trim(), dependentId: anchor, severity, reason };
    const e = removalStore.addUserEdge(input);
    setError(e);
    if (!e) {
      setOther("");
      setReason("");
    }
  };
  return (
    <div data-testid="user-deps">
      <div style={{ color: PALETTE.muted, fontSize: 11, margin: "8px 0 2px" }}>USER-DEFINED DEPENDENCIES (plan-wide)</div>
      {plan.userEdges.length === 0 && <div style={{ color: PALETTE.muted, fontSize: 11 }}>None. Add one when the model does not capture a relationship you know about.</div>}
      {plan.userEdges.map((u) => (
        <div key={u.id} data-testid="user-dep" style={{ borderLeft: `3px solid ${PALETTE.line}`, padding: "1px 0 1px 7px", margin: "3px 0" }}>
          <div style={{ fontSize: 11.5 }}>
            {chip("user", PALETTE.muted)}
            <button type="button" style={{ ...linkBtn, wordBreak: "break-all" }} onClick={() => onSelect(u.prerequisiteId)}>
              {u.prerequisiteId}
            </button>{" "}
            before{" "}
            <button type="button" style={{ ...linkBtn, wordBreak: "break-all" }} onClick={() => onSelect(u.dependentId)}>
              {u.dependentId}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 2 }}>
            <select data-testid="user-dep-severity" style={field} value={u.severity} onChange={(e) => removalStore.updateUserEdge(u.id, { prerequisiteId: u.prerequisiteId, dependentId: u.dependentId, severity: e.target.value as "blocking" | "advisory", reason: u.reason })}>
              <option value="blocking">blocking</option>
              <option value="advisory">advisory</option>
            </select>
            <input
              style={{ ...field, flex: 1 }}
              defaultValue={u.reason}
              aria-label="reason"
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== u.reason) removalStore.updateUserEdge(u.id, { prerequisiteId: u.prerequisiteId, dependentId: u.dependentId, severity: u.severity, reason: e.target.value });
                else e.target.value = u.reason;
              }}
            />
            <button type="button" data-testid="user-dep-delete" style={btn} onClick={() => removalStore.removeUserEdge(u.id)}>
              delete
            </button>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginTop: 4 }}>
        <span style={{ fontSize: 11 }}>
          <b>{anchor}</b> is removed
        </span>
        <select data-testid="user-dep-dir" style={field} value={dir} onChange={(e) => setDir(e.target.value as "before" | "after")}>
          <option value="after">after</option>
          <option value="before">before</option>
        </select>
        <input data-testid="user-dep-other" style={{ ...field, flex: 1, minWidth: 140 }} placeholder="other component id" value={other} onChange={(e) => setOther(e.target.value)} />
        <button type="button" data-testid="user-dep-pick" style={pick ? btnAccent : btn} onClick={() => setPick(pick ? null : anchor)} title="Then click a component in the model">
          {pick ? "click it in the model…" : "pick in model"}
        </button>
        <select data-testid="user-dep-new-severity" style={field} value={severity} onChange={(e) => setSeverity(e.target.value as "blocking" | "advisory")}>
          <option value="blocking">blocking</option>
          <option value="advisory">advisory</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input data-testid="user-dep-reason" style={{ ...field, flex: 1 }} placeholder="reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button type="button" data-testid="user-dep-add" style={btn} onClick={add}>
          add
        </button>
      </div>
      {error && (
        <div data-testid="user-dep-error" role="alert" style={{ color: LEVEL_COLOUR.error, fontSize: 11, marginTop: 2 }}>
          {error}
        </div>
      )}
    </div>
  );
}

export function EntryDetail({ plan, analysis, selectedId, onSelect }: { plan: RemovalPlan; analysis: PlanAnalysis; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const graph = useMemo(() => getModelGraph(), []);
  const inv = useMemo(() => getModelInventory(), []);
  const { assessments } = useRecovery();
  const node = selectedId ? graph.node(selectedId) : undefined;
  const idx = selectedId ? analysis.owner.get(selectedId) : undefined;
  const entry = idx !== undefined ? analysis.entries[idx] : undefined;

  // relationships of the whole entry (an assembly: of all its parts), excluding those inside it
  const rel = useMemo(() => {
    if (!selectedId || !node) return null;
    const cov = entry ? entry.coverage : graph.coverage(selectedId);
    const own = new Set(cov);
    const pre: DependencyEdge[] = [];
    const dep: DependencyEdge[] = [];
    let links = 0;
    for (const c of cov.slice(0, 3000)) {
      for (const e of graph.edgesOf(c)) {
        if (!e.directed) {
          const o = e.prerequisiteId === c ? e.dependentId : e.prerequisiteId;
          if (!own.has(o)) links++;
        } else if (e.dependentId === c && !own.has(e.prerequisiteId)) pre.push(e);
        else if (e.prerequisiteId === c && !own.has(e.dependentId)) dep.push(e);
      }
    }
    const uniq = (l: DependencyEdge[]) => [...new Map(l.map((e) => [e.id, e])).values()].sort((a, b) => (a.severity === b.severity ? (a.id < b.id ? -1 : 1) : a.severity === "blocking" ? -1 : 1));
    return { pre: uniq(pre), dep: uniq(dep), links };
  }, [graph, selectedId, node, entry]);

  const missing = useMemo(() => {
    if (!entry) return 0;
    const have = new Set<string>();
    for (const e of analysis.entries) for (const c of e.coverage) have.add(c);
    return requiredBefore(graph, [entry.id]).required.filter((r) => !have.has(r)).length;
  }, [graph, entry, analysis]);

  if (!selectedId) return <div style={{ color: PALETTE.muted }}>Click a component in the 3D model or a step in the sequence.</div>;
  if (!node) {
    // an obsolete or mistyped plan entry: say why it is flagged, and let the user remove it
    const stale = analysis.entries.find((e) => e.id === selectedId);
    return (
      <div data-testid="removal-detail">
        <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{selectedId}</div>
        {stale ? (
          <>
            {stale.findings.map((f, i) => (
              <FindingBlock key={i} f={f} onSelect={onSelect} />
            ))}
            <button type="button" data-testid="detail-remove" style={btn} onClick={() => removalStore.removeEntry(stale.index)}>
              Remove from plan
            </button>
          </>
        ) : (
          <div style={{ color: PALETTE.muted }}>Not a component of this model.</div>
        )}
      </div>
    );
  }

  const cq = inv.byId.get(selectedId);
  const a = assessments.get(selectedId);
  const leaves = graph.leaves(selectedId).length;
  const container = graph.containerOf(selectedId);
  const prim = cq?.primary;

  return (
    <div data-testid="removal-detail">
      <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{node.id}</div>
      <div style={{ color: PALETTE.muted }}>{node.name}</div>
      <Row k="system · type · floor">
        {node.system} · {node.componentType} · {FLOOR_LABEL[node.floor] ?? node.floor}
      </Row>
      <Row k="quantity (B1)">
        {node.group ? (
          <>assembly of {leaves} parts</>
        ) : prim && prim.value !== null ? (
          <>
            {formatValue(prim.value, prim.unit)} {UNIT_LABEL[prim.unit]} <span style={{ color: PALETTE.muted }}>({prim.status})</span>
          </>
        ) : (
          <span style={{ color: PALETTE.muted }}>Not available</span>
        )}
      </Row>
      <Row k="recovery (B2)">
        {node.group ? (
          <span style={{ color: PALETTE.muted }}>assessed per part</span>
        ) : a?.classification ? (
          <>
            {CLASSIFICATION_SHORT[a.classification]}
            {a.recoveryPct !== null ? ` · ${a.recoveryPct}%` : ""}
          </>
        ) : (
          <span style={{ color: PALETTE.muted }}>not assessed</span>
        )}
      </Row>

      {entry ? (
        <>
          <Row k="sequence">
            <b data-testid="detail-step">
              step {entry.index + 1} of {analysis.entries.length}
            </b>{" "}
            {chip(STATE_LABELS[entry.state], PALETTE.muted, "detail-state")}
            {entry.blocked && chip("blocked", LEVEL_COLOUR.error, "detail-blocked")}
            {selectedId !== entry.id && <span style={{ color: PALETTE.muted }}>(part of {entry.id})</span>}
          </Row>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "4px 0" }}>
            <button type="button" data-testid="add-prerequisites" disabled={missing === 0} style={missing === 0 ? btnOff : btn} onClick={() => removalStore.insertPrerequisites(entry.id)} title="Insert the blocking prerequisites the plan does not yet cover, just before this step">
              Add blocking prerequisites ({missing})
            </button>
            <button type="button" data-testid="detail-up" style={btn} disabled={entry.index === 0} onClick={() => removalStore.moveEntry(entry.index, entry.index - 1)}>
              ▲ earlier
            </button>
            <button type="button" data-testid="detail-down" style={btn} disabled={entry.index === analysis.entries.length - 1} onClick={() => removalStore.moveEntry(entry.index, entry.index + 1)}>
              ▼ later
            </button>
            <button type="button" data-testid="detail-remove" style={btn} onClick={() => removalStore.removeEntry(entry.index)}>
              Remove from plan
            </button>
          </div>
          {entry.findings.length === 0 ? <div style={{ color: PALETTE.muted, fontSize: 11.5 }}>No validation findings for this step.</div> : entry.findings.map((f, i) => <FindingBlock key={`${f.code}-${i}`} f={f} onSelect={onSelect} />)}
          <label style={{ display: "block", color: PALETTE.muted, fontSize: 11, marginTop: 6 }}>
            Note for this step
            <textarea
              key={entry.id}
              data-testid="entry-note"
              style={{ ...field, width: "100%", minHeight: 38, marginTop: 2, boxSizing: "border-box" }}
              defaultValue={plan.notes[entry.id] ?? ""}
              onBlur={(e) => e.target.value !== (plan.notes[entry.id] ?? "") && removalStore.setNote(entry.id, e.target.value)}
            />
          </label>
        </>
      ) : (
        <div style={{ margin: "4px 0" }}>
          <span style={{ color: PALETTE.muted }}>Not planned.</span>{" "}
          <button type="button" data-testid="detail-add" style={btn} onClick={() => removalStore.addEntries([selectedId])}>
            Add to plan
          </button>{" "}
          {container && (
            <button type="button" data-testid="detail-add-assembly" style={btn} onClick={() => removalStore.addEntries([container])} title={container}>
              Add its assembly
            </button>
          )}
        </div>
      )}

      {rel && (
        <>
          <div style={{ color: PALETTE.muted, fontSize: 11, margin: "8px 0 2px" }}>
            MUST BE ADDRESSED FIRST ({rel.pre.length}) <span style={{ opacity: 0.8 }}>· prerequisites</span>
          </div>
          {rel.pre.length === 0 && <div style={{ color: PALETTE.muted, fontSize: 11 }}>None recorded in the model.</div>}
          <div data-testid="rel-prerequisites">{rel.pre.slice(0, 12).map((e) => <EdgeLine key={e.id} e={e} focus={selectedId} onSelect={onSelect} />)}</div>
          {rel.pre.length > 12 && <div style={{ color: PALETTE.muted, fontSize: 11 }}>… and {rel.pre.length - 12} more</div>}
          <div style={{ color: PALETTE.muted, fontSize: 11, margin: "8px 0 2px" }}>
            WAITS FOR THIS ({rel.dep.length}) <span style={{ opacity: 0.8 }}>· dependents</span>
          </div>
          {rel.dep.length === 0 && <div style={{ color: PALETTE.muted, fontSize: 11 }}>None recorded in the model.</div>}
          <div data-testid="rel-dependents">{rel.dep.slice(0, 12).map((e) => <EdgeLine key={e.id} e={e} focus={selectedId} onSelect={onSelect} />)}</div>
          {rel.dep.length > 12 && <div style={{ color: PALETTE.muted, fontSize: 11 }}>… and {rel.dep.length - 12} more</div>}
          {rel.links > 0 && (
            <div style={{ color: PALETTE.muted, fontSize: 11, marginTop: 4 }}>
              {rel.links} physical connection{rel.links === 1 ? "" : "s"} to other components: recorded in the model, but they imply no removal order.
            </div>
          )}
        </>
      )}
      <UserDependencies plan={plan} anchor={entry?.id ?? selectedId} onSelect={onSelect} selectedId={selectedId} />
    </div>
  );
}
