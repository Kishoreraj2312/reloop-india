/**
 * Relationship graph (B3): turns the model's raw relationship fields into removal-order edges
 * (prerequisite -> dependent) through one adapter per source. Nothing is inferred from proximity, nothing is
 * invented: a field whose direction cannot be read for removal order becomes an "unknown" link that implies no order.
 *
 * Census of the generated model (scripts/removal/census.ts, documented in docs/REMOVAL_SIMULATION.md):
 *   A1 structure   dependencies = "bears on / frames into": X lists the member it rests on, so X goes BEFORE it.
 *                  (parentId = member beneath is the same relation: all 252 such edges are also in dependencies.)
 *   A2 openings    dependencies = opening -> host wall assembly and lintel: the opening goes BEFORE its host.
 *   A2/A3 parentId = containing assembly (a group record): containment, never an order.
 *   A3 MEP         dependencies = "fed from / drains into": supply and electrical point upstream (prerequisite =
 *                  the listed record), drainage points downstream (prerequisite = the listing record).
 *   A3 connectedTo = physical joints, symmetric except for 3,602 one-way entries: no order.
 */

import type { DependencyEdge, GraphNode, Relationship } from "./types";

/** Minimal shape of a generated ComponentRecord (kept structural so tests can use small fixtures). */
export interface NodeSource {
  readonly id: string;
  readonly name: string;
  readonly system: string;
  readonly componentType: string;
  readonly floor: number;
  readonly parentId?: string;
  readonly dependencies: readonly string[];
  readonly connectedTo?: readonly string[];
  readonly networkId?: string;
  readonly geometry: { readonly kind: string };
}

export const nodeOf = (r: NodeSource): GraphNode => ({
  id: r.id,
  name: r.name,
  system: r.system,
  componentType: r.componentType,
  floor: r.floor,
  ...(r.parentId !== undefined ? { parentId: r.parentId } : {}),
  dependencies: r.dependencies,
  ...(r.connectedTo !== undefined ? { connectedTo: r.connectedTo } : {}),
  ...(r.networkId !== undefined ? { networkId: r.networkId } : {}),
  group: r.geometry.kind === "group",
});

const label = (n: GraphNode) => `${n.id} (${n.componentType})`;
const OPENING = /^(window|door|cased_opening)_assembly$/;

type Family = "supply" | "drain";
/** Flow family of an MEP record, from its network id; null where the model does not say. */
function flowFamily(n: GraphNode): Family | null {
  const net = n.networkId ?? "";
  if (/^PLB-NET-(CW|HW|WS)(-|$)/.test(net) || net.startsWith("ELC-NET-")) return "supply";
  if (/^PLB-NET-(DR|SEW|RW)(-|$)/.test(net)) return "drain";
  return null;
}
const isVent = (n: GraphNode) => n.componentType.startsWith("vent");

function make(
  prerequisite: GraphNode,
  dependent: GraphNode,
  relationship: Relationship,
  severity: DependencyEdge["severity"],
  directed: boolean,
  via: string,
  reason: string,
): DependencyEdge {
  // An undirected link is stored with its ends in sorted order, so (a,b) and (b,a) are the same edge.
  const [p, d] = directed || prerequisite.id <= dependent.id ? [prerequisite, dependent] : [dependent, prerequisite];
  return { id: `model|${relationship}|${p.id}>${d.id}`, prerequisiteId: p.id, dependentId: d.id, relationship, severity, directed, source: "model", via, reason };
}

/**
 * Adapter for one entry S.dependencies[T] (or the structural parentId, `field` = "parentId").
 * Returns null when the pair is not usable (unknown target).
 */
export function dependencyEdge(s: GraphNode, t: GraphNode | undefined, field: "dependencies" | "parentId" = "dependencies"): DependencyEdge | null {
  if (!t || s.id === t.id) return null;
  const via = `${s.id}.${field}`;
  if (s.system === "structure" && t.system === "structure") {
    return make(s, t, "bears_on", "blocking", true, via, `${label(s)} bears on ${label(t)}: the supported element is removed before its support.`);
  }
  if (s.system === "architecture" && t.system === "architecture" && OPENING.test(s.componentType)) {
    return make(s, t, "hosted_in", "blocking", true, via, `${label(s)} is hosted in ${label(t)}: the opening is removed before the element that hosts it.`);
  }
  if ((s.system === "plumbing" || s.system === "electrical") && (t.system === "plumbing" || t.system === "electrical")) {
    const fs = flowFamily(s);
    const ft = flowFamily(t);
    if (fs !== null && fs === ft && !isVent(s) && !isVent(t)) {
      return fs === "supply"
        ? make(t, s, "fed_from", "advisory", true, via, `${label(s)} is fed from ${label(t)}: confirm the supply side is isolated or addressed first. Isolation status is not modelled.`)
        : make(s, t, "drains_into", "advisory", true, via, `${label(s)} drains into ${label(t)}: the discharging element is removed before the receiving one. Discharge status is not modelled.`);
    }
  }
  return make(s, t, "unordered_flow", "unknown", false, via, `${label(s)} depends on ${label(t)} in the model, but the direction cannot be read as a removal order here (vent, cross-system or unrecognised relationship): review manually.`);
}

function linkEdge(a: GraphNode, b: GraphNode): DependencyEdge {
  return make(a, b, "connected_to", "unknown", false, `${a.id}.connectedTo`, `${label(a)} is physically connected to ${label(b)}. The model records the joint but no removal order: review whether it must be disconnected.`);
}

export class RelationshipGraph {
  private readonly byId = new Map<string, GraphNode>();
  private readonly kids = new Map<string, string[]>();
  private readonly fwd = new Map<string, { to: string; field: "dependencies" | "parentId" }[]>();
  private readonly rev = new Map<string, string[]>();
  private readonly revConn = new Map<string, string[]>();
  private readonly leafCache = new Map<string, readonly string[]>();

  constructor(nodes: readonly GraphNode[]) {
    for (const n of nodes) this.byId.set(n.id, n);
    for (const n of nodes) {
      const parent = n.parentId !== undefined ? this.byId.get(n.parentId) : undefined;
      if (parent?.group) (this.kids.get(parent.id) ?? this.kids.set(parent.id, []).get(parent.id)!).push(n.id);
      const f: { to: string; field: "dependencies" | "parentId" }[] = [];
      for (const t of n.dependencies) if (this.byId.has(t)) f.push({ to: t, field: "dependencies" });
      // A1 "member beneath": the same relation as dependencies; added only when a record omits it.
      if (n.system === "structure" && parent && !parent.group && !n.dependencies.includes(parent.id)) f.push({ to: parent.id, field: "parentId" });
      if (f.length) this.fwd.set(n.id, f);
      for (const x of f) (this.rev.get(x.to) ?? this.rev.set(x.to, []).get(x.to)!).push(n.id);
      for (const c of n.connectedTo ?? []) if (this.byId.has(c)) (this.revConn.get(c) ?? this.revConn.set(c, []).get(c)!).push(n.id);
    }
  }

  get size(): number {
    return this.byId.size;
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  node(id: string): GraphNode | undefined {
    return this.byId.get(id);
  }
  isGroup(id: string): boolean {
    return this.byId.get(id)?.group === true;
  }
  /** Parts of an assembly (empty for a plain component). */
  children(id: string): readonly string[] {
    return this.kids.get(id) ?? [];
  }
  /** The assembly that contains `id`, if its parent is a group (A1 "member beneath" is not containment). */
  containerOf(id: string): string | undefined {
    const p = this.byId.get(id)?.parentId;
    return p !== undefined && this.byId.get(p)?.group ? p : undefined;
  }
  /** Drawn (non-group) components an id stands for: itself, or an assembly's parts at any depth. */
  leaves(id: string): readonly string[] {
    const n = this.byId.get(id);
    if (!n) return [];
    if (!n.group) return [id];
    const hit = this.leafCache.get(id);
    if (hit) return hit;
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      const c = this.byId.get(cur)!;
      if (!c.group) out.push(cur);
      else for (const k of this.children(cur)) stack.push(k);
    }
    this.leafCache.set(id, out);
    return out;
  }
  /** The id plus every descendant record (assemblies and parts). */
  coverage(id: string): string[] {
    if (!this.byId.has(id)) return [];
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      out.push(cur);
      for (const k of this.children(cur)) stack.push(k);
    }
    return out;
  }

  /** Every relationship touching `id`: ordered edges (either end) and order-free links. */
  edgesOf(id: string): DependencyEdge[] {
    const n = this.byId.get(id);
    if (!n) return [];
    const out = new Map<string, DependencyEdge>();
    const add = (e: DependencyEdge | null) => e && out.set(e.id, e);
    for (const x of this.fwd.get(id) ?? []) add(dependencyEdge(n, this.byId.get(x.to), x.field));
    for (const s of this.rev.get(id) ?? []) {
      const sn = this.byId.get(s)!;
      for (const x of this.fwd.get(s) ?? []) if (x.to === id) add(dependencyEdge(sn, n, x.field));
    }
    const nb = new Set<string>([...(n.connectedTo ?? []), ...(this.revConn.get(id) ?? [])]);
    for (const o of nb) {
      const on = this.byId.get(o);
      if (on && o !== id) add(linkEdge(n, on));
    }
    return [...out.values()];
  }

  /** Ordered edges whose dependent is `id` (blocking and advisory). */
  prerequisitesOf(id: string): DependencyEdge[] {
    return this.edgesOf(id).filter((e) => e.directed && e.dependentId === id);
  }
  /** Ordered edges whose prerequisite is `id`. */
  dependentsOf(id: string): DependencyEdge[] {
    return this.edgesOf(id).filter((e) => e.directed && e.prerequisiteId === id);
  }
  /** Relationships that imply no order (physical joints, unreadable dependencies). */
  linksOf(id: string): DependencyEdge[] {
    return this.edgesOf(id).filter((e) => !e.directed);
  }
}
