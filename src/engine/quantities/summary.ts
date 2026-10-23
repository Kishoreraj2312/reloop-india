/**
 * Summary cards and breakdown tables (B1). Everything the drawer shows is computed here, from
 * the inventory, so the UI never sums anything. Breakdown totals are built from the same rows
 * as the cards (an identity test checks they agree).
 */

import { countOf } from "./counts";
import { hasWarning, type Inventory, type InventoryRow, type RowFilter } from "./inventory";
import { formatTonnes, formatValue, UNIT_LABEL } from "./units";
import { CATEGORY_LABELS, type Category, type Status, type Unit } from "./types";

export interface SummaryLine {
  readonly label: string;
  readonly value: number;
  readonly unit: Unit;
}

export interface SummaryCard {
  readonly key: string;
  readonly label: string;
  /** Null = Not available (see `reason`). */
  readonly value: number | null;
  readonly unit: Unit | "t";
  readonly display: string;
  readonly status: Status;
  /** Members without a value: the total is partial when > 0. */
  readonly incompleteCount: number;
  readonly note?: string;
  readonly reason?: string;
  readonly lines?: readonly SummaryLine[];
  /** Table filter applied when the card is clicked. */
  readonly filter: RowFilter | null;
}

/** The volume / area / length measure of a leaf in the given unit (primary or secondary), or undefined. */
export function measureIn(row: InventoryRow, unit: Unit): number | null | undefined {
  const q = row.q;
  if (q.primary.unit === unit) return q.primary.value;
  if (q.mass.unit === unit) return q.mass.value;
  for (const s of q.secondary) if (s.unit === unit) return s.value;
  return undefined;
}

const worst = (a: Status, b: Status): Status => (a === "unavailable" || b === "unavailable" ? "unavailable" : a === "estimated" || b === "estimated" ? "estimated" : "calculated");

/** Total of one unit over rows of one category (and optional component types). Null when no member has a value. */
export function sumMeasure(rows: Iterable<InventoryRow>, unit: Unit, pick?: (r: InventoryRow) => boolean): { value: number | null; status: Status; incompleteCount: number; count: number } {
  let sum = 0;
  let count = 0;
  let incomplete = 0;
  let status: Status = "calculated";
  for (const r of rows) {
    if (pick && !pick(r)) continue;
    const v = measureIn(r, unit);
    if (v === undefined) continue;
    if (v === null) incomplete++;
    else {
      sum += v;
      count++;
      const m = r.q.primary.unit === unit ? r.q.primary : r.q.mass.unit === unit ? r.q.mass : r.q.secondary.find((s) => s.unit === unit)!;
      status = worst(status, m.status);
    }
  }
  return count === 0 ? { value: null, status: "unavailable", incompleteCount: incomplete, count } : { value: sum, status, incompleteCount: incomplete, count };
}

const card = (c: Omit<SummaryCard, "display"> & { display?: string }): SummaryCard => ({
  ...c,
  display: c.display ?? (c.value === null ? "Not available" : c.unit === "t" ? formatTonnes(c.value * 1000) : formatValue(c.value, c.unit)),
});

const byCategory = (inv: Inventory) => {
  const m = new Map<Category, InventoryRow[]>();
  for (const r of inv.rows) {
    let l = m.get(r.q.category);
    if (!l) m.set(r.q.category, (l = []));
    l.push(r);
  }
  return m;
};

const memo = new WeakMap<Inventory, Summary>();

export interface Summary {
  readonly cards: readonly SummaryCard[];
  readonly notModelled: readonly string[];
  readonly issueComponents: readonly string[];
}

function categoryCard(rows: ReadonlyMap<Category, InventoryRow[]>, key: string, label: string, cat: Category, unit: Unit, note?: string, reason?: string): SummaryCard {
  const t = sumMeasure(rows.get(cat) ?? [], unit);
  return card({ key, label, value: t.value, unit, status: t.status, incompleteCount: t.incompleteCount, ...(note ? { note } : {}), ...(t.value === null ? { reason: reason ?? "no component of this category has a valid value" } : {}), filter: { category: cat } });
}

export function buildSummary(inv: Inventory): Summary {
  const hit = memo.get(inv);
  if (hit) return hit;
  const rows = byCategory(inv);
  const lintelTypes = ["wall_lintel", "enclosure_wall_lintel"];
  const lintels = sumMeasure(rows.get("concrete") ?? [], "m3", (r) => lintelTypes.includes(r.rec.componentType));
  const cov = inv.massCoverage;
  const mass = inv.totals.totals.kg;
  const issueIds = [...new Set(inv.issues.filter((i) => i.severity === "warning" && i.componentId).map((i) => i.componentId!))];
  const products = ["doors", "windows", "kitchens", "wc", "basins"].map((k) => ({ label: inv.counts.find((c) => c.key === k)!.label, value: countOf(inv.counts, k), unit: "nr" as const }));

  const cards: SummaryCard[] = [
    categoryCard(rows, "concrete", "Concrete", "concrete", "m3", "plain volume; reinforcement not modelled"),
    categoryCard(rows, "masonry", "Masonry (net)", "masonry", "m3", "as built: openings are not in the pieces"),
    card({ key: "lintels", label: "Lintels", value: lintels.value, unit: "m3", status: lintels.status, incompleteCount: lintels.incompleteCount, note: "RCC, counted within Concrete", filter: { componentTypes: lintelTypes } }),
    categoryCard(rows, "tile_floor", "Floor tiles", "tile_floor", "m2", "tile faces (grout joints are gaps); incl. balcony and roof-enclosure tile"),
    categoryCard(rows, "screed", "Screed", "screed", "m2"),
    categoryCard(rows, "ceiling_board", "Ceilings", "ceiling_board", "m2", "gypsum board incl. coves and fascia"),
    categoryCard(rows, "tile_wall", "Wall tiles", "tile_wall", "m2", "wet-wall tiles and kitchen backsplash"),
    categoryCard(rows, "skirting", "Skirting", "skirting", "m"),
    categoryCard(rows, "glazing", "Glazing", "glazing", "m2", "window and door glass panes"),
    card({ key: "products", label: "Products", value: products.reduce((s, p) => s + p.value, 0), unit: "nr", status: "calculated", incompleteCount: 0, lines: products, note: "counted by assembly, not by part", filter: null, display: String(products.reduce((s, p) => s + p.value, 0)) }),
    card({
      key: "mass",
      label: "Estimated mass",
      value: mass?.value == null ? null : mass.value / 1000,
      unit: "t",
      status: mass?.status ?? "unavailable",
      incompleteCount: mass?.incompleteCount ?? 0,
      note: cov.pct === null ? "no material with a density" : `only materials with a density; covers ${cov.pct.toFixed(1)}% of modelled solid volume`,
      ...(mass?.value == null ? { reason: "no component has a material density" } : {}),
      filter: null,
    }),
    categoryCard(rows, "pipes", "Pipes (route length)", "pipe", "m", "MEP and rainwater pipes drawn as route segments"),
    categoryCard(rows, "cables", "Cables (route length)", "cable", "m", "conductor size not modelled"),
    card({ key: "issues", label: "Components with issues", value: issueIds.length, unit: "nr", status: "calculated", incompleteCount: 0, note: issueIds.length === 0 ? "none" : "see the issue list", filter: { hasIssues: true }, display: String(issueIds.length) }),
  ];
  const out: Summary = { cards, notModelled: ["Reinforcement steel", "Structural steel", "MEP wall thickness / conductor size", "Plaster and paint", "Mortar and adhesive", "Formwork"], issueComponents: issueIds };
  memo.set(inv, out);
  return out;
}

// ── Breakdown tables ─────────────────────────────────────────────────────────

export interface BreakdownTable {
  readonly title: string;
  readonly columns: readonly { readonly key: string; readonly label: string; readonly unit?: Unit }[];
  /** Row label first; one value (or null) per column. */
  readonly rows: readonly { readonly label: string; readonly floor?: number; readonly values: readonly (number | null)[] }[];
  readonly totals: readonly (number | null)[];
}

export const FLOOR_LABEL: Readonly<Record<number, string>> = { [-1]: "FDN", 0: "G", 1: "F01", 2: "F02", 3: "F03", 4: "F04", 5: "RF" };
const FLOORS = [-1, 0, 1, 2, 3, 4, 5];

function matrix(title: string, columns: BreakdownTable["columns"], rowsOf: (floor: number) => readonly (number | null)[], total: readonly (number | null)[]): BreakdownTable {
  return { title, columns, rows: FLOORS.map((f) => ({ label: FLOOR_LABEL[f]!, floor: f, values: rowsOf(f) })), totals: total };
}

const CONCRETE_COLUMNS: readonly { key: string; label: string; types: readonly string[] }[] = [
  { key: "footing", label: "Footing", types: ["footing"] },
  { key: "pedestal", label: "Pedestal", types: ["pedestal"] },
  { key: "column", label: "Column", types: ["column"] },
  { key: "beam", label: "Beam", types: ["beam"] },
  { key: "slab", label: "Slab", types: ["slab"] },
  { key: "stair", label: "Stair", types: ["stair_flight", "stair_landing"] },
];

const dash = (v: number | null) => v;

/** Concrete (m3) by floor × member type; "Other*" is every other concrete component (lintels, balconies, fins, canopies, ...). */
export function concreteTable(inv: Inventory): BreakdownTable {
  const concrete = inv.rows.filter((r) => r.q.category === "concrete");
  const known = new Set(CONCRETE_COLUMNS.flatMap((c) => c.types));
  const cell = (floor: number | null, pick: (r: InventoryRow) => boolean) => sumMeasure(concrete, "m3", (r) => (floor === null || r.rec.floor === floor) && pick(r)).value;
  const cols = [
    ...CONCRETE_COLUMNS.map((c) => ({ key: c.key, label: c.label, unit: "m3" as const, pick: (r: InventoryRow) => c.types.includes(r.rec.componentType) })),
    { key: "other", label: "Other*", unit: "m3" as const, pick: (r: InventoryRow) => !known.has(r.rec.componentType) },
  ];
  const all = (floor: number | null) => cols.map((c) => dash(cell(floor, c.pick)));
  const rowTotal = (floor: number | null) => sumMeasure(concrete, "m3", (r) => floor === null || r.rec.floor === floor).value;
  const t = matrix("Concrete by floor and member type", [...cols.map(({ key, label, unit }) => ({ key, label, unit })), { key: "total", label: "Total", unit: "m3" as const }], (f) => [...all(f), rowTotal(f)], [...all(null), rowTotal(null)]);
  return t;
}

/** Masonry (m3) by floor: net built, lintels and opening voids of wall assemblies, and their gross band. */
export function masonryTable(inv: Inventory): BreakdownTable {
  const masonry = inv.rows.filter((r) => r.q.category === "masonry");
  const wallsOf = (floor: number | null) => inv.walls.filter((w) => floor === null || w.floor === floor);
  const sum = (xs: readonly (number | null)[]) => (xs.length === 0 || xs.some((x) => x === null) ? null : xs.reduce<number>((s, x) => s + (x ?? 0), 0));
  const col = (floor: number | null) => {
    const w = wallsOf(floor);
    return [
      sumMeasure(masonry, "m3", (r) => floor === null || r.rec.floor === floor).value,
      sum(w.map((x) => x.lintel.value)),
      sum(w.map((x) => x.voids.value)),
      sum(w.map((x) => x.gross.value)),
    ];
  };
  return matrix(
    "Masonry by floor",
    [
      { key: "net", label: "Net masonry (all)", unit: "m3" },
      { key: "lintel", label: "Wall lintels (RCC)", unit: "m3" },
      { key: "voids", label: "Opening voids", unit: "m3" },
      { key: "gross", label: "Wall gross (net walls + lintel + voids)", unit: "m3" },
    ],
    col,
    col(null),
  );
}

const FINISH_COLUMNS: readonly { key: string; label: string; cat: Category; unit: Unit }[] = [
  { key: "tile_floor", label: "Floor tile", cat: "tile_floor", unit: "m2" },
  { key: "screed", label: "Screed", cat: "screed", unit: "m2" },
  { key: "ceiling_board", label: "Ceiling", cat: "ceiling_board", unit: "m2" },
  { key: "tile_wall", label: "Wall tile", cat: "tile_wall", unit: "m2" },
  { key: "skirting", label: "Skirting", cat: "skirting", unit: "m" },
];

export function finishesTable(inv: Inventory): BreakdownTable {
  const by = byCategory(inv);
  const col = (floor: number | null) => FINISH_COLUMNS.map((c) => sumMeasure(by.get(c.cat) ?? [], c.unit, (r) => floor === null || r.rec.floor === floor).value);
  return matrix("Finishes by floor", FINISH_COLUMNS.map(({ key, label, unit }) => ({ key, label, unit })), col, col(null));
}

export interface CategoryCountRow {
  readonly category: Category;
  readonly label: string;
  readonly components: number;
  readonly warnings: number;
}

/** Leaf components per category; the total equals the number of table rows. */
export function categoryCounts(inv: Inventory): { rows: readonly CategoryCountRow[]; total: number } {
  const m = new Map<Category, { n: number; w: number }>();
  for (const r of inv.rows) {
    const e = m.get(r.q.category) ?? { n: 0, w: 0 };
    e.n++;
    if (hasWarning(r.q)) e.w++;
    m.set(r.q.category, e);
  }
  const rows = [...m].map(([category, e]) => ({ category, label: CATEGORY_LABELS[category], components: e.n, warnings: e.w })).sort((a, b) => b.components - a.components);
  return { rows, total: inv.rows.length };
}

export const unitLabel = (u: Unit | "t") => (u === "t" ? "t" : UNIT_LABEL[u]);
