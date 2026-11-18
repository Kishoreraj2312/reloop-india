/**
 * Explode model (A4): the static, canonical facts the explosion is derived from. Built once from the same records the
 * viewer renders (registry and meshes cannot diverge); never mutated.
 *
 * Grouping rules (documented in docs/EXPLODED_VIEW.md):
 *   floor    the record's explicit `floor` field (-1 foundation, 0..4, 5 roof), exactly the scene's Floor_* groups.
 *            Slab, beams, columns, walls and fixtures of one storey therefore move as one rigid group.
 *   system   the record's `system` (structure | architecture | plumbing | electrical), exactly the scene's <floor>_<system> groups.
 *   category the record's `assembly` name (the scene's assembly-category groups); used for bounds and visibility only.
 *   assembly an assembly record (group) and its contained members, where a decomposition rule supports it.
 */

import { LEVEL_NAMES } from "@/building/config";
import { recordBounds, type Box3, type ComponentRecord } from "@/building/structure";
import type { BuildingSystem } from "@/building/types";
import { planAssembly, STRUCTURE_REASON, type AssemblyPlan, type UnsupportedAssembly } from "./assemblies";
import { DEFAULT_EXPLODE_CONFIG } from "./config";
import type { Box, ExplodeConfig, FloorKey, Vec3 } from "./types";

/** A0 floor index (-1 foundation, 0..4, 5 roof) -> floor group key (same rule as scene/sceneTree.floorKeyOf). */
export const floorKeyOf = (floor: number): FloorKey => (floor < 0 ? "FDN" : LEVEL_NAMES[floor]!);

/** Position of a floor group relative to the anchor floor: FDN -1 - anchor, L0 0 - anchor, ... ROOF 5 - anchor. */
export const floorIndexOf = (key: FloorKey): number => (key === "FDN" ? -1 : LEVEL_NAMES.indexOf(key));

export interface Cell {
  readonly floor: FloorKey;
  readonly system: BuildingSystem;
  /** The scene's assembly-category group name. */
  readonly category: string;
  readonly count: number;
  readonly bounds: Box3;
}

export interface ExplodeModel {
  readonly cfg: ExplodeConfig;
  readonly records: readonly ComponentRecord[];
  readonly byId: ReadonlyMap<string, ComponentRecord>;
  /** Floor groups that have components, in order FDN, L0 .. ROOF. */
  readonly floors: readonly FloorKey[];
  /** Index of each floor group in `floors`. */
  readonly floorSlot: ReadonlyMap<FloorKey, number>;
  /** floorIndexOf(key) - floorAnchor, per slot. */
  readonly floorRel: readonly number[];
  /** Systems that have components, in config order. */
  readonly systems: readonly BuildingSystem[];
  readonly systemSlot: ReadonlyMap<BuildingSystem, number>;
  readonly floorBounds: ReadonlyMap<FloorKey, Box3>;
  /** Bounds of each system over all floors (what the system explosion spaces). */
  readonly systemBounds: ReadonlyMap<BuildingSystem, Box3>;
  readonly cells: readonly Cell[];
  /** Supported assemblies. */
  readonly assemblies: readonly AssemblyPlan[];
  /** Every other assembly record, each with a reason. */
  readonly unsupported: readonly UnsupportedAssembly[];
  /** Member id -> index into `assemblies`. */
  readonly memberAssembly: ReadonlyMap<string, number>;
  /** Member id -> unit offset (layers: axis x layer index from the middle; radial: unit direction). */
  readonly memberUnit: ReadonlyMap<string, Vec3>;
  /** Assembly id (supported or not) -> member ids. */
  readonly assemblyMembers: ReadonlyMap<string, readonly string[]>;
  /** Index into `assemblies` by assembly id. */
  readonly assemblyIndex: ReadonlyMap<string, number>;
  /** Drawn components that belong to no assembly record, per system, with the reason (structure has none). */
  readonly unassembled: Readonly<Record<string, { count: number; reason: string }>>;
  /** Records the grouping could not place (no valid floor or system). Expected to be empty. */
  readonly ungrouped: readonly string[];
}

const empty = (): Box => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const grow = (a: Box, b: Box3) => {
  for (let i = 0; i < 3; i++) {
    if (b.min[i]! < a.min[i]!) a.min[i] = b.min[i]!;
    if (b.max[i]! > a.max[i]!) a.max[i] = b.max[i]!;
  }
};

export function buildExplodeModel(records: readonly ComponentRecord[], cfg: ExplodeConfig = DEFAULT_EXPLODE_CONFIG): ExplodeModel {
  const byId = new Map<string, ComponentRecord>();
  const kids = new Map<string, ComponentRecord[]>();
  for (const r of records) byId.set(r.id, r);
  for (const r of records) {
    const p = r.parentId !== undefined ? byId.get(r.parentId) : undefined;
    if (p && p.geometry.kind === "group") (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(r); // containment: the parent is an assembly record
  }

  const floorB = new Map<FloorKey, Box>();
  const sysB = new Map<BuildingSystem, Box>();
  const cellB = new Map<string, { floor: FloorKey; system: BuildingSystem; category: string; count: number; box: Box }>();
  const ungrouped: string[] = [];
  for (const r of records) {
    if (r.geometry.kind === "group") continue; // assemblies are not drawn
    if (!Number.isFinite(r.floor) || r.floor > 5) {
      ungrouped.push(r.id);
      continue;
    }
    const fk = floorKeyOf(r.floor);
    const b = recordBounds(r);
    grow(floorB.get(fk) ?? floorB.set(fk, empty()).get(fk)!, b);
    grow(sysB.get(r.system) ?? sysB.set(r.system, empty()).get(r.system)!, b);
    const key = `${fk}|${r.system}|${r.assembly}`;
    let c = cellB.get(key);
    if (!c) cellB.set(key, (c = { floor: fk, system: r.system, category: r.assembly, count: 0, box: empty() }));
    c.count++;
    grow(c.box, b);
  }

  const floors = (["FDN", ...LEVEL_NAMES] as FloorKey[]).filter((k) => floorB.has(k));
  const systems = cfg.systemOrder.filter((s) => sysB.has(s));
  const memberAssembly = new Map<string, number>();
  const memberUnit = new Map<string, Vec3>();
  const assemblyMembers = new Map<string, readonly string[]>();
  const assemblyIndex = new Map<string, number>();
  const assemblies: AssemblyPlan[] = [];
  const unsupported: UnsupportedAssembly[] = [];
  for (const g of records) {
    if (g.geometry.kind !== "group") continue;
    const members = (kids.get(g.id) ?? []).filter((k) => k.geometry.kind !== "group");
    assemblyMembers.set(g.id, members.map((m) => m.id));
    const res = planAssembly(g, members, floorKeyOf(g.floor), byId, cfg);
    if (res.plan && res.units) {
      const idx = assemblies.length;
      assemblies.push(res.plan);
      assemblyIndex.set(g.id, idx);
      res.plan.members.forEach((id, i) => {
        memberAssembly.set(id, idx);
        memberUnit.set(id, res.units![i]!);
      });
    } else if (res.unsupported) unsupported.push(res.unsupported);
  }

  const unassembled: Record<string, { count: number; reason: string }> = {};
  for (const r of records) {
    if (r.geometry.kind === "group") continue;
    const contained = r.parentId !== undefined && byId.get(r.parentId)?.geometry.kind === "group";
    if (contained) continue;
    const u = (unassembled[r.system] ??= { count: 0, reason: r.system === "structure" ? STRUCTURE_REASON : "not contained in an assembly record" });
    u.count++;
  }

  const box3 = (b: Box): Box3 => ({ min: b.min, max: b.max });
  return {
    cfg,
    records,
    byId,
    floors,
    floorSlot: new Map(floors.map((f, i) => [f, i])),
    floorRel: floors.map((f) => floorIndexOf(f) - cfg.floorAnchor),
    systems,
    systemSlot: new Map(systems.map((s, i) => [s, i])),
    floorBounds: new Map([...floorB].map(([k, b]) => [k, box3(b)])),
    systemBounds: new Map([...sysB].map(([k, b]) => [k, box3(b)])),
    cells: [...cellB.values()].map((c) => ({ floor: c.floor, system: c.system, category: c.category, count: c.count, bounds: box3(c.box) })),
    assemblies,
    unsupported,
    memberAssembly,
    memberUnit,
    assemblyMembers,
    assemblyIndex,
    unassembled,
    ungrouped,
  };
}
