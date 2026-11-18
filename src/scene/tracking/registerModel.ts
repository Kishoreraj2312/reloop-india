/** The register of the tracking workspace (C3): which components it lists for the current scope and filters, and the facet counts. Pure derivation, memoised. */

import { useMemo } from "react";
import { substanceOf } from "@/engine/recovery";
import { materialName } from "@/engine/reuse";
import { STAGE_ORDER, type Status } from "@/engine/tracking";
import type { Filters } from "./trackingStore";
import type { TrackingWorkspace } from "./hooks";
import { useTracking } from "./trackingStore";

export interface Item {
  readonly id: string;
  readonly tracked: boolean;
}

export interface Counts {
  readonly status: ReadonlyMap<Status | "not_tracked", number>;
  readonly substance: ReadonlyMap<string, number>;
  readonly floor: ReadonlyMap<number, number>;
}

export interface RegisterModel {
  /** Components in scope (before the facet filters). */
  readonly base: readonly string[];
  readonly items: readonly Item[];
  readonly counts: Counts;
}

const LEVEL = { error: 0, warning: 1, info: 2 } as const;

export function useRegister(ws: TrackingWorkspace, f: Filters): RegisterModel {
  const { batches } = useTracking();
  const { ctx, rowById, scope } = ws;
  const inv = ctx.inv;

  const base = useMemo<readonly string[]>(() => {
    const tracked = [...rowById.keys()];
    if (f.scope === "tracked") return tracked;
    if (f.scope === "all") return inv.rows.map((r) => r.rec.id);
    const planned = [...scope.keys()].filter((id) => f.scope === "planned" || !rowById.has(id));
    return f.scope === "planned" ? [...new Set([...tracked, ...planned])].sort() : planned.sort();
  }, [f.scope, rowById, scope, inv]);

  const counts = useMemo<Counts>(() => {
    const status = new Map<Status | "not_tracked", number>();
    const substance = new Map<string, number>();
    const floor = new Map<number, number>();
    for (const id of base) {
      const row = rowById.get(id);
      const rec = inv.recordById.get(id);
      const k = row ? row.summary.status : "not_tracked";
      status.set(k, (status.get(k) ?? 0) + 1);
      const sub = row ? row.substance : rec ? substanceOf(rec.materialId) : "unknown";
      substance.set(sub, (substance.get(sub) ?? 0) + 1);
      const fl = row ? row.floor : (rec?.floor ?? 0);
      floor.set(fl, (floor.get(fl) ?? 0) + 1);
    }
    return { status, substance, floor };
  }, [base, rowById, inv]);

  const items = useMemo<readonly Item[]>(() => {
    const batch = f.batchId ? new Set(batches.find((b) => b.id === f.batchId)?.componentIds ?? []) : null;
    const text = f.text.trim().toLowerCase();
    const out: Item[] = [];
    for (const id of base) {
      const row = rowById.get(id);
      const rec = inv.recordById.get(id);
      if (f.status === "not_tracked" ? !!row : f.status !== "" && row?.summary.status !== f.status) continue;
      if (f.substance !== "" && (row ? row.substance : rec ? substanceOf(rec.materialId) : "unknown") !== f.substance) continue;
      if (f.floor !== "" && (row ? row.floor : (rec?.floor ?? 0)) !== f.floor) continue;
      if (batch && !batch.has(id)) continue;
      if (f.flaggedOnly && !(row && row.summary.flags.some((x) => x.level !== "info"))) continue;
      if (text && !id.toLowerCase().includes(text) && !(rec?.name ?? "").toLowerCase().includes(text) && !(rec ? materialName(rec.materialId) : "").toLowerCase().includes(text)) continue;
      out.push({ id, tracked: !!row });
    }
    if (f.sort === "id" && f.scope !== "all") return out; // base is already in id order
    if (f.sort === "attention") {
      const rank = (i: Item) => (i.tracked ? Math.min(3, ...rowById.get(i.id)!.summary.flags.map((x) => LEVEL[x.level])) : 4);
      const key = new Map(out.map((i) => [i.id, rank(i)]));
      return [...out].sort((a, b) => key.get(a.id)! - key.get(b.id)! || (a.id < b.id ? -1 : 1));
    }
    if (f.sort === "stage") {
      const rank = (i: Item) => (i.tracked ? STAGE_ORDER[rowById.get(i.id)!.summary.status] : -2);
      const key = new Map(out.map((i) => [i.id, rank(i)]));
      return [...out].sort((a, b) => key.get(a.id)! - key.get(b.id)! || (a.id < b.id ? -1 : 1));
    }
    return out;
  }, [base, f.status, f.substance, f.floor, f.batchId, f.flaggedOnly, f.text, f.sort, f.scope, rowById, inv, batches]);

  return { base, items, counts };
}
