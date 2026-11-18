/** Derived data of the tracking workspace (C3): the engine's context from the live stores, the tracked rows and the planned scope. All memoised per input object. */

import { createContext, useContext, useMemo } from "react";
import { buildRows, coverage, planScope, type Coverage, type Row, type ScopeEvidence, type TrackingContext } from "@/engine/tracking";
import { useRecovery } from "../recovery/recoveryStore";
import { useRemoval } from "../removal/removalStore";
import { useReuse } from "../reuse/reuseStore";
import { trackingContext, useTracking } from "./trackingStore";

export function useTrackingCtx(): TrackingContext {
  const { assessments } = useRecovery();
  const rs = useReuse();
  const rm = useRemoval();
  // the context reads the stores itself; the dependencies say when its inputs changed
  return useMemo(() => trackingContext(), [assessments, rs.allocations, rs.requirements, rm.activeId, rm.plans, rm.version]); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface TrackingWorkspace {
  readonly ctx: TrackingContext;
  /** One row per tracked component. */
  readonly rows: readonly Row[];
  readonly rowById: ReadonlyMap<string, Row>;
  /** Components something plans to recover (B2 / B3 / C2). */
  readonly scope: ReadonlyMap<string, ScopeEvidence>;
  readonly coverage: Coverage;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly drawerWidth: number;
}

export const WorkspaceContext = createContext<TrackingWorkspace | null>(null);
export function useWorkspace(): TrackingWorkspace {
  const w = useContext(WorkspaceContext);
  if (!w) throw new Error("useWorkspace outside the tracking workspace");
  return w;
}

export function useTrackingData(ctx: TrackingContext) {
  const { records } = useTracking();
  const rows = useMemo(() => buildRows(records, ctx), [records, ctx]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const scope = useMemo(() => planScope(ctx), [ctx]);
  const cov = useMemo(() => coverage(records, ctx), [records, ctx]);
  return { rows, rowById, scope, coverage: cov };
}
