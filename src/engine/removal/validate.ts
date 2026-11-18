/**
 * Plan analysis (B3): deterministic validation of a removal sequence against the relationship graph.
 *
 * Hard errors (the entry is "blocked" and cannot be advanced): missing component, duplicate entry, assembly/part
 * overlap, a blocking prerequisite that is not in the plan or is scheduled after its dependent, and cycles.
 * Warnings never block: advisory prerequisites that are absent or later in the sequence. Unknown relationships
 * (physical joints, unreadable dependencies) are listed for review and imply no order.
 *
 * The user's order is never changed here.
 */

import type { RelationshipGraph } from "./graph";
import type { DependencyEdge, EdgeSource, EntryAnalysis, Finding, FindingCode, FindingLevel, PlanAnalysis, RemovalPlan, RemovalState, UserEdge } from "./types";

const SAMPLE = { error: 25, other: 8 } as const;

export function userEdgeToEdge(u: UserEdge): DependencyEdge {
  return {
    id: `user|${u.id}`,
    prerequisiteId: u.prerequisiteId,
    dependentId: u.dependentId,
    relationship: "user",
    severity: u.severity,
    directed: true,
    source: "user",
    via: "user-defined dependency",
    reason: u.reason,
  };
}

interface Acc {
  code: FindingCode;
  level: FindingLevel;
  entryIndex: number;
  count: number;
  edges: DependencyEdge[];
  source: EdgeSource;
  message: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tarjan strongly connected components (iterative) over `n` nodes. */
function components(n: number, adj: readonly (readonly number[])[]): number[][] {
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const on = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: [number, number][] = [[s, 0]];
    index[s] = low[s] = counter++;
    stack.push(s);
    on[s] = true;
    while (work.length) {
      const top = work[work.length - 1]!;
      const v = top[0];
      const nexts = adj[v]!;
      if (top[1] < nexts.length) {
        const w = nexts[top[1]++]!;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          on[w] = true;
          work.push([w, 0]);
        } else if (on[w]) low[v] = Math.min(low[v]!, index[w]!);
      } else {
        work.pop();
        if (work.length) {
          const p = work[work.length - 1]![0];
          low[p] = Math.min(low[p]!, low[v]!);
        }
        if (low[v] === index[v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            on[w] = false;
            comp.push(w);
          } while (w !== v);
          out.push(comp);
        }
      }
    }
  }
  return out;
}

/** Shortest cycle through the smallest node of a strongly connected component, as node indices closed on the first. */
function cycleIn(comp: readonly number[], adj: readonly (readonly number[])[]): number[] {
  const inComp = new Set(comp);
  const start = Math.min(...comp);
  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const u = queue[qi]!;
    for (const w of [...adj[u]!].sort((x, y) => x - y)) {
      if (!inComp.has(w)) continue;
      if (w === start) {
        const path = [u];
        for (let c = u; c !== start; ) {
          c = prev.get(c)!;
          path.push(c);
        }
        return [...path.reverse(), start];
      }
      if (!seen.has(w)) {
        seen.add(w);
        prev.set(w, u);
        queue.push(w);
      }
    }
  }
  return [start, start]; // unreachable inside an SCC
}

const ISOLATION_NET = /^(PLB|ELC)-NET-/;

export function analysePlan(graph: RelationshipGraph, plan: RemovalPlan): PlanAnalysis {
  const ids = plan.entries;
  const n = ids.length;
  const cursor = clamp(Math.trunc(plan.cursor) || 0, 0, n);

  // 1) classify entries: ok / missing / duplicate
  const firstAt = new Map<string, number>();
  const kind: ("ok" | "missing" | "duplicate")[] = ids.map((id, i) => {
    if (firstAt.has(id)) return "duplicate";
    firstAt.set(id, i);
    return graph.has(id) ? "ok" : "missing";
  });

  // 2) coverage and ownership (which entry stands for each record)
  const owner = new Map<string, number>();
  const coverage: string[][] = ids.map(() => []);
  const overlaps: { later: number; earlier: number; via: string }[] = [];
  const overlapSeen = new Set<string>();
  ids.forEach((id, i) => {
    if (kind[i] !== "ok") return;
    const cov = graph.coverage(id);
    coverage[i] = cov;
    for (const c of cov) {
      const o = owner.get(c);
      if (o === undefined) owner.set(c, i);
      else if (o !== i) {
        const key = `${o}|${i}`;
        if (!overlapSeen.has(key)) {
          overlapSeen.add(key);
          overlaps.push({ later: i, earlier: o, via: c });
        }
      }
    }
  });
  /** Sequence position that addresses a record: its owning entry, or for an assembly the last entry among its parts. */
  const posOf = (id: string): number | undefined => {
    const o = owner.get(id);
    if (o !== undefined) return o;
    if (!graph.isGroup(id)) return undefined;
    const leaves = graph.leaves(id);
    if (!leaves.length) return undefined;
    let m = -1;
    for (const l of leaves) {
      const q = owner.get(l);
      if (q === undefined) return undefined;
      if (q > m) m = q;
    }
    return m;
  };

  const acc = new Map<string, Acc>();
  const note = (entryIndex: number, code: FindingCode, level: FindingLevel, source: EdgeSource, message: string, edge?: DependencyEdge) => {
    const key = `${entryIndex}|${code}|${edge?.relationship ?? ""}|${edge?.severity ?? ""}`;
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { code, level, entryIndex, count: 0, edges: [], source, message }));
    a.count++;
    if (edge && a.edges.length < (level === "error" ? SAMPLE.error : SAMPLE.other)) a.edges.push(edge);
  };

  ids.forEach((id, i) => {
    if (kind[i] === "missing") note(i, "MISSING_REF", "error", "model", `Component ${id} does not exist in the model (obsolete or mistyped reference). Remove the entry or replace it.`);
    if (kind[i] === "duplicate") note(i, "DUPLICATE_ENTRY", "error", "model", `${id} is already in the plan at position ${firstAt.get(id)! + 1}. Remove the duplicate.`);
  });
  for (const o of overlaps) {
    const msg = `${ids[o.later]} and ${ids[o.earlier]} overlap: ${o.via} is covered by both (an assembly and one of its own parts). Keep only one of them.`;
    note(o.later, "OVERLAP_ENTRY", "error", "model", msg);
    note(o.earlier, "OVERLAP_ENTRY", "error", "model", msg);
  }

  // 3) relationships. User edges are looked up by dependent record id.
  const userBy = new Map<string, DependencyEdge[]>();
  const userEdges = plan.userEdges.map(userEdgeToEdge);
  for (const e of userEdges) (userBy.get(e.dependentId) ?? userBy.set(e.dependentId, []).get(e.dependentId)!).push(e);

  const blockingQ = new Array<number>(n).fill(-1); // latest in-plan blocking prerequisite position
  const edgeSet = new Set<string>();
  const entryEdges: [number, number][] = [];
  const addEntryEdge = (q: number, p: number) => {
    const k = `${q},${p}`;
    if (!edgeSet.has(k)) {
      edgeSet.add(k);
      entryEdges.push([q, p]);
    }
  };

  const apply = (e: DependencyEdge, i: number) => {
    const q = posOf(e.prerequisiteId);
    if (q === i) return; // removed together with its dependent
    const blocking = e.severity === "blocking";
    const src = e.source;
    if (q === undefined) {
      note(i, blocking ? "PREREQ_NOT_IN_PLAN" : "ADVISORY_NOT_IN_PLAN", blocking ? "error" : "warning", src, e.reason, e);
      return;
    }
    if (blocking) {
      addEntryEdge(q, i);
      if (q > blockingQ[i]!) blockingQ[i] = q;
    }
    if (q > i) note(i, blocking ? "ORDER_VIOLATION" : "ADVISORY_ORDER", blocking ? "error" : "warning", src, e.reason, e);
  };

  for (let i = 0; i < n; i++) {
    if (kind[i] !== "ok") continue;
    const isolation = new Set<string>();
    for (const c of coverage[i]!) {
      for (const e of graph.edgesOf(c)) {
        if (e.directed) {
          if (e.dependentId === c) apply(e, i);
        } else {
          const other = e.prerequisiteId === c ? e.dependentId : e.prerequisiteId;
          if (posOf(other) === undefined) note(i, "UNKNOWN_LINK", "review", "model", e.reason, e);
        }
      }
      for (const e of userBy.get(c) ?? []) apply(e, i);
      const nd = graph.node(c);
      if (nd?.networkId && ISOLATION_NET.test(nd.networkId) && !nd.group) isolation.add(nd.networkId);
    }
    if (isolation.size) {
      const nets = [...isolation].sort();
      note(
        i,
        "ISOLATION_UNCONFIRMED",
        "info",
        "rule",
        `Covers ${nets.length} MEP network${nets.length === 1 ? "" : "s"} (${nets.slice(0, 3).join(", ")}${nets.length > 3 ? ", ..." : ""}). Service isolation is not modelled: confirm it on site before any real work.`,
      );
    }
  }
  for (const u of userEdges) {
    const missing = [u.prerequisiteId, u.dependentId].filter((x) => !graph.has(x));
    if (missing.length) note(-1, "USER_EDGE_INACTIVE", "review", "user", `User dependency ${u.prerequisiteId} → ${u.dependentId} refers to a component that does not exist (${missing.join(", ")}). Edit or delete it.`, u);
    else if (posOf(u.dependentId) === undefined) note(-1, "USER_EDGE_INACTIVE", "info", "user", `User dependency ${u.prerequisiteId} → ${u.dependentId} has no effect: ${u.dependentId} is not in the plan.`, u);
  }

  // 4) cycles among sequence entries
  const adj: number[][] = ids.map(() => []);
  for (const [q, p] of entryEdges) adj[q]!.push(p);
  const cycles: string[][] = [];
  for (const comp of components(n, adj)) {
    const selfLoop = comp.length === 1 && adj[comp[0]!]!.includes(comp[0]!);
    if (comp.length < 2 && !selfLoop) continue;
    const path = cycleIn(comp, adj).map((x) => ids[x]!);
    cycles.push(path);
    const msg = `Circular dependency: ${path.join(" → ")}. Blocking relationships cannot all be satisfied; review the relationships (or the user-defined ones) behind it.`;
    for (const x of comp) note(x, "CYCLE", "error", "model", msg);
  }
  cycles.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));

  // 5) findings, states
  const findings: Finding[] = [];
  const byEntry: Finding[][] = ids.map(() => []);
  const keys = [...acc.keys()].sort((a, b) => {
    const [ea, ca] = a.split("|");
    const [eb, cb] = b.split("|");
    return Number(ea) - Number(eb) || (ca! < cb! ? -1 : ca! > cb! ? 1 : a < b ? -1 : 1);
  });
  for (const k of keys) {
    const a = acc.get(k)!;
    const first = a.edges[0];
    const prefix = a.count > 1 && first ? `${a.count} relationships (first shown): ` : "";
    const f: Finding = {
      code: a.code,
      level: a.level,
      entryIndex: a.entryIndex,
      entryId: a.entryIndex >= 0 ? ids[a.entryIndex]! : "",
      count: a.count,
      message: describe(a, ids, prefix),
      edges: a.edges,
      source: a.source,
    };
    findings.push(f);
    if (a.entryIndex >= 0) byEntry[a.entryIndex]!.push(f);
  }

  const entries: EntryAnalysis[] = ids.map((id, i) => {
    const blocked = byEntry[i]!.some((f) => f.level === "error");
    const leafCount = kind[i] === "ok" ? graph.leaves(id).length : 0;
    return { index: i, id, exists: kind[i] !== "missing", coverage: coverage[i]!, leafCount, blockingPrereq: blockingQ[i]!, blocked, state: "planned", findings: byEntry[i]! };
  });

  const count = (l: FindingLevel) => findings.filter((f) => f.level === l).reduce((s, f) => s + f.count, 0);
  return withCursor(
    {
      entries,
      findings,
      errorCount: count("error"),
      warningCount: count("warning"),
      reviewCount: count("review"),
      blockedCount: entries.filter((e) => e.blocked).length,
      nextAvailable: null,
      cycles,
      entryEdges,
      owner,
    },
    cursor,
  );
}

/**
 * The same analysis seen from another simulation cursor. Findings do not depend on the cursor, only each step's
 * state and the next available step do, so moving through the simulation never re-validates the plan.
 */
export function withCursor(a: PlanAnalysis, cursor: number): PlanAnalysis {
  const c = clamp(Math.trunc(cursor) || 0, 0, a.entries.length);
  let nextAvailable: number | null = null;
  const entries = a.entries.map((e, i) => {
    const state: RemovalState = i < c ? "simulated_removed" : !e.blocked && e.blockingPrereq < c ? "ready_for_review" : "planned";
    if (state === "ready_for_review" && nextAvailable === null) nextAvailable = i;
    return e.state === state ? e : { ...e, state };
  });
  return { ...a, entries, nextAvailable };
}

function describe(a: Acc, ids: readonly string[], prefix: string): string {
  const e = a.edges[0];
  const who = a.entryIndex >= 0 ? ids[a.entryIndex]! : "";
  switch (a.code) {
    case "PREREQ_NOT_IN_PLAN":
      return `${prefix}Blocking prerequisite ${e!.prerequisiteId} is not in the plan, but must be addressed before ${who}. ${e!.reason}`;
    case "ORDER_VIOLATION":
      return `${prefix}${who} is scheduled before its blocking prerequisite ${e!.prerequisiteId}. ${e!.reason}`;
    case "ADVISORY_NOT_IN_PLAN":
      return `${prefix}Advisory: ${e!.prerequisiteId} is related to ${who} and is not in the plan. ${e!.reason}`;
    case "ADVISORY_ORDER":
      return `${prefix}Advisory: ${e!.prerequisiteId} would normally be addressed before ${who} but is scheduled after it. ${e!.reason}`;
    case "UNKNOWN_LINK":
      return `${prefix}${who} is connected to components outside the plan; the model gives no removal order. ${e!.reason}`;
    default:
      return a.message;
  }
}

/** Record ids removed by the first `cursor` entries (assemblies expand to their parts; groups included). */
export function removedIds(analysis: PlanAnalysis, cursor: number): Set<string> {
  const out = new Set<string>();
  const upto = clamp(cursor, 0, analysis.entries.length);
  for (let i = 0; i < upto; i++) for (const c of analysis.entries[i]!.coverage) out.add(c);
  return out;
}
