/**
 * Demo project loader. "Load demo project" backs up the user's own entries in every data-entry module (B2 assessments, B3 plans, B4
 * scenarios, B5 factors and assumptions, C1 passport notes, C2 requirements, C3 tracking), then fills the modules with the illustrative
 * inputs of demoPlan.ts THROUGH THE MODULES' OWN STORE ACTIONS (same validation, same derived results as typed-in data). "Exit demo"
 * writes the backup back and reloads, so the user's data returns exactly as it was. While the demo is loaded a badge says so on every
 * screen (DemoBadge), and every free-text field the demo writes says "Demo".
 */

import { useSyncExternalStore } from "react";
import { getModelInventory } from "@/engine/quantities";
import { substanceOf } from "@/engine/recovery";
import { illustrativeFactors } from "@/engine/carbon/factors";
import { EMPTY_DRAFT } from "@/engine/reuse/requirement";
import { STORAGE_KEY as RECOVERY_KEY, STARTER_FLAG_KEY, recoveryStore } from "@/scene/recovery/recoveryStore";
import { STORAGE_KEY as REMOVAL_KEY, removalStore } from "@/scene/removal/removalStore";
import { STORAGE_KEY as SCENARIO_KEY, scenarioStore } from "@/scene/scenarios/scenarioStore";
import { STORAGE_KEY as CARBON_KEY, carbonStore } from "@/scene/carbon/carbonStore";
import { STORAGE_KEY as PASSPORT_KEY, passportStore } from "@/scene/passport/passportStore";
import { STORAGE_KEY as REUSE_KEY, reuseStore } from "@/scene/reuse/reuseStore";
import { STORAGE_KEY as TRACKING_KEY, trackingStore } from "@/scene/tracking/trackingStore";
import { DEMO_NOTE, DEMO_REQUIREMENTS, DEMO_TAG, demoAssessments, demoExtraRemovalPlans, demoPassports, demoRemovalEntries, demoTracked, rowsOf } from "./demoPlan";

const MODULE_KEYS = [RECOVERY_KEY, STARTER_FLAG_KEY, REMOVAL_KEY, SCENARIO_KEY, CARBON_KEY, PASSPORT_KEY, REUSE_KEY, TRACKING_KEY] as const;
export const DEMO_KEY = "rematter.demo.v1";
/** Set by Exit demo (and by the browser checks): the demo is then no longer loaded on its own when the app opens empty. */
export const AUTOLOAD_OFF_KEY = "rematter.demo.autoload.off";
/** Categories the B5 illustrative set leaves out, given labelled placeholder factors per their own unit so the baseline covers about 70 % of the components. */
const EXTRA_FACTORS: readonly (readonly [string, number])[] = [["copper_conductor", 0.45], ["cpvc", 0.7], ["stainless_steel", 4], ["aluminium", 2.5], ["bitumen_membrane", 1.6]];
/** How far through the main removal plan the simulation stands when the demo opens (a project under way). */
const REMOVAL_PROGRESS = 0.65;

interface Persisted {
  readonly loadedAt: string;
  /** The user's own raw stored value per module key (null: nothing stored). */
  readonly backup: Readonly<Record<string, string | null>>;
}

export interface DemoState {
  readonly active: boolean;
  readonly busy: boolean;
  readonly loadedAt: string | null;
  readonly error: string | null;
  /** What the loader wrote (counts), for the badge's tooltip and the browser check. */
  readonly summary: Readonly<Record<string, number>> | null;
  /** Presentation mode shows its own compact demo label, so the global badge steps aside. */
  readonly presenting: boolean;
}

function readPersisted(): Persisted | null {
  try {
    const raw = window.localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as Persisted) : null;
  } catch {
    return null;
  }
}

const initial = typeof window === "undefined" ? null : readPersisted();
let state: DemoState = { active: initial !== null, busy: false, loadedAt: initial?.loadedAt ?? null, error: null, summary: null, presenting: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<DemoState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

/** Empty every module through its own actions (the backup is already taken). */
function clearModules(): void {
  recoveryStore.clearAll();
  for (const p of [...removalStore.get().plans]) removalStore.delete(p.id);
  for (const s of [...scenarioStore.get().scenarios]) scenarioStore.delete(s.id);
  carbonStore.clearAllFactors();
  carbonStore.resetAssumptions();
  passportStore.removeAll([...passportStore.get().meta.keys()]);
  reuseStore.clearAll();
  trackingStore.clearAll();
}

/** Fill every module. Returns counts of what was written. */
function seed(): Record<string, number> {
  const inv = getModelInventory();
  const out: Record<string, number> = {};

  // B2 recovery assessments
  let assessed = 0;
  for (const g of demoAssessments(inv)) assessed += recoveryStore.assess(g.ids, g.patch).applied;
  out.assessments = assessed;

  // B3 removal plans: two smaller ones first, then the strip-out of the top storey (created last, so it is the active plan), each in the plan's suggested order
  const plan = (name: string, ids: readonly string[]) => {
    if (!ids.length) return;
    removalStore.createPlan(name);
    removalStore.addEntries(ids);
    removalStore.applySuggestedOrder();
  };
  for (const p of demoExtraRemovalPlans(inv)) plan(p.name, p.ids);
  plan("Demo: strip-out of F04", demoRemovalEntries(inv));
  out.removalEntries = removalStore.activePlan()?.entries.length ?? 0;
  out.removalPlans = removalStore.get().plans.length;

  // B4 scenarios (they read the B2 assessments above), all three compared
  scenarioStore.createStarterSet();
  out.scenarios = scenarioStore.get().scenarios.length;

  // B5 the labelled illustrative factor set
  carbonStore.loadIllustrative();
  const tpl = illustrativeFactors().get("concrete")!; // the same labelled placeholder wording, never presented as data
  const factorErrors: string[] = [];
  for (const [category, value] of EXTRA_FACTORS) {
    const e = carbonStore.editFactor(category, { value, origin: "illustrative", sourceName: tpl.sourceName, reference: tpl.reference, geography: tpl.geography, boundary: tpl.boundary, quality: tpl.quality, note: tpl.note });
    if (e) factorErrors.push(`${category}: ${e}`);
  }
  if (factorErrors.length && import.meta.env?.DEV) console.warn("demo carbon: " + factorErrors.join(" || "));
  out.factors = carbonStore.get().factors.size;

  // C1 passport notes
  let notes = 0;
  for (const p of demoPassports(inv)) if (passportStore.edit(p.id, p.meta) === null) notes++;
  out.passports = notes;

  // C2 requirements of a receiving project (accepts cleaned / refurbished items), quantities from the model's own B1 totals; the proposed fill confirmed
  let allocations = 0;
  for (const r of DEMO_REQUIREMENTS) {
    const rows = rowsOf(inv, r.componentType, r.materialId);
    const first = rows[0];
    if (!first) continue;
    const unit = first.q.primary.unit as (typeof EMPTY_DRAFT)["unit"];
    const total = rows.reduce((s, x) => s + (x.q.primary.value ?? 0), 0);
    const quantity = unit === "nr" ? Math.max(1, Math.round(total * r.share)) : Math.round(total * r.share * 10) / 10;
    const { id } = reuseStore.add({ ...EMPTY_DRAFT, name: r.name, application: r.application, substance: substanceOf(r.materialId), componentType: r.componentType, materialId: r.materialId, quantity, unit, accept: { ...EMPTY_DRAFT.accept, cleaning: true, refurbishment: true }, note: DEMO_NOTE });
    // doors (no preparation) are strong matches; railings and sills need refurbishment and stay conditional, with their conditions shown; a need marked open is left unconfirmed
    if (id && r.confirm !== false) allocations += reuseStore.confirmProposal(id, true).applied;
  }
  out.requirements = reuseStore.get().requirements.length;
  out.allocations = allocations;

  // C3 tracking: the project is about two-thirds through its recovery. The top storey is recovered as planned (the B2 estimate) and reused
  // (linked to its C2 allocations) or recycled, F02 glazing is recycled, F03 doors are recovered and being inspected, F02 / F01 doors and
  // rails are recovered and allocated (or inspected), F03 handrails are in progress, a few F03 panes are on hold and the first storey is planned.
  // Recording the planned quantity keeps the demo free of plan-vs-actual flags.
  const t = demoTracked(inv);
  trackingStore.start([...t.reused, ...t.recycled, ...t.inProgress, ...t.inspected, ...t.allocatable, ...t.planned, ...t.onHold]);
  const assessments = recoveryStore.get().assessments;
  const planned = (id: string) => {
    const q = inv.byId.get(id)?.primary.value ?? 0;
    const pct = assessments.get(id)?.recoveryPct ?? 100;
    if (pct >= 100) return q; // all of it: B1's own value, so a C2 allocation of the whole item is fulfilled exactly
    return Math.floor(((q * pct) / 100) * 1000) / 1000; // rounded DOWN: never more than B1's modelled quantity
  };
  const at = "2026-10-21T10:00:00.000Z";
  const errors: string[] = [];
  const track = (id: string, op: Parameters<typeof trackingStore.apply>[1]) => {
    const e = trackingStore.apply(id, op);
    if (e) errors.push(`${op.type} ${id}: ${e}`);
  };
  const available = (id: string) => inv.byId.get(id)?.primary.value ?? 0;
  /** The share the B2 % does not expect to recover, recorded as an explicit loss so every unit is accounted for. */
  const lose = (id: string, recovered: number, reason: string) => {
    const loss = available(id) - recovered; // the exact remainder, so recovered + lost = the B1 quantity
    if (loss > 1e-9) track(id, { type: "unrecovered", quantity: loss, source: "estimated", reason, note: DEMO_TAG, at });
  };
  /** Everything C2 allocated of a component (a need can take part of it, a later need the rest). */
  const allocationsOf = new Map<string, ReturnType<typeof reuseStore.get>["allocations"][number][]>();
  for (const a of reuseStore.get().allocations) allocationsOf.set(a.componentId, [...(allocationsOf.get(a.componentId) ?? []), a]);
  const recoverWhole = (id: string, method: string) => {
    // at least what C2 allocated (the allocation is the exact B2 estimate; the rounded-down figure can fall a hair short of it), never above B1's quantity
    const allocated = (allocationsOf.get(id) ?? []).reduce((s, a) => s + a.quantity, 0);
    const q = Math.min(Math.max(planned(id), allocated), available(id));
    if (q <= 0) return 0;
    track(id, { type: "recover", quantity: q, source: "measured", method, note: DEMO_TAG, at });
    lose(id, q, "Damaged at the fixings during removal (demo)");
    return q;
  };

  for (const id of t.reused) {
    const q = recoverWhole(id, "Unhung / unbolted whole");
    if (q <= 0) continue;
    let rest = q;
    for (const a of allocationsOf.get(id) ?? []) {
      const linked = Math.min(rest, a.quantity);
      if (linked <= 0) continue;
      track(id, { type: "outcome", outcome: "reused", quantity: linked, source: "measured", destination: "Demo receiving project", allocationId: a.id, note: DEMO_TAG, at });
      rest -= linked;
    }
    if (rest > 1e-9) track(id, { type: "outcome", outcome: "reused", quantity: rest, source: "measured", destination: "Demo receiving project", note: DEMO_TAG, at });
  }
  for (const id of t.recycled) {
    const q = planned(id);
    if (q <= 0) continue;
    track(id, { type: "recover", quantity: q, source: "estimated", method: "Panes removed, frames separated", note: DEMO_TAG, at });
    lose(id, q, "Broken panes, not collected for recycling (demo)");
    track(id, { type: "outcome", outcome: "recycled", quantity: q, source: "estimated", destination: "Glass recycler (demo)", note: DEMO_TAG, at });
  }
  t.inspected.forEach((id, i) => {
    if (recoverWhole(id, "Unhung / unbolted whole") > 0) track(id, { type: "status", status: i % 2 === 0 ? "recovered" : "inspected", note: DEMO_TAG, at });
  });
  for (const id of t.allocatable) {
    if (recoverWhole(id, "Unhung / unbolted whole") > 0) track(id, { type: "status", status: allocationsOf.has(id) ? "allocated" : "inspected", note: DEMO_TAG, at });
  }
  trackingStore.bulkStatus(t.inProgress, "in_progress", DEMO_TAG);
  for (const id of t.inProgress) {
    const half = Math.floor(planned(id) * 0.5 * 1000) / 1000; // work under way: about half recovered so far
    if (half > 0) track(id, { type: "recover", quantity: half, source: "estimated", method: "Frames being unscrewed", note: DEMO_TAG, at });
  }
  const hold = trackingStore.bulkStatus(t.onHold, "hold", "Waiting for the hazardous-material check (demo)");
  if (hold.firstError) errors.push(`hold: ${hold.firstError}`);
  out.tracked = Object.keys(trackingStore.get().records).length;
  out.inProgress = t.inProgress.length;
  out.onHold = t.onHold.length;
  out.trackingErrors = errors.length;
  if (errors.length && import.meta.env?.DEV) console.warn("demo tracking: " + errors.slice(0, 12).join(" || "));
  return out;
}

export const demoStore = {
  get: (): DemoState => state,
  setPresenting: (presenting: boolean) => set({ presenting }),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },

  /** Back up the user's entries, then fill every module with the demo project. Idempotent while active. */
  load(): DemoState {
    if (state.active || state.busy) return state;
    set({ busy: true, error: null });
    try {
      const backup: Record<string, string | null> = {};
      for (const k of MODULE_KEYS) backup[k] = window.localStorage.getItem(k);
      const persisted: Persisted = { loadedAt: new Date().toISOString(), backup };
      window.localStorage.setItem(DEMO_KEY, JSON.stringify(persisted)); // before touching anything: a failed backup aborts here
      clearModules();
      const summary = seed();
      set({ active: true, busy: false, loadedAt: persisted.loadedAt, summary });
      demoStore.restoreSession();
    } catch (e) {
      set({ busy: false, error: `The demo project could not be loaded: ${e instanceof Error ? e.message : String(e)}` });
    }
    return state;
  },

  /**
   * The demo fills the modules by itself when the app opens with nothing entered (nobody types during a presentation). Not after Exit demo,
   * not with ?demo=0, and never when the user already has entries of their own (they would be backed up, but they were not asked for).
   */
  autoLoadIfFresh(): void {
    if (state.active || state.busy) return;
    try {
      if (new URLSearchParams(window.location.search).get("demo") === "0") return;
      if (window.localStorage.getItem(AUTOLOAD_OFF_KEY)) return;
      if (MODULE_KEYS.some((k) => window.localStorage.getItem(k) !== null)) return;
    } catch {
      return; // storage blocked: the demo could not be backed up or restored either
    }
    demoStore.load();
  },

  /** State that is not stored: the removal simulation stands about two-thirds through the main plan, as in a project under way. */
  restoreSession(): void {
    const p = removalStore.activePlan();
    if (state.active && p && /^Demo/.test(p.name) && p.cursor === 0 && p.entries.length > 2) removalStore.goTo(Math.round(p.entries.length * REMOVAL_PROGRESS));
  },

  /** Put the user's own entries back exactly as they were, then reload (every module re-reads its storage). */
  exit(): void {
    const p = readPersisted();
    if (p) {
      for (const k of MODULE_KEYS) {
        const v = p.backup[k] ?? null;
        try {
          if (v === null) window.localStorage.removeItem(k);
          else window.localStorage.setItem(k, v);
        } catch {
          /* storage blocked: nothing more can be done */
        }
      }
    }
    window.localStorage.removeItem(DEMO_KEY);
    try {
      window.localStorage.setItem(AUTOLOAD_OFF_KEY, "1"); // leaving the demo must not bring it straight back
    } catch {
      /* storage blocked */
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("demo");
    window.location.replace(url.toString());
  },
};

export function useDemo(): DemoState {
  return useSyncExternalStore(demoStore.subscribe, demoStore.get);
}

declare global {
  interface Window {
    __demo?: typeof demoStore;
  }
}
if (import.meta.env?.DEV && typeof window !== "undefined") window.__demo = demoStore;
