/** (De)serialisation of passport metadata (C1). Pure: the storage glue lives in the scene layer. Invalid parts are dropped, never repaired. */

import { isIsoDate } from "./meta";
import { EMPTY_META, INSPECTION_STATUSES, isEmptyMeta, MAX_NOTE, MAX_SHORT, OBSERVED_CONDITIONS, type MetaMap, type PassportMeta } from "./types";

export const PERSIST_VERSION = 1;

export function serializeMeta(m: MetaMap): string {
  return JSON.stringify({ version: PERSIST_VERSION, entries: [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)) });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);

function clean(raw: unknown): PassportMeta | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const on = typeof r.inspectedOn === "string" && isIsoDate(r.inspectedOn) ? r.inspectedOn : "";
  const m: PassportMeta = {
    ...EMPTY_META,
    inspectionStatus: oneOf(INSPECTION_STATUSES, r.inspectionStatus),
    observedCondition: oneOf(OBSERVED_CONDITIONS, r.observedCondition),
    inspectedOn: on,
    inspectedBy: str(r.inspectedBy, MAX_SHORT),
    conditionNote: str(r.conditionNote, MAX_NOTE),
    provenanceNote: str(r.provenanceNote, MAX_NOTE),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
  return isEmptyMeta(m) ? null : m;
}

/**
 * Parse stored JSON. Malformed or outdated data yields nothing (never throws). Entries for ids that are not components of the
 * current model are KEPT (the model may be regenerated) and reported in `orphans`, so a user's notes are never silently lost.
 */
export function parseMeta(text: string | null, isComponent?: (id: string) => boolean): { map: Map<string, PassportMeta>; dropped: number; orphans: string[] } {
  const map = new Map<string, PassportMeta>();
  const empty = { map, dropped: 0, orphans: [] as string[] };
  if (!text) return empty;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return empty;
  }
  const d = data as { version?: unknown; entries?: unknown } | null;
  if (!d || d.version !== PERSIST_VERSION || !Array.isArray(d.entries)) return empty;
  let dropped = 0;
  const orphans: string[] = [];
  for (const e of d.entries) {
    const id = Array.isArray(e) ? e[0] : undefined;
    const m = Array.isArray(e) ? clean(e[1]) : null;
    if (typeof id !== "string" || !id || !m) dropped++;
    else {
      map.set(id, m);
      if (isComponent && !isComponent(id)) orphans.push(id);
    }
  }
  return { map, dropped, orphans };
}
