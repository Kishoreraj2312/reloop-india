/**
 * Tracking export (C3): every record with its history as JSON (structured; a quantity that was never recorded is null, not 0) and one row
 * per record as CSV. Pure; the timestamp is injected. The export states what was PLANNED and what was RECORDED; it asserts no
 * environmental saving (that needs B5's factors and measured data, which the user supplies there).
 */

import { csvField, UNIT_LABEL } from "@/engine/quantities";
import { STATUS_LABELS, type Records } from "./types";
import { FLOOR_NAMES, type Row } from "./report";

export const SCHEMA = "rematter.recovery-tracking/1";
const DISCLAIMER = "Recovery tracking record from the RE:MATTER model and the user's entries. Planned quantities come from B2 estimates (or the user); actual quantities exist only where an entry records them, each with its source (measured, estimated or assumed). A quantity that was not recorded is null, not 0. No environmental saving is asserted.";

const exact = (v: number | null): number | null => (v === null ? null : Number(v.toPrecision(12)));

export function trackingToJson(records: Records, rows: readonly Row[], exportedAt: string): string {
  return JSON.stringify(
    {
      schema: SCHEMA,
      tool: "RE:MATTER",
      exportedAt,
      disclaimer: DISCLAIMER,
      records: rows.map((r) => {
        const s = r.summary;
        return {
          componentId: r.id,
          name: r.name,
          materialCategory: r.substance,
          floor: r.floor,
          unit: s.unit,
          status: s.status,
          statusLabel: STATUS_LABELS[s.status],
          planned: exact(s.planned),
          plannedBasis: s.plannedBasis,
          available: exact(s.available),
          documentedVariance: exact(s.variance),
          recovered: exact(s.recovered),
          reused: exact(s.reused),
          recycled: exact(s.recycled),
          disposed: exact(s.disposed),
          notRecovered: exact(s.unrecovered),
          inHand: exact(s.inHand),
          notYetRecovered: exact(s.notYetRecovered),
          unaccounted: exact(s.unaccounted),
          completion: s.completion === null ? null : Number(s.completion.toPrecision(6)),
          quality: s.quality,
          flags: s.flags.map((f) => ({ code: f.code, level: f.level, text: f.text })),
          history: records[r.id]?.events ?? [],
        };
      }),
    },
    null,
    2,
  );
}

export const CSV_HEADER = ["component_id", "name", "material_category", "floor", "unit", "status", "planned", "planned_basis", "available", "recovered", "reused", "recycled", "disposed", "not_recovered", "in_hand", "not_yet_recovered", "unaccounted", "completion_pct", "quality", "flags", "last_recorded"] as const;

const cell = (v: number | null): string => (v === null ? "" : String(exact(v)));

export function trackingToCsv(rows: readonly Row[]): string {
  const out: string[] = [CSV_HEADER.join(",")];
  for (const r of rows) {
    const s = r.summary;
    out.push(
      [
        r.id,
        r.name,
        r.substance,
        FLOOR_NAMES[r.floor] ?? String(r.floor),
        UNIT_LABEL[s.unit],
        STATUS_LABELS[s.status],
        cell(s.planned),
        s.plannedBasis,
        cell(s.available),
        cell(s.recovered),
        cell(s.reused),
        cell(s.recycled),
        cell(s.disposed),
        cell(s.unrecovered),
        cell(s.inHand),
        cell(s.notYetRecovered),
        cell(s.unaccounted),
        s.completion === null ? "" : String(Number((s.completion * 100).toPrecision(5))),
        s.quality ?? "",
        s.flags.map((f) => f.code).join(" | "),
        s.lastRecordedAt,
      ]
        .map(csvField)
        .join(","),
    );
  }
  return out.join("\r\n") + "\r\n";
}

export const trackingFileName = (ext: "json" | "csv"): string => `recovery-tracking.${ext}`;
