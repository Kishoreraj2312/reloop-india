/** Passport export (C1): JSON (structured, with every field's status and source) and CSV (one row per field). Pure; the timestamp is injected. */

import { csvField } from "@/engine/quantities";
import { STATUS_LABELS, type Passport } from "./types";

export const SCHEMA = "rematter.passport/1";

/** Numbers are exported to 12 significant digits, which removes floating-point noise (0.7290000000000001) without losing any real precision. */
const exact = (v: string | number | null): string | number | null => (typeof v === "number" ? Number(v.toPrecision(12)) : v);
const DISCLAIMER = "Decision-support record composed from the RE:MATTER model, the user's assessments and estimates. Model values are generated design assumptions, not site measurements; every field states its source and status; missing values are null.";

export function passportToJson(p: Passport, exportedAt: string): string {
  return JSON.stringify(
    {
      schema: SCHEMA,
      tool: "RE:MATTER",
      exportedAt,
      disclaimer: DISCLAIMER,
      component: { id: p.id, name: p.name, kind: p.kind },
      dataQuality: p.counts,
      cautions: p.cautions,
      sections: p.sections.map((s) => ({ key: s.key, title: s.title, fields: s.fields.map((f) => ({ key: f.key, label: f.label, value: exact(f.value), unit: f.unit ?? null, status: f.status, source: f.source, note: f.note ?? null })) })),
    },
    null,
    2,
  );
}

export const CSV_HEADER = ["section", "field", "value", "unit", "status", "source", "note"] as const;

export function passportToCsv(p: Passport): string {
  const rows: string[] = [CSV_HEADER.join(",")];
  rows.push([p.id, "component", p.name, "", "", "", p.kind].map(csvField).join(","));
  for (const s of p.sections) for (const f of s.fields) rows.push([s.key, f.label, f.value === null ? "" : String(exact(f.value)), f.unit ?? "", STATUS_LABELS[f.status], f.source, f.note ?? ""].map(csvField).join(","));
  return rows.join("\r\n") + "\r\n";
}

/** A file name safe on every platform. */
export const passportFileName = (id: string, ext: "json" | "csv"): string => `passport_${id.replace(/[^A-Za-z0-9._-]/g, "_")}.${ext}`;
