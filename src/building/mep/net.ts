/**
 * Network graph builder (A3). A network is laid out as nodes (route points) and straight
 * runs between them; `emit` turns it into records from that single description:
 *   run          -> one pipe / conduit / cable / strip / tray record (length = |b - a|,
 *                   sloped drains are rotated cylinders with the configured gradient)
 *   node         -> a fitting chosen from the legs that meet there (elbow, tee, conduit
 *                   bend, junction box, tray piece), an explicit part (valve, meter, trap,
 *                   cleanout, cowl), an existing record (device, equipment, A2 endpoint),
 *                   or nothing (straight joint, cable bend)
 * Every joint becomes a connection (connectedTo) and a dependency in flow direction, so
 * geometry, quantities and connectivity come from the same source.
 */

import type { MepCategory, Vec3 } from "../structure";
import { fittingBox, PART_FILL, TRAY, type FittingPart } from "./parts";
import { axisDir, cross, dist, dot, len, near, norm, perpUp, placeLocal, sub, X, Y, type V3 } from "./geom";
import type { Draft, Group, MepDrafts } from "./record";

export type RunKind = "pipe" | "conduit" | "cable" | "strip" | "tray";

export interface RunSpec {
  readonly kind: RunKind;
  readonly group: Group;
  readonly networkId: string;
  /** Outer diameter (pipes, conduits, cables); strip / tray width. */
  readonly od: number;
  readonly materialId: string;
  readonly componentType: string;
  readonly label: string;
  readonly nominal: string;
  readonly category?: MepCategory;
  readonly carries?: readonly string[];
  /** Drainage fall (flow from a to b). Runs with a gradient are drawn sloped. */
  readonly gradient?: number;
  /** "upstream": b is fed through a (supply); "downstream": a discharges through b (drainage). */
  readonly flow?: "upstream" | "downstream";
  /** Strip thickness. */
  readonly thickness?: number;
  /** Tray: direction the open side faces (default world up; vertical risers face into the shaft). */
  readonly up?: V3;
  readonly roomId?: string;
  readonly assumptions?: string;
}

export interface NodePart {
  readonly kind: FittingPart;
  readonly group: Group;
  readonly networkId: string;
  readonly materialId: string;
  readonly label: string;
  readonly componentType: string;
  /** Pipe radius the part is sized for (default: the largest run at the node). */
  readonly r?: number;
  /** Inline / end parts: direction of the handle, dial or cap opening. */
  readonly up?: V3;
  readonly nominal?: string;
  readonly category?: MepCategory;
  readonly roomId?: string;
}

interface Node {
  readonly p: V3;
  readonly edges: number[];
  record?: string;
  part?: NodePart;
  /** Fitting / part record created by emit. */
  emitted?: string;
}

interface Edge {
  readonly a: number;
  readonly b: number;
  readonly spec: RunSpec;
  record?: string;
}

const FITTING_TYPES: Record<RunKind, { elbow: FittingPart | "tray-node" | null; tee: FittingPart | "tray-node" | null }> = {
  pipe: { elbow: "elbow", tee: "tee" },
  conduit: { elbow: "bend-conduit", tee: "jb" },
  tray: { elbow: "tray-node", tee: "tray-node" },
  cable: { elbow: null, tee: null },
  strip: { elbow: null, tee: null },
};

const CODE: Record<RunKind, string> = { pipe: "P", conduit: "C", cable: "K", strip: "S", tray: "T" };

export class Net {
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];

  /** A route point; `record` attaches an existing record (A2 endpoint, device, equipment). */
  node(p: V3, opts: { record?: string; part?: NodePart } = {}): number {
    this.nodes.push({ p, edges: [], ...(opts.record ? { record: opts.record } : {}), ...(opts.part ? { part: opts.part } : {}) });
    return this.nodes.length - 1;
  }

  point(n: number): V3 {
    return this.nodes[n]!.p;
  }

  setPart(n: number, part: NodePart): void {
    this.nodes[n]!.part = part;
  }

  setRecord(n: number, record: string): void {
    this.nodes[n]!.record = record;
  }

  /** Record emitted for a node's fitting / part (after emit). */
  emittedAt(n: number): string | undefined {
    return this.nodes[n]!.emitted;
  }

  /** Run records incident to a node (after emit). */
  runsAt(n: number): string[] {
    return this.nodes[n]!.edges.map((k) => this.edges[k]!.record!).filter(Boolean);
  }

  edge(a: number, b: number, spec: RunSpec): number {
    if (a === b) throw new Error("MEP: zero-length run");
    const pa = this.nodes[a]!.p;
    const pb = this.nodes[b]!.p;
    if (dist(pa, pb) < 1e-6) throw new Error(`MEP: zero-length run at ${pa.join(",")}`);
    this.edges.push({ a, b, spec });
    const i = this.edges.length - 1;
    this.nodes[a]!.edges.push(i);
    this.nodes[b]!.edges.push(i);
    return i;
  }

  /** Runs through a sequence of nodes / new points; returns the node ids. */
  run(path: readonly (number | V3)[], spec: RunSpec): number[] {
    const ids = path.map((p) => (typeof p === "number" ? p : this.node(p)));
    for (let i = 0; i + 1 < ids.length; i++) this.edge(ids[i]!, ids[i + 1]!, spec);
    return ids;
  }

  /** Unit direction of an edge leaving node n. */
  private dirFrom(n: number, e: Edge): V3 {
    const other = e.a === n ? e.b : e.a;
    return norm(sub(this.nodes[other]!.p, this.nodes[n]!.p));
  }

  emit(drafts: MepDrafts): void {
    // Runs first (fittings link to them), in insertion order.
    for (const e of this.edges) e.record = emitRun(drafts, this.nodes[e.a]!.p, this.nodes[e.b]!.p, e.spec).id;
    // Runs meeting an external record at several nodes (e.g. trap -> A2 connection point ->
    // wall chase) continue through it: join them directly so the network stays traceable.
    const viaExternal = new Map<string, Edge[]>();
    for (const n of this.nodes) if (n.record && (!drafts.byId.has(n.record) || n.edges.some((k) => drafts.byId.get(n.record!)!.networkId !== this.edges[k]!.spec.networkId))) for (const k of n.edges) (viaExternal.get(n.record) ?? viaExternal.set(n.record, []).get(n.record)!).push(this.edges[k]!);
    for (const list of viaExternal.values())
      for (let p = 0; p < list.length; p++)
        for (let q = p + 1; q < list.length; q++) if (list[p]!.spec.networkId === list[q]!.spec.networkId) drafts.link(list[p]!.record!, list[q]!.record!);
    this.nodes.forEach((n, i) => {
      const inc = n.edges.map((k) => this.edges[k]!);
      if (inc.length === 0) return;
      const legs = inc.map((e) => this.dirFrom(i, e));
      const fit = n.record ? null : (n.part ?? autoPart(inc, legs));
      if (fit && fit !== "none") {
        n.emitted = emitFitting(drafts, n.p, fit, inc, legs).id;
      } else if (fit === null && !n.record && inc.length === 1 && inc[0]!.spec.kind !== "cable" && inc[0]!.spec.kind !== "tray" && inc[0]!.spec.kind !== "strip") {
        throw new Error(`MEP: open end at ${n.p.map((v) => v.toFixed(3)).join(",")} (${inc[0]!.spec.group.id})`);
      }
      const hub = n.record ?? n.emitted;
      for (const e of inc) if (hub) drafts.link(e.record!, hub);
      // Straight joints, cable bends/splices, or a hub from another network: join the runs directly.
      const hubNet = hub ? drafts.byId.get(hub)?.networkId : undefined;
      for (let p = 0; p < inc.length; p++)
        for (let q = p + 1; q < inc.length; q++)
          if (inc[p]!.spec.networkId === inc[q]!.spec.networkId && hubNet !== inc[p]!.spec.networkId) drafts.link(inc[p]!.record!, inc[q]!.record!);
      // Dependencies in flow direction.
      for (const e of inc) {
        const down = e.spec.flow === "downstream";
        const isA = e.a === i;
        if (!hub) continue;
        // upstream flow: the run depends on its a-end, the b-end depends on the run
        if (!down) {
          if (isA) drafts.dependsOn(e.record!, hub);
          else drafts.dependsOn(hub, e.record!);
        } else {
          if (isA) drafts.dependsOn(hub, e.record!);
          else drafts.dependsOn(e.record!, hub);
        }
      }
    });
  }
}

type AutoPart = NodePart | "none" | null;

function autoPart(inc: Edge[], legs: V3[]): AutoPart {
  const kind = inc[0]!.spec.kind;
  const types = FITTING_TYPES[kind];
  if (inc.length === 1) return null; // open end (cables end on devices, trays and strips may simply stop; pipes must not)
  const ax = legs.map(axisDir);
  if (inc.length === 2) {
    if (dot(ax[0]!, ax[1]!) < -0.999) return "none"; // straight joint
    if (!types.elbow) return "none";
    const e = largest(inc);
    return { kind: types.elbow as FittingPart, group: e.spec.group, networkId: e.spec.networkId, materialId: e.spec.materialId, label: kind === "tray" ? "tray bend piece" : kind === "conduit" ? "conduit bend" : "elbow 90°", componentType: kind === "tray" ? "tray_fitting" : kind === "conduit" ? "conduit_bend" : "pipe_elbow", ...(e.spec.category ? { category: e.spec.category } : {}) };
  }
  if (inc.length === 3) {
    if (!types.tee) return "none";
    const e = largest(inc);
    return { kind: types.tee as FittingPart, group: e.spec.group, networkId: e.spec.networkId, materialId: e.spec.materialId, label: kind === "tray" ? "tray tee piece" : kind === "conduit" ? "junction box (round, 3-way)" : e.spec.gradient !== undefined || e.spec.flow === "downstream" ? "junction (sanitary tee)" : "equal / reducing tee", componentType: kind === "tray" ? "tray_fitting" : kind === "conduit" ? "junction_box" : "pipe_tee", ...(e.spec.category ? { category: e.spec.category } : {}) };
  }
  if (kind === "cable" || kind === "strip") return "none";
  if (inc.length === 4 && kind === "pipe") {
    const e = largest(inc);
    return { kind: "cross", group: e.spec.group, networkId: e.spec.networkId, materialId: e.spec.materialId, label: "double junction (double sanitary tee)", componentType: "pipe_cross", ...(e.spec.category ? { category: e.spec.category } : {}) };
  }
  throw new Error(`MEP: ${inc.length}-way joint in ${inc[0]!.spec.group.id} (not supported)`);
}

const largest = (inc: Edge[]) => inc.reduce((a, b) => (b.spec.od > a.spec.od ? b : a));

/** Basis for a fitting from its legs. */
function fittingBasis(kind: FittingPart | "tray-node", legs: V3[], up?: V3): { ex: V3; ey: V3 } {
  const ax = legs.map(axisDir);
  switch (kind) {
    case "elbow":
    case "bend-conduit":
    case "trap-bottle":
    case "trap-floor": {
      // Traps: outlet (horizontal) on +X, inlet (vertical) on +Y.
      const h = ax.findIndex((a) => Math.abs(a[1]) < 0.5);
      if ((kind === "trap-bottle" || kind === "trap-floor") && h >= 0) return { ex: ax[h]!, ey: ax[1 - h]! };
      return { ex: ax[0]!, ey: ax[1]! };
    }
    case "cross": {
      // two straight pairs: run on X, branches on Y
      const pairs: [number, number][] = [];
      for (let i = 0; i < ax.length; i++) for (let j = i + 1; j < ax.length; j++) if (dot(ax[i]!, ax[j]!) < -0.999) pairs.push([i, j]);
      if (pairs.length < 2) throw new Error("MEP: cross without two straight pairs");
      return { ex: ax[pairs[0]![0]]!, ey: ax[pairs[1]![0]]! };
    }
    case "tee":
    case "jb":
    case "tray-node": {
      // a junction box with a drop: lie flat (drum axis vertical), the drop leaves its base
      const v = ax.findIndex((a) => Math.abs(a[1]) > 0.5);
      if (kind === "jb" && v >= 0 && ax.length === 3) {
        const run = ax.find((_, i) => i !== v)!;
        return { ex: run, ey: cross(run, [0, 1, 0]) };
      }
      for (let i = 0; i < ax.length; i++)
        for (let j = i + 1; j < ax.length; j++)
          if (dot(ax[i]!, ax[j]!) < -0.999) {
            const k = [0, 1, 2].find((t) => t !== i && t !== j)!;
            return { ex: ax[i]!, ey: ax[k]! };
          }
      throw new Error("MEP: tee without a straight run");
    }
    default: {
      const ex = ax[0]!;
      let ey = up ? axisDir(up) : perpUp(ex);
      if (Math.abs(dot(ex, ey)) > 0.5) ey = perpUp(ex);
      return { ex, ey };
    }
  }
}

function emitFitting(drafts: MepDrafts, p: V3, part: NodePart, inc: Edge[], legs: V3[]): Draft {
  const e = largest(inc);
  if (e.spec.kind === "tray") {
    const { ex, ey } = { ex: axisDir(legs[0]!), ey: e.spec.up ?? Y };
    const w = TRAY.width;
    const lo: V3 = [-w / 2, 0, -w / 2];
    const hi: V3 = [w / 2, TRAY.depth, w / 2];
    const exh = Math.abs(dot(ex, ey)) > 0.5 ? perpUp(ey) : ex;
    const pl = placeLocal(p, exh, ey, lo, hi);
    return drafts.add(part.group, { code: "T", name: `${part.group.name}: ${part.label}`, componentType: part.componentType, materialId: part.materialId, geometry: { kind: "part", part: "tray-node", size: pl.size, fill: PART_FILL["tray-node"]! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] }, unit: "nr", networkId: part.networkId, nominalSize: e.spec.nominal, ...(part.category ? { category: part.category } : {}), ...(e.spec.roomId ? { roomId: e.spec.roomId } : {}) });
  }
  const r = part.r ?? Math.max(...inc.map((x) => x.spec.od / 2));
  const { ex, ey } = fittingBasis(part.kind, legs, part.up);
  const { lo, hi } = fittingBox(part.kind, r);
  const pl = placeLocal(p, ex, ey, lo, hi);
  const code = part.kind.startsWith("valve") ? "V" : part.kind === "meter-water" ? "M" : part.kind === "jb" ? "J" : part.kind.startsWith("trap") ? "R" : "F";
  return drafts.add(part.group, {
    code,
    name: `${part.group.name}: ${part.label}`,
    componentType: part.componentType,
    materialId: part.materialId,
    geometry: { kind: "part", part: part.kind, size: pl.size, fill: PART_FILL[part.kind]! },
    position: pl.position,
    rotation: pl.rotation,
    dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1], diameter: 2 * r },
    unit: "nr",
    networkId: part.networkId,
    nominalSize: part.nominal ?? e.spec.nominal,
    ...(part.category ? { category: part.category } : e.spec.category ? { category: e.spec.category } : {}),
    ...((part.roomId ?? e.spec.roomId) ? { roomId: part.roomId ?? e.spec.roomId } : {}),
  });
}

/** One straight run record. */
export function emitRun(drafts: MepDrafts, a: V3, b: V3, s: RunSpec): Draft {
  const d = sub(b, a);
  const L = len(d);
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const base = {
    code: CODE[s.kind],
    name: `${s.group.name}: ${s.label}`,
    componentType: s.componentType,
    materialId: s.materialId,
    unit: "m" as const,
    networkId: s.networkId,
    nominalSize: s.nominal,
    ...(s.category ? { category: s.category } : {}),
    ...(s.carries ? { carries: s.carries } : {}),
    ...(s.roomId ? { roomId: s.roomId } : {}),
    ...(s.assumptions ? { assumptions: s.assumptions } : {}),
  };
  if (s.kind === "tray") {
    const ex = norm(d);
    const ey = s.up ?? Y;
    const pl = placeLocal(a, ex, ey, [0, 0, -TRAY.width / 2], [L, TRAY.depth, TRAY.width / 2]);
    return drafts.add(s.group, { ...base, geometry: { kind: "part", part: "tray", size: pl.size, fill: PART_FILL.tray! }, position: pl.position, rotation: pl.rotation, dimensions: { length: L, width: TRAY.width, height: TRAY.depth } });
  }
  const ad = axisDir(d);
  const axis: "x" | "y" | "z" = ad[0] !== 0 ? "x" : ad[1] !== 0 ? "y" : "z";
  const along = Math.abs(axis === "x" ? d[0] : axis === "y" ? d[1] : d[2]);
  const off = L - along; // non-zero only for sloped runs
  let rotation: Vec3 = [0, 0, 0];
  if (off > 1e-9) {
    if (axis === "y") throw new Error(`MEP: skewed vertical run in ${s.group.id}`);
    // Sloped horizontal: rotate the cylinder in its vertical plane (axis x -> about z; axis z -> about x).
    const crossOff = axis === "x" ? Math.abs(d[2]) : Math.abs(d[0]);
    if (crossOff > 1e-6) throw new Error(`MEP: run is neither axis-aligned nor a vertical-plane slope in ${s.group.id}`);
    rotation = axis === "x" ? [0, 0, Math.atan(d[1] / d[0])] : [Math.atan(-d[1] / d[2]), 0, 0];
  }
  const flow = s.gradient !== undefined ? { gradient: s.gradient, flowFrom: [...a] as unknown as Vec3, flowTo: [...b] as unknown as Vec3 } : {};
  if (s.kind === "strip") {
    const t = s.thickness ?? 0.003;
    // Earth strips: flat bar, broad face against the surface it is fixed to (vertical: faces X).
    const size: Vec3 = axis === "x" ? [L, t, s.od] : axis === "z" ? [s.od, t, L] : [t, L, s.od];
    return drafts.add(s.group, { ...base, geometry: { kind: "box", size }, position: mid, dimensions: { length: L, width: s.od, thickness: t } });
  }
  return drafts.add(s.group, { ...base, ...flow, geometry: { kind: "cylinder", radius: s.od / 2, height: L, axis }, position: mid, rotation, dimensions: { length: L, diameter: s.od } });
}

/** Re-exported helpers used by generators. */
export { cross, near, X };
