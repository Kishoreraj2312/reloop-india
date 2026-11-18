/** (De)serialisation of assessments (B2). Pure: the storage glue lives in the app layer. */

import { validatePct } from "./assess";
import { CLASSIFICATIONS, DESTINATIONS, isEmptyAssessment, isRecoverableClass, PREPARATIONS, type Assessments, type RecoveryAssessment } from "./types";

export const PERSIST_VERSION = 1;

export function serializeAssessments(a: Assessments): string {
  return JSON.stringify({ version: PERSIST_VERSION, entries: [...a].sort((x, y) => (x[0] < y[0] ? -1 : 1)) });
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

/** One stored entry, validated; null when it is invalid or empty. */
export function cleanAssessment(raw: unknown): RecoveryAssessment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const classification = oneOf(CLASSIFICATIONS, r.classification);
  const pct = typeof r.recoveryPct === "number" && validatePct(r.recoveryPct) === null && isRecoverableClass(classification) ? r.recoveryPct : null;
  const a: RecoveryAssessment = {
    classification,
    recoveryPct: pct,
    preparation: oneOf(PREPARATIONS, r.preparation),
    destination: oneOf(DESTINATIONS, r.destination),
    lossNote: typeof r.lossNote === "string" ? r.lossNote : "",
    note: typeof r.note === "string" ? r.note : "",
  };
  return isEmptyAssessment(a) ? null : a;
}

/** Parse stored JSON; invalid entries (and, when `validIds` is given, unknown ids) are dropped and counted. */
export function parseAssessments(text: string | null, validIds?: (id: string) => boolean): { map: Map<string, RecoveryAssessment>; dropped: number } {
  const map = new Map<string, RecoveryAssessment>();
  if (!text) return { map, dropped: 0 };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { map, dropped: 0 };
  }
  const entries = (data as { version?: unknown; entries?: unknown })?.entries;
  if ((data as { version?: unknown })?.version !== PERSIST_VERSION || !Array.isArray(entries)) return { map, dropped: 0 };
  let dropped = 0;
  for (const e of entries) {
    const id = Array.isArray(e) ? e[0] : undefined;
    const a = Array.isArray(e) ? cleanAssessment(e[1]) : null;
    if (typeof id !== "string" || !a || (validIds && !validIds(id))) dropped++;
    else map.set(id, a);
  }
  return { map, dropped };
}
