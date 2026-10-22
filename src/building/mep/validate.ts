/**
 * MEP validation (A3), on the generated records (the same records the viewer draws).
 * Geometric validity, logical connectivity and engineering adequacy are kept apart: these
 * checks establish the first two only. Passing them says nothing about code compliance.
 *
 * Clashes use the A2 overlap engine (findOverlaps) with an explicit, documented allow-list:
 * intentional contacts between connected parts, sleeved penetrations of masonry, floors and
 * ceilings, services inside the sink cabinet, cables inside their containment and modules
 * inside their enclosures. Nothing is allowed against beams, columns or foundations.
 */

import { isValidComponentId, parseComponentId } from "../ids";
import type { ComponentRecord } from "../structure";
import { quantityFor, type ArcUnit } from "../architecture/record";
import { findOverlaps, type AllowRule } from "../architecture/validateComponents";
import { hasMaterial } from "../materialLibrary";
import { CEILINGS, FINISHES, MASONRY } from "./context";

/** Equipment never sits inside masonry (everything else may pass through it in a chase or sleeve). */
const EQUIPMENT = new Set(["water_tank", "pump", "sump_tank", "pump_plinth", "tank_platform", "pump_control_panel", "support_post", "inspection_chamber", "manhole", "recharge_pit", "manhole_cover", "water_heater", "main_panel", "meter_board", "feeder_pillar", "earth_pit"]);
const SLAB_PASS = new Set(["pipe_elbow", "pipe_tee", "pipe_cross", "trap", "cleanout", "conduit_bend", "junction_box"]);

const isVerticalRun = (r: ComponentRecord) =>
  (r.geometry.kind === "cylinder" && r.geometry.axis === "y") || (r.geometry.kind === "box" && r.componentType.includes("strip") && r.geometry.size[1] > Math.max(r.geometry.size[0], r.geometry.size[2])) || (r.geometry.kind === "part" && r.geometry.part === "tray" && Math.abs(r.originalRotation[2]) > 1);
const isMep = (r: ComponentRecord) => r.system === "plumbing" || r.system === "electrical";

export function mepAllowRules(byId: ReadonlyMap<string, ComponentRecord>): AllowRule[] {
  const connected = (a: ComponentRecord, b: ComponentRecord) => (a.connectedTo ?? []).includes(b.id) || (b.connectedTo ?? []).includes(a.id);
  const twoHop = (a: ComponentRecord, b: ComponentRecord) => (a.connectedTo ?? []).some((x) => (byId.get(x)?.connectedTo ?? []).includes(b.id) || (b.connectedTo ?? []).includes(x));
  return [
    { reason: "physically joined components (pipe/fitting/endpoint contact)", allow: (a, b) => isMep(a) && connected(a, b) },
    { reason: "fitting bodies reaching over the next joint (short legs between fittings)", allow: (a, b) => isMep(a) && twoHop(a, b) },
    { reason: "concealed chases and sleeved wall penetrations (pipes, conduits, cables, trays, recessed devices)", allow: (a, b) => isMep(a) && !EQUIPMENT.has(a.componentType) && MASONRY.has(b.componentType) },
    { reason: "services through floor finishes, roof finish and ceiling boards", allow: (a, b) => isMep(a) && (FINISHES.has(b.componentType) || CEILINGS.has(b.componentType)) },
    { reason: "sleeved slab penetrations (vertical runs and the fittings at them)", allow: (a, b) => isMep(a) && b.componentType === "slab" && (isVerticalRun(a) || SLAB_PASS.has(a.componentType)) },
    { reason: "sink waste/supply inside the sink base unit", allow: (a, b) => isMep(a) && (b.componentType === "kitchen_base_cabinet" || b.componentType === "kitchen_plinth") && a.roomId === b.roomId },
    { reason: "floor-trap tail through the shower tray", allow: (a, b) => a.system === "plumbing" && b.componentType === "shower_tray" && a.roomId === b.roomId },
    { reason: "cables inside the conduit / tray that carries their circuit", allow: (a, b) => a.componentType.includes("cable") && (b.carries ?? []).includes(a.networkId ?? "") },
    { reason: "conduits and cables embedded in the RCC entrance canopy", allow: (a, b) => a.system === "electrical" && b.componentType === "entrance_canopy" },
    { reason: "cables in their trays, conduits, junction boxes and tray adaptors (pulled through)", allow: (a, b) => a.componentType.includes("cable") && (b.system === "electrical" && /tray|conduit|junction_box|adaptor|cable/.test(b.componentType)) },
    { reason: "cables entering panels, boards and meters", allow: (a, b) => a.componentType.includes("cable") && /panel|board|meter|isolator|rccb|mcb|pillar/.test(b.componentType) },
    { reason: "modules and meters inside their enclosure", allow: (a, b) => isMep(a) && isMep(b) && a.parentId !== undefined && a.parentId === b.parentId && (a.componentType === "mcb" || a.componentType === "energy_meter" || a.componentType === "rccb") },
  ];
}

/** MEP records against A1/A2 and against each other. */
export function findMepClashes(mep: readonly ComponentRecord[], building: readonly ComponentRecord[]) {
  const byId = new Map<string, ComponentRecord>([...building, ...mep].map((r) => [r.id, r]));
  const rules = mepAllowRules(byId);
  return { building: findOverlaps(mep, building, rules), internal: findOverlaps(mep, undefined, rules) };
}

export function checkMepIds(records: readonly ComponentRecord[]): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) errs.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!isValidComponentId(r.id)) errs.push(`invalid id ${r.id}`);
    const p = parseComponentId(r.id);
    if (!p) continue;
    if (p.system !== r.system) errs.push(`${r.id}: prefix does not match system ${r.system}`);
    const floor = r.floor < 0 ? 0 : r.floor;
    if (p.floor !== floor) errs.push(`${r.id}: floor tag ${p.floor} != record floor ${r.floor}`);
  }
  return errs;
}

/** Quantities follow unit + dimensions; dimensions follow geometry; materials exist. */
export function checkMepQuantities(records: readonly ComponentRecord[]): string[] {
  const errs: string[] = [];
  for (const r of records) {
    if (!hasMaterial(r.materialId)) errs.push(`${r.id}: unknown material ${r.materialId}`);
    const unit = r.unit as ArcUnit;
    const q = quantityFor(unit, r.dimensions, r.geometry);
    if (Math.abs(q - r.quantity) > 1e-9 * Math.max(1, q)) errs.push(`${r.id}: quantity ${r.quantity} != ${q}`);
    if (!(r.quantity > 0)) errs.push(`${r.id}: non-positive quantity`);
    for (const [k, v] of Object.entries(r.dimensions)) if (!(v! > 0)) errs.push(`${r.id}: dimension ${k} = ${v}`);
    const g = r.geometry;
    if (g.kind === "cylinder") {
      if (r.unit !== "m") errs.push(`${r.id}: run not measured in m`);
      if (Math.abs((r.dimensions.length ?? 0) - g.height) > 1e-9) errs.push(`${r.id}: length ${r.dimensions.length} != geometry ${g.height}`);
      if (Math.abs((r.dimensions.diameter ?? 0) - 2 * g.radius) > 1e-9) errs.push(`${r.id}: diameter ${r.dimensions.diameter} != geometry ${2 * g.radius}`);
    }
    if (g.kind === "part" && g.part === "tray" && Math.abs((r.dimensions.length ?? 0) - g.size[0]) > 1e-9) errs.push(`${r.id}: tray length != geometry`);
    if (g.kind === "part" && g.part !== "tray" && r.unit !== "nr") errs.push(`${r.id}: discrete part not counted in nr`);
  }
  return errs;
}

/** Connections are symmetric between MEP records and point at real records; networks hang together. */
export function checkConnectivity(mep: readonly ComponentRecord[], building: ReadonlyMap<string, ComponentRecord>, networkIds: ReadonlySet<string>): string[] {
  const errs: string[] = [];
  const byId = new Map(mep.map((r) => [r.id, r]));
  const solids = mep.filter((r) => r.geometry.kind !== "group");
  for (const r of solids) {
    if (!r.networkId) errs.push(`${r.id}: no network`);
    else if (!networkIds.has(r.networkId)) errs.push(`${r.id}: unknown network ${r.networkId}`);
    if (!r.connectedTo?.length) errs.push(`${r.id}: connected to nothing`);
    for (const o of r.connectedTo ?? []) {
      const m = byId.get(o);
      if (m) {
        if (!(m.connectedTo ?? []).includes(r.id)) errs.push(`${r.id} -> ${o} not symmetric`);
      } else if (!building.has(o)) errs.push(`${r.id}: connected to unknown ${o}`);
    }
    for (const d of r.dependencies) if (!byId.has(d) && !building.has(d)) errs.push(`${r.id}: dependency on unknown ${d}`);
    for (const c of r.carries ?? []) if (!networkIds.has(c)) errs.push(`${r.id}: carries unknown network ${c}`);
  }
  // One connected component per network (through same-network joints).
  const members = new Map<string, ComponentRecord[]>();
  for (const r of solids) if (r.networkId) (members.get(r.networkId) ?? members.set(r.networkId, []).get(r.networkId)!).push(r);
  for (const [net, list] of members) {
    const seen = new Set<string>([list[0]!.id]);
    const queue = [list[0]!];
    while (queue.length) {
      const r = queue.pop()!;
      for (const o of r.connectedTo ?? []) {
        const m = byId.get(o);
        if (m && m.networkId === net && !seen.has(o)) {
          seen.add(o);
          queue.push(m);
        }
      }
    }
    if (seen.size !== list.length) errs.push(`network ${net}: ${list.length - seen.size} of ${list.length} components not reachable from the rest`);
  }
  return errs;
}

/** Every run with a gradient falls from flowFrom to flowTo at no less than that gradient, as drawn. */
export function checkFalls(mep: readonly ComponentRecord[]): string[] {
  const errs: string[] = [];
  for (const r of mep) {
    if (r.gradient === undefined) continue;
    const a = r.flowFrom;
    const b = r.flowTo;
    if (!a || !b) {
      errs.push(`${r.id}: gradient without flow direction`);
      continue;
    }
    const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const fall = a[1] - b[1];
    if (fall < r.gradient * run - 1e-9) errs.push(`${r.id}: falls ${fall.toFixed(4)} over ${run.toFixed(3)} (< 1 in ${(1 / r.gradient).toFixed(0)})`);
    // geometry agrees with the flow line (midpoint and length)
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (mid.some((v, k) => Math.abs(v - r.originalPosition[k]!) > 1e-6)) errs.push(`${r.id}: drawn position does not match its flow line`);
    const L = Math.hypot(run, fall);
    if (r.geometry.kind === "cylinder" && Math.abs(r.geometry.height - L) > 1e-6) errs.push(`${r.id}: drawn length does not match its flow line`);
    const rot = r.originalRotation;
    const tilt = Math.abs(rot[0]) + Math.abs(rot[2]);
    if (Math.abs(Math.tan(tilt) - fall / run) > 1e-6) errs.push(`${r.id}: drawn slope ${Math.tan(tilt).toFixed(4)} != ${(fall / run).toFixed(4)}`);
  }
  return errs;
}
