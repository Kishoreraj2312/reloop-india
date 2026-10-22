/** Component inventory by ID prefix (assemblies vs drawn components): npx vite-node scripts/plans/inventory.ts */
import { DEFAULT_CONFIG } from "../../src/building/config";
import { getStructure } from "../../src/building/structure";
import { getArchitecture } from "../../src/building/architecture/generate";

const all = [...getStructure(DEFAULT_CONFIG), ...getArchitecture(DEFAULT_CONFIG).records];
const rows = new Map<string, { asm: number; drawn: number; instanced: number }>();
for (const r of all) {
  const k = r.id.split("-").slice(0, 2).join("-");
  const e = rows.get(k) ?? { asm: 0, drawn: 0, instanced: 0 };
  if (r.geometry.kind === "group") e.asm++;
  else {
    e.drawn++;
    if (r.system === "architecture") e.instanced++;
  }
  rows.set(k, e);
}
console.log("| Prefix | Assemblies | Drawn components | Instanced | Own mesh |\n|---|---|---|---|---|");
let t = { asm: 0, drawn: 0, instanced: 0 };
for (const [k, e] of [...rows.entries()].sort()) {
  console.log(`| ${k} | ${e.asm} | ${e.drawn} | ${e.instanced} | ${e.drawn - e.instanced} |`);
  t = { asm: t.asm + e.asm, drawn: t.drawn + e.drawn, instanced: t.instanced + e.instanced };
}
console.log(`| **Total** | ${t.asm} | ${t.drawn} | ${t.instanced} | ${t.drawn - t.instanced} |`);
console.log(`records: ${all.length}`);
