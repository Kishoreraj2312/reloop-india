/**
 * A4 census 2: assembly records by type: member counts, envelope sizes, nesting, containment inside the envelope, floor
 * consistency, drawn components without an assembly. Run: npx vite-node scripts/explode/census2.ts
 */
import { modelRecords } from "@/engine/quantities";
import { recordBounds } from "@/building/structure";
const recs = modelRecords();
const byId = new Map(recs.map((r) => [r.id, r]));
const kids = new Map<string, string[]>();
for (const r of recs) { const p = r.parentId && byId.get(r.parentId); if (p && p.geometry.kind === "group") (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(r.id); }
const groups = recs.filter((r) => r.geometry.kind === "group");
const byType = new Map<string, typeof groups>();
for (const g of groups) (byType.get(`${g.system}/${g.componentType}`) ?? byType.set(`${g.system}/${g.componentType}`, []).get(`${g.system}/${g.componentType}`)!).push(g);
const q = (a: number[], p: number) => a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) * p)]!;
console.log("type".padEnd(44), "groups  kids(min/med/max)  envelope(med x,y,z)  cat   nested-groups?");
for (const [t, gs] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
  const ks = gs.map((g) => kids.get(g.id)?.length ?? 0);
  const env = gs.map((g) => (g.geometry as { size: number[] }).size);
  const nested = gs.some((g) => (kids.get(g.id) ?? []).some((c) => byId.get(c)!.geometry.kind === "group"));
  const cats = [...new Set(gs.map((g) => g.assembly))].join(",");
  console.log(t.padEnd(44), String(gs.length).padStart(6), `${Math.min(...ks)}/${q(ks, 0.5)}/${Math.max(...ks)}`.padStart(14), `${q(env.map((e) => e[0]!), 0.5).toFixed(2)} x ${q(env.map((e) => e[1]!), 0.5).toFixed(2)} x ${q(env.map((e) => e[2]!), 0.5).toFixed(2)}`.padStart(24), cats, nested ? "NESTED" : "");
}
// children inside envelope?
let outside = 0, checked = 0;
const eps = 0.02;
for (const g of groups) {
  const [px, py, pz] = g.originalPosition; const [sx, sy, sz] = (g.geometry as { size: number[] }).size as [number, number, number];
  for (const c of kids.get(g.id) ?? []) { const b = recordBounds(byId.get(c)!); checked++; if (b.min[0]! < px - sx / 2 - eps || b.max[0]! > px + sx / 2 + eps || b.min[1]! < py - sy / 2 - eps || b.max[1]! > py + sy / 2 + eps || b.min[2]! < pz - sz / 2 - eps || b.max[2]! > pz + sz / 2 + eps) outside++; }
}
console.log("\nchildren checked", checked, "outside their assembly envelope (+2 cm):", outside);
// does every instanced/drawn non-structure record have a group parent?
const drawnNoGroup = recs.filter((r) => r.system !== "structure" && r.geometry.kind !== "group" && !(r.parentId && byId.get(r.parentId)?.geometry.kind === "group"));
console.log("non-structure drawn records without an assembly parent:", drawnNoGroup.length, [...new Set(drawnNoGroup.map((r) => r.componentType))].slice(0, 10));
// do assemblies keep to one floor? one apartment?
let crossFloor = 0;
for (const g of groups) for (const c of kids.get(g.id) ?? []) if (byId.get(c)!.floor !== g.floor) crossFloor++;
console.log("children whose floor differs from their assembly's floor:", crossFloor);
