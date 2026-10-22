/**
 * Balconies (A2): cantilevered slab projections on selected bays of the long facades, one per
 * apartment from F01. The cantilever structure is conceptual (no back-span or reinforcement
 * is modelled); the slab butts the edge-beam outer face between the column faces.
 *
 * Per balcony: slab, soffit, finish (15 mm below room FFL), kerb, railing (posts, balusters,
 * handrails on the three open edges) and a drainage spout. Over the top-floor balconies a
 * roof-level canopy slab caps each stack.
 */

import type { BuildingConfig } from "../config";
import { buildGrid, type ComponentRecord, type Vec3 } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig } from "./config";
import type { FloorPlan, PlanBalcony, Side } from "./plan";
import { arcAssembly, arcId, arcRecord, box, boxGeom, dimsHorizontal, dimsSolid, floorTag, pad2, type Box } from "./record";

/** Facade geometry for a side: outward direction and the face planes (column outer face, beam outer face). */
export interface FacadeFrame {
  readonly side: Side;
  readonly axis: "x" | "z"; // facade runs along
  readonly out: 1 | -1; // outward sign on the across axis
  readonly wallFace: number; // exterior wall / column outer face
  readonly beamFace: number; // edge-beam outer face
  readonly gridLine: number;
}

export function facadeFrame(cfg: BuildingConfig, side: Side): FacadeFrame {
  const g = buildGrid(cfg);
  const zMin = g.zs[0]!;
  const zMax = g.zs[g.zs.length - 1]!;
  const xMin = g.xs[0]!;
  const xMax = g.xs[g.xs.length - 1]!;
  const ch = cfg.column.depth / 2;
  const cw = cfg.column.width / 2;
  const bh = cfg.beam.width / 2;
  switch (side) {
    case "S":
      return { side, axis: "x", out: -1, wallFace: zMin - ch, beamFace: zMin - bh, gridLine: zMin };
    case "N":
      return { side, axis: "x", out: 1, wallFace: zMax + ch, beamFace: zMax + bh, gridLine: zMax };
    case "W":
      return { side, axis: "z", out: -1, wallFace: xMin - cw, beamFace: xMin - bh, gridLine: xMin };
    case "E":
      return { side, axis: "z", out: 1, wallFace: xMax + cw, beamFace: xMax + bh, gridLine: xMax };
  }
}

/** Box in a facade frame: along range, y range, and outward distances [d0, d1] from a reference plane. */
export function facadeBox(f: FacadeFrame, a0: number, a1: number, y0: number, y1: number, ref: number, d0: number, d1: number): Box {
  const c0 = ref + f.out * d0;
  const c1 = ref + f.out * d1;
  return f.axis === "x" ? box(a0, a1, y0, y1, c0, c1) : box(c0, c1, y0, y1, a0, a1);
}

/** Plan footprint of a balcony slab (between column faces, from the beam face out to the full depth). */
export function balconyFootprint(cfg: BuildingConfig, b: PlanBalcony, arch: ArchitectureConfig = ARCH_CONFIG) {
  const f = facadeFrame(cfg, b.side);
  const a0 = b.bay[0] + cfg.column.width / 2;
  const a1 = b.bay[1] - cfg.column.width / 2;
  const outer = Math.abs(f.wallFace - f.beamFace) + arch.balcony.depth; // distance from the beam face
  return { f, a0, a1, outer };
}

function balconyRecords(cfg: BuildingConfig, b: PlanBalcony, level: number, arch: ArchitectureConfig, cap: boolean): ComponentRecord[] {
  const d = archDatums(cfg, arch);
  const bc = arch.balcony;
  const E = d.slabTop(level);
  const { f, a0, a1, outer } = balconyFootprint(cfg, b, arch);
  const wallD = Math.abs(f.wallFace - f.beamFace); // beam face -> wall face distance
  const floor = level; // balcony slab at level s belongs to floor s (roof cap: RF)
  const key = cap ? `${b.key}-CAP` : b.key;
  const id = arcId("BAL", floor, key);
  const out: ComponentRecord[] = [];
  const common = { type: "BAL" as const, floor, category: "balconies" as const, assemblyType: cap ? "balcony_canopy" : "balcony", parentId: id, apartmentId: b.aptId, roomId: b.roomId };
  const name = cap ? `Roof canopy over balcony stack ${b.aptId} (${b.side})` : `Balcony ${b.aptId} (${b.side}, ${floorTag(floor)})`;
  const part = (suffix: string, label: string, componentType: string, materialId: string, bx: Box, unit: "m3" | "m2" | "m" | "nr", dims = dimsSolid(bx)) => {
    const { geometry, position } = boxGeom(bx);
    out.push(arcRecord({ ...common, location: `${key}-${suffix}`, name: `${name}: ${label}`, componentType, materialId, geometry, position, dimensions: dims, unit }));
  };
  const FB = (x0: number, x1: number, y0: number, y1: number, dd0: number, dd1: number) => facadeBox(f, x0, x1, y0, y1, f.beamFace, dd0, dd1);

  part("SLB", cap ? "canopy slab" : "cantilever slab (conceptual)", "balcony_slab", "concrete_balcony", FB(a0, a1, E - bc.slabThickness, E, 0, outer), "m3");
  const sofInset = 0.02;
  const sof = FB(a0 + sofInset, a1 - sofInset, E - bc.slabThickness - bc.soffit, E - bc.slabThickness, 0, outer - sofInset);
  part("SOF", "soffit plaster", "balcony_soffit", "plaster_soffit", sof, "m2", dimsHorizontal(sof));
  if (cap) return wrap(out, id, floor, key, name, b, FB(a0, a1, E - bc.slabThickness - bc.soffit, E, 0, outer), "balcony_canopy");

  const kw = bc.kerb.width;
  const fin = E + bc.finish;
  const kerbTop = fin + bc.kerb.height;
  const fb = FB(a0 + kw, a1 - kw, E, fin, wallD, outer - kw);
  part("FIN", "tile finish", "balcony_finish", "tile_balcony", fb, "m2", dimsHorizontal(fb));
  part("KRB-F", "front kerb", "balcony_kerb", "concrete_balcony", FB(a0, a1, E, kerbTop, outer - kw, outer), "m3");
  part("KRB-L", "side kerb", "balcony_kerb", "concrete_balcony", FB(a0, a0 + kw, E, kerbTop, wallD, outer - kw), "m3");
  part("KRB-R", "side kerb", "balcony_kerb", "concrete_balcony", FB(a1 - kw, a1, E, kerbTop, wallD, outer - kw), "m3");

  // Railing on the kerb centre lines
  const r = bc.railing;
  const top = fin + r.height;
  const hr = r.handrail;
  const railBottom = top - hr.depth;
  const frontD = outer - kw / 2; // front rail line (distance from beam face)
  const sideL = a0 + kw / 2;
  const sideR = a1 - kw / 2;
  const hrFront = FB(a0, a1, railBottom, top, frontD - hr.width / 2, frontD + hr.width / 2);
  part("HRL-F", "front handrail", "balcony_handrail", "metal_railing", hrFront, "m", { length: a1 - a0, width: hr.width, height: hr.depth });
  const sideEnd = frontD - hr.width / 2;
  part("HRL-L", "side handrail", "balcony_handrail", "metal_railing", FB(sideL - hr.width / 2, sideL + hr.width / 2, railBottom, top, wallD, sideEnd), "m", { length: sideEnd - wallD, width: hr.width, height: hr.depth });
  part("HRL-R", "side handrail", "balcony_handrail", "metal_railing", FB(sideR - hr.width / 2, sideR + hr.width / 2, railBottom, top, wallD, sideEnd), "m", { length: sideEnd - wallD, width: hr.width, height: hr.depth });

  // Posts: four corners, plus intermediates at <= postSpacingMax; balusters between posts.
  const p = r.post;
  let np = 0;
  let nb = 0;
  const post = (bx: Box) => part(`PST${pad2(++np)}`, "railing post", "balcony_post", "metal_railing", bx, "nr");
  const bal = (bx: Box) => part(`BLS${String(++nb).padStart(3, "0")}`, "baluster", "balcony_baluster", "metal_railing", bx, "nr");
  const run = (len: number) => {
    const n = Math.max(1, Math.ceil(len / r.postSpacingMax));
    return Array.from({ length: n + 1 }, (_, i) => (i * len) / n);
  };
  const fill = (s0: number, s1: number, place: (s: number) => void) => {
    const gap0 = s0 + p / 2;
    const gap1 = s1 - p / 2;
    const n = Math.floor((gap1 - gap0) / r.balusterSpacing);
    for (let i = 1; i <= n; i++) {
      const s = gap0 + ((gap1 - gap0) * i) / (n + 1);
      place(s);
    }
  };
  // Front edge: along the facade
  const fpos = run(sideR - sideL).map((u) => sideL + u);
  for (const x of fpos) post(FB(x - p / 2, x + p / 2, kerbTop, railBottom, frontD - p / 2, frontD + p / 2));
  for (let i = 0; i < fpos.length - 1; i++)
    fill(fpos[i]!, fpos[i + 1]!, (x) => bal(FB(x - r.baluster / 2, x + r.baluster / 2, kerbTop, railBottom, frontD - r.baluster / 2, frontD + r.baluster / 2)));
  // Side edges: from the wall face to the front corner post (corner posts already placed)
  for (const sx of [sideL, sideR]) {
    const len = frontD - p / 2 - wallD;
    const n = Math.max(1, Math.ceil(len / r.postSpacingMax));
    const stations = Array.from({ length: n + 1 }, (_, i) => wallD + p / 2 + ((frontD - wallD - p / 2) * i) / n); // last = front corner
    for (const dd of stations.slice(0, -1)) post(FB(sx - p / 2, sx + p / 2, kerbTop, railBottom, dd - p / 2, dd + p / 2));
    for (let i = 0; i < stations.length - 1; i++)
      fill(stations[i]!, stations[i + 1]!, (dd) => bal(FB(sx - r.baluster / 2, sx + r.baluster / 2, kerbTop, railBottom, dd - r.baluster / 2, dd + r.baluster / 2)));
  }

  // Drainage spout through the front kerb face, near the low-along corner
  const o = bc.outlet;
  const ox = a0 + 0.3;
  const oy = E + 0.06;
  const spout = FB(ox - o.radius, ox + o.radius, oy - o.radius, oy + o.radius, outer, outer + o.length);
  const { position } = boxGeom(spout);
  out.push(
    arcRecord({
      ...common,
      location: `${key}-OUT`,
      name: `${name}: drainage spout`,
      componentType: "balcony_outlet",
      materialId: "pvc_pipe",
      geometry: { kind: "cylinder", radius: o.radius, height: o.length, axis: f.axis === "x" ? "z" : "x" },
      position,
      dimensions: { length: o.length, diameter: 2 * o.radius },
      unit: "nr",
    }),
  );
  const env = FB(a0, a1, E - bc.slabThickness - bc.soffit, top, 0, outer + o.length);
  return wrap(out, id, floor, key, name, b, env, "balcony");
}

function wrap(out: ComponentRecord[], _id: string, floor: number, key: string, name: string, b: PlanBalcony, env: Box, assemblyType: string): ComponentRecord[] {
  out.unshift(
    arcAssembly({
      type: "BAL",
      floor,
      location: key,
      name,
      assemblyType,
      category: "balconies",
      materialId: "concrete_balcony",
      min: env.min as Vec3,
      max: env.max as Vec3,
      dimensions: dimsSolid(env),
      unit: "nr",
      apartmentId: b.aptId,
      roomId: b.roomId,
    }),
  );
  return out;
}

export function generateBalconies(plan: FloorPlan, cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  const out: ComponentRecord[] = [];
  for (const b of plan.balconies) {
    out.push(...balconyRecords(cfg, b, plan.storey, arch, false));
    if (plan.kind === "top") out.push(...balconyRecords(cfg, b, cfg.storeyCount, arch, true));
  }
  return out;
}
