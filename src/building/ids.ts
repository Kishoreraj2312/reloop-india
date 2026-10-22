/**
 * ReLoop India — Component ID Builder & Parser
 *
 * Convention: SYSTEM-TYPE-FLOOR-LOCATION
 *   SYSTEM:   STR | ARC | PLB | ELC
 *   TYPE:     FTG, PED, COL, BM, SLAB, STAIR, LAND, WALL, DOOR, WIN, PIPE, etc.
 *   FLOOR:    G (ground / foundation), F01-F04, RF (roof)
 *   LOCATION: Grid intersection or sequential index, e.g. A1, A1-B1, P03
 *
 * Examples:
 *   STR-FTG-G-A1          Foundation at grid A-1
 *   STR-COL-F01-A1        Column on floor 1 at A-1
 *   STR-BM-F01-X-A1-B1    X-beam on floor 1 from A1 to B1
 *   STR-SLAB-F02-P03      Slab panel 3 on floor 2
 *   STR-STAIR-F01-FL1     Stair flight 1, floor 1
 */

import type { BuildingSystem } from "./types";

const SYSTEM_PREFIXES: Record<BuildingSystem, string> = {
  structure: "STR",
  architecture: "ARC",
  plumbing: "PLB",
  electrical: "ELC",
};

const PREFIX_TO_SYSTEM: Record<string, BuildingSystem> = Object.fromEntries(
  Object.entries(SYSTEM_PREFIXES).map(([k, v]) => [v, k as BuildingSystem]),
) as Record<string, BuildingSystem>;

function floorToTag(floor: number): string {
  if (floor < 0) return "G"; // foundation level
  if (floor === 0) return "G";
  if (floor >= 5) return "RF";
  return `F${String(floor).padStart(2, "0")}`;
}

function tagToFloor(tag: string): number {
  if (tag === "G") return 0;
  if (tag === "RF") return 5;
  return parseInt(tag.slice(1), 10);
}

export interface ComponentIdParts {
  system: BuildingSystem;
  type: string;
  floor: number;
  location: string;
}

const ID_REGEX = /^(STR|ARC|PLB|ELC)-([A-Z0-9]+)-(G|RF|F\d{2})-(.+)$/;

export function buildComponentId(parts: ComponentIdParts): string {
  const prefix = SYSTEM_PREFIXES[parts.system];
  const floor = floorToTag(parts.floor);
  return `${prefix}-${parts.type}-${floor}-${parts.location}`;
}

export function parseComponentId(id: string): ComponentIdParts | null {
  const m = id.match(ID_REGEX);
  if (!m) return null;
  const system = PREFIX_TO_SYSTEM[m[1]!];
  if (!system) return null;
  return {
    system,
    type: m[2]!,
    floor: tagToFloor(m[3]!),
    location: m[4]!,
  };
}

export function isValidComponentId(id: string): boolean {
  return ID_REGEX.test(id);
}
