/**
 * Wall assemblies (A2): exterior walls, party/core walls and partitions, with openings.
 *
 * 1. Runs: interior walls follow room-boundary runs (one per room pair); exterior walls are
 *    split per structural bay (ID by the bay's grid nodes).
 * 2. Footprints: each run extends at its ends to the far face of any perpendicular wall
 *    meeting there, so junctions are filled.
 * 3. Junction ownership: for every overlapping pair exactly one wall keeps the overlap. A wall
 *    passing through beats one ending there (unless the ending wall has a higher rank:
 *    exterior > core/party > partition); otherwise rank, then X-running walls, then order.
 *    Pieces = footprint minus winners minus columns, so walls never overlap each other or
 *    the structure, and masonry butts column faces.
 * 4. Openings (no CSG): the piece hosting an opening is split into piers, jamb reveals
 *    (windows), a sill panel, a lintel and above-lintel infill around the opening.
 * Heights: slab top to the beam soffit of the level above (clear height 3.1 m).
 */

import type { BuildingConfig } from "../config";
import { buildGrid, nodeLabel, type ComponentRecord } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig } from "./config";
import { floorBoundaries, wallFootprint, type Boundary, type WallKind } from "./boundaries";
import type { FloorPlan, Side } from "./plan";
import { EPS, overlaps, subtractAll, type PlanRect } from "./rect";
import { columnRects } from "./validatePlan";
import { arcAssembly, arcRecord, box, boxGeom, dimsVertical, floorTag, pad2, type Box } from "./record";

export type PieceRole = "pier" | "sill" | "reveal" | "lintel" | "above";

export interface WallPiece {
  readonly id: string;
  readonly role: PieceRole;
  readonly box: Box;
}

export interface HostedOpening {
  readonly kind: "door" | "window";
  readonly key: string; // plan key
  readonly o0: number; // structural opening along the wall line
  readonly o1: number;
  readonly bottom: number; // y of the opening bottom (slab top for doors, sill top for windows)
  readonly head: number; // y of the head
  readonly lintelId: string;
}

export interface WallBuild {
  readonly id: string; // assembly id
  readonly kind: WallKind;
  readonly boundary: Boundary;
  readonly axis: "x" | "z";
  /** Thickness band across the line [c0, c1] (z for axis "x", x for axis "z"). */
  readonly across: readonly [number, number];
  /** For exterior walls: the facade side and which across-face is outside. */
  readonly side?: Side;
  readonly outerFace?: number;
  readonly y0: number;
  readonly y1: number;
  readonly pieces: readonly WallPiece[];
  readonly openings: readonly HostedOpening[];
}

interface Run {
  readonly b: Boundary;
  readonly s0: number;
  readonly s1: number;
  readonly fp: PlanRect;
  readonly rank: number;
  readonly order: number;
  readonly id: string;
  readonly side?: Side;
}

const RANK: Record<WallKind, number> = { exterior: 3, core: 2, party: 2, partition: 1 };

const along = (r: PlanRect, axis: "x" | "z"): [number, number] => (axis === "x" ? [r.x0, r.x1] : [r.z0, r.z1]);
const acrossOf = (r: PlanRect, axis: "x" | "z"): [number, number] => (axis === "x" ? [r.z0, r.z1] : [r.x0, r.x1]);

function extendRun(b: Boundary, s0: number, s1: number, all: readonly Boundary[], cfg: BuildingConfig): PlanRect {
  let e0 = 0;
  let e1 = 0;
  for (const p of all) {
    if (p.kind === "open" || p.kind === "none" || p.line.axis === b.line.axis) continue;
    if (p.s0 > b.line.c + EPS || p.s1 < b.line.c - EPS) continue;
    const [f0, f1] = along(wallFootprint(p, cfg), b.line.axis);
    if (Math.abs(p.line.c - s0) < EPS) e0 = Math.max(e0, s0 - f0);
    if (Math.abs(p.line.c - s1) < EPS) e1 = Math.max(e1, f1 - s1);
  }
  return wallFootprint(b, cfg, s0 - e0, s1 + e1);
}

function sideOf(b: Boundary): Side {
  const outwardLow = b.low === null; // no room on the low side
  return b.line.axis === "x" ? (outwardLow ? "S" : "N") : outwardLow ? "W" : "E";
}

function runIds(plan: FloorPlan, runs: { b: Boundary; s0: number; s1: number; side?: Side }[], cfg: BuildingConfig): string[] {
  const grid = buildGrid(cfg);
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  const base = runs.map(({ b, s0, s1, side }) => {
    const tag = b.kind === "partition" ? "PART" : "WALL";
    if (b.kind === "exterior") {
      const ix = (x: number) => grid.xs.findIndex((g) => Math.abs(g - x) < EPS);
      const iz = (z: number) => grid.zs.findIndex((g) => Math.abs(g - z) < EPS);
      const [a, c] =
        b.line.axis === "x"
          ? [nodeLabel(ix(s0), iz(b.line.c)), nodeLabel(ix(s1), iz(b.line.c))]
          : [nodeLabel(ix(b.line.c), iz(s0)), nodeLabel(ix(b.line.c), iz(s1))];
      return `${tag}|EXT-${side}-${a}-${c}`;
    }
    const [ra, rb] = [rooms.get(b.low!)!, rooms.get(b.high!)!].sort((p, q) => p.id.localeCompare(q.id));
    return ra!.aptId === rb!.aptId && b.kind === "partition"
      ? `${tag}|${ra!.aptId}-${ra!.code}-${rb!.code}`
      : `${tag}|${ra!.id}-${rb!.id}`;
  });
  const total = new Map<string, number>();
  for (const k of base) total.set(k, (total.get(k) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((k) => {
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    const [tag, loc] = k.split("|") as [string, string];
    return `${tag}|${total.get(k)! > 1 ? `${loc}-R${n}` : loc}`;
  });
}

function buildRuns(plan: FloorPlan, bounds: readonly Boundary[], cfg: BuildingConfig): Run[] {
  const grid = buildGrid(cfg);
  const raw: { b: Boundary; s0: number; s1: number; side?: Side }[] = [];
  for (const b of bounds) {
    if (b.kind === "open" || b.kind === "none") continue;
    if (b.kind !== "exterior") {
      raw.push({ b, s0: b.s0, s1: b.s1 });
      continue;
    }
    // Exterior: split at structural gridlines (one assembly per bay).
    const lines = b.line.axis === "x" ? grid.xs : grid.zs;
    const cuts = [b.s0, ...lines.filter((g) => g > b.s0 + EPS && g < b.s1 - EPS), b.s1];
    for (let i = 0; i < cuts.length - 1; i++) raw.push({ b, s0: cuts[i]!, s1: cuts[i + 1]!, side: sideOf(b) });
  }
  // Merge exterior pieces of one bay that came from different rooms into a single run.
  const merged: typeof raw = [];
  for (const r of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      r.b.kind === "exterior" &&
      prev.b.kind === "exterior" &&
      prev.b.line.axis === r.b.line.axis &&
      Math.abs(prev.b.line.c - r.b.line.c) < EPS &&
      Math.abs(prev.s1 - r.s0) < EPS &&
      !(r.b.line.axis === "x" ? grid.xs : grid.zs).some((g) => Math.abs(g - r.s0) < EPS)
    ) {
      merged[merged.length - 1] = { ...prev, s1: r.s1 };
    } else merged.push(r);
  }
  merged.sort((p, q) => (p.b.line.axis === q.b.line.axis ? p.b.line.c - q.b.line.c || p.s0 - q.s0 : p.b.line.axis === "x" ? -1 : 1));
  const ids = runIds(plan, merged, cfg);
  return merged.map((r, order) => ({
    ...r,
    fp: extendRun(r.b, r.s0, r.s1, bounds, cfg),
    rank: RANK[r.b.kind as WallKind],
    order,
    id: ids[order]!,
  }));
}

/** True if the overlap `o` lies within the run's own boundary interval (the run passes through it). */
function passesThrough(r: Run, o: PlanRect): boolean {
  const [a, b] = along(o, r.b.line.axis);
  return a >= r.s0 - EPS && b <= r.s1 + EPS;
}

function beats(a: Run, b: Run, o: PlanRect): boolean {
  const at = passesThrough(a, o);
  const bt = passesThrough(b, o);
  if (at !== bt) {
    const [through, ending] = at ? [a, b] : [b, a];
    const winner = ending.rank > through.rank ? ending : through;
    return winner === a;
  }
  if (a.rank !== b.rank) return a.rank > b.rank;
  if (a.b.line.axis !== b.b.line.axis) return a.b.line.axis === "x";
  return a.order < b.order;
}

interface OpeningSpec {
  readonly kind: "door" | "window";
  readonly key: string;
  readonly line: { axis: "x" | "z"; c: number };
  readonly centre: number;
  readonly width: number;
  readonly bottom: number;
  readonly head: number;
  readonly reveal: number;
  readonly stone: number; // stone sill thickness under a window (part of the window assembly)
}

function openingSpecs(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig): OpeningSpec[] {
  const d = archDatums(cfg, arch);
  const slab = d.slabTop(plan.storey);
  const ffl = d.ffl(plan.storey);
  return [
    ...plan.doors.map((x) => ({
      kind: "door" as const,
      key: x.key,
      line: x.line,
      centre: x.centre,
      width: x.width,
      bottom: slab,
      head: ffl + x.height,
      reveal: 0,
      stone: 0,
    })),
    ...plan.windows.map((x) => {
      const t = arch.windowTypes[x.typeKey];
      return {
        kind: "window" as const,
        key: x.key,
        line: x.line,
        centre: x.centre,
        width: t.width,
        bottom: ffl + t.sill,
        head: ffl + t.sill + t.height,
        reveal: arch.openings.revealWidth,
        stone: arch.openings.stoneSill.thickness,
      };
    }),
  ];
}

export interface WallsResult {
  readonly walls: readonly WallBuild[];
  readonly records: readonly ComponentRecord[];
}

export function generateWalls(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): WallsResult {
  const s = plan.storey;
  const d = archDatums(cfg, arch);
  const y0 = d.slabTop(s);
  const y1 = d.wallTop(s);
  const bounds = floorBoundaries(plan, arch);
  const runs = buildRuns(plan, bounds, cfg);
  const cols = columnRects(cfg, s);
  const specs = openingSpecs(plan, cfg, arch);
  const walls: WallBuild[] = [];
  const records: ComponentRecord[] = [];

  for (const run of runs) {
    const axis = run.b.line.axis;
    const cutters = [
      ...cols,
      ...runs.filter((o) => o !== run && overlaps(o.fp, run.fp) && beats(o, run, intersectRect(o.fp, run.fp))).map((o) => o.fp),
    ];
    const plan2d = subtractAll(run.fp, cutters, axis === "z").sort((p, q) => along(p, axis)[0] - along(q, axis)[0]);
    const [tag, loc] = run.id.split("|") as ["WALL" | "PART", string];
    const assemblyId = `ARC-${tag}-${floorTag(s)}-${loc}`;
    const across = acrossOf(run.fp, axis);
    // Openings hosted by this run (by boundary line and interval).
    const hosted = specs
      .filter(
        (o) =>
          o.line.axis === axis &&
          Math.abs(o.line.c - run.b.line.c) < EPS &&
          o.centre - o.width / 2 >= run.s0 - EPS &&
          o.centre + o.width / 2 <= run.s1 + EPS,
      )
      .sort((p, q) => p.centre - q.centre);

    // Split plan pieces around openings (along the wall), stacking pieces vertically in the gap.
    type Seg = { a0: number; a1: number; c0: number; c1: number; role: PieceRole; y0: number; y1: number; k?: number };
    let segs: Seg[] = plan2d.map((p) => {
      const [a0, a1] = along(p, axis);
      const [c0, c1] = acrossOf(p, axis);
      return { a0, a1, c0, c1, role: "pier", y0, y1 };
    });
    const hostedOut: HostedOpening[] = [];
    hosted.forEach((o, i) => {
      const k = i + 1;
      const o0 = o.centre - o.width / 2;
      const o1 = o.centre + o.width / 2;
      const g0 = o0 - o.reveal;
      const g1 = o1 + o.reveal;
      const idx = segs.findIndex((p) => p.role === "pier" && p.a0 <= g0 + 1e-6 && p.a1 >= g1 - 1e-6 && Math.abs(p.c0 - across[0]) < 1e-6 && Math.abs(p.c1 - across[1]) < 1e-6);
      if (idx < 0) throw new Error(`walls: opening ${o.key} does not fit a full-thickness piece of ${assemblyId}`);
      const p = segs[idx]!;
      const out: Seg[] = [];
      const lintelTop = o.head + arch.openings.lintelDepth;
      if (g0 - p.a0 > EPS) out.push({ ...p, a1: g0 });
      if (o.kind === "window" && o.bottom - o.stone - y0 > EPS) out.push({ ...p, a0: g0, a1: g1, role: "sill", y0, y1: o.bottom - o.stone, k });
      if (o.reveal > 0) {
        out.push({ ...p, a0: g0, a1: o0, role: "reveal", y0: o.bottom - o.stone, y1: o.head, k });
        out.push({ ...p, a0: o1, a1: g1, role: "reveal", y0: o.bottom - o.stone, y1: o.head, k });
      }
      out.push({ ...p, a0: g0, a1: g1, role: "lintel", y0: o.head, y1: lintelTop, k });
      if (y1 - lintelTop > EPS) out.push({ ...p, a0: g0, a1: g1, role: "above", y0: lintelTop, y1, k });
      if (p.a1 - g1 > EPS) out.push({ ...p, a0: g1 });
      segs = [...segs.slice(0, idx), ...out, ...segs.slice(idx + 1)];
      hostedOut.push({ kind: o.kind, key: o.key, o0, o1, bottom: o.bottom, head: o.head, lintelId: `${assemblyId}-LN${pad2(k)}` });
    });

    // Name pieces: piers P01.. along the wall; opening pieces by opening index.
    let pier = 0;
    const revealCount = new Map<number, number>();
    const pieces: WallPiece[] = segs.map((g) => {
      let suffix: string;
      if (g.role === "pier") suffix = `P${pad2(++pier)}`;
      else if (g.role === "reveal") {
        const n = (revealCount.get(g.k!) ?? 0) + 1;
        revealCount.set(g.k!, n);
        suffix = `RV${pad2(2 * (g.k! - 1) + n)}`;
      } else suffix = `${{ sill: "SL", lintel: "LN", above: "AB" }[g.role]}${pad2(g.k!)}`;
      const b = axis === "x" ? box(g.a0, g.a1, g.y0, g.y1, g.c0, g.c1) : box(g.c0, g.c1, g.y0, g.y1, g.a0, g.a1);
      return { id: `${assemblyId}-${suffix}`, role: g.role, box: b };
    });

    const kind = run.b.kind as WallKind;
    const category = kind === "exterior" ? "exteriorWalls" : "partitions";
    const wallMat = kind === "exterior" ? "masonry_paint_ext" : kind === "core" ? "masonry_paint_core" : "masonry_paint_int";
    const lintelMat = kind === "exterior" ? "lintel_rcc_ext" : "lintel_rcc_int";
    const rooms = kind === "exterior" ? [] : [run.b.low, run.b.high].filter((x): x is string => x !== null);
    const aptIds = [...new Set(rooms.map((r) => r.split("-")[0]!))];
    const [a0, a1] = along(run.fp, axis);
    const envelope = axis === "x" ? box(a0, a1, y0, y1, across[0], across[1]) : box(across[0], across[1], y0, y1, a0, a1);
    const label = kind === "exterior" ? `Exterior wall ${loc.replace("EXT-", "")}` : `${kind === "partition" ? "Partition" : kind === "core" ? "Core wall" : "Party wall"} ${rooms.join(" | ")}`;
    records.push(
      arcAssembly({
        type: tag,
        floor: s,
        location: loc,
        name: `${label} (${floorTag(s)})`,
        assemblyType: "wall",
        category,
        materialId: wallMat,
        min: envelope.min,
        max: envelope.max,
        dimensions: dimsVertical(envelope, axis),
        unit: "m2",
        ...(aptIds.length === 1 ? { apartmentId: aptIds[0]! } : {}),
      }),
    );
    for (const p of pieces) {
      const { geometry, position } = boxGeom(p.box);
      const roleName = { pier: "masonry", sill: "sill panel", reveal: "reveal", lintel: "lintel", above: "above-lintel infill" }[p.role];
      records.push(
        arcRecord({
          type: tag,
          floor: s,
          location: p.id.slice(`ARC-${tag}-${floorTag(s)}-`.length),
          name: `${label}: ${roleName}`,
          componentType: `wall_${p.role}`,
          assemblyType: "wall",
          category,
          materialId: p.role === "lintel" ? lintelMat : wallMat,
          geometry,
          position,
          dimensions: dimsVertical(p.box, axis),
          unit: "m3",
          parentId: assemblyId,
          ...(aptIds.length === 1 ? { apartmentId: aptIds[0]! } : {}),
        }),
      );
    }
    const ext = kind === "exterior";
    const outerFace = ext ? (run.b.low === null ? across[0] : across[1]) : undefined;
    walls.push({
      id: assemblyId,
      kind,
      boundary: run.b,
      axis,
      across,
      ...(ext ? { side: run.side!, outerFace: outerFace! } : {}),
      y0,
      y1,
      pieces,
      openings: hostedOut,
    });
  }
  return { walls, records };
}

function intersectRect(a: PlanRect, b: PlanRect): PlanRect {
  return { x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), z0: Math.max(a.z0, b.z0), z1: Math.min(a.z1, b.z1) };
}
