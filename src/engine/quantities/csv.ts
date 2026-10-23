/**
 * CSV export (B1). RFC 4180: comma separated, CRLF records, fields containing a comma, quote,
 * CR or LF are quoted and quotes are doubled. One header row, then one record per row given.
 * Unknown values are empty cells (never 0); `status` and `method` say how each number was made.
 */

import { dimensionsLabel, type InventoryRow } from "./inventory";
import { CATEGORY_LABELS } from "./types";
import { csvValue } from "./units";

export const CSV_COLUMNS = [
  "id",
  "name",
  "floor",
  "system",
  "category",
  "component_type",
  "material_id",
  "dimensions_m",
  "quantity",
  "unit",
  "status",
  "method",
  "secondary_quantities",
  "mass_kg",
  "mass_status",
  "mass_method",
  "issues",
] as const;

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const FLOORS: Readonly<Record<number, string>> = { [-1]: "FDN", 0: "G", 1: "F01", 2: "F02", 3: "F03", 4: "F04", 5: "RF" };

export function csvRecord(row: InventoryRow): string[] {
  const { rec, q } = row;
  const secondary = q.secondary.map((s) => `${s.kind} ${csvValue(s.value)} ${s.unit} (${s.status})`).join("; ");
  const issues = [...q.primary.issues, ...q.secondary.flatMap((s) => s.issues), ...q.mass.issues].map((i) => `${i.code}: ${i.message}`).join(" | ");
  return [
    rec.id,
    rec.name,
    FLOORS[rec.floor] ?? String(rec.floor),
    rec.system,
    CATEGORY_LABELS[q.category],
    rec.componentType,
    rec.materialId,
    dimensionsLabel(rec).replace(/ m$/, ""),
    csvValue(q.primary.value),
    q.primary.unit,
    q.primary.status,
    q.primary.method,
    secondary,
    csvValue(q.mass.value),
    q.mass.status,
    q.mass.value === null ? "" : q.mass.method,
    issues,
  ];
}

export function rowsToCsv(rows: readonly InventoryRow[]): string {
  const out = [CSV_COLUMNS.join(",")];
  for (const r of rows) out.push(csvRecord(r).map(csvField).join(","));
  return out.join("\r\n") + "\r\n";
}

/** Minimal RFC 4180 parser (for tests and the browser check). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
