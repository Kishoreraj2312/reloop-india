/**
 * A4 census: how the generated model maps to floor / system / assembly groups, what its bounds are, and where the
 * floor field and the geometry disagree. Run: npx vite-node scripts/explode/census.ts
 */
import { modelRecords } from "@/engine/quantities";
import { recordBounds, type ComponentRecord } from "@/building/structure";
import { floorKeyOf } from "@/scene/sceneTree";

const recs = modelRecords();
const f = (n: number) => n.toFixed(2).padStart(7);
console.log("records", recs.length);

// 1) floor x system
type Acc = { n: number; drawn: number; min: number[]; max: number[] };
const acc = new Map<string, Acc>();
for (const r of recs) {
  const k = `${floorKeyOf(r.floor)}|${r.system}`;
  let a = acc.get(k);
  if (!a) acc.set(k, (a = { n: 0, drawn: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
  a.n++;
  if (r.geometry.kind !== "group") {
    a.drawn++;
    const b = recordBounds(r);
    for (let i = 0; i < 3; i++) {
      a.min[i] = Math.min(a.min[i]!, b.min[i]!);
      a.max[i] = Math.max(a.max[i]!, b.max[i]!);
    }
  }
}
console.log("\n=== floor|system: records, drawn, bounds x[min,max] y[min,max] z[min,max] ===");
for (const [k, a] of [...acc].sort()) console.log(k.padEnd(20), String(a.n).padStart(6), String(a.drawn).padStart(6), `x[${f(a.min[0]!)},${f(a.max[0]!)}] y[${f(a.min[1]!)},${f(a.max[1]!)}] z[${f(a.min[2]!)},${f(a.max[2]!)}]`);

// 2) per system overall bounds
console.log("\n=== per system bounds (all floors) ===");
for (const sys of ["structure", "architecture", "plumbing", "electrical"]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let n = 0;
  for (const r of recs) if (r.system === sys && r.geometry.kind !== "group") { n++; const b = recordBounds(r); for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i]!, b.min[i]!); max[i] = Math.max(max[i]!, b.max[i]!); } }
  console.log(sys.padEnd(13), String(n).padStart(6), `x[${f(min[0]!)},${f(max[0]!)}] y[${f(min[1]!)},${f(max[1]!)}] z[${f(min[2]!)},${f(max[2]!)}]`);
}

// 3) floor field vs geometry: the y range each floor's drawn components occupy
console.log("\n=== per floor: y range of drawn components (all systems) ===");
for (const fl of [-1, 0, 1, 2, 3, 4, 5]) {
  const ys = recs.filter((r) => r.floor === fl && r.geometry.kind !== "group").map((r) => recordBounds(r));
  if (!ys.length) { console.log(fl, "none"); continue; }
  const lo = Math.min(...ys.map((b) => b.min[1]!)), hi = Math.max(...ys.map((b) => b.max[1]!));
  console.log("floor", String(fl).padStart(2), `y[${f(lo)},${f(hi)}]`, "components", ys.length);
}

// 4) records whose floor looks inconsistent with their position (below the previous level or above the next one)
const H = 3.6;
let odd = 0;
const oddByType = new Map<string, number>();
for (const r of recs) {
  if (r.geometry.kind === "group") continue;
  const b = recordBounds(r);
  const mid = (b.min[1]! + b.max[1]!) / 2;
  // expected storey of the midpoint: floor index k covers y in [k*H - 0.5, (k+1)*H - 0.5) roughly; flag > 1 storey away
  const k = Math.floor((mid + 0.5) / H);
  if (Math.abs(Math.max(-1, Math.min(5, k)) - r.floor) > 1) { odd++; oddByType.set(`${r.system}/${r.componentType}/f${r.floor}`, (oddByType.get(`${r.system}/${r.componentType}/f${r.floor}`) ?? 0) + 1); }
}
console.log("\ncomponents whose y-midpoint is more than 1 storey from their floor field:", odd);
for (const [k, n] of [...oddByType].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log("  ", String(n).padStart(6), k);

// 5) render path per system
const plain = recs.filter((r) => r.system === "structure" && r.geometry.kind !== "group").length;
const inst = recs.filter((r) => r.system !== "structure" && r.geometry.kind !== "group").length;
console.log("\nplain meshes (structure):", plain, " instanced:", inst, " groups:", recs.filter((r) => r.geometry.kind === "group").length);
console.log("structure geometry kinds:", Object.fromEntries([...new Set(recs.filter((r) => r.system === "structure").map((r) => r.geometry.kind))].map((k) => [k, recs.filter((r) => r.system === "structure" && r.geometry.kind === k).length])));
