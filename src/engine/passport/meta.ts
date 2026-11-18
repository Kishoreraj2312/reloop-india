/** Editing the passport metadata (C1). Pure and immutable: invalid input returns the SAME map and an error; empty entries are removed. */

import { EMPTY_META, INSPECTION_STATUSES, isEmptyMeta, MAX_NOTE, MAX_SHORT, OBSERVED_CONDITIONS, type MetaMap, type MetaPatch, type PassportMeta } from "./types";

export interface MetaEdit {
  readonly map: MetaMap;
  readonly error: string | null;
}

/** True for a real calendar date written YYYY-MM-DD (year 1900–2100). */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Error text for an invalid patch, or null. */
export function validatePatch(p: MetaPatch): string | null {
  if (p.inspectionStatus !== undefined && p.inspectionStatus !== null && !(INSPECTION_STATUSES as readonly string[]).includes(p.inspectionStatus)) return "Unknown inspection status";
  if (p.observedCondition !== undefined && p.observedCondition !== null && !(OBSERVED_CONDITIONS as readonly string[]).includes(p.observedCondition)) return "Unknown condition";
  if (p.inspectedOn !== undefined && p.inspectedOn !== "" && !isIsoDate(p.inspectedOn)) return "Date must be a real date written YYYY-MM-DD";
  for (const [k, max] of [["inspectedBy", MAX_SHORT], ["conditionNote", MAX_NOTE], ["provenanceNote", MAX_NOTE]] as const) {
    const v = p[k];
    if (v !== undefined && typeof v !== "string") return "Text expected";
    if (v !== undefined && v.length > max) return `Too long (at most ${max} characters)`;
  }
  return null;
}

/** Apply a patch to one component's metadata. `now` is injected so results are deterministic. */
export function applyMeta(map: MetaMap, id: string, patch: MetaPatch, now: string): MetaEdit {
  if (!id) return { map, error: "Missing component id" };
  const error = validatePatch(patch);
  if (error) return { map, error };
  const before = map.get(id) ?? EMPTY_META;
  const next: PassportMeta = { ...before, ...patch, updatedAt: before.updatedAt };
  const same = (["inspectionStatus", "observedCondition", "inspectedOn", "inspectedBy", "conditionNote", "provenanceNote"] as const).every((k) => next[k] === before[k]);
  if (same) return { map, error: null };
  const out = new Map(map);
  if (isEmptyMeta(next)) out.delete(id);
  else out.set(id, { ...next, updatedAt: now });
  return { map: out, error: null };
}

export function clearMeta(map: MetaMap, id: string): MetaMap {
  if (!map.has(id)) return map;
  const out = new Map(map);
  out.delete(id);
  return out;
}
