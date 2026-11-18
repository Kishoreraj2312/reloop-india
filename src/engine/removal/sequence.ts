/**
 * Sequence helpers (B3): what must be addressed first, and a deterministic valid order.
 * Both are explicit user actions: nothing here runs on its own or reorders a plan silently.
 */

import type { RelationshipGraph } from "./graph";
import type { DependencyEdge, PlanAnalysis } from "./types";

export interface RequiredResult {
  /** Records (components or assemblies) that must be addressed before `ids`, discovery order, not already part of `ids`. */
  readonly required: readonly string[];
  /** Every blocking relationship from a required record into the set (including `ids`); used to order the additions. */
  readonly edges: readonly DependencyEdge[];
  readonly truncated: boolean;
}

/**
 * Transitive closure over BLOCKING prerequisites: the records that must be removed before `ids` can be.
 * (In A1 terms: everything that bears on a column must go before the column; the "left unsupported" set.)
 * Advisory and unknown relationships are not followed.
 */
export function requiredBefore(graph: RelationshipGraph, ids: readonly string[], limit = 5000): RequiredResult {
  const covered = new Set<string>();
  const queue: string[] = [];
  for (const id of ids) for (const c of graph.coverage(id)) if (!covered.has(c)) (covered.add(c), queue.push(c));
  const original = new Set(covered);
  const required: string[] = [];
  const edges: DependencyEdge[] = [];
  let truncated = false;
  // Every covered record is expanded once, so each blocking edge into the set is seen exactly once.
  for (let qi = 0; qi < queue.length; qi++) {
    for (const e of graph.prerequisitesOf(queue[qi]!)) {
      if (e.severity !== "blocking" || original.has(e.prerequisiteId)) continue;
      if (!covered.has(e.prerequisiteId)) {
        if (required.length >= limit) {
          truncated = true;
          continue;
        }
        required.push(e.prerequisiteId);
        for (const c of graph.coverage(e.prerequisiteId)) if (!covered.has(c)) (covered.add(c), queue.push(c));
      }
      edges.push(e);
    }
  }
  return { required, edges, truncated };
}

class MinHeap {
  private a: number[] = [];
  get size() {
    return this.a.length;
  }
  push(v: number) {
    const a = this.a;
    a.push(v);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (a[p]! <= a[i]!) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]! < a[m]!) m = l;
        if (r < a.length && a[r]! < a[m]!) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

export interface OrderSuggestion {
  /** Entry ids in a valid order (stable: ties keep their current relative order). */
  readonly order: readonly string[];
  readonly changed: boolean;
  /** Entries that could not be placed because they sit on a cycle (appended in their current order). */
  readonly stuck: readonly string[];
}

/** A valid order for the plan's entries that satisfies every blocking relationship between them (Kahn, stable). */
export function suggestOrder(analysis: PlanAnalysis): OrderSuggestion {
  const n = analysis.entries.length;
  const indeg = new Array<number>(n).fill(0);
  const out: number[][] = Array.from({ length: n }, () => []);
  for (const [q, p] of analysis.entryEdges) {
    out[q]!.push(p);
    indeg[p]!++;
  }
  const heap = new MinHeap();
  for (let i = 0; i < n; i++) if (indeg[i] === 0) heap.push(i);
  const placed: number[] = [];
  while (heap.size) {
    const v = heap.pop();
    placed.push(v);
    for (const w of out[v]!) if (--indeg[w]! === 0) heap.push(w);
  }
  const done = new Set(placed);
  const stuckIdx: number[] = [];
  for (let i = 0; i < n; i++) if (!done.has(i)) stuckIdx.push(i);
  const order = [...placed, ...stuckIdx].map((i) => analysis.entries[i]!.id);
  return { order, changed: order.some((id, i) => id !== analysis.entries[i]!.id), stuck: stuckIdx.map((i) => analysis.entries[i]!.id) };
}
