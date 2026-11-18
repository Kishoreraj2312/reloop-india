/**
 * A4 census 3: how many separable layers each assembly type has along Y and along its thin horizontal axis (1 cm tolerance).
 * This is what the decomposition rules in src/engine/explode/assemblies.ts were chosen from.
 * Run: npx vite-node scripts/explode/census3.ts
 */
// layer statistics per assembly type along Y and along the (thin horizontal) envelope axis
import { modelRecords } from "@/engine/quantities";
import { recordBounds } from "@/building/structure";
const recs = modelRecords();
const byId = new Map(recs.map((r) => [r.id, r]));
const kids = new Map<string, string[]>();
for (const r of recs) { const p = r.parentId && byId.get(r.parentId); if (p && p.geometry.kind === "group") (kids.get(p.id) ?? kids.set(p.id, []).get(p.id)!).push(r.id); }
const centre = (id: string): [number, number, number] => { const b = recordBounds(byId.get(id)!); return [(b.min[0]! + b.max[0]!) / 2, (b.min[1]! + b.max[1]!) / 2, (b.min[2]! + b.max[2]!) / 2]; };
function layers(vals: number[], tol: number): number {
  const s = vals.slice().sort((a, b) => a - b);
  let n = 1;
  for (let i = 1; i < s.length; i++) if (s[i]! - s[i - 1]! > tol) n++;
  return n;
}
const stat = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return `${s[0]}/${s[Math.floor((s.length - 1) / 2)]}/${s[s.length - 1]}`; };
const groups = recs.filter((r) => r.geometry.kind === "group");
const types = [...new Set(groups.map((g) => `${g.system}/${g.componentType}`))];
console.log("type".padEnd(44), "groups  layers along Y (min/med/max) tol 1cm | along thin-horizontal axis | with <2 layers (Y / N)");
for (const t of types) {
  const gs = groups.filter((g) => `${g.system}/${g.componentType}` === t);
  const ly: number[] = [], ln: number[] = [];
  let lowY = 0, lowN = 0;
  for (const g of gs) {
    const ms = (kids.get(g.id) ?? []).map(centre);
    if (ms.length < 2) { lowY++; lowN++; ly.push(ms.length); ln.push(ms.length); continue; }
    const [sx, , sz] = (g.geometry as { size: number[] }).size as [number, number, number];
    const ax = sx < sz ? 0 : 2;
    const a = layers(ms.map((m) => m[1]), 0.01), b = layers(ms.map((m) => m[ax]), 0.01);
    ly.push(a); ln.push(b); if (a < 2) lowY++; if (b < 2) lowN++;
  }
  console.log(t.padEnd(44), String(gs.length).padStart(6), stat(ly).padStart(12), stat(ln).padStart(12), `   <2: ${lowY} / ${lowN}`);
}
