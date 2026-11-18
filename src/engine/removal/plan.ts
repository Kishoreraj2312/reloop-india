/**
 * Removal-plan operations (B3). Pure and immutable: every function returns a new plan. Plans reference
 * components by ID only and never touch model records, B1 quantities or B2 assessments.
 *
 * Any edit that changes an entry before the simulation cursor pulls the cursor back to that entry, so the
 * "simulated as removed" prefix always describes the plan as it now stands.
 */

import type { RelationshipGraph } from "./graph";
import { requiredBefore } from "./sequence";
import type { PlanAnalysis, RemovalPlan, UserEdge } from "./types";

export const createPlan = (id: string, name: string): RemovalPlan => ({ id, name: name.trim() || "Removal plan", entries: [], notes: {}, userEdges: [], cursor: 0 });

export const renamePlan = (p: RemovalPlan, name: string): RemovalPlan => ({ ...p, name: name.trim() || p.name });

/** An independent copy with the same entries, notes and user dependencies, restarted at step 0. */
export const duplicatePlan = (p: RemovalPlan, id: string, name?: string): RemovalPlan => ({
  id,
  name: name?.trim() || `${p.name} (copy)`,
  entries: [...p.entries],
  notes: { ...p.notes },
  userEdges: p.userEdges.map((e) => ({ ...e })),
  cursor: 0,
});

/** Empty the plan (entries, notes, user dependencies) and restart the simulation. */
export const clearPlan = (p: RemovalPlan): RemovalPlan => ({ ...p, entries: [], notes: {}, userEdges: [], cursor: 0 });

export interface AddResult {
  readonly plan: RemovalPlan;
  readonly added: readonly string[];
  /** Ids already in the plan. */
  readonly duplicates: readonly string[];
  /** Ids that do not exist in the model. */
  readonly unknown: readonly string[];
}

/** Insert components at `at` (default: the end). Existing entries, unknown ids and repeats are skipped and reported. */
export function addEntries(p: RemovalPlan, graph: RelationshipGraph, ids: readonly string[], at?: number): AddResult {
  const have = new Set(p.entries);
  const added: string[] = [];
  const duplicates: string[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    if (!graph.has(id)) unknown.push(id);
    else if (have.has(id)) duplicates.push(id);
    else {
      have.add(id);
      added.push(id);
    }
  }
  if (!added.length) return { plan: p, added, duplicates, unknown };
  const pos = at === undefined ? p.entries.length : Math.min(Math.max(at, 0), p.entries.length);
  const entries = [...p.entries.slice(0, pos), ...added, ...p.entries.slice(pos)];
  return { plan: { ...p, entries, cursor: Math.min(p.cursor, pos) }, added, duplicates, unknown };
}

export function removeEntry(p: RemovalPlan, index: number): RemovalPlan {
  if (index < 0 || index >= p.entries.length) return p;
  const id = p.entries[index]!;
  const entries = p.entries.filter((_, i) => i !== index);
  const notes = { ...p.notes };
  if (!entries.includes(id)) delete notes[id];
  return { ...p, entries, notes, cursor: Math.min(p.cursor, index) };
}

export function moveEntry(p: RemovalPlan, from: number, to: number): RemovalPlan {
  const n = p.entries.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return p;
  const entries = [...p.entries];
  const [x] = entries.splice(from, 1);
  entries.splice(to, 0, x!);
  return { ...p, entries, cursor: Math.min(p.cursor, from, to) };
}

/** Replace the order wholesale (e.g. from a suggested order the user accepted). Must be a permutation of the entries. */
export function reorder(p: RemovalPlan, order: readonly string[]): RemovalPlan {
  if (order.length !== p.entries.length || [...order].sort().join("\n") !== [...p.entries].sort().join("\n")) return p;
  const first = order.findIndex((id, i) => id !== p.entries[i]);
  return first < 0 ? p : { ...p, entries: [...order], cursor: Math.min(p.cursor, first) };
}

export function setNote(p: RemovalPlan, id: string, text: string): RemovalPlan {
  const notes = { ...p.notes };
  if (text.trim()) notes[id] = text;
  else delete notes[id];
  return { ...p, notes };
}

// ── simulation cursor ────────────────────────────────────────────────────────

export const resetSimulation = (p: RemovalPlan): RemovalPlan => (p.cursor === 0 ? p : { ...p, cursor: 0 });
export const stepBack = (p: RemovalPlan): RemovalPlan => (p.cursor > 0 ? { ...p, cursor: p.cursor - 1 } : p);
/** Advance one step, only if the entry at the cursor is not blocked. */
export function stepForward(p: RemovalPlan, a: PlanAnalysis): RemovalPlan {
  const e = a.entries[p.cursor];
  return e && !e.blocked ? { ...p, cursor: p.cursor + 1 } : p;
}
/** Move the cursor to `target` (entries before it simulated as removed); going forward stops at the first blocked entry. */
export function goToStep(p: RemovalPlan, a: PlanAnalysis, target: number): RemovalPlan {
  const t = Math.min(Math.max(Math.trunc(target), 0), p.entries.length);
  let c = Math.min(p.cursor, t);
  while (c < t && !a.entries[c]!.blocked) c++;
  return c === p.cursor ? p : { ...p, cursor: c };
}

// ── user-defined dependencies ────────────────────────────────────────────────

export interface UserEdgeInput {
  readonly prerequisiteId: string;
  readonly dependentId: string;
  readonly severity: "blocking" | "advisory";
  readonly reason: string;
}

function checkUserEdge(p: RemovalPlan, graph: RelationshipGraph, i: UserEdgeInput, ignoreId?: string): string | null {
  if (!i.reason.trim()) return "A reason is required for a user-defined dependency.";
  if (!graph.has(i.prerequisiteId)) return `Unknown component: ${i.prerequisiteId}`;
  if (!graph.has(i.dependentId)) return `Unknown component: ${i.dependentId}`;
  if (i.prerequisiteId === i.dependentId) return "A component cannot be its own prerequisite.";
  if (p.userEdges.some((e) => e.id !== ignoreId && e.prerequisiteId === i.prerequisiteId && e.dependentId === i.dependentId)) return "That user-defined dependency already exists.";
  return null;
}

export function addUserEdge(p: RemovalPlan, graph: RelationshipGraph, input: UserEdgeInput, id: string): { plan: RemovalPlan; error: string | null } {
  const error = checkUserEdge(p, graph, input);
  if (error) return { plan: p, error };
  const e: UserEdge = { id, prerequisiteId: input.prerequisiteId, dependentId: input.dependentId, severity: input.severity, reason: input.reason.trim() };
  return { plan: { ...p, userEdges: [...p.userEdges, e] }, error: null };
}

export function updateUserEdge(p: RemovalPlan, graph: RelationshipGraph, id: string, input: UserEdgeInput): { plan: RemovalPlan; error: string | null } {
  if (!p.userEdges.some((e) => e.id === id)) return { plan: p, error: "No such user-defined dependency." };
  const error = checkUserEdge(p, graph, input, id);
  if (error) return { plan: p, error };
  return { plan: { ...p, userEdges: p.userEdges.map((e) => (e.id === id ? { id, ...input, reason: input.reason.trim() } : e)) }, error: null };
}

export const removeUserEdge = (p: RemovalPlan, id: string): RemovalPlan => ({ ...p, userEdges: p.userEdges.filter((e) => e.id !== id) });

// ── prerequisites ───────────────────────────────────────────────────────────

/**
 * Insert, just before `entryId`, the records that must be removed before it (blocking prerequisites, transitively)
 * and that the plan does not yet cover, ordered so they satisfy the relationships among themselves.
 * An explicit user action; entries already in the plan stay where they are.
 */
export function insertPrerequisites(p: RemovalPlan, graph: RelationshipGraph, entryId: string): { plan: RemovalPlan; added: readonly string[]; truncated: boolean } {
  const at = p.entries.indexOf(entryId);
  if (at < 0) return { plan: p, added: [], truncated: false };
  const have = new Set<string>();
  for (const id of p.entries) for (const c of graph.coverage(id)) have.add(c);
  const { required, edges, truncated } = requiredBefore(graph, [entryId]);
  const fresh = required.filter((r) => !have.has(r));
  if (!fresh.length) return { plan: p, added: [], truncated };
  // order the new records among themselves (prerequisite first), stable by discovery order
  const top = new Map<string, string>();
  for (const t of [entryId, ...fresh]) for (const x of graph.coverage(t)) if (!top.has(x)) top.set(x, t);
  const idx = new Map(fresh.map((id, i) => [id, i]));
  const out: number[][] = fresh.map(() => []);
  const indeg = fresh.map(() => 0);
  for (const e of edges) {
    const a = idx.get(top.get(e.prerequisiteId) ?? "");
    const b = idx.get(top.get(e.dependentId) ?? "");
    if (a !== undefined && b !== undefined && a !== b) {
      out[a]!.push(b);
      indeg[b]!++;
    }
  }
  const ready = fresh.map((_, i) => i).filter((i) => indeg[i] === 0);
  const order: number[] = [];
  while (ready.length) {
    ready.sort((x, y) => y - x);
    const v = ready.pop()!;
    order.push(v);
    for (const w of out[v]!) if (--indeg[w]! === 0) ready.push(w);
  }
  for (let i = 0; i < fresh.length; i++) if (!order.includes(i)) order.push(i);
  const added = order.map((i) => fresh[i]!);
  const entries = [...p.entries.slice(0, at), ...added, ...p.entries.slice(at)];
  return { plan: { ...p, entries, cursor: Math.min(p.cursor, at) }, added, truncated };
}
