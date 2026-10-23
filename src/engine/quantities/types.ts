/**
 * Quantity engine (B1) — shared types.
 *
 * Every quantity is a QuantityResult: a value (or null when it cannot be derived), the unit
 * it is expressed in, how reliable it is (status), the method that produced it and the
 * component ids it came from. "Unknown" is never 0: it is `value: null`, status "unavailable"
 * and at least one structured issue.
 */

export type Status = "calculated" | "estimated" | "unavailable";
export type Kind = "volume" | "area" | "length" | "count" | "mass";
export type Unit = "m3" | "m2" | "m" | "nr" | "kg";

/** calculated < estimated < unavailable (a group takes the worst member). */
export const STATUS_RANK: Readonly<Record<Status, number>> = { calculated: 0, estimated: 1, unavailable: 2 };
export const worseStatus = (a: Status, b: Status): Status => (STATUS_RANK[a] >= STATUS_RANK[b] ? a : b);

export const KIND_UNIT: Readonly<Record<Kind, Unit>> = { volume: "m3", area: "m2", length: "m", count: "nr", mass: "kg" };
export const UNIT_KIND: Readonly<Record<Unit, Kind>> = { m3: "volume", m2: "area", m: "length", nr: "count", kg: "mass" };

export type IssueCode =
  | "MISSING_DIMENSION"
  | "INVALID_VALUE"
  | "NO_DENSITY"
  | "UNSUPPORTED_GEOMETRY"
  | "RECORD_MISMATCH"
  | "DUPLICATE_ID"
  | "UNCLASSIFIED"
  | "NOT_MODELLED"
  | "UNLINKED_OPENING";

export interface QuantityIssue {
  readonly code: IssueCode;
  readonly message: string;
  readonly componentId?: string;
  /**
   * "info": an expected, documented limitation (e.g. a hollow product has no solid-box mass).
   * "warning": something the reader should look at (invalid input, mismatch, unlinked opening).
   */
  readonly severity: "info" | "warning";
}

export interface QuantityResult {
  readonly kind: Kind;
  readonly value: number | null;
  readonly unit: Unit;
  readonly status: Status;
  readonly method: string;
  readonly assumptions: readonly string[];
  readonly issues: readonly QuantityIssue[];
  readonly sourceIds: readonly string[];
}

export const CATEGORIES = [
  "concrete",
  "masonry",
  "stone",
  "tile_floor",
  "tile_wall",
  "screed",
  "plaster",
  "ceiling_board",
  "skirting",
  "glazing",
  "glass_fixture",
  "timber",
  "board",
  "metal",
  "sanitary",
  "kitchen_unit",
  "appliance",
  "fitting",
  "pipe",
  "cable",
  "containment",
  "mep_equipment",
  "mep_stub",
  "roof_finish",
  "assembly",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  concrete: "Concrete",
  masonry: "Masonry",
  stone: "Stone",
  tile_floor: "Floor tile",
  tile_wall: "Wall tile",
  screed: "Screed",
  plaster: "Plaster",
  ceiling_board: "Ceiling board",
  skirting: "Skirting",
  glazing: "Glazing",
  glass_fixture: "Mirror / glass screen",
  timber: "Timber joinery",
  board: "Board joinery",
  metal: "Metalwork",
  sanitary: "Sanitary",
  kitchen_unit: "Kitchen units",
  appliance: "Appliances",
  fitting: "Fittings",
  pipe: "Pipes",
  cable: "Cables",
  containment: "Conduit / tray",
  mep_equipment: "MEP equipment",
  mep_stub: "MEP stubs",
  roof_finish: "Roof finish",
  assembly: "Assembly",
  other: "Other",
};

export interface ComponentQuantities {
  readonly id: string;
  readonly category: Category;
  /** In the record's own unit (m3, m2, m, nr). Assemblies: a count of 1. */
  readonly primary: QuantityResult;
  /** Derived measures with distinct units (volume of a panel, plan area of a slab, ...). */
  readonly secondary: readonly QuantityResult[];
  readonly mass: QuantityResult;
  /** Volume of the modelled solid box/prism/cylinder (null for groups and catalogue parts); mass coverage only. */
  readonly solidVolumeM3: number | null;
}
