/** (De)serialisation of removal plans (B3). Pure: the storage glue lives in the app layer. */

import type { RemovalPlan, UserEdge } from "./types";

export const PERSIST_VERSION = 1;

export interface PersistedPlans {
  readonly plans: readonly RemovalPlan[];
  readonly activeId: string | null;
}

/** The simulation cursor is a view concern and is not saved: a reloaded plan starts at step 0. */
export function serializePlans(s: PersistedPlans): string {
  return JSON.stringify({
    version: PERSIST_VERSION,
    activeId: s.activeId,
    plans: s.plans.map((p) => ({ id: p.id, name: p.name, entries: p.entries, notes: p.notes, userEdges: p.userEdges })),
  });
}

const str = (v: unknown): v is string => typeof v === "string";

function cleanEdge(raw: unknown): UserEdge | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.id) || !str(r.prerequisiteId) || !str(r.dependentId) || !str(r.reason) || !r.reason.trim()) return null;
  if (r.severity !== "blocking" && r.severity !== "advisory") return null;
  return { id: r.id, prerequisiteId: r.prerequisiteId, dependentId: r.dependentId, severity: r.severity, reason: r.reason };
}

function cleanPlan(raw: unknown): RemovalPlan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.id) || !str(r.name) || !Array.isArray(r.entries)) return null;
  const notes: Record<string, string> = {};
  if (typeof r.notes === "object" && r.notes !== null) for (const [k, v] of Object.entries(r.notes)) if (str(v) && v.trim()) notes[k] = v;
  const edges = Array.isArray(r.userEdges) ? r.userEdges.map(cleanEdge).filter((e): e is UserEdge => e !== null) : [];
  // References to components that no longer exist are kept: validation flags them for the user instead of dropping data.
  return { id: r.id, name: r.name || "Removal plan", entries: r.entries.filter(str), notes, userEdges: edges, cursor: 0 };
}

/** Parse stored JSON. Malformed or outdated data yields no plans (never throws); invalid plans are dropped and counted. */
export function parsePlans(text: string | null): PersistedPlans & { dropped: number } {
  const empty = { plans: [], activeId: null, dropped: 0 };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = data as { version?: unknown; plans?: unknown; activeId?: unknown } | null;
  if (!d || d.version !== PERSIST_VERSION || !Array.isArray(d.plans)) return empty;
  const plans: RemovalPlan[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of d.plans) {
    const p = cleanPlan(raw);
    if (!p || seen.has(p.id)) dropped++;
    else {
      seen.add(p.id);
      plans.push(p);
    }
  }
  return { plans, activeId: str(d.activeId) && seen.has(d.activeId) ? d.activeId : (plans[0]?.id ?? null), dropped };
}
