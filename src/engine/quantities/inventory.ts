/**
 * Inventory (B1): the one place that turns records into quantities.
 *
 * buildInventory(records, model?) computes every record once, deduplicates ids, aggregates the
 * LEAF records (assemblies are never summed), derives wall takeoffs and product counts, and is
 * memoised per records array (and model). UI code only reads this object.
 */

import type { ArchitectureModel } from "@/building/architecture/generate";
import type { ComponentRecord } from "@/building/structure";
import { aggregateBy, totalOf, type Bucket } from "./aggregate";
import { computeComponent } from "./component";
import { countProducts, type ProductCounts } from "./counts";
import { issue } from "./geometry";
import { wallTakeoffs, type WallTakeoff } from "./walls";
import { CATEGORIES, STATUS_RANK, type Category, type ComponentQuantities, type IssueCode, type QuantityIssue, type Status } from "./types";

export interface InventoryRow {
  readonly rec: ComponentRecord;
  readonly q: ComponentQuantities;
}

export interface Breakdowns {
  /** Keyed by String(record.floor): -1 foundation, 0 ground, 1–4, 5 roof. */
  readonly floor: ReadonlyMap<string, Bucket>;
  readonly system: ReadonlyMap<string, Bucket>;
  readonly category: ReadonlyMap<string, Bucket>;
  readonly material: ReadonlyMap<string, Bucket>;
  readonly componentType: ReadonlyMap<string, Bucket>;
  /** Keyed by the direct parentId (records without a parent are not listed). */
  readonly assembly: ReadonlyMap<string, Bucket>;
}

export interface NotModelled {
  readonly key: string;
  readonly label: string;
  readonly reason: string;
}

/** Things a reader might expect in a takeoff that the model does not contain. Never reported as 0. */
export const NOT_MODELLED: readonly NotModelled[] = [
  { key: "reinforcement", label: "Reinforcement steel", reason: "bars and stirrups are not modelled; concrete is reported as plain volume" },
  { key: "structural_steel", label: "Structural steel", reason: "the structure is reinforced concrete only" },
  { key: "mep_sections", label: "MEP wall thickness / conductor size", reason: "pipes, conduits and cables are drawn as solid cylinders: lengths and counts are reported, mass is not" },
  { key: "plaster_paint", label: "Plaster and paint", reason: "material properties of the wall (see materialId), not geometry" },
  { key: "mortar", label: "Mortar and adhesive", reason: "joints are not modelled" },
  { key: "formwork", label: "Formwork / shuttering", reason: "temporary works are not modelled" },
];

export interface MassCoverage {
  readonly coveredM3: number;
  readonly totalM3: number;
  /** Share (0–100) of the modelled solid volume whose mass is estimated; null when there is no volume. */
  readonly pct: number | null;
}

export interface Inventory {
  readonly records: readonly ComponentRecord[];
  /** Leaf records (no assemblies), deduplicated, in input order. */
  readonly rows: readonly InventoryRow[];
  /** Quantities of every record, leaf or assembly, by id. */
  readonly byId: ReadonlyMap<string, ComponentQuantities>;
  readonly recordById: ReadonlyMap<string, ComponentRecord>;
  readonly childIds: ReadonlyMap<string, readonly string[]>;
  readonly totals: Bucket;
  readonly breakdowns: Breakdowns;
  readonly walls: readonly WallTakeoff[];
  readonly wallById: ReadonlyMap<string, WallTakeoff>;
  readonly counts: ProductCounts;
  /** Warning-level issues plus building-level notes. Per-leaf "info" issues live on the results. */
  readonly issues: readonly QuantityIssue[];
  /** How many results carry each issue code (info + warning). */
  readonly issueCounts: Readonly<Partial<Record<IssueCode, number>>>;
  readonly massCoverage: MassCoverage;
  readonly assemblyCount: number;
}

const EMPTY: readonly string[] = Object.freeze([]);

function build(records: readonly ComponentRecord[], model?: ArchitectureModel): Inventory {
  const byId = new Map<string, ComponentQuantities>();
  const recordById = new Map<string, ComponentRecord>();
  const issues: QuantityIssue[] = [];
  const issueCounts: Partial<Record<IssueCode, number>> = {};
  const rows: InventoryRow[] = [];
  const kids = new Map<string, string[]>();
  let assemblies = 0;

  const note = (i: QuantityIssue) => {
    issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
    if (i.severity === "warning") issues.push(i);
  };

  const kept: ComponentRecord[] = [];
  for (const rec of records) {
    if (recordById.has(rec.id)) {
      note(issue("DUPLICATE_ID", `${rec.id}: duplicate id, the second record is excluded from every total`, rec.id));
      continue;
    }
    recordById.set(rec.id, rec);
    kept.push(rec);
  }
  for (const rec of kept) {
    const q = computeComponent(rec);
    byId.set(rec.id, q);
    if (rec.parentId !== undefined) {
      let l = kids.get(rec.parentId);
      if (!l) kids.set(rec.parentId, (l = []));
      l.push(rec.id);
      if (!recordById.has(rec.parentId)) note(issue("RECORD_MISMATCH", `${rec.id}: parent ${rec.parentId} is not in the record set`, rec.id));
    }
    for (const r of [q.primary, ...q.secondary, q.mass]) for (const i of r.issues) note(i);
    if (rec.geometry.kind === "group") assemblies++;
    else rows.push({ rec, q });
  }

  const wt = wallTakeoffs(kept, model);
  for (const i of wt.issues) note(i);
  for (const w of wt.walls) for (const i of w.issues) note(i);
  for (const n of NOT_MODELLED) note({ code: "NOT_MODELLED", message: `${n.label}: ${n.reason}`, severity: "info" });
  // Building-level notes are listed with the warnings so the UI can show them once.
  for (const n of NOT_MODELLED) issues.push({ code: "NOT_MODELLED", message: `${n.label}: ${n.reason}`, severity: "info" });

  const breakdowns: Breakdowns = {
    floor: aggregateBy(rows, (r) => String(r.rec.floor)),
    system: aggregateBy(rows, (r) => r.rec.system),
    category: aggregateBy(rows, (r) => r.q.category),
    material: aggregateBy(rows, (r) => r.rec.materialId),
    componentType: aggregateBy(rows, (r) => r.rec.componentType),
    assembly: aggregateBy(
      rows.filter((r) => r.rec.parentId !== undefined),
      (r) => r.rec.parentId!,
    ),
  };

  return {
    records,
    rows,
    byId,
    recordById,
    childIds: kids,
    totals: totalOf(rows, "building"),
    breakdowns,
    walls: wt.walls,
    wallById: new Map(wt.walls.map((w) => [w.wallId, w])),
    counts: countProducts(kept),
    issues,
    issueCounts,
    massCoverage: massCoverage(rows),
    assemblyCount: assemblies,
  };
}

/** Share of the modelled solid volume (boxes, prisms, cylinders; catalogue parts excluded) that has a mass. */
export function massCoverage(rows: Iterable<InventoryRow>): MassCoverage {
  let covered = 0;
  let total = 0;
  for (const { q } of rows) {
    if (q.solidVolumeM3 === null) continue;
    total += q.solidVolumeM3;
    if (q.mass.value !== null) covered += q.solidVolumeM3;
  }
  return { coveredM3: covered, totalM3: total, pct: total > 0 ? (covered / total) * 100 : null };
}

// ── Memoisation ──────────────────────────────────────────────────────────────

const cache = new WeakMap<readonly ComponentRecord[], { model: ArchitectureModel | undefined; inventory: Inventory }[]>();

export function buildInventory(records: readonly ComponentRecord[], model?: ArchitectureModel): Inventory {
  let entries = cache.get(records);
  if (!entries) cache.set(records, (entries = []));
  const hit = entries.find((e) => e.model === model);
  if (hit) return hit.inventory;
  const inventory = build(records, model);
  entries.push({ model, inventory });
  return inventory;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export interface RowFilter {
  readonly floor?: number;
  readonly system?: string;
  readonly category?: Category;
  readonly material?: string;
  readonly componentType?: string;
  readonly componentTypes?: readonly string[];
  readonly status?: Status;
  /** Case-insensitive match on id or name. */
  readonly text?: string;
  /** Only leaves carrying at least one warning-level issue. */
  readonly hasIssues?: boolean;
  readonly parentId?: string;
}

export function hasWarning(q: ComponentQuantities): boolean {
  return q.primary.issues.some((i) => i.severity === "warning") || q.mass.issues.some((i) => i.severity === "warning") || q.secondary.some((s) => s.issues.some((i) => i.severity === "warning"));
}

export function filterRows(rows: readonly InventoryRow[], f: RowFilter): InventoryRow[] {
  const text = f.text?.trim().toLowerCase();
  const types = f.componentTypes ? new Set(f.componentTypes) : null;
  return rows.filter(({ rec, q }) => {
    if (f.floor !== undefined && rec.floor !== f.floor) return false;
    if (f.system !== undefined && rec.system !== f.system) return false;
    if (f.category !== undefined && q.category !== f.category) return false;
    if (f.material !== undefined && rec.materialId !== f.material) return false;
    if (f.componentType !== undefined && rec.componentType !== f.componentType) return false;
    if (types && !types.has(rec.componentType)) return false;
    if (f.status !== undefined && q.primary.status !== f.status) return false;
    if (f.parentId !== undefined && rec.parentId !== f.parentId) return false;
    if (f.hasIssues && !hasWarning(q)) return false;
    if (text && !rec.id.toLowerCase().includes(text) && !rec.name.toLowerCase().includes(text)) return false;
    return true;
  });
}

export const SORT_COLUMNS = ["id", "name", "floor", "system", "category", "material", "dimensions", "quantity", "unit", "status", "issues"] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];

/** Compact "L×W×H m" label from the record's dimensions (Ø for diameter). */
export function dimensionsLabel(rec: ComponentRecord): string {
  const d = rec.dimensions;
  const f = (n: number | undefined) => (n === undefined ? undefined : n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2));
  const l = f(d.length);
  const w = f(d.width ?? d.thickness);
  const h = f(d.height ?? (d.width !== undefined ? d.thickness : undefined));
  const parts = [l, w, h].filter((x): x is string => x !== undefined);
  const dia = f(d.diameter);
  if (dia !== undefined) parts.unshift(`Ø${dia}`);
  return parts.length ? `${parts.join("×")} m` : "—";
}

const warningCount = (q: ComponentQuantities) => q.primary.issues.filter((i) => i.severity === "warning").length + q.mass.issues.filter((i) => i.severity === "warning").length;

export function sortRows(rows: readonly InventoryRow[], column: SortColumn, dir: "asc" | "desc" = "asc"): InventoryRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const num = (f: (r: InventoryRow) => number) => (a: InventoryRow, b: InventoryRow) => f(a) - f(b);
  const str = (f: (r: InventoryRow) => string) => (a: InventoryRow, b: InventoryRow) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
  const cmp: Record<SortColumn, (a: InventoryRow, b: InventoryRow) => number> = {
    id: str((r) => r.rec.id),
    name: str((r) => r.rec.name),
    floor: num((r) => r.rec.floor),
    system: str((r) => r.rec.system),
    category: str((r) => r.q.category),
    material: str((r) => r.rec.materialId),
    dimensions: str((r) => dimensionsLabel(r.rec)),
    quantity: num((r) => r.q.primary.value ?? -Infinity),
    unit: str((r) => r.q.primary.unit),
    status: num((r) => STATUS_RANK[r.q.primary.status]),
    issues: num((r) => warningCount(r.q)),
  };
  const f = cmp[column];
  return [...rows].sort((a, b) => sign * f(a, b) || (a.rec.id < b.rec.id ? -1 : a.rec.id > b.rec.id ? 1 : 0));
}

/** Leaf descendants of an assembly (the assembly itself when it is a leaf), depth-first. */
export function leafDescendants(inv: Inventory, id: string): InventoryRow[] {
  const out: InventoryRow[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    const rec = inv.recordById.get(cur);
    if (!rec) continue;
    if (rec.geometry.kind !== "group") {
      const q = inv.byId.get(cur);
      if (q) out.push({ rec, q });
    } else for (const c of inv.childIds.get(cur) ?? EMPTY) stack.push(c);
  }
  return out;
}

export interface AssemblyRollup {
  readonly id: string;
  readonly childCount: number;
  readonly leafCount: number;
  readonly totals: Bucket;
  readonly counts: ProductCounts;
  readonly wall: WallTakeoff | undefined;
}

/** Roll-up of an assembly's leaves (no double counting: leaves only). */
export function assemblyRollup(inv: Inventory, id: string): AssemblyRollup {
  const leaves = leafDescendants(inv, id);
  return {
    id,
    childCount: inv.childIds.get(id)?.length ?? 0,
    leafCount: leaves.length,
    totals: totalOf(leaves, id),
    counts: countProducts([inv.recordById.get(id)!, ...leaves.map((l) => l.rec)]),
    wall: inv.wallById.get(id),
  };
}

export { CATEGORIES };
