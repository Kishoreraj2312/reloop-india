/**
 * The allocation ledger (C2). Pure and immutable.
 *
 * An allocation plans a quantity of ONE component for ONE requirement. The ledger enforces, on every write:
 *   - a component's allocations over ALL requirements never exceed what it can supply (no double counting),
 *   - a requirement is never allocated more than it asks for,
 *   - the allocation unit is the requirement's unit AND the component's own B1 unit (units are never converted or combined),
 *   - an incompatible component cannot be allocated, and a whole item (nr) is allocated whole.
 * One allocation exists per (requirement, component); allocating again revises it. B1 quantities, B2 assessments and C1 passports
 * are never written: the ledger lives beside them and is reconciled against them (`reviewAllocations`).
 */

import { UNIT_LABEL, type Unit } from "@/engine/quantities";
import { evaluate, type MatchContext } from "./match";
import { EPS, fmtQtyU } from "./source";
import type { Allocation, AllocationBasis, Candidate, DemandStatus, Requirement, Review, ReviewFlag } from "./types";

const round9 = (n: number): number => Math.round(n * 1e9) / 1e9;

export function allocatedByComponent(allocs: readonly Allocation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of allocs) m.set(a.componentId, (m.get(a.componentId) ?? 0) + a.quantity);
  return m;
}
export function allocatedByRequirement(allocs: readonly Allocation[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of allocs) m.set(a.requirementId, (m.get(a.requirementId) ?? 0) + a.quantity);
  return m;
}

/** What is left of a component's supply once every allocation (except `excludeId`) is taken: never below 0. */
export const freeOf = (supply: number | null, componentId: string, byComponent: ReadonlyMap<string, number>, ownAllocated = 0): number => (supply === null ? 0 : Math.max(0, supply - ((byComponent.get(componentId) ?? 0) - ownAllocated)));

export interface AllocateInput {
  readonly requirementId: string;
  readonly componentId: string;
  readonly quantity: number;
  readonly note?: string;
}
export interface AllocateResult {
  readonly allocations: readonly Allocation[];
  readonly allocation: Allocation | null;
  readonly error: string | null;
}

const basisOf = (c: Candidate, classification: AllocationBasis["classification"]): AllocationBasis => ({
  tier: c.tier === "strong" ? "strong" : "conditional",
  score: c.score,
  supply: c.supply.value,
  supplyBasis: c.supply.basis,
  classification,
  conditions: c.conditions.map((n) => n.text),
  missing: c.missing.map((n) => n.text),
});

/** Confirm (or revise) an allocation. An invalid request returns the SAME list and the reason. */
export function allocate(ctx: MatchContext, reqs: readonly Requirement[], allocs: readonly Allocation[], input: AllocateInput, now: string, newId: () => string): AllocateResult {
  const fail = (error: string): AllocateResult => ({ allocations: allocs, allocation: null, error });
  const req = reqs.find((r) => r.id === input.requirementId);
  if (!req) return fail("That requirement does not exist");
  const rec = ctx.inv.recordById.get(input.componentId);
  const q = ctx.inv.byId.get(input.componentId);
  if (!rec || !q || rec.geometry.kind === "group") return fail("That is not a component of the model (assemblies are allocated through their parts)");
  const qty = input.quantity;
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) return fail("Quantity must be a number above 0");
  if (req.unit === "nr" && !Number.isInteger(qty)) return fail("A count is allocated in whole items");

  const cand = evaluate(ctx, req, { rec, q });
  if (cand.tier === "incompatible") return fail(`Incompatible: ${cand.blockers[0]!.text}`);
  const supply = cand.supply;
  if (supply.unit !== req.unit) return fail(`Unit mismatch: ${UNIT_LABEL[supply.unit]} component, ${UNIT_LABEL[req.unit]} requirement`);
  if (supply.value === null) return fail(`No quantity to allocate: ${supply.note}`);

  const existing = allocs.find((a) => a.requirementId === req.id && a.componentId === rec.id);
  const byComp = allocatedByComponent(allocs);
  const free = freeOf(supply.value, rec.id, byComp, existing?.quantity ?? 0);
  if (qty > free + EPS) {
    const others = (byComp.get(rec.id) ?? 0) - (existing?.quantity ?? 0);
    return fail(others > EPS ? `Only ${fmtQtyU(free, req.unit)} of this component is free: ${fmtQtyU(others, req.unit)} of its ${fmtQtyU(supply.value, req.unit)} is already allocated to other requirements` : `This component can supply ${fmtQtyU(supply.value, req.unit)}`);
  }
  const byReq = allocatedByRequirement(allocs);
  const remaining = Math.max(0, req.quantity - ((byReq.get(req.id) ?? 0) - (existing?.quantity ?? 0)));
  if (qty > remaining + EPS) return fail(`More than the requirement still needs (${fmtQtyU(remaining, req.unit)} remaining)`);

  const quantity = round9(qty);
  const basis = basisOf(cand, ctx.assessments.get(rec.id)?.classification ?? null);
  if (existing) {
    const next: Allocation = { ...existing, quantity, unit: req.unit, note: input.note ?? existing.note, basis, updatedAt: now };
    return { allocations: allocs.map((a) => (a === existing ? next : a)), allocation: next, error: null };
  }
  const created: Allocation = { id: newId(), requirementId: req.id, componentId: rec.id, quantity, unit: req.unit, note: input.note ?? "", basis, createdAt: now, updatedAt: now };
  return { allocations: [...allocs, created], allocation: created, error: null };
}

/** Apply many allocations in order; each one is validated against the ledger as it stands. Returns what was applied and what was refused. */
export function allocateBatch(ctx: MatchContext, reqs: readonly Requirement[], allocs: readonly Allocation[], inputs: readonly AllocateInput[], now: string, newId: () => string): { allocations: readonly Allocation[]; applied: number; errors: readonly string[] } {
  let cur = allocs;
  let applied = 0;
  const errors: string[] = [];
  for (const input of inputs) {
    const r = allocate(ctx, reqs, cur, input, now, newId);
    if (r.error) errors.push(`${input.componentId}: ${r.error}`);
    else {
      cur = r.allocations;
      applied++;
    }
  }
  return { allocations: cur, applied, errors };
}

export const removeAllocation = (allocs: readonly Allocation[], id: string): readonly Allocation[] => (allocs.some((a) => a.id === id) ? allocs.filter((a) => a.id !== id) : allocs);
export const removeForRequirement = (allocs: readonly Allocation[], requirementId: string): readonly Allocation[] => (allocs.some((a) => a.requirementId === requirementId) ? allocs.filter((a) => a.requirementId !== requirementId) : allocs);
export const removeForComponent = (allocs: readonly Allocation[], componentId: string): readonly Allocation[] => (allocs.some((a) => a.componentId === componentId) ? allocs.filter((a) => a.componentId !== componentId) : allocs);

// ── review ───────────────────────────────────────────────────────────────────

/**
 * Check every allocation against the CURRENT data (B1, B2, C1 and the requirement). A flag never changes an allocation: the user
 * decides whether to keep, trim or remove it.
 */
export function reviewAllocations(ctx: MatchContext, reqs: readonly Requirement[], allocs: readonly Allocation[]): Review[] {
  const byComp = allocatedByComponent(allocs);
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const out: Review[] = [];
  for (const a of allocs) {
    const flags: ReviewFlag[] = [];
    const req = reqById.get(a.requirementId);
    const rec = ctx.inv.recordById.get(a.componentId);
    const q = ctx.inv.byId.get(a.componentId);
    if (!rec || !q || rec.geometry.kind === "group") flags.push({ code: "missing_component", text: "This component is not in the current model" });
    else if (req) {
      if (a.unit !== req.unit || a.unit !== q.primary.unit) flags.push({ code: "unit_changed", text: `Allocated in ${UNIT_LABEL[a.unit]}; the requirement is in ${UNIT_LABEL[req.unit]} and the component is measured in ${UNIT_LABEL[q.primary.unit]}` });
      const c = evaluate(ctx, req, { rec, q });
      if (c.tier === "incompatible") flags.push({ code: "now_incompatible", text: c.blockers[0]!.text });
      else if (a.basis.tier === "strong" && c.tier === "conditional") flags.push({ code: "now_conditional", text: (c.conditions[0] ?? c.missing[0])?.text ?? "A criterion is no longer fully met" });
      const supply = c.supply.unit === a.unit ? c.supply.value : null;
      if (supply !== null) {
        const total = byComp.get(a.componentId) ?? 0;
        if (total > supply + EPS) flags.push({ code: "over_supply", text: `${fmtQtyU(total, a.unit)} is allocated in total, the component can now supply ${fmtQtyU(supply, a.unit)}`, fits: Math.max(0, supply - (total - a.quantity)) });
      }
    }
    if (flags.length) out.push({ allocationId: a.id, flags });
  }
  return out;
}

// ── demand ───────────────────────────────────────────────────────────────────

export interface DemandRow {
  readonly requirement: Requirement;
  readonly required: number;
  readonly allocated: number;
  readonly remaining: number;
  readonly status: DemandStatus;
  readonly components: number;
  /** Part of `allocated` that comes from conditional matches: their conditions (refurbishment, cutting, testing, missing data) are still open. */
  readonly conditional: number;
  /** Allocations of this requirement that the review flags. */
  readonly flagged: number;
}

export function demandStatus(required: number, allocated: number): DemandStatus {
  const tol = Math.max(1e-9, required * 1e-9);
  if (allocated <= tol) return "unmet";
  if (allocated > required + tol) return "over";
  return required - allocated <= tol ? "matched" : "partial";
}

export function demandRows(reqs: readonly Requirement[], allocs: readonly Allocation[], reviews: readonly Review[] = []): DemandRow[] {
  const flaggedIds = new Set(reviews.map((r) => r.allocationId));
  return reqs.map((requirement) => {
    const mine = allocs.filter((a) => a.requirementId === requirement.id);
    const allocated = round9(mine.reduce((s, a) => s + a.quantity, 0));
    return {
      requirement,
      required: requirement.quantity,
      allocated,
      remaining: Math.max(0, round9(requirement.quantity - allocated)),
      status: demandStatus(requirement.quantity, allocated),
      components: mine.length,
      conditional: round9(mine.filter((a) => a.basis.tier === "conditional").reduce((s, a) => s + a.quantity, 0)),
      flagged: mine.filter((a) => flaggedIds.has(a.id)).length,
    };
  });
}

export interface UnitTotal {
  readonly unit: Unit;
  readonly requirements: number;
  readonly required: number;
  readonly allocated: number;
  readonly remaining: number;
}
const UNIT_ORDER: readonly Unit[] = ["m2", "m3", "m", "nr", "kg"];

/** Totals per unit. Different units are NEVER added together: there is one line per unit. */
export function totalsByUnit(rows: readonly DemandRow[]): UnitTotal[] {
  const m = new Map<Unit, { n: number; req: number; alloc: number; rem: number }>();
  for (const r of rows) {
    const e = m.get(r.requirement.unit) ?? { n: 0, req: 0, alloc: 0, rem: 0 };
    e.n++;
    e.req += r.required;
    e.alloc += Math.min(r.allocated, r.required);
    e.rem += r.remaining;
    m.set(r.requirement.unit, e);
  }
  return UNIT_ORDER.filter((u) => m.has(u)).map((unit) => {
    const e = m.get(unit)!;
    return { unit, requirements: e.n, required: round9(e.req), allocated: round9(e.alloc), remaining: round9(e.rem) };
  });
}

export const statusCounts = (rows: readonly DemandRow[]): Record<DemandStatus, number> => {
  const c: Record<DemandStatus, number> = { unmet: 0, partial: 0, matched: 0, over: 0 };
  for (const r of rows) c[r.status]++;
  return c;
};

/**
 * The invariants the ledger promises, checked against the current data. An empty list means the books balance: no component is
 * allocated beyond its supply, no requirement beyond its demand, and every allocation is in the right unit.
 */
export function reconcile(ctx: MatchContext, reqs: readonly Requirement[], allocs: readonly Allocation[]): string[] {
  const problems: string[] = [];
  const byComp = allocatedByComponent(allocs);
  const byReq = allocatedByRequirement(allocs);
  const pair = new Set<string>();
  for (const a of allocs) {
    const k = `${a.requirementId}|${a.componentId}`;
    if (pair.has(k)) problems.push(`${a.componentId} is allocated twice to the same requirement`);
    pair.add(k);
  }
  for (const [id, total] of byComp) {
    const q = ctx.inv.byId.get(id);
    const rec = ctx.inv.recordById.get(id);
    if (!q || !rec) {
      problems.push(`${id}: not a component of the model`);
      continue;
    }
    // the supply the component would offer to a requirement of its own unit (a requirement is only matched in the component's unit)
    const req = reqs.find((r) => allocs.some((a) => a.componentId === id && a.requirementId === r.id));
    if (!req) continue;
    const supply = evaluate(ctx, req, { rec, q }).supply;
    if (supply.value !== null && total > supply.value + EPS) problems.push(`${id}: ${fmtQtyU(total, supply.unit)} allocated, supply ${fmtQtyU(supply.value, supply.unit)}`);
  }
  for (const r of reqs) if ((byReq.get(r.id) ?? 0) > r.quantity + EPS) problems.push(`${r.name}: more allocated than required`);
  return problems;
}
