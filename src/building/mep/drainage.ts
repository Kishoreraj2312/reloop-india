/**
 * Soil, waste and vent drainage (A3), single-stack system.
 *
 * 1. Endpoints: every A2 WC pan, floor/shower drain and waste connection point (basin,
 *    sink, washer) on every storey.
 * 2. Tails: WCs and floor drains drop straight through the slab; wall waste outlets run
 *    from the fixture trap (bottle trap under basins, P-trap in the sink cabinet) into the
 *    connection point, down the wall chase and through the slab. On gridline walls the
 *    beam below blocks the chase, so the tail steps out of the wall at floor level first.
 * 3. Stacks: one per apartment and structural bay holding drains, placed in a wet-room
 *    corner that is free on every storey (fixtures, clearances, door swings, approach
 *    zones, beams, columns, roof items), nearest to that bay's drains.
 * 4. Branches: per storey a rectilinear tree from the drains to the stack in zone B below
 *    the slab (above the masonry, between beams, so it never crosses a beam), sloped 1:60
 *    (110 mm) / 1:40 (50-75 mm) down to the stack junction.
 * 5. Stack below the ground slab bends into an underground building drain (1:100) to an
 *    inspection chamber outside the facade; chambers on each long side join a sewer line
 *    to a final manhole. Above the top junction the stack continues as the stack vent
 *    through the roof to a cowl.
 */

import type { ComponentRecord } from "../structure";
import type { PlanRect } from "../architecture/rect";
import { overlaps } from "../architecture/rect";
import { fixtureSpace, isFree } from "../architecture/fixtureSpace";
import { arcHitsRect, swingArcs } from "../architecture/swing";
import type { InteriorRoom } from "../architecture/interior";
import { MEP_CONFIG } from "./config";
import { CEILINGS, FINISHES, declareNetwork, endpoint, indexDrafts, planObstacles, unresolved, type MepContext } from "./context";
import { FIXED_PARTS, PART_FILL, type FittingPart } from "./parts";
import { Net, type NodePart, type RunSpec } from "./net";
import { buildTree, routeOrtho, type Tree } from "./router";
import { box3 } from "./space";
import { add, axisDir, placeLocal, scale, sub, type P2, type V3 } from "./geom";
import { alongOf, findChase, inMasonry, mountAt, runFree, throughFloor, wallPoint, type Allow } from "./walls";
import type { Group } from "./record";

const C = MEP_CONFIG;
const P = C.pipe;
/** Half width the branch router keeps clear (largest branch + half the clearance). */
const TREE_HALF = P.swr110.od / 2 + 0.005 + C.clearance / 2;

type DrainKind = "wc" | "floor" | "wall";

interface DrainEnd {
  readonly rec: ComponentRecord;
  readonly kind: DrainKind;
  readonly storey: number;
  readonly aptId: string;
  readonly roomId: string;
  readonly fixture?: ComponentRecord; // basin / sink bowl (trap side)
}

interface TailNode {
  readonly p: V3;
  readonly record?: string;
  readonly part?: FittingPart;
}

interface Tail {
  readonly end: DrainEnd;
  /** Fixture -> trap -> connection point (outer end); empty for WCs, floor drains, washers. */
  readonly fixturePath: TailNode[];
  /** From the endpoint down to the last bend above the slab penetration. */
  readonly nodes: TailNode[];
  readonly p: P2;
  readonly od: number;
  readonly nominal: string;
  readonly finalPart: FittingPart | null;
}

export interface Stack {
  readonly id: string; // "A1-S1"
  readonly aptId: string;
  readonly p: P2;
  readonly bay: string;
  readonly networkId: string;
  readonly roomAtTop: string;
  /** Horizontal direction toward the room (cleanout doors face this way). */
  readonly face: V3;
  readonly groundOnly?: boolean;
}

const bayKey = (ctx: MepContext, x: number, z: number) => {
  const g = ctx.grid;
  const ix = Math.min(g.xs.length - 2, Math.max(0, Math.floor((x - g.xs[0]!) / ctx.cfg.gridSpacingX)));
  const iz = Math.min(g.zs.length - 2, Math.max(0, Math.floor((z - g.zs[0]!) / ctx.cfg.gridSpacingZ)));
  return `${ix},${iz}`;
};

const bayRect = (ctx: MepContext, key: string): PlanRect => {
  const [ix, iz] = key.split(",").map(Number) as [number, number];
  const g = ctx.grid;
  return { x0: g.xs[ix]!, x1: g.xs[ix + 1]!, z0: g.zs[iz]!, z1: g.zs[iz + 1]! };
};

/** Pipe-extent band for drains hanging below slab s (centre must stay r inside it). */
export function drainZone(ctx: MepContext, s: number): { lo: number; hi: number; soffit: number } {
  if (s === 0) return { lo: C.ground.branchBottom, hi: C.ground.branchTop, soffit: -ctx.cfg.slab.thickness };
  const soffit = ctx.d.slabTop(s) - ctx.cfg.slab.thickness;
  return { lo: ctx.d.wallTop(s - 1) + C.drainZone.aboveWallTop, hi: soffit - C.drainZone.belowSoffit, soffit };
}

// ── 1. endpoints ──────────────────────────────────────────────────────────────

function drainEnds(ctx: MepContext): DrainEnd[] {
  const out: DrainEnd[] = [];
  for (const r of ctx.archRecords) {
    if (r.geometry.kind === "group" || !r.roomId || !r.apartmentId) continue;
    let kind: DrainKind | null = null;
    let fixture: ComponentRecord | undefined;
    if (r.componentType === "wc_pan") kind = "wc";
    else if (r.componentType === "floor_drain") kind = "floor";
    else if (r.componentType === "connection_point" && /-(CPD|CP-BSN-D)$/.test(r.id)) {
      kind = "wall";
      if (r.id.endsWith("-CP-BSN-D")) fixture = ctx.byId.get(r.id.replace(/-CP-BSN-D$/, "-BSN"));
      else if (r.id.startsWith("ARC-KIT-")) fixture = ctx.byId.get(r.id.replace(/-CPD$/, "-SNK-B"));
    }
    if (!kind) continue;
    out.push({ rec: r, kind, storey: r.floor, aptId: r.apartmentId, roomId: r.roomId, ...(fixture ? { fixture } : {}) });
    endpoint(ctx, r.id, kind === "wc" ? "soil (WC outlet)" : kind === "floor" ? "floor / shower drain" : r.id.includes("BSN") ? "basin waste" : r.id.startsWith("ARC-KIT") ? "sink waste" : "washer waste");
    if (fixture) endpoint(ctx, fixture.id, fixture.componentType === "basin" ? "basin outlet (trap)" : "sink outlet (trap)");
  }
  return out;
}

// ── 2. tails ──────────────────────────────────────────────────────────────────

const centre = (r: ComponentRecord): V3 => [r.originalPosition[0], r.originalPosition[1], r.originalPosition[2]];
const bottom = (r: ComponentRecord): number => {
  const g = r.geometry;
  const h = g.kind === "box" ? g.size[1] : g.kind === "cylinder" ? (g.axis === "y" ? g.height : 2 * g.radius) : 0;
  return r.originalPosition[1] - h / 2;
};

function roomOf(ctx: MepContext, storey: number, roomId: string): InteriorRoom {
  const ir = ctx.interiors[storey]!.rooms.get(roomId);
  if (!ir) throw new Error(`MEP: room ${roomId} missing on storey ${storey}`);
  return ir;
}

/** Plan rect of a solid record. */
const planOf = (r: ComponentRecord): PlanRect => {
  const p = r.originalPosition;
  const g = r.geometry;
  const [hx, hz] = g.kind === "box" || g.kind === "part" ? [g.size[0] / 2, g.size[2] / 2] : g.kind === "cylinder" ? (g.axis === "x" ? [g.height / 2, g.radius] : g.axis === "z" ? [g.radius, g.height / 2] : [g.radius, g.radius]) : [0, 0];
  return { x0: p[0] - hx, x1: p[0] + hx, z0: p[2] - hz, z1: p[2] + hz };
};

/** Beam rectangles (plan) under the slab of level s, inflated to the clearance a pipe of radius r needs. */
function beamsBelow(ctx: MepContext, level: number, r: number): PlanRect[] {
  const y = ctx.d.slabTop(level) - ctx.cfg.beam.depth / 2;
  return ctx.structure
    .filter((x) => x.componentType === "beam" && Math.abs(x.originalPosition[1] - y) < 0.3)
    .map((x) => {
      const b = planOf(x);
      const g = r + C.clearance;
      return { x0: b.x0 - g, x1: b.x1 + g, z0: b.z0 - g, z1: b.z1 + g };
    });
}

const inRects = (rs: readonly PlanRect[], x: number, z: number) => rs.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);

function makeTail(ctx: MepContext, e: DrainEnd): Tail | null {
  const s = e.storey;
  const ffl = ctx.d.ffl(s);
  const ir = roomOf(ctx, s, e.roomId);
  // Penetrations must clear beams/columns by what the branch router needs (largest pipe + clearance).
  const beams = beamsBelow(ctx, s, TREE_HALF);
  if (e.kind === "wc" || e.kind === "floor") {
    const c = centre(e.rec);
    let x = c[0];
    let z = c[2];
    if (e.kind === "wc") {
      // S-trap outlet: 0.30 from the wall face behind the pan (pan box starts 0.18 out).
      const cis = ctx.byId.get(e.rec.id.replace(/-WC-P$/, "-WC-C"));
      const cc = cis ? centre(cis) : c;
      const m = mountAt(s, ir, cc[0], cc[2]);
      const pr = planOf(e.rec);
      const near = m.side === "S" ? pr.z0 : m.side === "N" ? pr.z1 : m.side === "W" ? pr.x0 : pr.x1;
      const d = Math.abs(near - m.face) + 0.12;
      const pt = wallPoint(m, alongOf(m, c), 0, d);
      x = pt[0];
      z = pt[2];
    }
    const pipe = e.kind === "wc" ? P.swr110 : P.swr75;
    if (inRects(beamsBelow(ctx, s, pipe.od / 2), x, z)) {
      unresolved(ctx, e.rec.id, "outlet lies over a beam: no slab penetration possible without an offset (not modelled)");
      return null;
    }
    return {
      end: e,
      fixturePath: [],
      nodes: [{ p: [x, bottom(e.rec), z], record: e.rec.id }],
      p: [x, z],
      od: pipe.od,
      nominal: pipe.nominal,
      finalPart: e.kind === "floor" ? "trap-floor" : null,
    };
  }
  // Wall waste outlet
  const cp = e.rec;
  const c = centre(cp);
  const m = mountAt(s, ir, c[0], c[2]);
  const g = cp.geometry;
  const h = g.kind === "cylinder" ? g.height : 0.05;
  // Stub runs from the finished face outward; its wall end is the nearer end to the plaster face.
  const out = scale(m.n, h / 2);
  const outer = add(c, out);
  const wallEnd = sub(c, out);
  const y = c[1];
  const a = alongOf(m, c);
  const r = P.waste50.od / 2;
  const fixturePath: TailNode[] = [];
  if (e.fixture) {
    const f = e.fixture;
    const fc = centre(f);
    const fa = alongOf(m, fc);
    const fd = m.axis === "x" ? (fc[2] - m.face) * m.n[2] : (fc[0] - m.face) * m.n[0];
    const outletY = bottom(f);
    fixturePath.push({ p: wallPoint(m, fa, outletY, fd), record: f.id });
    fixturePath.push({ p: wallPoint(m, fa, y, fd), part: "trap-bottle" });
    if (Math.abs(fa - a) > 0.02) fixturePath.push({ p: wallPoint(m, a, y, fd) });
    fixturePath.push({ p: outer, record: cp.id });
  }
  const kitchenCabinet: Allow = (x) => x.roomId === e.roomId && (x.componentType === "kitchen_base_cabinet" || x.componentType === "kitchen_plinth");
  const floorAllow: Allow = (x) => throughFloor(x) || kitchenCabinet(x) || inMasonry(x);
  // Case A: straight down the chase through the slab (no beam under this stretch of wall).
  const zone = drainZone(ctx, s);
  const below = zone.hi - r;
  const nodes: TailNode[] = [{ p: wallEnd, record: cp.id }];
  const chaseA = findChase(ctx, m, a, y, below, r, { reach: 0.6, extraAllow: throughFloor, clear: TREE_HALF - r + C.clearance });
  if (chaseA) {
    const pts = chaseA.points;
    nodes.push({ p: pts[0]! });
    if (pts.length === 3) nodes.push({ p: pts[1]! });
    const last = pts[pts.length - 1]!;
    return { end: e, fixturePath, nodes, p: [last[0], last[2]], od: P.waste50.od, nominal: P.waste50.nominal, finalPart: null };
  }
  // Case B: chase down to floor level, step out past the beam, then down through the floor.
  const yt = ffl + C.tail.chaseBottom;
  const ch = findChase(ctx, m, a, y, yt, r, { reach: 0.0001 });
  /** How far the (inflated) beam under this wall reaches into the room past the plaster face. */
  const beamReach = (x: number, z: number) => {
    let dmax = 0;
    for (const b of beams) {
      const inAlong = m.axis === "x" ? x > b.x0 && x < b.x1 : z > b.z0 && z < b.z1;
      const nearWall = m.axis === "x" ? b.z0 < m.face + 0.6 && b.z1 > m.face - 0.6 : b.x0 < m.face + 0.6 && b.x1 > m.face - 0.6;
      if (!inAlong || !nearWall) continue;
      const far = m.axis === "x" ? (m.n[2] > 0 ? b.z1 : b.z0) : m.n[0] > 0 ? b.x1 : b.x0;
      dmax = Math.max(dmax, (far - m.face) * (m.axis === "x" ? m.n[2] : m.n[0]));
    }
    return dmax;
  };
  for (let k = 0; ch && k <= 48; k++) {
    const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.025;
    const ac = a + off;
    const bottomPt = ch.points[ch.points.length - 1]!;
    const foot = wallPoint(m, ac, yt, -C.chase);
    if (off !== 0 && !runFree(ctx, bottomPt, foot, r, inMasonry)) continue;
    const probe = wallPoint(m, ac, yt, 0.2);
    const dOut = Math.max(C.tail.floorStep, beamReach(probe[0], probe[2]) + 0.002);
    const step = wallPoint(m, ac, yt, dOut);
    const sp: P2 = [step[0], step[2]];
    if (inRects(beams, sp[0], sp[1])) continue;
    if (!runFree(ctx, foot, step, r, floorAllow)) continue;
    if (!runFree(ctx, step, [step[0], below, step[2]], r, floorAllow)) continue;
    nodes.push({ p: ch.points[0]! }, { p: bottomPt });
    if (off !== 0) nodes.push({ p: foot });
    nodes.push({ p: step });
    return { end: e, fixturePath, nodes, p: sp, od: P.waste50.od, nominal: P.waste50.nominal, finalPart: null };
  }
  unresolved(ctx, cp.id, "no clear chase / floor penetration found for the waste outlet");
  return null;
}

// ── 3. stacks ─────────────────────────────────────────────────────────────────

const STACK_ROOM_PENALTY: Readonly<Record<string, number>> = { utility: 0, bathroom: 0.3, toilet: 0.3, store: 0.8, kitchen: 2.0, meter: 0.5, services: 0.5, security: 1.5, office: 1.5 };

function roomAt(ctx: MepContext, s: number, x: number, z: number): InteriorRoom | null {
  for (const ir of ctx.interiors[s]!.rooms.values()) for (const c of ir.clears) if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return ir;
  return null;
}

/** Stack position valid on every storey and through the roof. */
function stackFree(ctx: MepContext, x: number, z: number, r: number): number | null {
  const sq: PlanRect = { x0: x - r, x1: x + r, z0: z - r, z1: z + r };
  const top = ctx.d.slabTop(ctx.cfg.storeyCount) + ctx.arch.roof.finish + C.stack.ventAboveRoof + 0.2;
  const allow: Allow = (y) => y.componentType === "slab" || FINISHES.has(y.componentType) || CEILINGS.has(y.componentType);
  if (!ctx.space.free(box3(x - r - 0.005, x + r + 0.005, C.ground.stackBase - 0.2, top, z - r - 0.005, z + r + 0.005), (y) => !allow(y))) return null;
  if (!ctx.mep.free(box3(x - r - C.clearance, x + r + C.clearance, C.ground.stackBase - 0.2, top, z - r - C.clearance, z + r + C.clearance))) return null;
  let penalty = 0;
  for (let s = 0; s < ctx.cfg.storeyCount; s++) {
    const ir = roomAt(ctx, s, x, z);
    if (!ir) return null;
    const pen = STACK_ROOM_PENALTY[ir.room.type];
    if (pen === undefined) return null;
    penalty = Math.max(penalty, pen);
    const ictx = ctx.interiors[s]!;
    if (ctx.model.storeys[s]!.clearances.some((c) => overlaps(c.rect, sq))) return null;
    for (const dr of ictx.plan.doors) for (const arc of swingArcs(dr, ictx.bounds, ctx.cfg, ctx.arch)) if (arcHitsRect(arc, sq)) return null;
    const sp = fixtureSpace(ictx, ir, 0.6);
    if (sp.approach.some((ap) => overlaps(ap, sq))) return null;
    if (!isFree({ ...sp, clear: { x0: -1e9, x1: 1e9, z0: -1e9, z1: 1e9 } }, sq)) return null;
  }
  return penalty;
}

interface StackCandidate {
  readonly x: number;
  readonly z: number;
  readonly score: number;
  readonly room: InteriorRoom;
}

/** Valid stack positions along the walls of the cluster's rooms, best (heuristic) first. */
function stackCandidates(ctx: MepContext, bay: string, pts: readonly P2[], rooms: readonly InteriorRoom[], limit: number): StackCandidate[] {
  const r = P.swr110.od / 2;
  const o = r + C.stack.standoff;
  const bayR = bayRect(ctx, bay);
  const beams = beamsBelow(ctx, 1, TREE_HALF);
  const all: { x: number; z: number; d: number; room: InteriorRoom }[] = [];
  for (const ir of rooms) {
    for (const c of ir.clears) {
      const cand: P2[] = [];
      for (let x = c.x0 + o; x <= c.x1 - o + 1e-9; x += C.stack.candidateStep) cand.push([x, c.z0 + o], [x, c.z1 - o]);
      for (let z = c.z0 + o; z <= c.z1 - o + 1e-9; z += C.stack.candidateStep) cand.push([c.x0 + o, z], [c.x1 - o, z]);
      for (const [x, z] of cand) {
        if (x < bayR.x0 || x > bayR.x1 || z < bayR.z0 || z > bayR.z1) continue;
        if (inRects(beams, x, z)) continue;
        all.push({ x, z, d: pts.reduce((sum, p) => sum + Math.abs(p[0] - x) + Math.abs(p[1] - z), 0), room: ir });
      }
    }
  }
  all.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  const out: StackCandidate[] = [];
  for (const c of all) {
    if (out.length >= limit) break;
    // keep candidates apart so the evaluated set covers different corners
    if (out.some((k) => Math.abs(k.x - c.x) + Math.abs(k.z - c.z) < 0.2)) continue;
    const pen = stackFree(ctx, c.x, c.z, r);
    if (pen === null) continue;
    out.push({ x: c.x, z: c.z, score: c.d + pen, room: c.room });
  }
  return out;
}

function makeStack(c: StackCandidate, aptId: string, bay: string, n: number): Stack {
  const k = c.room.clears.find((q) => c.x > q.x0 && c.x < q.x1 && c.z > q.z0 && c.z < q.z1) ?? c.room.clears[0]!;
  const face = axisDir([(k.x0 + k.x1) / 2 - c.x, 0, (k.z0 + k.z1) / 2 - c.z]);
  const id = `${aptId}-S${n}`;
  return { id, aptId, p: [c.x, c.z], bay, networkId: `PLB-NET-DR-${id}`, roomAtTop: c.room.room.id, face };
}

// ── 4-5. emission ─────────────────────────────────────────────────────────────

interface Groups {
  dr(floor: number, apt: string): Group;
  vt(floor: number, apt: string): Group;
}

function groups(ctx: MepContext): Groups {
  const mk = (type: "DR" | "VT", floor: number, apt: string) =>
    ctx.drafts.group({
      system: "plumbing",
      type,
      floor,
      loc: apt,
      name: `${type === "DR" ? "Drainage" : "Stack vents"} ${apt} ${floor === 0 ? "G" : floor === 5 ? "RF" : `F0${floor}`}`,
      assemblyType: type === "DR" ? "drainage" : "vent",
      category: type === "DR" ? "drainage" : "vent",
      materialId: type === "DR" ? "upvc_swr" : "upvc_vent",
      ...(apt !== "UG" ? { apartmentId: apt } : {}),
    });
  return { dr: (f, a) => mk("DR", f, a), vt: (f, a) => mk("VT", f, a) };
}

const spec = (group: Group, networkId: string, pipe: { od: number; nominal: string }, opts: Partial<RunSpec> = {}): RunSpec => ({
  kind: "pipe",
  group,
  networkId,
  od: pipe.od,
  materialId: opts.materialId ?? (pipe.od >= 0.16 ? "upvc_drain" : "upvc_swr"),
  componentType: opts.componentType ?? "drain_pipe",
  label: opts.label ?? `${pipe.nominal} pipe`,
  nominal: pipe.nominal,
  flow: "downstream",
  ...opts,
});

const part = (kind: FittingPart, group: Group, networkId: string, label: string, componentType: string, extra: Partial<NodePart> = {}): NodePart => ({ kind, group, networkId, materialId: "upvc_swr", label, componentType, ...extra });

/** Tree: per-node height from slope and edge sizes; returns null when the rise exceeds the zone. */
function treeHeights(tree: Tree, tails: Map<string, Tail>, yRoot: number): { y: number[]; od: number[] } {
  const n = tree.pts.length;
  const parent = new Array<number>(n).fill(-1);
  const kids: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of tree.segs) {
    parent[b] = a;
    kids[a]!.push(b);
  }
  // Edge size (indexed by child node): 110 if any WC upstream, 75 if a floor trap or several wastes, else 50.
  const od = new Array<number>(n).fill(0);
  const visit = (v: number): { wc: boolean; floor: boolean; count: number } => {
    const t = tree.pts[v]!.term ? tails.get(tree.pts[v]!.term!) : undefined;
    const acc = { wc: t?.end.kind === "wc", floor: t?.end.kind === "floor", count: t ? 1 : 0 };
    for (const k of kids[v]!) {
      const s = visit(k);
      acc.wc ||= s.wc;
      acc.floor ||= s.floor;
      acc.count += s.count;
    }
    od[v] = acc.wc ? P.swr110.od : acc.floor || acc.count > 1 ? P.swr75.od : P.waste50.od;
    return acc;
  };
  visit(0);
  const y = new Array<number>(n).fill(yRoot);
  const order = [0];
  for (let i = 0; i < order.length; i++) for (const k of kids[order[i]!]!) order.push(k);
  for (const v of order.slice(1)) {
    const p = parent[v]!;
    const a = tree.pts[p]!.p;
    const b = tree.pts[v]!.p;
    const L = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    y[v] = y[p]! + L * (od[v]! >= P.swr110.od - 1e-9 ? C.slope.soil : C.slope.waste);
  }
  return { y, od };
}

export interface DrainageResult {
  readonly stacks: readonly Stack[];
}

export function generateDrainage(ctx: MepContext): DrainageResult {
  const ends = drainEnds(ctx);
  const G = groups(ctx);
  const byStorey = new Map<number, DrainEnd[]>();
  for (const e of ends) (byStorey.get(e.storey) ?? byStorey.set(e.storey, []).get(e.storey)!).push(e);

  // Tails on the typical storey decide the stack positions (apartments repeat F01-F04).
  const typical = 1;
  const mark = ctx.unresolved.length;
  const clusters = new Map<string, { aptId: string; bay: string; tails: Tail[]; rooms: Set<string> }>();
  for (const e of byStorey.get(typical) ?? []) {
    const t = makeTail(ctx, e);
    if (!t) continue;
    const bay = bayKey(ctx, t.p[0], t.p[1]);
    const key = `${e.aptId}|${bay}`;
    let c = clusters.get(key);
    if (!c) clusters.set(key, (c = { aptId: e.aptId, bay, tails: [], rooms: new Set() }));
    c.tails.push(t);
    c.rooms.add(e.roomId);
  }
  // Forget the probe pass (tails are rebuilt per storey below).
  ctx.unresolved.length = mark;
  for (const e of ctx.endpoints.values()) delete e.unresolved;

  const stacks: Stack[] = [];
  const perApt = new Map<string, number>();
  const reserve = new Set<string>();
  for (const c of [...clusters.values()].sort((p, q) => (p.aptId + p.bay < q.aptId + q.bay ? -1 : 1))) {
    const ictx = ctx.interiors[typical]!;
    // Candidate rooms: the cluster's wet rooms, then the apartment's other service rooms.
    const rooms = [...ictx.rooms.values()].filter((ir) => ir.room.aptId === c.aptId && (c.rooms.has(ir.room.id) || ["utility", "store", "bathroom", "toilet"].includes(ir.room.type)));
    const n = (perApt.get(c.aptId) ?? 0) + 1;
    // Evaluate the best candidates with the real typical-floor branch tree.
    let best: { st: Stack; key: number } | null = null;
    for (const cand of stackCandidates(ctx, c.bay, c.tails.map((t) => t.p), rooms, 14)) {
      const st = makeStack(cand, c.aptId, c.bay, n);
      const ft = planFloorTree(ctx, st, c.tails, typical, new Set());
      const key = ft.failures.length * 100 + ft.maxRise * 10 + cand.score * 0.05;
      if (!best || key < best.key - 1e-9) best = { st, key };
    }
    if (!best) {
      unresolved(ctx, `${c.aptId} bay ${c.bay}`, "no stack position free on every storey in this bay: its drains are unresolved");
      continue;
    }
    const st = best.st;
    perApt.set(c.aptId, n);
    stacks.push(st);
    // Reserve the stack volume so later stacks and branches keep clear of it.
    const id = `RESERVED-${st.id}`;
    reserve.add(id);
    const top = ctx.d.slabTop(ctx.cfg.storeyCount) + C.stack.ventAboveRoof + 0.3;
    const r = P.swr110.od / 2;
    ctx.mep.add({ id, geometry: { kind: "box", size: [2 * r, top - C.ground.stackBase, 2 * r] }, originalPosition: [st.p[0], (top + C.ground.stackBase) / 2, st.p[1]], originalRotation: [0, 0, 0] } as unknown as ComponentRecord);
  }

  // Per storey: tails, grouped onto the stack of their apartment in their bay.
  const plan = new Map<string, { st: Stack; floors: Map<number, Tail[]> }>();
  for (const st of stacks) plan.set(st.id, { st, floors: new Map() });
  const groundDrops: Stack[] = [];
  for (let s = 0; s < ctx.cfg.storeyCount; s++) {
    for (const e of byStorey.get(s) ?? []) {
      const t = makeTail(ctx, e);
      if (!t) continue;
      const bay = bayKey(ctx, t.p[0], t.p[1]);
      let st = stacks.find((x) => x.aptId === e.aptId && x.bay === bay) ?? stacks.filter((x) => x.bay === bay).sort((p, q) => Math.abs(p.p[0] - t.p[0]) + Math.abs(p.p[1] - t.p[1]) - Math.abs(q.p[0] - t.p[0]) - Math.abs(q.p[1] - t.p[1]))[0];
      if (!st && s === 0) {
        st = groundDrops.find((x) => x.bay === bay);
        if (!st && t.end.kind !== "wc") {
          // prefer a WC position for a ground-floor drop (integral trap); fall back to this drain
          const wc = (byStorey.get(0) ?? []).find((x) => x.kind === "wc" && x.aptId === e.aptId && bayKey(ctx, x.rec.originalPosition[0], x.rec.originalPosition[2]) === bay);
          if (wc) {
            const wt = makeTail(ctx, wc);
            if (wt) {
              const id = `${e.aptId}-GD${groundDrops.length + 1}`;
              st = { id, aptId: e.aptId, p: wt.p, bay, networkId: `PLB-NET-DR-${id}`, roomAtTop: wc.roomId, face: [1, 0, 0], groundOnly: true };
              groundDrops.push(st);
              plan.set(st.id, { st, floors: new Map() });
            }
          }
        }
        if (!st) {
          const id = `${e.aptId}-GD${groundDrops.length + 1}`;
          st = { id, aptId: e.aptId, p: t.p, bay, networkId: `PLB-NET-DR-${id}`, roomAtTop: e.roomId, face: [1, 0, 0], groundOnly: true };
          groundDrops.push(st);
          plan.set(st.id, { st, floors: new Map() });
        }
      }
      if (!st) {
        unresolved(ctx, e.rec.id, `no drainage stack in bay ${bay} for ${e.aptId}`);
        continue;
      }
      const f = plan.get(st.id)!.floors;
      (f.get(s) ?? f.set(s, []).get(s)!).push(t);
    }
  }

  const sewer = { S: [] as { ic: string; p: P2; y: number }[], N: [] as { ic: string; p: P2; y: number }[] };
  const orphans: Tail[] = [];
  for (const { st, floors } of plan.values()) emitStack(ctx, G, st, floors, reserve, sewer, orphans);
  // Ground drops for orphaned ground-floor drains: a short root beside the drain, tried at small offsets.
  for (const t of orphans) {
    let done = false;
    for (const [ox, oz] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const) {
      const id = `${t.end.aptId}-GD${groundDrops.length + 1}`;
      const st: Stack = { id, aptId: t.end.aptId, p: [t.p[0] + ox, t.p[1] + oz], bay: bayKey(ctx, t.p[0], t.p[1]), networkId: `PLB-NET-DR-${id}`, roomAtTop: t.end.roomId, face: [1, 0, 0], groundOnly: true };
      const ft = planFloorTree(ctx, st, [t], 0, new Set());
      if (!ft.ok || ft.failures.length) continue;
      const before = ctx.unresolved.length;
      emitStack(ctx, G, st, new Map([[0, [t]]]), reserve, sewer);
      groundDrops.push(st);
      if (ctx.unresolved.length > before) ctx.unresolved.length = before; // emitted: drop any probe notes
      done = true;
      break;
    }
    if (!done) unresolved(ctx, t.end.rec.id, "ground-floor drain could neither join its stack nor drop to the underground drainage");
  }
  emitSewers(ctx, sewer);
  return { stacks: [...stacks, ...groundDrops] };
}

interface FloorTree {
  readonly tree: Tree;
  readonly y: number[];
  readonly od: number[];
  readonly tails: Map<string, Tail>;
  readonly yj: number;
  readonly ok: boolean;
  readonly failures: { subject: string; reason: string }[];
  readonly maxRise: number;
}

/** Branch tree of one storey's drains to the stack, with heights from the falls. */
function planFloorTree(ctx: MepContext, st: Stack, tails: readonly Tail[], s: number, ignore: ReadonlySet<string>): FloorTree {
  const [sx, sz] = st.p;
  const r = P.swr110.od / 2;
  const zone = drainZone(ctx, s);
  const yj = zone.lo + r;
  const area = { x0: sx - 7, x1: sx + 7, z0: sz - 7, z1: sz + 7 };
  const yMid = (zone.lo + zone.hi) / 2;
  const obstacles = planObstacles(ctx, area, yMid, (zone.hi - zone.lo) / 2, { ignore, allow: (x) => x.componentType === "slab" });
  const tmap = new Map(tails.map((t) => [t.end.rec.id, t]));
  // A drain straight above a ground-floor drop (its WC) joins the drop directly.
  const direct = st.groundOnly ? tails.filter((t) => Math.abs(t.p[0] - sx) < 1e-6 && Math.abs(t.p[1] - sz) < 1e-6 && !t.finalPart).slice(0, 1) : [];
  const grow = (order: "far" | "near") =>
    buildTree(
      { p: [sx, sz], legs: st.groundOnly ? (direct.length ? [[0, -1, 0], [0, 1, 0]] : [[0, -1, 0]]) : [[0, 1, 0], [0, -1, 0]] },
      tails
        .filter((t) => !direct.includes(t))
        .map((t) => ({ key: t.end.rec.id, p: t.p, legs: [[0, 1, 0]] as V3[], attach: !t.finalPart, minLeg: 2.7 * (t.od / 2) + 2.7 * (P.swr110.od / 2) + 0.01, half: t.od / 2 + 0.005 + C.clearance / 2 })),
      obstacles,
      { half: TREE_HALF, jointGap: 2 * 2.7 * (P.swr110.od / 2) + 0.01, attachTerms: false, bendCost: 0.3, order, depthWeight: 1, rootCross: !st.groundOnly },
    );
  // Trunk first; if a drain is left over, nearest-first may fit it (deterministic fallback).
  let tree = grow("far");
  if (tree.unresolved.length) {
    const alt = grow("near");
    if (alt.unresolved.length < tree.unresolved.length) tree = alt;
  }
  const failures = tree.unresolved.map((k) => ({ subject: k, reason: `drain branch to stack ${st.id} could not be routed below the slab (storey ${s})` }));
  if (direct[0]) tree.pts[0] = { ...tree.pts[0]!, term: direct[0].end.rec.id };
  const { y, od } = treeHeights(tree, tmap, yj);
  // Rise limit: every fitting must stay below the slab soffit.
  let ok = true;
  let maxRise = 0;
  tree.pts.forEach((pt, i) => {
    maxRise = Math.max(maxRise, y[i]! - yj);
    const lim = zone.soffit - 0.005 - (pt.term ? 2.7 : 1.32) * (od[i]! / 2);
    if (y[i]! > lim) {
      ok = false;
      failures.push({ subject: pt.term ?? `${st.id} F${s}`, reason: `branch to ${st.id} too long for the zone below the slab at the required fall (storey ${s})` });
    }
  });
  return { tree, y, od, tails: tmap, yj, ok, failures, maxRise };
}

function emitStack(ctx: MepContext, G: Groups, st: Stack, floors: Map<number, Tail[]>, reserve: ReadonlySet<string>, sewer: { S: { ic: string; p: P2; y: number }[]; N: { ic: string; p: P2; y: number }[] }, orphans?: Tail[]): void {
  const from = ctx.drafts.drafts.length;
  const net = new Net();
  const netId = declareNetwork(ctx, { id: st.networkId, system: "plumbing", kind: "drainage", name: `Soil & waste stack ${st.id}${st.groundOnly ? " (ground floor drop)" : ""}`, apartmentId: st.aptId });
  const [sx, sz] = st.p;
  // Stack nodes (bottom -> top): base bend, one junction per storey tree, slab crossings, cleanouts, vent cowl.
  const stackNodes: { y: number; node?: number; kind: "base" | "junction" | "slab" | "cleanout" | "top"; storey: number }[] = [];
  stackNodes.push({ y: C.ground.stackBase, kind: "base", storey: 0 });
  const junction = new Map<number, number>(); // storey -> y
  const ignore = new Set([...reserve].filter((x) => x === `RESERVED-${st.id}`));
  const trees = new Map<number, FloorTree>();
  for (const [s, tails0] of [...floors.entries()].sort((a, b) => a[0] - b[0])) {
    let tails = tails0;
    let ft = planFloorTree(ctx, st, tails, s, ignore);
    // Ground-floor drains that cannot join the stack drain on their own to the underground system.
    if (s === 0 && orphans && ft.failures.length && ft.ok) {
      const failed = new Set(ft.failures.map((f) => f.subject));
      orphans.push(...tails.filter((t) => failed.has(t.end.rec.id)));
      tails = tails.filter((t) => !failed.has(t.end.rec.id));
      ft = planFloorTree(ctx, st, tails, s, ignore);
    }
    for (const f of ft.failures) unresolved(ctx, f.subject, f.reason);
    if (!ft.ok) continue;
    trees.set(s, ft);
    junction.set(s, ft.yj);
    stackNodes.push({ y: ft.yj, kind: "junction", storey: s });
  }
  if (!trees.size) return;
  const topJ = Math.max(...junction.values());
  if (!st.groundOnly) {
    for (let L = 0; L <= ctx.cfg.storeyCount; L++) stackNodes.push({ y: ctx.d.slabTop(L) - ctx.cfg.slab.thickness / 2, kind: "slab", storey: L });
    for (let s = 0; s < ctx.cfg.storeyCount; s++) if (ctx.d.ffl(s) + 0.45 < topJ) stackNodes.push({ y: ctx.d.ffl(s) + 0.45, kind: "cleanout", storey: s });
    stackNodes.push({ y: ctx.d.slabTop(ctx.cfg.storeyCount) + ctx.arch.roof.finish + C.stack.ventAboveRoof, kind: "top", storey: ctx.cfg.storeyCount });
  }
  stackNodes.sort((a, b) => a.y - b.y);
  const storeyOf = (y: number) => {
    for (let L = ctx.cfg.storeyCount; L >= 0; L--) if (y >= ctx.d.slabTop(L) - ctx.cfg.slab.thickness / 2 - 1e-9) return Math.min(L, ctx.cfg.storeyCount);
    return 0;
  };
  for (const n of stackNodes) {
    const s = storeyOf(n.y);
    const vent = n.y > topJ + 1e-9;
    const g = n.kind === "base" ? G.dr(0, st.aptId) : vent ? G.vt(s, st.aptId) : G.dr(s, st.aptId);
    if (n.kind === "cleanout") n.node = net.node([sx, n.y, sz], { part: part("cleanout", g, netId, "cleanout / access door", "cleanout", { up: st.face }) });
    else if (n.kind === "top") n.node = net.node([sx, n.y, sz], { part: part("cowl", g, netId, "vent cowl", "vent_cowl", { materialId: "upvc_vent" }) });
    else n.node = net.node([sx, n.y, sz]);
  }
  for (let i = 0; i + 1 < stackNodes.length; i++) {
    const a = stackNodes[i]!;
    const b = stackNodes[i + 1]!;
    const mid = (a.y + b.y) / 2;
    const s = storeyOf(mid);
    const vent = mid > topJ;
    const g = vent ? G.vt(s, st.aptId) : G.dr(s, st.aptId);
    // Upper node drains into the lower one.
    net.edge(b.node!, a.node!, spec(g, netId, P.swr110, vent ? { materialId: "upvc_vent", componentType: "vent_pipe", label: "110 mm stack vent", category: "vent", flow: "upstream" } : { componentType: "drain_stack", label: "110 mm soil & waste stack" }));
  }
  // Branch trees
  for (const [s, { tree, y, od, tails }] of trees) {
    const jNode = stackNodes.find((n) => n.kind === "junction" && n.storey === s)!.node!;
    const ids = tree.pts.map((pt, i) => (i === 0 ? jNode : net.node([pt.p[0], y[i]!, pt.p[1]])));
    const gb = (apt: string) => G.dr(s, apt);
    tree.pts.forEach((pt, i) => {
      if (!pt.term) return;
      const t = tails.get(pt.term)!;
      const g = gb(t.end.aptId);
      if (t.finalPart) net.setPart(ids[i]!, part(t.finalPart, g, netId, t.finalPart === "trap-floor" ? "floor trap (nahani)" : "trap", "trap", { roomId: t.end.roomId, nominal: t.nominal }));
      // tail: endpoint -> ... -> last bend -> straight down to the tree node
      const tailIds = t.nodes.map((n) => net.node(n.p, { ...(n.record ? { record: n.record } : {}) }));
      tailIds.push(ids[i]!);
      const tspec = spec(g, netId, { od: t.od, nominal: t.nominal }, { componentType: "drain_pipe", label: `${t.nominal} ${t.end.kind === "wc" ? "soil pipe (WC)" : "waste pipe"}`, roomId: t.end.roomId });
      for (let k = 0; k + 1 < tailIds.length; k++) net.edge(tailIds[k]!, tailIds[k + 1]!, tspec);
      // fixture side: fixture outlet -> trap -> connection point
      if (t.fixturePath.length) {
        const fids = t.fixturePath.map((n) => net.node(n.p, { ...(n.record ? { record: n.record } : {}), ...(n.part ? { part: part(n.part, g, netId, "bottle trap", "trap", { materialId: "stainless_steel", roomId: t.end.roomId, r: P.waste50.od / 2 * 0.8 }) } : {}) }));
        const fspec = spec(g, netId, { od: 0.032, nominal: "32 mm waste" }, { materialId: "stainless_steel", componentType: "trap_waste_pipe", label: "32 mm waste connector", roomId: t.end.roomId });
        for (let k = 0; k + 1 < fids.length; k++) net.edge(fids[k]!, fids[k + 1]!, fspec);
      }
      for (const n of [t.end.rec.id, t.end.fixture?.id]) if (n) ctx.endpoints.get(n)?.connectedBy.push(st.networkId);
    });
    for (const [a, b] of tree.segs) {
      // segment oriented root-outward: flow from b (child) down to a (parent)
      const cd = od[b]!;
      const pipe = cd >= P.swr110.od - 1e-9 ? P.swr110 : cd >= P.swr75.od - 1e-9 ? P.swr75 : P.waste50;
      const t0 = tree.pts[b]!.term ? tails.get(tree.pts[b]!.term!) : undefined;
      const apt = t0?.end.aptId ?? st.aptId;
      net.edge(ids[b]!, ids[a]!, spec(gb(apt), netId, pipe, { gradient: pipe === P.swr110 ? C.slope.soil : C.slope.waste, componentType: "drain_branch", label: `${pipe.nominal} branch` }));
    }
  }
  // Building drain: from the stack base to an inspection chamber outside the nearer long facade.
  const baseNode = stackNodes.find((n) => n.kind === "base")!.node!;
  const ic = buildingDrain(ctx, net, G.dr(0, st.aptId), netId, st, baseNode);
  if (ic) sewer[ic.side].push(ic);
  else net.setPart(baseNode, part("cap", G.dr(0, st.aptId), netId, "capped stack base (building drain unresolved)", "pipe_cap"));
  net.emit(ctx.drafts);
  indexDrafts(ctx, from);
}

/** Underground drain from the stack base to an inspection chamber; returns the chamber. */
function buildingDrain(ctx: MepContext, net: Net, g: Group, netId: string, st: Stack, baseNode: number): { side: "S" | "N"; ic: string; p: P2; y: number } | null {
  const [sx, sz] = st.p;
  const g0 = ctx.grid;
  const outer = { S: g0.zs[0]! - 1.35, N: g0.zs[g0.zs.length - 1]! + 1.35 };
  const pipe = P.drain160;
  const r = pipe.od / 2;
  const y0 = C.ground.stackBase;
  const area = { x0: -26, x1: 26, z0: -22, z1: 22 };
  // Pedestals always block; footings only where the falling drain is deep enough to reach them.
  const own = new Set([`RESERVED-${st.id}`]);
  const shallow = planObstacles(ctx, area, y0 - 0.25, 0.25 + r, { allow: (x) => x.componentType === "footing", ignore: own });
  const deep = planObstacles(ctx, area, y0 - 0.25, 0.25 + r, { ignore: own });
  const hitsFooting = (path: readonly P2[]) => {
    let y: number = y0;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const y1 = y - (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])) * C.slope.underground;
      const bx = box3(Math.min(a[0], b[0]) - r, Math.max(a[0], b[0]) + r, y1 - r - C.clearance, y + r, Math.min(a[1], b[1]) - r, Math.max(a[1], b[1]) + r);
      if (ctx.space.query(bx, (x) => x.componentType === "footing").length) return true;
      y = y1;
    }
    return false;
  };
  const tries: { side: "S" | "N"; path: { x: number; z: number }[] | null; len: number }[] = [];
  for (const side of ["S", "N"] as const) {
    for (const dx of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4]) {
      const ix = sx + dx;
      const icRect = { x0: ix - 0.5, x1: ix + 0.5, z0: outer[side] - 0.5, z1: outer[side] + 0.5 };
      if (!ctx.space.free(box3(icRect.x0, icRect.x1, -1.5, 0.3, icRect.z0, icRect.z1))) continue;
      if (!ctx.mep.free(box3(icRect.x0 - 0.4, icRect.x1 + 0.4, -1.5, 0.3, icRect.z0, icRect.z1))) continue;
      const ro = { half: r + C.clearance, bendCost: 0.5, minLeg: 2 * 2.7 * r + 0.01 };
      let path = routeOrtho([sx, sz], [ix, outer[side]], shallow, ro);
      if (path && hitsFooting(path)) path = routeOrtho([sx, sz], [ix, outer[side]], deep, ro);
      if (!path) continue;
      let len = 0;
      for (let i = 0; i + 1 < path.length; i++) len += Math.abs(path[i]![0] - path[i + 1]![0]) + Math.abs(path[i]![1] - path[i + 1]![1]);
      tries.push({ side, path: path.map(([x, z]) => ({ x, z })), len });
      break;
    }
  }
  tries.sort((a, b) => a.len - b.len);
  const best = tries[0];
  if (!best?.path) {
    unresolved(ctx, st.networkId, "no underground route from the stack base to an inspection chamber");
    return null;
  }
  const path = best.path;
  let y: number = y0;
  let prev = baseNode;
  const spec0 = spec(g, netId, pipe, { gradient: C.slope.underground, componentType: "building_drain", label: "160 mm underground building drain", materialId: "upvc_drain" });
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    y -= (Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) * C.slope.underground;
    const last = i === path.length - 1;
    const n = net.node([b.x, y, b.z]);
    net.edge(prev, n, spec0);
    prev = n;
    if (last) {
      const icId = chamber(ctx, g, netId, "chamber", [b.x, ctx.arch.datums.siteGrade, b.z], `inspection chamber (600 x 600) ${st.id}`, "inspection_chamber");
      net.setRecord(n, icId);
      return { side: best.side, ic: icId, p: [b.x, b.z], y };
    }
  }
  return null;
}

/** A below-grade chamber part record, anchored at its cover top. */
function chamber(ctx: MepContext, g: Group, netId: string, kind: "chamber" | "manhole", top: V3, label: string, ctype: string): string {
  const S = FIXED_PARTS[kind];
  const pl = placeLocal(top, [1, 0, 0], [0, 1, 0], sub(S.centre, scale(S.size, 0.5)) as V3, add(S.centre, scale(S.size, 0.5)) as V3);
  return ctx.drafts.add(g, {
    code: kind === "chamber" ? "IC" : "MH",
    name: `${g.name}: ${label}`,
    componentType: ctype,
    materialId: "concrete_precast",
    geometry: { kind: "part", part: kind, size: pl.size, fill: PART_FILL[kind]! },
    position: pl.position,
    rotation: pl.rotation,
    dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] },
    unit: "nr",
    networkId: netId,
    nominalSize: kind === "chamber" ? "600 x 600 mm" : "900 mm dia.",
  }).id;
}

/** Sewer lines along the long facades: chambers in order, falling 1:100 to a final manhole at the east end. */
function emitSewers(ctx: MepContext, sewer: { S: { ic: string; p: P2; y: number }[]; N: { ic: string; p: P2; y: number }[] }): void {
  for (const side of ["S", "N"] as const) {
    const list = sewer[side].sort((a, b) => a.p[0] - b.p[0]);
    if (!list.length) continue;
    const from = ctx.drafts.drafts.length;
    const netId = declareNetwork(ctx, { id: `PLB-NET-SEW-${side}`, system: "plumbing", kind: "sewer", name: `External sewer line, ${side === "S" ? "south" : "north"} side` });
    const g = ctx.drafts.group({ system: "plumbing", type: "SEW", floor: 0, loc: side, name: `External sewer ${side === "S" ? "south" : "north"}`, assemblyType: "sewer", category: "drainage", materialId: "upvc_drain" });
    const net = new Net();
    const z = list[0]!.p[1];
    let y = Math.min(...list.map((c) => c.y)) - 0.12;
    const pipe = P.drain160;
    const sp = spec(g, netId, pipe, { gradient: C.slope.underground, componentType: "sewer_pipe", label: "160 mm external sewer", materialId: "upvc_drain" });
    let prev = net.node([list[0]!.p[0], y, z], { record: list[0]!.ic });
    let px = list[0]!.p[0];
    for (const c of list.slice(1)) {
      y -= (c.p[0] - px) * C.slope.underground;
      const n = net.node([c.p[0], y, z], { record: c.ic });
      net.edge(prev, n, sp);
      prev = n;
      px = c.p[0];
      // link the chamber records to their sewer network as boundary components
    }
    const mx = ctx.grid.xs[ctx.grid.xs.length - 1]! + 2.0;
    y -= (mx - px) * C.slope.underground;
    const mh = chamber(ctx, g, netId, "manhole", [mx, ctx.arch.datums.siteGrade, z], "final manhole (to municipal sewer)", "manhole");
    const mn = net.node([mx, y, z], { record: mh });
    net.edge(prev, mn, sp);
    const cap = net.node([mx + 2.2, y - 0.022, z], { part: { kind: "cap", group: g, networkId: netId, materialId: "upvc_drain", label: "connection to municipal sewer (by authority, capped)", componentType: "sewer_connection" } });
    net.edge(mn, cap, sp);
    net.emit(ctx.drafts);
    indexDrafts(ctx, from);
  }
}

