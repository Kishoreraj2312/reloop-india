// Demo project footprint: B2 entries, serialized size (localStorage budget) and mass coverage of the assessed leaves.
import { getModelInventory } from "@/engine/quantities/modelInventory";
import { applyPatch, serializeAssessments } from "@/engine/recovery";
import { demoAssessments, demoRemovalEntries, demoTracked, demoPassports } from "@/demo/demoPlan";

const inv = getModelInventory();
let a = new Map() as Parameters<typeof applyPatch>[1];
for (const g of demoAssessments(inv)) {
  const r = applyPatch(inv, a, g.ids, g.patch);
  if (r.error) console.log("ERR", g.label, r.error);
  a = r.map;
  console.log(g.label.padEnd(14), g.ids.length);
}
const mass = (row: (typeof inv.rows)[number]) => row.q.mass.value ?? 0;
const total = inv.rows.reduce((s, r) => s + mass(r), 0);
const covered = inv.rows.filter((r) => a.has(r.rec.id)).reduce((s, r) => s + mass(r), 0);
console.log({ entries: a.size, bytes: serializeAssessments(a).length, massCoverage: +(covered / total).toFixed(4), removal: demoRemovalEntries(inv).length, tracked: Object.fromEntries(Object.entries(demoTracked(inv)).map(([k, v]) => [k, v.length])), passports: demoPassports(inv).length });
