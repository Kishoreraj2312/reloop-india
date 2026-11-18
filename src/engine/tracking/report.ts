/**
 * Planned versus actual reporting (C3). Pure and deterministic.
 *
 * Every figure comes from the tracking records' summaries (summary.ts) and counts each COMPONENT ONCE: records are keyed by the component
 * id, an assembly can never hold a record (its parts do), and a batch holds no quantities, so a rollup cannot count material twice.
 * Quantities of different units are never added: every rollup is one line per unit. A figure that was never recorded is not 0: sums run
 * over the records that have a value and the number of records without one is reported next to them. B1 quantities are only read.
 */

import type { Category, Unit } from "@/engine/quantities";
import { substanceOf } from "@/engine/recovery";
import { liveFn, planScope, type TrackingContext } from "./plan";
import { isTerminal, summarize, type Summary } from "./summary";
import { EPS, STATUSES, type Flag, type Records, type Status } from "./types";

export interface Row {
  readonly id: string;
  readonly name: string;
  readonly category: Category;
  readonly substance: string;
  readonly floor: number;
  readonly system: string;
  readonly apartment: string | null;
  readonly room: string | null;
  readonly summary: Summary;
}

/** One row per tracked component, in id order. */
export function buildRows(records: Records, ctx: TrackingContext): Row[] {
  const live = liveFn(ctx);
  const rows: Row[] = [];
  for (const id of Object.keys(records).sort()) {
    const rec = ctx.inv.recordById.get(id);
    const q = ctx.inv.byId.get(id);
    const summary = summarize(records[id]!, live(id));
    rows.push({
      id,
      name: rec?.name ?? id,
      category: q?.category ?? "other",
      substance: rec ? substanceOf(rec.materialId) : "unknown",
      floor: rec?.floor ?? 0,
      system: rec?.system ?? "unknown",
      apartment: rec?.apartmentId ?? null,
      room: rec?.roomId ?? null,
      summary,
    });
  }
  return rows;
}

export const FLOOR_NAMES: Readonly<Record<number, string>> = { [-1]: "Foundation", 0: "Ground", 1: "F01", 2: "F02", 3: "F03", 4: "F04", 5: "Roof" };

export interface Rollup {
  readonly key: string;
  readonly unit: Unit;
  readonly records: number;
  /** Σ effective available quantity of the components that are in the model. */
  readonly available: number;
  /** Σ planned over the records that have a planned quantity. */
  readonly planned: number;
  readonly plannedRecords: number;
  /** Σ recovered over the records that recorded recovery (an explicit 0 counts as recorded). */
  readonly recovered: number;
  readonly recoveredRecords: number;
  /** Records with no recovered quantity recorded: unknown, not zero. */
  readonly notRecorded: number;
  /** Σ recovered ÷ Σ planned over the records where both are known and the plan is above 0. */
  readonly completion: number | null;
  readonly pairedRecords: number;
  readonly reused: number;
  readonly recycled: number;
  readonly disposed: number;
  readonly unrecovered: number;
  readonly inHand: number;
  readonly notYetRecovered: number;
  /** Σ what no outcome or write-off explains (the whole effective quantity of a record whose recovery is not recorded). */
  readonly unaccounted: number;
  readonly byStatus: Readonly<Record<Status, number>>;
  /** Records with a warning or an error flag. */
  readonly flagged: number;
}

const emptyByStatus = (): Record<Status, number> => Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
const UNIT_ORDER: readonly Unit[] = ["m2", "m3", "m", "nr", "kg"];
const round9 = (n: number): number => Math.round(n * 1e9) / 1e9;

interface Acc {
  key: string;
  unit: Unit;
  records: number;
  available: number;
  planned: number;
  plannedRecords: number;
  recovered: number;
  recoveredRecords: number;
  notRecorded: number;
  paired: number;
  pairedPlanned: number;
  pairedRecovered: number;
  reused: number;
  recycled: number;
  disposed: number;
  unrecovered: number;
  inHand: number;
  notYet: number;
  unaccounted: number;
  byStatus: Record<Status, number>;
  flagged: number;
}

/** Group rows by `keyOf` and unit; never adds different units. */
export function rollup(rows: readonly Row[], keyOf: (r: Row) => string): Rollup[] {
  const m = new Map<string, Acc>();
  for (const r of rows) {
    const s = r.summary;
    const key = keyOf(r);
    const k = `${key}\u0000${s.unit}`;
    let a = m.get(k);
    if (!a) m.set(k, (a = { key, unit: s.unit, records: 0, available: 0, planned: 0, plannedRecords: 0, recovered: 0, recoveredRecords: 0, notRecorded: 0, paired: 0, pairedPlanned: 0, pairedRecovered: 0, reused: 0, recycled: 0, disposed: 0, unrecovered: 0, inHand: 0, notYet: 0, unaccounted: 0, byStatus: emptyByStatus(), flagged: 0 }));
    a.records++;
    a.byStatus[s.status]++;
    if (s.effective !== null) a.available += s.effective;
    if (s.planned !== null) (a.planned += s.planned), a.plannedRecords++;
    if (s.recovered !== null) (a.recovered += s.recovered), a.recoveredRecords++;
    else a.notRecorded++;
    if (s.planned !== null && s.planned > EPS && s.recovered !== null) (a.paired++, (a.pairedPlanned += s.planned), (a.pairedRecovered += s.recovered));
    a.reused += s.reused ?? 0;
    a.recycled += s.recycled ?? 0;
    a.disposed += s.disposed ?? 0;
    a.unrecovered += s.unrecovered ?? 0;
    a.inHand += s.inHand ?? 0;
    a.notYet += s.notYetRecovered ?? 0;
    a.unaccounted += s.unaccounted ?? 0;
    if (s.flags.some((f) => f.level !== "info")) a.flagged++;
  }
  return [...m.values()]
    .sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : UNIT_ORDER.indexOf(x.unit) - UNIT_ORDER.indexOf(y.unit)))
    .map((a) => ({
      key: a.key,
      unit: a.unit,
      records: a.records,
      available: round9(a.available),
      planned: round9(a.planned),
      plannedRecords: a.plannedRecords,
      recovered: round9(a.recovered),
      recoveredRecords: a.recoveredRecords,
      notRecorded: a.notRecorded,
      completion: a.pairedPlanned > EPS ? a.pairedRecovered / a.pairedPlanned : null,
      pairedRecords: a.paired,
      reused: round9(a.reused),
      recycled: round9(a.recycled),
      disposed: round9(a.disposed),
      unrecovered: round9(a.unrecovered),
      inHand: round9(a.inHand),
      notYetRecovered: round9(a.notYet),
      unaccounted: round9(a.unaccounted),
      byStatus: a.byStatus,
      flagged: a.flagged,
    }));
}

/** Whole-population totals: one line per unit. */
export const totals = (rows: readonly Row[]): Rollup[] => rollup(rows, () => "all");
export const byCategory = (rows: readonly Row[]): Rollup[] => rollup(rows, (r) => r.substance);
export const byFloor = (rows: readonly Row[]): Rollup[] => rollup(rows, (r) => String(r.floor));
export const byStatus = (rows: readonly Row[]): Rollup[] => rollup(rows, (r) => r.summary.status);

export function statusCounts(rows: readonly Row[]): Record<Status, number> {
  const c = emptyByStatus();
  for (const r of rows) c[r.summary.status]++;
  return c;
}

// ── coverage of the planned scope ────────────────────────────────────────────

export interface Coverage {
  /** Components something plans to recover (B2 / B3 / C2). */
  readonly scope: number;
  readonly trackedInScope: number;
  /** Tracked components nothing planned: unplanned recoveries. */
  readonly trackedOutside: number;
  readonly untracked: number;
  /** Planned quantity of the planned components not yet tracked, per unit (only where B2 gives a planned quantity). */
  readonly untrackedPlanned: readonly { unit: Unit; planned: number; components: number; noPlan: number }[];
}

export function coverage(records: Records, ctx: TrackingContext): Coverage {
  const scope = planScope(ctx);
  let inScope = 0;
  const by = new Map<Unit, { planned: number; components: number; noPlan: number }>();
  for (const [id, ev] of scope) {
    if (records[id]) {
      inScope++;
      continue;
    }
    const unit = ctx.inv.byId.get(id)!.primary.unit;
    const e = by.get(unit) ?? { planned: 0, components: 0, noPlan: 0 };
    e.components++;
    if (ev.planned === null) e.noPlan++;
    else e.planned += ev.planned;
    by.set(unit, e);
  }
  const tracked = Object.keys(records).length;
  return {
    scope: scope.size,
    trackedInScope: inScope,
    trackedOutside: tracked - inScope,
    untracked: scope.size - inScope,
    untrackedPlanned: UNIT_ORDER.filter((u) => by.has(u)).map((unit) => ({ unit, planned: round9(by.get(unit)!.planned), components: by.get(unit)!.components, noPlan: by.get(unit)!.noPlan })),
  };
}

// ── differences, unresolved and incomplete records ───────────────────────────

export interface Discrepancy {
  readonly row: Row;
  readonly flags: readonly Flag[];
}

const LEVEL_RANK = { error: 0, warning: 1, info: 2 } as const;

/** Records with at least one flag of the given minimum level, errors first. */
export function discrepancies(rows: readonly Row[], min: "error" | "warning" | "info" = "warning"): Discrepancy[] {
  const limit = LEVEL_RANK[min];
  return rows
    .map((row) => ({ row, flags: row.summary.flags.filter((f) => LEVEL_RANK[f.level] <= limit) }))
    .filter((d) => d.flags.length > 0)
    .sort((a, b) => Math.min(...a.flags.map((f) => LEVEL_RANK[f.level])) - Math.min(...b.flags.map((f) => LEVEL_RANK[f.level])) || (a.row.id < b.row.id ? -1 : 1));
}

export interface Unresolved {
  readonly row: Row;
  /** Why the record is not closed: what is still missing. */
  readonly reason: string;
}

/** A record is CLOSED when it has a final outcome and nothing is left unaccounted; every other record is unresolved. */
export const isClosed = (s: Summary): boolean => isTerminal(s.status) && (s.unaccounted ?? 0) <= EPS;

export function unresolved(rows: readonly Row[]): Unresolved[] {
  const out: Unresolved[] = [];
  for (const row of rows) {
    const s = row.summary;
    if (isClosed(s)) continue;
    const reason =
      s.status === "planned"
        ? "Planned, deconstruction not started"
        : s.status === "hold"
          ? "On hold: outcome unknown"
          : s.recovered === null
            ? "No recovered quantity recorded"
            : (s.inHand ?? 0) > EPS
              ? "Recovered material has no outcome yet"
              : (s.notYetRecovered ?? 0) > EPS
                ? "Material neither recovered nor written off"
                : s.status === "in_progress"
                  ? "Deconstruction in progress"
                  : "Outcome not recorded";
    out.push({ row, reason });
  }
  return out;
}

/** Invariants of a report: every component once, every rollup equal to the sum of its rows. Empty = consistent. */
export function reconcileRows(rows: readonly Row[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`${r.id} is counted twice`);
    seen.add(r.id);
  }
  const all = totals(rows);
  for (const unit of new Set(rows.map((r) => r.summary.unit))) {
    const mine = rows.filter((r) => r.summary.unit === unit);
    const t = all.find((x) => x.unit === unit);
    const sumOf = (f: (s: Summary) => number | null) => mine.reduce((a, r) => a + (f(r.summary) ?? 0), 0);
    if (!t) problems.push(`no total for ${unit}`);
    else {
      if (Math.abs(t.recovered - sumOf((s) => s.recovered)) > 1e-6) problems.push(`${unit}: recovered total differs from its rows`);
      if (Math.abs(t.unaccounted - sumOf((s) => s.unaccounted)) > 1e-6) problems.push(`${unit}: unaccounted total differs from its rows`);
      if (t.records !== mine.length) problems.push(`${unit}: record count differs`);
    }
    for (const dim of [byCategory, byFloor, byStatus]) {
      const parts = dim(mine).filter((x) => x.unit === unit);
      if (parts.reduce((a, x) => a + x.records, 0) !== mine.length) problems.push(`${unit}: a breakdown does not cover every record once`);
      if (Math.abs(parts.reduce((a, x) => a + x.recovered, 0) - (t?.recovered ?? 0)) > 1e-6) problems.push(`${unit}: a breakdown's recovered quantity does not add up to the total`);
    }
  }
  return problems;
}
