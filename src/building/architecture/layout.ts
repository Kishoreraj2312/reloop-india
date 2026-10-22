/**
 * ReLoop India — layout contract (A2). Design before geometry: rooms, doors, windows,
 * open boundaries and balconies, from which walls and every finish are generated.
 * Plan drawings: docs/ARCHITECTURE_LAYOUT.md.
 *
 * Local apartment frame: u runs along the facade (parallel to world X), v runs inward from
 * the facade gridline (world +Z for the south block, -Z for the north block). Room
 * rectangles are BOUNDARY rectangles: interior boundaries are wall centrelines, exterior
 * boundaries are the facade gridlines (the exterior wall itself sits flush with the
 * column outer faces, see walls.ts). Rooms of one apartment tile its area exactly.
 *
 * Grid recap (A1): X lines -18..18, Z lines -15..15, 6 m bays. Stair bay x[0,6] z[-3,3],
 * shaft bay x[6,12] z[-3,3]. The A1 stair arrives at the SOUTH edge of its well (z = -2.7),
 * so the common corridor runs E-W just south of gridline 3 (z in [-4.8, -3]).
 */

import type { DoorTypeKey, WindowTypeKey } from "./config";

export type RoomType =
  | "living"
  | "dining"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "toilet"
  | "utility"
  | "foyer"
  | "passage"
  | "store"
  | "study"
  | "corridor"
  | "stair"
  | "services"
  | "shaft"
  | "lobby"
  | "security"
  | "meter"
  | "office";

/** [u0, u1, v0, v1] in the apartment's local frame (metres). */
export type LocalRect = readonly [number, number, number, number];

export interface RoomDef {
  readonly code: string;
  readonly type: RoomType;
  readonly name: string;
  readonly rects: readonly LocalRect[];
}

/**
 * A door on the shared boundary of two rooms. Room references are local codes, a common
 * room id such as "CM-COR", or "EXT" (the building exterior, facade side).
 * `at` is the door centre along the boundary in local coordinates; `hinge` is the jamb
 * (local low or high end) the leaf is hung from; the leaf swings into `swingInto`.
 */
export interface DoorDef {
  readonly type: DoorTypeKey;
  readonly rooms: readonly [string, string];
  readonly at: number;
  readonly hinge: "low" | "high";
  readonly swingInto: string;
}

export type LocalSide = "facade" | "u0" | "uMax";

/** A window on one of a room's sides; ignored when that side is not exterior for an instance. */
export interface WindowDef {
  readonly type: WindowTypeKey;
  readonly room: string;
  readonly side: LocalSide;
  readonly at: number;
  /** Ground-floor substitute (e.g. balcony slider becomes a window at G). */
  readonly ground?: WindowTypeKey;
}

export interface BalconyDef {
  readonly room: string;
  /** Bay along the facade [u0, u1] in local coordinates (gridline to gridline). */
  readonly bay: readonly [number, number];
}

export interface ApartmentType {
  readonly key: string;
  readonly label: string;
  /** Main block width (along u) and depth (along v). */
  readonly width: number;
  readonly depth: number;
  /** Gross apartment area as grid-derived rectangles; the rooms must tile it exactly. */
  readonly envelope: readonly LocalRect[];
  readonly rooms: readonly RoomDef[];
  readonly doors: readonly DoorDef[];
  readonly windows: readonly WindowDef[];
  readonly open: readonly (readonly [string, string])[];
  readonly balcony?: BalconyDef;
  /** Room containing the apartment entrance door (from the common corridor). */
  readonly entrance: string;
}

export type Block = "south" | "north";

export interface ApartmentInstance {
  readonly id: string; // "A1".."A6", or "CM" for a common block
  readonly type: string; // ApartmentType key
  readonly block: Block;
  /** X gridline index of local u = 0. */
  readonly gridX: number;
  /** Mirrored instances run u toward -X. */
  readonly mirror: boolean;
}

export type FloorKind = "ground" | "typical" | "top";

// ── Apartment types ──────────────────────────────────────────────────────────

/** Front zone shared by S and N types (v 0..6, facade side): living, two bedrooms, en-suite. */
const FRONT_ROOMS: readonly RoomDef[] = [
  { code: "LIV", type: "living", name: "Living", rects: [[0, 4.8, 0, 6.0]] },
  { code: "BED2", type: "bedroom", name: "Bedroom 2", rects: [[4.8, 8.4, 0, 4.2]] },
  // Master bedroom: main room plus a small door lobby beside the en-suite.
  { code: "BED1", type: "bedroom", name: "Master bedroom", rects: [[8.4, 12, 0, 3.75], [8.4, 9.9, 3.75, 4.2]] },
  { code: "PAS", type: "passage", name: "Passage", rects: [[4.8, 9.9, 4.2, 6.0]] },
  // En-suite 2.1 x 2.25: room for shower, WC and basin with 0.6 m clear zones.
  { code: "BATH1", type: "bathroom", name: "En-suite bath", rects: [[9.9, 12, 3.75, 6.0]] },
];

const FRONT_DOORS: readonly DoorDef[] = [
  { type: "D", rooms: ["BED2", "PAS"], at: 7.6, hinge: "high", swingInto: "BED2" },
  { type: "D", rooms: ["BED1", "PAS"], at: 9.15, hinge: "low", swingInto: "BED1" },
  { type: "BD", rooms: ["BED1", "BATH1"], at: 10.65, hinge: "low", swingInto: "BATH1" },
  { type: "BD", rooms: ["PAS", "BATH2"], at: 7.6, hinge: "high", swingInto: "BATH2" },
  { type: "D", rooms: ["PAS", "KIT"], at: 9.15, hinge: "high", swingInto: "KIT" },
];

const FRONT_WINDOWS: readonly WindowDef[] = [
  { type: "SL", room: "LIV", side: "facade", at: 2.4, ground: "W3" },
  { type: "W1", room: "BED2", side: "facade", at: 7.2 },
  { type: "W1", room: "BED1", side: "facade", at: 10.2 },
  { type: "W1", room: "LIV", side: "u0", at: 3.0 },
];

/** South type: 2BHK, 12 x 10.2 m; entrance from the corridor at v = 10.2. */
const TYPE_S: ApartmentType = {
  key: "S",
  label: "2BHK south (12.0 x 10.2 m)",
  width: 12,
  depth: 10.2,
  envelope: [[0, 12, 0, 10.2]],
  rooms: [
    ...FRONT_ROOMS,
    { code: "DIN", type: "dining", name: "Dining", rects: [[0, 4.2, 6.0, 10.2]] },
    { code: "FOY", type: "foyer", name: "Foyer", rects: [[4.2, 6.0, 6.0, 10.2]] },
    { code: "BATH2", type: "bathroom", name: "Common bath", rects: [[6.0, 8.4, 6.0, 8.4]] },
    { code: "UTL", type: "utility", name: "Utility / wash", rects: [[6.0, 8.4, 8.4, 10.2]] },
    { code: "KIT", type: "kitchen", name: "Kitchen", rects: [[8.4, 12, 6.0, 10.2]] },
  ],
  doors: [
    ...FRONT_DOORS,
    { type: "D", rooms: ["KIT", "UTL"], at: 9.0, hinge: "low", swingInto: "UTL" },
    { type: "MD", rooms: ["FOY", "CM-COR"], at: 5.1, hinge: "low", swingInto: "FOY" },
  ],
  windows: [...FRONT_WINDOWS, { type: "W2", room: "DIN", side: "u0", at: 8.1 }],
  open: [
    ["LIV", "DIN"],
    ["LIV", "PAS"],
    ["LIV", "FOY"],
    ["PAS", "FOY"],
    ["DIN", "FOY"],
  ],
  balcony: { room: "LIV", bay: [0, 6] },
  entrance: "FOY",
};

/** North type: 3-room main block 12 x 12 m plus a 6 x 6 m annex in the central band (v 12..18). */
const TYPE_N: ApartmentType = {
  key: "N",
  label: "2BHK + study north (12 x 12 m + 6 x 6 m annex)",
  width: 12,
  depth: 12,
  envelope: [
    [0, 12, 0, 12],
    [0, 6, 12, 18],
  ],
  rooms: [
    ...FRONT_ROOMS,
    { code: "DIN", type: "dining", name: "Dining", rects: [[0, 6.0, 6.0, 12]] },
    { code: "BATH2", type: "bathroom", name: "Common bath", rects: [[6.0, 8.4, 6.0, 8.4]] },
    { code: "STO", type: "store", name: "Store", rects: [[6.0, 8.4, 8.4, 12]] },
    { code: "KIT", type: "kitchen", name: "Kitchen", rects: [[8.4, 12, 6.0, 9.6]] },
    { code: "UTL", type: "utility", name: "Utility / wash", rects: [[8.4, 12, 9.6, 12]] },
    { code: "STD", type: "study", name: "Family / study", rects: [[0, 6.0, 12, 15]] },
    { code: "BATH3", type: "toilet", name: "Powder room", rects: [[0, 2.4, 15, 18]] },
    { code: "FOY", type: "foyer", name: "Foyer", rects: [[2.4, 6.0, 15, 18]] },
  ],
  doors: [
    ...FRONT_DOORS,
    { type: "D", rooms: ["KIT", "UTL"], at: 10.5, hinge: "high", swingInto: "UTL" },
    { type: "BD", rooms: ["DIN", "STO"], at: 10.2, hinge: "low", swingInto: "STO" },
    { type: "BD", rooms: ["FOY", "BATH3"], at: 16.5, hinge: "high", swingInto: "BATH3" },
    { type: "MD", rooms: ["FOY", "CM-COR"], at: 4.2, hinge: "high", swingInto: "FOY" },
  ],
  windows: [
    ...FRONT_WINDOWS,
    { type: "W2", room: "DIN", side: "u0", at: 9.0 },
    { type: "W2", room: "STD", side: "u0", at: 13.5 },
    { type: "V1", room: "BATH3", side: "u0", at: 16.5 },
    { type: "W2", room: "BED1", side: "uMax", at: 2.1 },
    { type: "V1", room: "BATH1", side: "uMax", at: 5.1 },
    { type: "W2", room: "KIT", side: "uMax", at: 7.8 },
    { type: "W2", room: "UTL", side: "uMax", at: 10.8 },
  ],
  open: [
    ["LIV", "DIN"],
    ["LIV", "PAS"],
    ["PAS", "DIN"],
    ["DIN", "STD"],
    ["STD", "FOY"],
  ],
  balcony: { room: "LIV", bay: [0, 6] },
  entrance: "FOY",
};

/** North corner type with an extra bedroom suite in the band (u 6..12, v 12..18): 3BHK. */
const TYPE_NX: ApartmentType = {
  ...TYPE_N,
  key: "NX",
  label: "3BHK north corner (12 x 12 m + 12 x 6 m annex)",
  envelope: [
    [0, 12, 0, 12],
    [0, 12, 12, 18],
  ],
  rooms: [
    ...TYPE_N.rooms,
    { code: "BED3", type: "bedroom", name: "Bedroom 3", rects: [[6.0, 12, 12, 16.2]] },
    { code: "WIC", type: "store", name: "Walk-in wardrobe", rects: [[6.0, 9.0, 16.2, 18]] },
    { code: "BATH4", type: "bathroom", name: "Bedroom 3 bath", rects: [[9.0, 12, 16.2, 18]] },
  ],
  doors: [
    ...TYPE_N.doors,
    { type: "D", rooms: ["STD", "BED3"], at: 13.5, hinge: "high", swingInto: "BED3" },
    { type: "BD", rooms: ["BED3", "WIC"], at: 7.5, hinge: "low", swingInto: "WIC" },
    { type: "BD", rooms: ["BED3", "BATH4"], at: 10.5, hinge: "high", swingInto: "BATH4" },
  ],
  windows: [
    ...TYPE_N.windows,
    { type: "W1", room: "BED3", side: "uMax", at: 14.1 },
    { type: "V1", room: "BATH4", side: "uMax", at: 17.1 },
  ],
};

/** Ground-floor common block replacing A2: entrance lobby, security, staff toilet, meters, society office. */
const TYPE_GC: ApartmentType = {
  key: "GC",
  label: "Ground-floor common block (entrance lobby)",
  width: 12,
  depth: 10.2,
  envelope: [[0, 12, 0, 10.2]],
  rooms: [
    { code: "SOC", type: "office", name: "Society office", rects: [[0, 3.0, 0, 10.2]] },
    { code: "SEC", type: "security", name: "Security room", rects: [[3.0, 6.0, 0, 4.2]] },
    { code: "TLT", type: "toilet", name: "Staff toilet", rects: [[3.0, 6.0, 4.2, 6.0]] },
    { code: "MTR", type: "meter", name: "Meter room", rects: [[3.0, 6.0, 6.0, 10.2]] },
    { code: "LOB", type: "lobby", name: "Entrance lobby", rects: [[6.0, 12, 0, 10.2]] },
  ],
  doors: [
    { type: "ED", rooms: ["LOB", "EXT"], at: 9.0, hinge: "low", swingInto: "LOB" },
    { type: "D", rooms: ["LOB", "SEC"], at: 3.0, hinge: "low", swingInto: "SEC" },
    { type: "BD", rooms: ["LOB", "TLT"], at: 5.1, hinge: "low", swingInto: "TLT" },
    { type: "D", rooms: ["LOB", "MTR"], at: 8.1, hinge: "high", swingInto: "MTR" },
    { type: "D", rooms: ["SOC", "CM-COR"], at: 1.5, hinge: "low", swingInto: "SOC" },
  ],
  windows: [
    { type: "W1", room: "SOC", side: "facade", at: 1.5 },
    { type: "W2", room: "SEC", side: "facade", at: 4.5 },
    { type: "W4", room: "LOB", side: "facade", at: 7.05 },
    { type: "W4", room: "LOB", side: "facade", at: 10.95 },
  ],
  open: [["LOB", "CM-COR"]],
  entrance: "LOB",
};

export const APARTMENT_TYPES: Readonly<Record<string, ApartmentType>> = {
  S: TYPE_S,
  N: TYPE_N,
  NX: TYPE_NX,
  GC: TYPE_GC,
};

// ── Instances per floor ──────────────────────────────────────────────────────

const SOUTH_SIDE_TYPICAL: readonly ApartmentInstance[] = [
  { id: "A1", type: "S", block: "south", gridX: 0, mirror: false },
  { id: "A2", type: "S", block: "south", gridX: 4, mirror: true },
  { id: "A3", type: "S", block: "south", gridX: 6, mirror: true },
];

const NORTH_SIDE: readonly ApartmentInstance[] = [
  { id: "A4", type: "NX", block: "north", gridX: 2, mirror: true },
  { id: "A5", type: "N", block: "north", gridX: 2, mirror: false },
  { id: "A6", type: "N", block: "north", gridX: 6, mirror: true },
];

export const FLOOR_PLANS: Readonly<Record<FloorKind, readonly ApartmentInstance[]>> = {
  ground: [
    SOUTH_SIDE_TYPICAL[0]!,
    { id: "CM", type: "GC", block: "south", gridX: 2, mirror: false },
    SOUTH_SIDE_TYPICAL[2]!,
    ...NORTH_SIDE,
  ],
  typical: [...SOUTH_SIDE_TYPICAL, ...NORTH_SIDE],
  top: [...SOUTH_SIDE_TYPICAL, ...NORTH_SIDE],
};

export function floorKindOf(storey: number, storeyCount: number): FloorKind {
  if (storey === 0) return "ground";
  return storey === storeyCount - 1 ? "top" : "typical";
}

// ── Common circulation and core (world, from the grid) ──────────────────────

export const COMMON = {
  /** Corridor: full building length, `width` south of the gridline with index `gridZ`. */
  corridor: { gridZ: 2, width: 1.8 },
  /** Gable-end corridor windows (both ends), centred in the corridor. */
  corridorWindow: "W4" as WindowTypeKey,
  /** Door from the corridor into the services room, centre offset from the shaft bay's low-X gridline. */
  servicesDoor: { type: "D" as DoorTypeKey, offset: 1.5, hinge: "low" as const },
  /** Shaft inspection door on the south face of the shaft enclosure. */
  shaftDoor: { type: "SD" as DoorTypeKey, hinge: "low" as const },
} as const;
