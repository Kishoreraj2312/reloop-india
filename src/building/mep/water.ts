/**
 * Domestic water supply (A3), indirect system typical of Indian G+4 housing:
 *   municipal connection -> bulk meter -> underground sump (float valve)
 *   -> duty/standby pumps (foot valves, NRVs, gate valves) -> rising main, underground to
 *   the service shaft and up it -> two overhead HDPE tanks on a steel platform
 *   -> tank outlets -> down-take in the shaft -> per floor: isolation valve, branch to a
 *   corridor header -> per flat: take-off valve + water meter -> apartment cold-water tree
 *   in the ceiling void -> wall chases down to every A2 supply connection point (angle
 *   valves at WCs, basins, sinks and washers), shower mixers and geysers.
 * Hot water is local: a storage geyser in each bathroom with a shower feeds the mixer's
 * hot inlet; a concealed riser in the wall feeds the shower arm from the mixer.
 */

import type { ComponentRecord } from "../structure";
import { openingOf } from "../structure";
import type { InteriorRoom } from "../architecture/interior";
import type { PlanRect } from "../architecture/rect";
import type { Side } from "../architecture/plan";
import { MEP_CONFIG } from "./config";
import { declareNetwork, endpoint, indexDrafts, planObstacles, unresolved, MASONRY, type MepContext } from "./context";
import { FIXED_PARTS, PART_FILL, fittingBox, type FittingPart } from "./parts";
import { Net, type NodePart, type RunSpec } from "./net";
import { buildTree, routeOrtho, type Tree } from "./router";
import { add, axisDir, placeLocal, scale, sub, type P2, type V3 } from "./geom";
import { alongOf, findChase, mountAt, mountOn, stubEnds, wallBasis, wallPart, wallPartBox, wallPoint, type Mount } from "./walls";
import type { Group } from "./record";

const C = MEP_CONFIG;
const P = C.pipe;
const RF = 5;
const ftag = (s: number) => (s === 0 ? "G" : s === RF ? "RF" : `F0${s}`);

interface TakeOff {
  readonly storey: number;
  readonly aptId: string;
  readonly meter: string;
  readonly at: V3; // meter centre
  readonly into: V3; // unit direction from the meter toward the flat
  readonly wallFace: number; // z of the far wall face (apartment side)
}

export function generateWater(ctx: MepContext): void {
  const sh = openingOf(ctx.grid, "shaft");
  const takeoffs = commonWater(ctx, sh);
  for (const t of takeoffs) apartmentWater(ctx, t);
}

// ── common: source, plant, risers, distribution ───────────────────────────────

function commonWater(ctx: MepContext, sh: { x0: number; x1: number; z0: number; z1: number }): TakeOff[] {
  const from = ctx.drafts.drafts.length;
  const W = C.water;
  const grade = ctx.arch.datums.siteGrade;
  const muni = declareNetwork(ctx, { id: "PLB-NET-WS-MUNI", system: "plumbing", kind: "cold-water", name: "Municipal supply to sump" });
  const rise = declareNetwork(ctx, { id: "PLB-NET-WS-RISE", system: "plumbing", kind: "cold-water", name: "Sump, pumps and rising main to the overhead tanks", parent: muni });
  const dist = declareNetwork(ctx, { id: "PLB-NET-WS-DIST", system: "plumbing", kind: "cold-water", name: "Overhead tanks, down-take, floor branches, corridor headers and flat meters", parent: rise });
  const grp = (floor: number, loc: string, name: string) => ctx.drafts.group({ system: "plumbing", type: "CW", floor, loc, name, assemblyType: "cold_water", category: "water", materialId: "gi_pipe", apartmentId: "CM" });
  const gPlant = grp(0, "PLANT", "Water plant (sump, pumps, rising main)");
  const gRoof = grp(RF, "OHT", "Overhead tanks");
  const gFloor = (s: number) => grp(s, "CM", `Common water ${ftag(s)}`);
  const net = new Net();
  const spec = (g: Group, network: string, pipe: { od: number; nominal: string }, extra: Partial<RunSpec> = {}): RunSpec => ({ kind: "pipe", group: g, networkId: network, od: pipe.od, materialId: "gi_pipe", componentType: "pipe", label: `${pipe.nominal} pipe`, nominal: pipe.nominal, flow: "upstream", ...extra });
  const valve = (g: Group, network: string, kind: FittingPart, label: string, nominal: string, up?: V3): NodePart => ({ kind, group: g, networkId: network, materialId: "brass_valve", label, componentType: kind === "meter-water" ? "water_meter" : kind === "valve-check" ? "check_valve" : "valve", nominal, ...(up ? { up } : {}) });
  const box = (g: Group, network: string, code: string, name: string, ctype: string, mat: string, min: V3, max: V3, extra: { nominal?: string; assumptions?: string } = {}) =>
    ctx.drafts.add(g, { code, fixed: true, name: `${g.name}: ${name}`, componentType: ctype, materialId: mat, geometry: { kind: "box", size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }, position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2], dimensions: { length: max[0] - min[0], width: max[2] - min[2], height: max[1] - min[1] }, unit: "nr", networkId: network, ...(extra.nominal ? { nominalSize: extra.nominal } : {}), ...(extra.assumptions ? { assumptions: extra.assumptions } : {}) }).id;
  const floorPart = (g: Group, network: string, code: string, part: keyof typeof FIXED_PARTS, name: string, ctype: string, mat: string, anchor: V3, ex: V3 = [1, 0, 0], extra: { nominal?: string; assumptions?: string } = {}) => {
    const S = FIXED_PARTS[part];
    const pl = placeLocal(anchor, ex, [0, 1, 0], sub(S.centre, scale(S.size, 0.5)), add(S.centre, scale(S.size, 0.5)));
    return ctx.drafts.add(g, { code, fixed: true, name: `${g.name}: ${name}`, componentType: ctype, materialId: mat, geometry: { kind: "part", part, size: pl.size, fill: PART_FILL[part]! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] }, unit: "nr", networkId: network, ...(extra.nominal ? { nominalSize: extra.nominal } : {}), ...(extra.assumptions ? { assumptions: extra.assumptions } : {}) }).id;
  };

  // Sump, pad, pumps
  const S = W.sump;
  const sump = box(gPlant, rise, "SUMP", `underground RCC sump (${(S.capacityL / 1000).toFixed(0)} kL)`, "sump_tank", "concrete_precast", [S.x0, S.top - S.depth, S.z0], [S.x1, S.top, S.z1], { nominal: `${S.capacityL} L`, assumptions: "Conceptual sump volume (about one day's demand); structure not designed." });
  floorPart(gPlant, rise, "SUMP-MH1", "manhole-cover", "sump manhole cover", "manhole_cover", "cast_iron_cover", [S.x1 - 0.7, S.top, S.z0 + 0.7]);
  floorPart(gPlant, rise, "SUMP-MH2", "manhole-cover", "sump manhole cover", "manhole_cover", "cast_iron_cover", [S.x0 + 1.6, S.top, S.z1 - 0.7]);
  const pad = W.pumpPad;
  box(gPlant, rise, "PAD", "pump plinth", "pump_plinth", "concrete_precast", [pad.x0, grade, pad.z0], [pad.x1, grade + pad.height, pad.z1]);
  const padTop = grade + pad.height;
  const px = (pad.x0 + pad.x1) / 2;
  const pumpZ = [-0.55, 0.55];
  const pumps = pumpZ.map((z, i) => {
    const id = floorPart(gPlant, rise, `PMP${i + 1}`, "pump", `monoblock pump set ${i === 0 ? "(duty)" : "(standby)"} 2 HP`, "pump", "pump_body", [px, padTop, z], [1, 0, 0], { nominal: "2 HP, 50 x 40 mm" });
    ctx.appliances.push({ kind: "pump", id, storey: 0, anchor: [px, padTop, z] });
    return id;
  });
  // Pump starter panel on a post beside the pad
  const postX = pad.x0 + 0.1;
  const postZ = pad.z1 + 0.45;
  box(gPlant, rise, "POST", "panel post (MS)", "support_post", "steel_stand", [postX - 0.04, grade, postZ - 0.04], [postX + 0.04, 1.45, postZ + 0.04]);
  const pp = FIXED_PARTS["pump-panel"];
  const ppAnchor: V3 = [postX + 0.04, 0.95, postZ];
  const pplace = placeLocal(ppAnchor, [0, 0, -1], [0, 1, 0], sub(pp.centre, scale(pp.size, 0.5)), add(pp.centre, scale(pp.size, 0.5)));
  const panelId = ctx.drafts.add(gPlant, { code: "PNL", fixed: true, name: `${gPlant.name}: pump starter / control panel (DOL, dry-run + level controls)`, componentType: "pump_control_panel", materialId: "enclosure_steel", geometry: { kind: "part", part: "pump-panel", size: pplace.size, fill: PART_FILL["pump-panel"]! }, position: pplace.position, rotation: pplace.rotation, dimensions: { length: pplace.size[0], width: pplace.size[2], height: pplace.size[1] }, unit: "nr", networkId: rise }).id;
  ctx.appliances.push({ kind: "pump-panel", id: panelId, storey: 0, anchor: ppAnchor, along: [0, 0, -1], normal: [1, 0, 0] });

  // Municipal connection -> bulk meter -> valve -> sump (float valve)
  const mz = S.z1 - 0.6;
  const g50 = P.gi50;
  const g25 = P.gi25;
  const mEnd = net.node([S.x1 + 2.0, -0.75, mz], { part: { kind: "cap", group: gPlant, networkId: muni, materialId: "gi_pipe", label: "municipal supply connection (by authority)", componentType: "supply_connection" } });
  const mMeter = net.node([S.x1 + 1.4, -0.75, mz], { part: valve(gPlant, muni, "meter-water", "bulk water meter (municipal)", g25.nominal) });
  const mValve = net.node([S.x1 + 0.8, -0.75, mz], { part: valve(gPlant, muni, "valve-gate", "sump inlet gate valve", g25.nominal) });
  const mWall = net.node([S.x1 - 0.05, -0.75, mz]);
  const mFloat = net.node([S.x1 - 0.6, -0.75, mz], { part: { kind: "valve-float", group: gPlant, networkId: muni, materialId: "brass_valve", label: "float (ball) valve, sump inlet", componentType: "float_valve", nominal: g25.nominal } });
  net.run([mEnd, mMeter, mValve, mWall, mFloat], spec(gPlant, muni, g25, { label: "DN25 GI municipal supply" }));

  // Suction: pump -> into the sump -> foot valve near the bottom
  const pumpOut: number[] = [];
  pumpZ.forEach((z, i) => {
    const s0 = net.node([px + 0.38, padTop + 0.17, z], { record: pumps[i]! });
    const s1 = net.node([S.x0 + 0.55, padTop + 0.17, z]);
    const s2 = net.node([S.x0 + 0.55, S.top - S.depth + 0.35, z], { part: { kind: "cap", group: gPlant, networkId: rise, materialId: "brass_valve", label: "foot valve with strainer", componentType: "foot_valve", nominal: g50.nominal } });
    net.run([s0, s1, s2], spec(gPlant, rise, g50, { label: "DN50 GI suction" }));
    // Discharge: pump -> NRV -> gate valve -> header
    const d0 = net.node([px + 0.2, padTop + 0.44, z], { record: pumps[i]! });
    const d1 = net.node([px + 0.2, padTop + 0.64, z], { part: valve(gPlant, rise, "valve-check", "non-return valve", g50.nominal, [-1, 0, 0]) });
    const d2 = net.node([px + 0.2, padTop + 0.88, z], { part: valve(gPlant, rise, "valve-gate", "pump delivery gate valve", g50.nominal, [-1, 0, 0]) });
    const d3 = net.node([px + 0.2, 0.75, z]);
    net.run([d0, d1, d2, d3], spec(gPlant, rise, g50, { label: "DN50 GI pump delivery" }));
    pumpOut.push(d3);
  });
  const h0 = net.node([px + 0.2, 0.75, 0]);
  net.edge(pumpOut[0]!, h0, spec(gPlant, rise, g50, { label: "DN50 GI delivery header" }));
  net.edge(pumpOut[1]!, h0, spec(gPlant, rise, g50, { label: "DN50 GI delivery header" }));

  // Rising main: header -> below grade -> underground to below the shaft -> up the shaft -> tanks
  const RISE: P2 = [sh.x1 - 0.15, sh.z1 - 0.3];
  const DOWN: P2 = [sh.x1 - 0.2, sh.z0 + 0.45];
  const yU = -0.75;
  const startU: P2 = [pad.x0 - 0.35, 0];
  const ugObs = planObstacles(ctx, { x0: -30, x1: 30, z0: -25, z1: 25 }, yU, g50.od / 2 + 0.05);
  const ug = routeOrtho(startU, RISE, ugObs, { half: g50.od / 2 + C.clearance / 2, minLeg: 0.25, bendCost: 0.5 });
  const r1 = net.node([startU[0], 0.75, 0]);
  net.edge(h0, r1, spec(gPlant, rise, g50, { componentType: "rising_main", label: "DN50 GI rising main" }));
  let prev = net.node([startU[0], yU, 0]);
  net.edge(r1, prev, spec(gPlant, rise, g50, { componentType: "rising_main", label: "DN50 GI rising main" }));
  if (!ug) unresolved(ctx, rise, "no underground route for the rising main from the pumps to the shaft");
  for (const p of (ug ?? [startU, RISE]).slice(1)) {
    const n = net.node([p[0], yU, p[1]]);
    net.edge(prev, n, spec(gPlant, rise, g50, { componentType: "rising_main", label: "DN50 GI rising main (underground)" }));
    prev = n;
  }
  const roofTop = ctx.d.slabTop(RF);
  const yExitR = roofTop + 0.74;
  const tanksX = [11.4, 13.6];
  const plat = { x0: 10.35, x1: 14.65, z0: -1.1, z1: 1.1 };
  const platTop = roofTop + ctx.arch.roof.finish + W.platform.height + W.platform.thickness;
  // Riser segments per storey (floor attribution), then out through the upstand to the tanks
  const riserYs = [yU, ...Array.from({ length: ctx.cfg.storeyCount }, (_, L) => ctx.d.slabTop(L + 1) - ctx.cfg.slab.thickness / 2), yExitR];
  for (let i = 1; i < riserYs.length; i++) {
    const y = riserYs[i]!;
    const n = net.node([RISE[0], y, RISE[1]]);
    const s = Math.min(RF, i - 1);
    net.edge(prev, n, spec(i === 1 ? gPlant : i > ctx.cfg.storeyCount ? gRoof : gFloor(s), rise, g50, { componentType: "rising_main", label: "DN50 GI rising main (shaft)" }));
    prev = n;
  }
  const yIn = platTop + 1.85 + 0.35;
  const rOut = net.node([plat.x0 - 0.15, yExitR, RISE[1]]);
  const rUp = net.node([plat.x0 - 0.15, yIn, RISE[1]]);
  net.run([prev, rOut, rUp], spec(gRoof, rise, g50, { componentType: "rising_main", label: "DN50 GI rising main (roof)" }));
  // Platform and tanks
  box(gRoof, rise, "PLT", "tank platform deck (MS chequered plate on ISMB)", "tank_platform", "steel_stand", [plat.x0, platTop - W.platform.thickness, plat.z0], [plat.x1, platTop, plat.z1]);
  ([[plat.x0, plat.z0], [plat.x1, plat.z0], [plat.x0, plat.z1], [plat.x1, plat.z1]] as const).forEach(([x, z], i) => {
    const sx = x === plat.x0 ? 0 : -0.14;
    const sz = z === plat.z0 ? 0 : -0.14;
    box(gRoof, rise, `PLT-LEG${i + 1}`, "tank platform leg", "tank_platform", "steel_stand", [x + sx, roofTop + ctx.arch.roof.finish, z + sz], [x + sx + 0.14, platTop - W.platform.thickness, z + sz + 0.14]);
  });
  const tanks = tanksX.map((x, i) => {
    const id = floorPart(gRoof, rise, `TNK${i + 1}`, "tank-hdpe", `overhead water tank ${W.tankCapacityL} L (HDPE)`, "water_tank", "hdpe_tank", [x, platTop, 0], [1, 0, 0], { nominal: `${W.tankCapacityL} L`, assumptions: `Two ${W.tankCapacityL} L tanks: about half a day's planning demand (${W.demand.lpcd} lpcd x ${W.demand.persons} persons x 29 flats); not a design capacity.` });
    return id;
  });
  // Inlets: header over the tanks, a drop with a valve into each dome
  const inletZ = RISE[1];
  let hPrev = rUp;
  tanksX.forEach((x, i) => {
    const hn = net.node([x, yIn, inletZ]);
    net.edge(hPrev, hn, spec(gRoof, rise, g50, { label: "DN50 GI tank inlet header" }));
    const v = net.node([x, yIn - 0.14, inletZ], { part: valve(gRoof, rise, "valve-gate", "tank inlet valve", g50.nominal, [1, 0, 0]) });
    const end = net.node([x, platTop + 1.88, inletZ], { record: tanks[i]! });
    net.run([hn, v, end], spec(gRoof, rise, g50, { label: "DN50 GI tank inlet" }));
    hPrev = hn;
  });
  // Outlets -> header -> main valve -> into the shaft -> down-take
  const yO = platTop + 0.07; // below the shaft cap where it enters the upstand
  const oz = plat.z0 - 0.2;
  const outNodes = tanksX.map((x, i) => {
    const t0 = net.node([x, yO, -0.86], { record: tanks[i]! });
    const tv = net.node([x, yO, -1.0], { part: valve(gRoof, dist, "valve-gate", "tank outlet valve", P.gi65.nominal, [0, 1, 0]) });
    const t1 = net.node([x, yO, oz]);
    net.run([t0, tv, t1], spec(gRoof, dist, P.gi65, { flow: "upstream", label: "DN65 GI tank outlet" }));
    return t1;
  });
  const oW = net.node([plat.x0 - 0.15, yO, oz]);
  net.edge(outNodes[1]!, outNodes[0]!, spec(gRoof, dist, P.gi65, { label: "DN65 GI outlet header" }));
  net.edge(outNodes[0]!, oW, spec(gRoof, dist, P.gi65, { label: "DN65 GI outlet header" }));
  const mv = net.node([plat.x0 - 0.15, yO, (oz + DOWN[1]) / 2], { part: valve(gRoof, dist, "valve-gate", "down-take main valve", P.gi65.nominal, [0, 1, 0]) });
  const oN = net.node([plat.x0 - 0.15, yO, DOWN[1]]);
  const oIn = net.node([DOWN[0], yO, DOWN[1]]);
  net.run([oW, mv, oN, oIn], spec(gRoof, dist, P.gi65, { label: "DN65 GI down-take (roof)" }));
  // Down-take with one branch per storey
  const Zh = C.headerZ;
  const takeoffs: TakeOff[] = [];
  let dPrev = oIn;
  const slabMid = (L: number) => ctx.d.slabTop(L) - ctx.cfg.slab.thickness / 2;
  for (let s = ctx.cfg.storeyCount - 1; s >= 0; s--) {
    // slab crossing node (floor attribution) above this storey's branch
    const cross = net.node([DOWN[0], slabMid(s + 1), DOWN[1]]);
    net.edge(dPrev, cross, spec(s + 1 >= RF ? gRoof : gFloor(s + 1), dist, P.gi65, { componentType: "down_take", label: "DN65 GI down-take (shaft)" }));
    const yb = ctx.d.slabTop(s) + C.layers.cold;
    const tn = net.node([DOWN[0], yb, DOWN[1]]);
    net.edge(cross, tn, spec(gFloor(s), dist, P.gi65, { componentType: "down_take", label: "DN65 GI down-take (shaft)" }));
    dPrev = tn;
    const gv = net.node([DOWN[0], yb, sh.z0 + 0.2], { part: valve(gFloor(s), dist, "valve-gate", `floor isolation valve ${ftag(s)}`, P.gi32.nominal, [0, 1, 0]) });
    const hn = net.node([DOWN[0], yb, Zh]);
    net.run([tn, gv, hn], spec(gFloor(s), dist, P.gi32, { label: "DN32 GI floor branch" }));
    takeoffs.push(...header(ctx, net, gFloor(s), dist, s, hn, [DOWN[0], Zh], yb, spec, valve));
  }
  net.emit(ctx.drafts);
  // Penetrations into the sump: the inlet and suction pipes and their valves belong to it.
  for (const n of [mFloat]) {
    const id = net.emittedAt(n);
    if (id) ctx.drafts.link(id, sump);
  }
  for (const d of ctx.drafts.drafts.slice(from)) if (d.componentType === "foot_valve" || (d.name.includes("suction") && d.position[1] < S.top)) ctx.drafts.link(d.id, sump);
  for (const n of [mWall]) for (const run of net.runsAt(n)) ctx.drafts.link(run, sump);
  // Supports and covers belong to what they carry
  const id = (code: string) => `${gPlant.id}-${code}`;
  const rid = (code: string) => `${gRoof.id}-${code}`;
  ctx.drafts.link(id("SUMP-MH1"), sump);
  ctx.drafts.link(id("SUMP-MH2"), sump);
  for (const pmp of pumps) {
    ctx.drafts.link(id("PAD"), pmp);
    ctx.drafts.link(panelId, pmp);
  }
  ctx.drafts.link(id("POST"), panelId);
  for (const tk of tanks) ctx.drafts.link(rid("PLT"), tk);
  for (let i = 1; i <= 4; i++) ctx.drafts.link(rid(`PLT-LEG${i}`), rid("PLT"));
  indexDrafts(ctx, from);
  // Resolve meter ids
  return takeoffs.map((t) => ({ ...t, meter: net.emittedAt(Number(t.meter))! }));
}

/** Corridor header for one storey: take-offs (valve + meter) at every flat entrance. */
function header(
  ctx: MepContext,
  net: Net,
  g: Group,
  dist: string,
  s: number,
  hIn: number,
  at: P2,
  y: number,
  spec: (g: Group, network: string, pipe: { od: number; nominal: string }, extra?: Partial<RunSpec>) => RunSpec,
  valve: (g: Group, network: string, kind: FittingPart, label: string, nominal: string, up?: V3) => NodePart,
): TakeOff[] {
  const plan = ctx.interiors[s]!.plan;
  const zc = ctx.grid.zs[2]!; // corridor north line (gridline 3)
  const zsouth = zc - 1.8;
  const half = ctx.arch.walls.core / 2;
  const used: number[] = [at[0]];
  const tos: { x: number; aptId: string; north: boolean }[] = [];
  const pick = (x0: number) => {
    for (const off of [0.75, -0.75, 1.1, -1.1, 1.45, -1.45]) {
      const x = x0 + off;
      if (ctx.grid.xs.some((gx) => Math.abs(gx - x) < 0.5)) continue;
      if (used.some((u) => Math.abs(u - x) < 0.4)) continue;
      return x;
    }
    return null;
  };
  for (const apt of plan.apartments) {
    if (apt.id === "CM") continue;
    const door = plan.doors.find((d) => d.typeKey === "MD" && d.rooms.includes("CM-COR") && d.rooms.includes(apt.entranceRoom));
    if (!door) continue;
    const x = pick(door.centre);
    if (x === null) {
      unresolved(ctx, `${apt.id} ${ftag(s)}`, "no free take-off position on the corridor header");
      continue;
    }
    used.push(x);
    tos.push({ x, aptId: apt.id, north: Math.abs(door.line.c - zc) < 1e-6 });
  }
  // Ground floor common block (staff toilet) via the meter room wall
  if (plan.rooms.some((r) => r.id === "CM-TLT")) {
    const mtr = plan.rooms.find((r) => r.id === "CM-MTR")!.rects[0]!;
    const x = pick((mtr.x0 + mtr.x1) / 2 - 0.75);
    if (x !== null) {
      used.push(x);
      tos.push({ x, aptId: "CM", north: false });
    }
  }
  const out: TakeOff[] = [];
  const west = tos.filter((t) => t.x < at[0]).sort((a, b) => b.x - a.x);
  const east = tos.filter((t) => t.x > at[0]).sort((a, b) => a.x - b.x);
  const g40 = MEP_CONFIG.pipe.gi32;
  const g25 = MEP_CONFIG.pipe.gi25;
  for (const side of [west, east]) {
    let prev = hIn;
    for (const t of side) {
      const n = net.node([t.x, y, at[1]]);
      net.edge(prev, n, spec(g, dist, g40, { componentType: "pipe_header", label: "DN32 GI corridor header" }));
      prev = n;
      const dir = t.north ? 1 : -1;
      const rv = g25.od / 2;
      const vz = at[1] + dir * (2.7 * (g40.od / 2) + 0.02 + 2.8 * rv);
      const mz = vz + dir * (2.8 * rv + 0.02 + 3.4 * rv);
      const v = net.node([t.x, y, vz], { part: valve(g, dist, "valve-gate", `take-off gate valve ${t.aptId}`, g25.nominal, [0, 1, 0]) });
      const m = net.node([t.x, y, mz], { part: valve(g, dist, "meter-water", `water meter ${t.aptId} ${ftag(s)}`, g25.nominal, [0, 1, 0]) });
      net.run([n, v, m], spec(g, dist, g25, { label: "DN25 GI take-off" }));
      const wallFace = t.north ? zc + half : zsouth - half;
      out.push({ storey: s, aptId: t.aptId, meter: String(m), at: [t.x, y, mz], into: [0, 0, dir], wallFace });
    }
  }
  return out;
}

// ── apartments: cold water tree, geysers, hot water, shower risers ───────────────

interface Terminal {
  readonly key: string;
  /** Plan keep-out of the stub from Q into the wall. */
  readonly keep: PlanRect;
  readonly endRecord: string;
  /** Points from the void stub Q down to the endpoint (Q first). */
  readonly path: V3[];
  readonly q: P2;
  readonly leg: V3; // fixed leg at Q (toward the wall)
  readonly roomId: string;
  readonly valveAt?: { outer: V3; n: V3 }; // angle valve at an A2 connection point
}

const SUPPLY_CP = /-(CPW|CP-WC|CP-BSN-W)$/;

function apartmentWater(ctx: MepContext, t: TakeOff): void {
  const s = t.storey;
  const ictx = ctx.interiors[s]!;
  const plan = ictx.plan;
  const apt = plan.apartments.find((a) => a.id === t.aptId);
  if (!apt) return;
  const from = ctx.drafts.drafts.length;
  const netId = declareNetwork(ctx, { id: `PLB-NET-CW-${ftag(s)}-${t.aptId}`, system: "plumbing", kind: "cold-water", name: `Cold water ${t.aptId} ${ftag(s)}`, floor: s, apartmentId: t.aptId, parent: "PLB-NET-WS-DIST" });
  const g = ctx.drafts.group({ system: "plumbing", type: "CW", floor: s, loc: t.aptId, name: `Cold water ${t.aptId} ${ftag(s)}`, assemblyType: "cold_water", category: "water", materialId: "cpvc_cold", apartmentId: t.aptId });
  const gh = ctx.drafts.group({ system: "plumbing", type: "HW", floor: s, loc: t.aptId, name: `Hot water ${t.aptId} ${ftag(s)}`, assemblyType: "hot_water", category: "hotWater", materialId: "cpvc_hot", apartmentId: t.aptId });
  const yC = ctx.d.slabTop(s) + C.layers.cold;
  const yH = ctx.d.slabTop(s) + C.layers.hot;
  const recs = ctx.archRecords.filter((r) => r.floor === s && r.apartmentId === t.aptId && r.geometry.kind !== "group");
  const room = (id: string) => ictx.rooms.get(id)!;
  const tile = ctx.arch.tiling.thickness;
  const wet = (ir: InteriorRoom) => ir.room.type === "bathroom" || ir.room.type === "toilet";

  // Geysers first (they are terminals of both trees)
  const geysers: { id: string; m: Mount; a: number; y: number; roomId: string; mixer: ComponentRecord }[] = [];
  for (const mixer of recs.filter((r) => r.componentType === "shower_mixer")) {
    const ir = room(mixer.roomId!);
    const gy = placeGeyser(ctx, gh, ir, s, mixer);
    if (gy) geysers.push({ ...gy, roomId: ir.room.id, mixer });
    else unresolved(ctx, mixer.id, "no free wall position for a geyser in this bathroom (hot water not provided)");
  }

  const terms: Terminal[] = [];
  const reach = (key: string, endRecord: string, m: Mount, a: number, y: number, depth: number, roomId: string, layer: number, r: number, valveAt?: { outer: V3; n: V3 }): Terminal | null => {
    const ch = findChase(ctx, m, a, y, layer, r, { reach: 1.2, clear: 0.012 });
    if (!ch) {
      unresolved(ctx, endRecord, `no clear wall chase from ${key} up to the ceiling void`);
      return null;
    }
    const top = ch.points[ch.points.length - 1]!;
    const q = wallPoint(m, ch.a, layer, C.voidStub);
    const e0 = wallPoint(m, a, y, depth);
    const path = [q, top, ...ch.points.slice(0, -1).reverse(), e0];
    const k = r + C.clearance / 2;
    const keep = { x0: Math.min(q[0], top[0]) - k, x1: Math.max(q[0], top[0]) + k, z0: Math.min(q[2], top[2]) - k, z1: Math.max(q[2], top[2]) + k };
    return { key, endRecord, path, q: [q[0], q[2]], leg: axisDir(scale(m.n, -1)), roomId, keep, ...(valveAt ? { valveAt } : {}) };
  };
  for (const cp of recs.filter((r) => r.componentType === "connection_point" && SUPPLY_CP.test(r.id))) {
    const ir = room(cp.roomId!);
    const m = mountAt(s, ir, cp.originalPosition[0], cp.originalPosition[2]);
    const { wall, outer } = stubEnds(cp, m);
    const depth = (m.axis === "x" ? (wall[2] - m.face) * m.n[2] : (wall[0] - m.face) * m.n[0]);
    endpoint(ctx, cp.id, cp.id.endsWith("CP-WC") ? "WC cistern supply" : cp.id.endsWith("CP-BSN-W") ? "basin supply" : cp.id.startsWith("ARC-KIT") ? "sink supply" : "washer supply");
    const tm = reach(cp.id, cp.id, m, alongOf(m, cp.originalPosition), cp.originalPosition[1], depth, ir.room.id, yC, P.cpvc15.od / 2, { outer, n: m.n });
    if (tm) terms.push(tm);
  }
  const mixerLegs = new Map<string, { m: Mount; a: number; y: number; depth: number }>();
  for (const mixer of recs.filter((r) => r.componentType === "shower_mixer")) {
    const ir = room(mixer.roomId!);
    const m = mountAt(s, ir, mixer.originalPosition[0], mixer.originalPosition[2]);
    const a = alongOf(m, mixer.originalPosition);
    const depth = wet(ir) ? tile : 0;
    mixerLegs.set(mixer.id, { m, a, y: mixer.originalPosition[1], depth });
    endpoint(ctx, mixer.id, "shower mixer (cold / hot)");
    // facing the wall, hot is on the left: left = -(Y x n) along the wall
    const right = wallBasis(m).ex;
    const sideSign = m.axis === "x" ? right[0] : right[2];
    const tm = reach(`${mixer.id}#cold`, mixer.id, m, a + 0.055 * sideSign, mixer.originalPosition[1], depth, ir.room.id, yC, P.cpvc15.od / 2);
    if (tm) terms.push(tm);
  }
  for (const gy of geysers) {
    const right = wallBasis(gy.m).ex;
    const sideSign = gy.m.axis === "x" ? right[0] : right[2];
    const tm = reach(`${gy.id}#in`, gy.id, gy.m, gy.a + 0.06 * sideSign, gy.y - 0.12, tile, gy.roomId, yC, P.cpvc15.od / 2);
    if (tm) terms.push(tm);
  }
  if (!terms.length) return;

  // Hot-water chases pass the cold layer: reserve them before routing the cold tree.
  const hot: { src: Terminal; dst: Terminal; geyser: string; mixer: string; roomId: string }[] = [];
  for (const gy of geysers) {
    const right = wallBasis(gy.m).ex;
    const sideSign = gy.m.axis === "x" ? right[0] : right[2];
    const src = reach(`${gy.id}#out`, gy.id, gy.m, gy.a - 0.06 * sideSign, gy.y - 0.12, tile, gy.roomId, yH, P.cpvc20.od / 2);
    const ml = mixerLegs.get(gy.mixer.id)!;
    const rr = wallBasis(ml.m).ex;
    const sideM = ml.m.axis === "x" ? rr[0] : rr[2];
    const dst = reach(`${gy.mixer.id}#hot`, gy.mixer.id, ml.m, ml.a - 0.055 * sideM, ml.y, ml.depth, gy.roomId, yH, P.cpvc15.od / 2);
    if (src && dst) hot.push({ src, dst, geyser: gy.id, mixer: gy.mixer.id, roomId: gy.roomId });
  }
  const hotPins = hot.flatMap((h) => [...h.src.path, ...h.dst.path].map((p) => ({ x0: p[0] - 0.03, x1: p[0] + 0.03, z0: p[2] - 0.03, z1: p[2] + 0.03 })));

  // Root: the take-off continues from the meter through the corridor wall into the flat's void.
  const net = new Net();
  const meterNode = net.node(t.at, { record: t.meter });
  // meter -> through the corridor wall into the flat's ceiling void (same layer as the header)
  const q0: V3 = [t.at[0], yC, t.wallFace + t.into[2] * 0.2];
  const root = net.node(q0);
  const region =
    t.aptId === "CM"
      ? envelopeRegion(plan.rooms.filter((r) => ["CM-SOC", "CM-SEC", "CM-TLT", "CM-MTR", "CM-LOB"].includes(r.id)).flatMap((r) => r.rects), plan.outline)
      : envelopeRegion(apt.envelope, plan.outline);
  const area = bbox(region);
  const obstacles = [...planObstacles(ctx, area, yC, P.cpvc25.od / 2), ...hotPins];
  const tree = buildTree({ p: [q0[0], q0[2]], legs: [axisDir(scale(t.into, -1))] }, terms.map((x) => ({ key: x.key, p: x.q, legs: [x.leg], keep: x.keep })), obstacles, { half: P.cpvc25.od / 2 + C.clearance / 2, jointGap: 2 * 2.7 * (P.cpvc25.od / 2) + 0.01, region, bendCost: 0.15 });
  for (const k of tree.unresolved) unresolved(ctx, terms.find((x) => x.key === k)!.endRecord, `cold-water branch for ${k} could not be routed in the ceiling void`);
  const pipeFor = (n: number) => (n >= 4 ? P.cpvc25 : n >= 2 ? P.cpvc20 : P.cpvc15);
  const cspec = (pipe: { od: number; nominal: string }, extra: Partial<RunSpec> = {}): RunSpec => ({ kind: "pipe", group: g, networkId: netId, od: pipe.od, materialId: "cpvc_cold", componentType: "pipe", label: `${pipe.nominal} pipe`, nominal: pipe.nominal, flow: "upstream", ...extra });
  net.edge(meterNode, root, cspec(P.cpvc25, { label: "1 in CPVC flat main (from meter)" }));
  emitTree(net, tree, root, yC, terms, cspec, pipeFor);

  // Hot water per geyser (terminals were reserved before the cold tree was routed)
  const hobs = planObstacles(ctx, area, yH, P.cpvc20.od / 2);
  for (const h of hot) {
    const hnet = hotNetwork(ctx, s, t.aptId, h.roomId, netId);
    const hspec = (pipe: { od: number; nominal: string }, extra: Partial<RunSpec> = {}): RunSpec => ({ kind: "pipe", group: gh, networkId: hnet, od: pipe.od, materialId: "cpvc_hot", componentType: "pipe", label: `${pipe.nominal} hot-water pipe`, nominal: pipe.nominal, flow: "upstream", roomId: h.roomId, ...extra });
    const htree = buildTree({ p: h.src.q, legs: [h.src.leg] }, [{ key: h.dst.key, p: h.dst.q, legs: [h.dst.leg] }], hobs, { half: P.cpvc20.od / 2 + C.clearance / 2, jointGap: 2 * 2.7 * (P.cpvc20.od / 2) + 0.01, region, bendCost: 0.15 });
    if (htree.unresolved.length) {
      unresolved(ctx, h.mixer, "hot-water run from the geyser to the mixer could not be routed");
      continue;
    }
    const srcIds = [...h.src.path].reverse().map((p, i) => net.node(p, i === 0 ? { record: h.geyser } : {}));
    for (let i = 0; i + 1 < srcIds.length; i++) net.edge(srcIds[i]!, srcIds[i + 1]!, hspec(P.cpvc20, { label: "3/4 in CPVC hot outlet (chase)" }));
    emitTree(net, htree, srcIds[srcIds.length - 1]!, yH, [h.dst], (pipe, extra) => hspec(pipe, extra), () => P.cpvc20);
    ctx.endpoints.get(h.mixer)?.connectedBy.push(hnet);
  }

  // Shower risers: mixer -> concealed riser -> shower arm (mixed water, part of the cold-water network)
  for (const arm of recs.filter((r) => r.componentType === "shower_arm")) {
    const mixer = recs.find((r) => r.componentType === "shower_mixer" && r.roomId === arm.roomId);
    const ml = mixer && mixerLegs.get(mixer.id);
    if (!mixer || !ml) continue;
    endpoint(ctx, arm.id, "shower arm");
    const r = P.cpvc15.od / 2;
    const armWall = wallPoint(ml.m, alongOf(ml.m, arm.originalPosition), arm.originalPosition[1], ml.depth);
    const ch = findChase(ctx, ml.m, ml.a, ml.y, arm.originalPosition[1], r, { reach: 0.0001, clear: 0.005 });
    if (!ch) {
      unresolved(ctx, arm.id, "shower riser chase blocked");
      continue;
    }
    const pts = [wallPoint(ml.m, ml.a, ml.y, ml.depth), ...ch.points, armWall];
    const ids = pts.map((p, i) => net.node(p, i === 0 ? { record: mixer.id } : i === pts.length - 1 ? { record: arm.id } : {}));
    for (let i = 0; i + 1 < ids.length; i++) net.edge(ids[i]!, ids[i + 1]!, cspec(P.cpvc15, { componentType: "shower_riser", label: "1/2 in CPVC shower riser (mixed water)" }));
    ctx.endpoints.get(arm.id)?.connectedBy.push(netId);
  }

  net.emit(ctx.drafts);
  // Angle valves at the A2 connection points (fixture side)
  for (const tm of terms) {
    if (!tm.valveAt) continue;
    const rv = P.cpvc15.od / 2 * 0.9;
    const box = fittingBox("valve-ball", rv);
    const node = add(tm.valveAt.outer, scale(tm.valveAt.n, -box.lo[0]));
    const pl = placeLocal(node, tm.valveAt.n, [0, 1, 0], box.lo, box.hi);
    const d = ctx.drafts.add(g, { code: "V", name: `${g.name}: angle valve (stop cock)`, componentType: "angle_valve", materialId: "stainless_steel", geometry: { kind: "part", part: "valve-ball", size: pl.size, fill: PART_FILL["valve-ball"]! }, position: pl.position, rotation: pl.rotation, dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1], diameter: 2 * rv }, unit: "nr", networkId: netId, nominalSize: "1/2 in", roomId: tm.roomId });
    ctx.drafts.link(d.id, tm.endRecord);
    // joined to the supply run through the connection point
    for (const run of ctx.drafts.drafts.slice(from)) if (run.networkId === netId && run.connections.has(tm.endRecord) && run.id !== d.id && run.unit === "m") ctx.drafts.link(d.id, run.id);
  }
  for (const tm of terms) if (!tree.unresolved.includes(tm.key)) ctx.endpoints.get(tm.endRecord)?.connectedBy.push(netId);
  indexDrafts(ctx, from);
}

/** Emit a planar supply tree at height y plus each terminal's stub/chase path down to its endpoint. */
function emitTree(net: Net, tree: Tree, rootNode: number, y: number, terms: readonly Terminal[], spec: (pipe: { od: number; nominal: string }, extra?: Partial<RunSpec>) => RunSpec, pipeFor: (downstream: number) => { od: number; nominal: string }): void {
  const n = tree.pts.length;
  const kids: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of tree.segs) kids[a]!.push(b);
  const count = new Array<number>(n).fill(0);
  const visit = (v: number): number => {
    let c = tree.pts[v]!.term ? 1 : 0;
    for (const k of kids[v]!) c += visit(k);
    count[v] = c;
    return c;
  };
  visit(0);
  const ids = tree.pts.map((p, i) => (i === 0 ? rootNode : net.node([p.p[0], y, p.p[1]])));
  for (const [a, b] of tree.segs) net.edge(ids[a]!, ids[b]!, spec(pipeFor(count[b]!)));
  tree.pts.forEach((p, i) => {
    if (!p.term) return;
    const t = terms.find((x) => x.key === p.term)!;
    let prev = ids[i]!;
    t.path.slice(1).forEach((pt, k) => {
      const last = k === t.path.length - 2;
      const nn = net.node(pt, last ? { record: t.endRecord } : {});
      net.edge(prev, nn, spec(MEP_CONFIG.pipe.cpvc15, { label: k === 0 ? "1/2 in CPVC drop (void stub)" : "1/2 in CPVC drop (wall chase)" }));
      prev = nn;
    });
  });
}

/** Geyser on a bathroom wall near the shower mixer, clear of fittings, openings and the screen. */
function placeGeyser(ctx: MepContext, g: Group, ir: InteriorRoom, s: number, mixer: ComponentRecord): { id: string; m: Mount; a: number; y: number } | null {
  const tile = ctx.arch.tiling.thickness;
  const y = ctx.d.ffl(s) + C.geyser.centreAboveFFL;
  const clear = ir.clears.reduce((a, b) => ((b.x1 - b.x0) * (b.z1 - b.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a));
  const mx = mixer.originalPosition;
  let best: { m: Mount; a: number; d: number } | null = null;
  for (const side of ["S", "N", "W", "E"] as Side[]) {
    const m = mountOn(s, ir.room.id, clear, side);
    const [s0, s1] = m.axis === "x" ? [clear.x0, clear.x1] : [clear.z0, clear.z1];
    for (let a = s0 + 0.25; a <= s1 - 0.25 + 1e-9; a += 0.05) {
      const p = wallPoint(m, a, y, tile);
      const d = Math.abs(p[0] - mx[0]) + Math.abs(p[2] - mx[2]);
      if (best && d >= best.d) continue;
      const bx = wallPartBox("geyser", m, a, y, tile);
      if (!ctx.space.free(bx) || !ctx.mep.free(bx)) continue;
      // nothing but masonry in the wall behind it (no window / door / column)
      const back = wallPartBox("geyser", m, a, y, -0.12, 0.0);
      if (ctx.space.query(back, (x) => !MASONRY.has(x.componentType)).length) continue;
      best = { m, a, d };
    }
  }
  if (!best) return null;
  const network = hotNetwork(ctx, s, ir.room.aptId, ir.room.id, `PLB-NET-CW-${ftag(s)}-${ir.room.aptId}`);
  const d = wallPart(ctx, g, "geyser", best.m, best.a, y, tile, { code: "GEY", name: `${g.name}: storage water heater ${C.geyser.capacityL} L`, componentType: "water_heater", materialId: "appliance_white", networkId: network, nominalSize: `${C.geyser.capacityL} L, 2 kW`, roomId: ir.room.id });
  ctx.appliances.push({ kind: "geyser", id: d.id, storey: s, aptId: ir.room.aptId, roomId: ir.room.id, anchor: wallPoint(best.m, best.a, y, tile), along: wallBasis(best.m).ex, normal: best.m.n });
  return { id: d.id, m: best.m, a: best.a, y };
}

const hotNetworkId = (s: number, _aptId: string, roomId: string) => `PLB-NET-HW-${ftag(s)}-${roomId}`;

function hotNetwork(ctx: MepContext, s: number, aptId: string, roomId: string, parent: string): string {
  return declareNetwork(ctx, { id: hotNetworkId(s, aptId, roomId), system: "plumbing", kind: "hot-water", name: `Hot water ${roomId} ${ftag(s)} (geyser to shower mixer)`, floor: s, apartmentId: aptId, parent });
}

/**
 * Allowed plan region of a flat: its envelope, kept out of the boundary walls. Exterior
 * walls stand outside the facade gridline (inner face 5 mm inside it); party and corridor
 * walls are centred on the boundary (inner face 115 mm inside it).
 */
export function envelopeRegion(env: readonly PlanRect[], outline: PlanRect): PlanRect[] {
  const on = (v: number, a: number, b: number) => Math.abs(v - a) < 1e-6 || Math.abs(v - b) < 1e-6;
  return env.map((r) => {
    const kx0 = on(r.x0, outline.x0, outline.x1) ? 0.035 : 0.145;
    const kx1 = on(r.x1, outline.x0, outline.x1) ? 0.035 : 0.145;
    const kz0 = on(r.z0, outline.z0, outline.z1) ? 0.035 : 0.145;
    const kz1 = on(r.z1, outline.z0, outline.z1) ? 0.035 : 0.145;
    const shared = (side: "x0" | "x1" | "z0" | "z1") =>
      env.some((o) => o !== r && (side === "x0" ? Math.abs(o.x1 - r.x0) < 1e-6 && o.z1 > r.z0 && o.z0 < r.z1 : side === "x1" ? Math.abs(o.x0 - r.x1) < 1e-6 && o.z1 > r.z0 && o.z0 < r.z1 : side === "z0" ? Math.abs(o.z1 - r.z0) < 1e-6 && o.x1 > r.x0 && o.x0 < r.x1 : Math.abs(o.z0 - r.z1) < 1e-6 && o.x1 > r.x0 && o.x0 < r.x1));
    return { x0: r.x0 + (shared("x0") ? 0 : kx0), x1: r.x1 - (shared("x1") ? 0 : kx1), z0: r.z0 + (shared("z0") ? 0 : kz0), z1: r.z1 - (shared("z1") ? 0 : kz1) };
  });
}

const bbox = (rs: readonly PlanRect[]): PlanRect => ({ x0: Math.min(...rs.map((r) => r.x0)) - 0.5, x1: Math.max(...rs.map((r) => r.x1)) + 0.5, z0: Math.min(...rs.map((r) => r.z0)) - 0.5, z1: Math.max(...rs.map((r) => r.z1)) + 0.5 });

