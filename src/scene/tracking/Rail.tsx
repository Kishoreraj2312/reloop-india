/** The facet rail of the tracking workspace (C3): stage, material category, floor and saved batches, each with the number of components in the current scope. Clicking filters the register. */

import { useState } from "react";
import { substanceLabel } from "@/engine/reuse";
import { FLOOR_NAMES, STATUSES, STATUS_SHORT, type Status } from "@/engine/tracking";
import { useWorkspace } from "./hooks";
import type { RegisterModel } from "./registerModel";
import { trackingStore, useTracking } from "./trackingStore";

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tk-facet">
      <div className="rx-cap">{title}</div>
      {children}
    </div>
  );
}

function Opt({ label, count, on, onClick, testid, dot }: { label: string; count: number; on: boolean; onClick: () => void; testid: string; dot?: string }) {
  return (
    <button type="button" className="tk-opt" aria-pressed={on} onClick={onClick} data-testid={testid} disabled={count === 0 && !on}>
      {dot && <i className={`dot ${dot}`} />}
      <span className="l">{label}</span>
      <span className="n">{count.toLocaleString("en-US")}</span>
    </button>
  );
}

export function Rail({ model }: { model: RegisterModel }) {
  const ws = useWorkspace();
  const ts = useTracking();
  const f = ts.filters;
  const [rename, setRename] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const subs = [...model.counts.substance].sort((a, b) => b[1] - a[1]);
  const floors = [...model.counts.floor].sort((a, b) => a[0] - b[0]);
  const toggle = <K extends keyof typeof f>(key: K, value: (typeof f)[K]) => trackingStore.setFilters({ [key]: f[key] === value ? ("" as (typeof f)[K]) : value } as Partial<typeof f>);
  return (
    <aside className="rx-rail" data-testid="tracking-rail">
      <div className="rx-rail-head">
        <span className="rx-cap">Filters</span>
      </div>
      <div className="rx-rail-list tk-facets">
        <Facet title="Stage">
          {STATUSES.map((s: Status) => (
            <Opt key={s} label={STATUS_SHORT[s]} count={model.counts.status.get(s) ?? 0} on={f.status === s} onClick={() => toggle("status", s)} testid={`facet-stage-${s}`} dot={`st-${s}`} />
          ))}
          <Opt label="Not tracked" count={model.counts.status.get("not_tracked") ?? 0} on={f.status === "not_tracked"} onClick={() => toggle("status", "not_tracked")} testid="facet-stage-not_tracked" dot="st-none" />
        </Facet>
        <Facet title="Material category">
          {subs.length === 0 && <div className="rx-note">none in scope</div>}
          {subs.slice(0, 12).map(([sub, n]) => (
            <Opt key={sub} label={substanceLabel(sub)} count={n} on={f.substance === sub} onClick={() => toggle("substance", sub)} testid={`facet-material-${sub}`} />
          ))}
        </Facet>
        <Facet title="Floor">
          {floors.map(([fl, n]) => (
            <Opt key={fl} label={FLOOR_NAMES[fl] ?? String(fl)} count={n} on={f.floor === fl} onClick={() => toggle("floor", fl)} testid={`facet-floor-${fl}`} />
          ))}
        </Facet>
        <Facet title="Batches">
          {ts.batches.length === 0 && <div className="rx-note">Select rows in the register and save them as a batch to work on them together. A batch holds no quantities.</div>}
          {ts.batches.map((b) => (
            <div key={b.id} className="tk-batch" data-testid="batch" data-batch={b.id}>
              {rename?.id === b.id ? (
                <input className="rx-field" style={{ height: 22, flex: 1 }} autoFocus value={rename.text} onChange={(e) => setRename({ id: b.id, text: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { const x = trackingStore.renameBatch(b.id, rename.text); setErr(x); if (!x) setRename(null); } else if (e.key === "Escape") setRename(null); }} onBlur={() => setRename(null)} />
              ) : (
                <Opt label={b.name} count={b.componentIds.length} on={f.batchId === b.id} onClick={() => toggle("batchId", b.id)} testid="facet-batch" />
              )}
              <button type="button" className="rx-link" title="Rename" onClick={() => setRename({ id: b.id, text: b.name })}>✎</button>
              <button type="button" className="rx-link" title="Delete the batch (the records are not touched)" data-testid="batch-delete" onClick={() => trackingStore.deleteBatch(b.id)}>✕</button>
            </div>
          ))}
          {err && <div className="rx-error">{err}</div>}
        </Facet>
      </div>
      <div className="rx-rail-foot rx-note">
        Counts are components in the current scope ({ws.rows.length.toLocaleString("en-US")} tracked in all).
      </div>
    </aside>
  );
}
