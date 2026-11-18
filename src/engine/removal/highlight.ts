/**
 * Which drawn components the 3D view marks for a removal plan (B3). Pure: the renderer only paints these sets.
 *
 *   planned / blocked   entries not yet simulated as removed (blocked = a hard error is attached to the entry)
 *   prerequisites       blocking prerequisites of the focused component or entry
 *   dependents          blocking dependents of it
 *   advisory            advisory relatives of it (either direction), capped
 *
 * Simulated-as-removed components appear in none of the sets (they are hidden by the renderer).
 * Sets hold DRAWN (non-group) record ids: an assembly stands for its parts.
 */

import type { RelationshipGraph } from "./graph";
import type { PlanAnalysis, RemovalPlan } from "./types";
import { userEdgeToEdge } from "./validate";

export interface HighlightSets {
  readonly planned: ReadonlySet<string>;
  readonly blocked: ReadonlySet<string>;
  readonly prerequisites: ReadonlySet<string>;
  readonly dependents: ReadonlySet<string>;
  readonly advisory: ReadonlySet<string>;
  /** Sequence position of the entry that stands for the focused component, if any. */
  readonly focusEntry: number | null;
  /** Advisory relatives beyond the cap that are not painted. */
  readonly advisoryOmitted: number;
}

export const ADVISORY_CAP = 400;

export function highlightSets(graph: RelationshipGraph, analysis: PlanAnalysis, plan: RemovalPlan, focusId: string | null, removed: ReadonlySet<string>): HighlightSets {
  const planned = new Set<string>();
  const blocked = new Set<string>();
  const cursor = Math.min(plan.cursor, analysis.entries.length);
  for (let i = cursor; i < analysis.entries.length; i++) {
    const e = analysis.entries[i]!;
    if (!e.exists || !e.coverage.length) continue;
    for (const l of graph.leaves(e.id)) if (!removed.has(l)) (e.blocked ? blocked : planned).add(l);
  }

  const prerequisites = new Set<string>();
  const dependents = new Set<string>();
  const advisoryAll = new Set<string>();
  let focusEntry: number | null = null;
  if (focusId && graph.has(focusId)) {
    // The focus is the plan entry that stands for the selected component, or the component itself.
    const owner = analysis.owner.get(focusId);
    focusEntry = owner ?? null;
    const cov = owner !== undefined ? analysis.entries[owner]!.coverage : graph.coverage(focusId);
    const own = new Set(cov);
    const user = plan.userEdges.map(userEdgeToEdge);
    const mark = (otherId: string, sev: string, into: Set<string>) => {
      if (own.has(otherId)) return;
      for (const l of graph.leaves(otherId)) if (!removed.has(l) && !own.has(l)) (sev === "blocking" ? into : advisoryAll).add(l);
    };
    for (const c of cov) {
      for (const e of graph.edgesOf(c)) {
        if (!e.directed) continue;
        if (e.dependentId === c) mark(e.prerequisiteId, e.severity, prerequisites);
        else if (e.prerequisiteId === c) mark(e.dependentId, e.severity, dependents);
      }
      for (const e of user) {
        if (e.dependentId === c) mark(e.prerequisiteId, e.severity, prerequisites);
        if (e.prerequisiteId === c) mark(e.dependentId, e.severity, dependents);
      }
    }
  }
  const adv = [...advisoryAll].filter((l) => !prerequisites.has(l) && !dependents.has(l)).sort();
  return { planned, blocked, prerequisites, dependents, advisory: new Set(adv.slice(0, ADVISORY_CAP)), focusEntry, advisoryOmitted: Math.max(0, adv.length - ADVISORY_CAP) };
}
