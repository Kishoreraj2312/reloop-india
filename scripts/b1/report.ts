/**
 * B1 report: building totals per category (with status and coverage), counts, walls, issues.
 *   npx vite-node scripts/b1/report.ts            # totals
 *   npx vite-node scripts/b1/report.ts --density  # density table (markdown)
 */
import { buildSummary, CATEGORY_LABELS, formatTonnes, formatValue, getModelInventory, HOLLOW_TYPES, MATERIAL_PROPS, UNIT_LABEL, type Unit } from "../../src/engine/quantities";

if (process.argv.includes("--density")) {
  // Markdown density table straight from the engine's table (docs/QUANTITY_ENGINE.md embeds this output).
  console.log("| materialId | density kg/m3 | basis | source | note |\n|---|---:|---|---|---|");
  for (const [id, p] of Object.entries(MATERIAL_PROPS)) console.log(`| \`${id}\` | ${p.densityKgM3 ?? "null"} | ${p.basis} | ${p.source} | ${p.note ?? ""} |`);
  console.log("\n| componentType | density override |\n|---|---|");
  for (const [t, why] of Object.entries(HOLLOW_TYPES)) console.log(`| \`${t}\` | null: ${why} |`);
  process.exit(0);
}
const t0 = performance.now();
const inv = getModelInventory();
const ms = performance.now() - t0;
console.log(`records ${inv.records.length} · leaves ${inv.rows.length} · assemblies ${inv.assemblyCount} · built in ${ms.toFixed(0)} ms (incl. generation)`);
console.log("\nSUMMARY CARDS");
for (const c of buildSummary(inv).cards) console.log(`${c.label.padEnd(24)} ${c.display.padStart(12)} ${String(c.unit === "t" ? "t" : UNIT_LABEL[c.unit]).padEnd(3)} ${c.status.padEnd(11)} incomplete=${c.incompleteCount}${c.lines ? "  " + c.lines.map((l) => `${l.label} ${l.value}`).join(", ") : ""}`);
console.log("\nBY CATEGORY (value status [incomplete members])");
for (const [k, b] of inv.breakdowns.category) {
  const cells = (Object.entries(b.totals) as [Unit, NonNullable<(typeof b.totals)[Unit]>][]).map(([u, t]) => `${u === "kg" ? formatTonnes(t.value) + " t" : formatValue(t.value, u) + " " + UNIT_LABEL[u]} ${t.status}${t.incompleteCount ? ` [${t.incompleteCount} missing]` : ""}`);
  console.log(`${CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS].padEnd(22)} ${String(b.leafCount).padStart(6)} comps · ${cells.join(" · ")}`);
}
console.log("\nMASS COVERAGE", inv.massCoverage);
console.log("\nCOUNTS", inv.counts.map((c) => `${c.label}=${c.result.value}`).join("; "));
const g = inv.walls.filter((w) => w.gross.value !== null);
const sum = (f: (w: (typeof inv.walls)[number]) => number | null) => g.reduce((s, w) => s + (f(w) ?? 0), 0);
console.log(`\nWALLS ${inv.walls.length} assemblies: net ${sum((w) => w.net.value).toFixed(3)} + lintel ${sum((w) => w.lintel.value).toFixed(3)} + voids ${sum((w) => w.voids.value).toFixed(3)} = gross ${sum((w) => w.gross.value).toFixed(3)} m3; openings deducted ${inv.walls.reduce((n, w) => n + w.openings.length, 0)}; gross not calculated: ${inv.walls.length - inv.walls.filter((w) => w.gross.status === "calculated").length}`);
console.log("\nISSUE COUNTS", inv.issueCounts);
for (const i of inv.issues.filter((i) => i.severity === "warning")) console.log(`  warning ${i.code}: ${i.message}`);
console.log("\nBY SYSTEM");
for (const [k, b] of inv.breakdowns.system) console.log(`  ${k.padEnd(13)} ${b.leafCount} leaves`);
