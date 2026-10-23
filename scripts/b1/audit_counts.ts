/**
 * B1 Stage 0 audit: counts from the generators (not from docs).
 *   npx vite-node scripts/b1/audit_counts.ts          # facts
 *   npx vite-node scripts/b1/audit_counts.ts --md     # componentType table (markdown)
 */
import { DEFAULT_CONFIG } from "../../src/building/config";
import { getStructure } from "../../src/building/structure";
import { getArchitecture } from "../../src/building/architecture/generate";
import { getMep } from "../../src/building/mep/generate";
import { classify } from "../../src/engine/quantities";

const md = process.argv.includes("--md");
const str = getStructure(DEFAULT_CONFIG);
const arc = getArchitecture(DEFAULT_CONFIG);
const mep = getMep(DEFAULT_CONFIG);
const sets = { STR: [...str], ARC: [...arc.records], MEP: [...mep.records] };
const all = [...sets.STR, ...sets.ARC, ...sets.MEP];

const count = <T>(xs: T[], f: (x: T) => string) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return m;
};

if (!md) {
  console.log("records", { STR: sets.STR.length, ARC: sets.ARC.length, MEP: sets.MEP.length, "STR+ARC": sets.STR.length + sets.ARC.length, all: all.length });
  for (const [k, rs] of Object.entries(sets)) {
    const groups = rs.filter((r) => r.geometry.kind === "group");
    console.log(k, { groups: groups.length, groupsWithAssemblySuffix: groups.filter((r) => r.componentType.endsWith("_assembly")).length, leaves: rs.length - groups.length });
    console.log("  geometry kinds", count(rs, (r) => r.geometry.kind), "units", count(rs, (r) => r.unit));
  }
  console.log("prism planes", count(all.filter((r) => r.geometry.kind === "prism"), (r) => (r.geometry.kind === "prism" ? r.geometry.plane : "")));
  const rotated = all.filter((r) => r.geometry.kind === "box" && r.originalRotation.some((x) => x !== 0));
  console.log("rotated boxes", rotated.length, count(rotated, (r) => r.componentType));
  console.log("duplicate ids", all.length - new Set(all.map((r) => r.id)).size);
  console.log("hosted openings per storey", arc.storeys.map((s) => s.walls.reduce((n, w) => n + w.openings.length, 0)));
  const mats = [...new Set(all.map((r) => r.materialId))].sort();
  console.log(`materialIds used (${mats.length}):`, mats.join(" "));
  const sys = count(all, (r) => r.system);
  console.log("by system", sys, "componentTypes", new Set(all.map((r) => r.componentType)).size);
} else {
  console.log("| system | componentType | geometry | count | unit | category | materialIds |\n|---|---|---|---:|---|---|---|");
  const byType = new Map<string, typeof all>();
  for (const r of all) (byType.get(`${r.system}|${r.componentType}`) ?? byType.set(`${r.system}|${r.componentType}`, []).get(`${r.system}|${r.componentType}`)!).push(r);
  for (const [k, rs] of [...byType].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [system, type] = k.split("|") as [string, string];
    const set = (f: (r: (typeof all)[number]) => string) => [...new Set(rs.map(f))].sort().join(", ");
    console.log(`| ${system} | \`${type}\` | ${set((r) => r.geometry.kind)} | ${rs.length} | ${set((r) => r.unit)} | ${classify(rs[0]!).category} | ${set((r) => r.materialId)} |`);
  }
}
