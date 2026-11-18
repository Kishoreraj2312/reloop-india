/**
 * A4 census 4: the explode model on the real building: supported / unsupported assemblies per type with reasons, axes, and the
 * three system layouts (offsets and displayed bounds). Run: npx vite-node scripts/explode/census4.ts
 */
import { modelRecords } from "@/engine/quantities";
import { buildExplodeModel, solveOffsets, defaultParams, displayedBounds } from "@/engine/explode";
const t0 = performance.now();
const m = buildExplodeModel(modelRecords());
console.log("model build ms", Math.round(performance.now() - t0));
console.log("floors", m.floors.join(","), "rel", m.floorRel.join(","), "| systems", m.systems.join(","));
console.log("supported assemblies", m.assemblies.length, "members", m.memberAssembly.size, "| unsupported", m.unsupported.length, "| ungrouped", m.ungrouped.length);
const byType = new Map<string, { ok: number; no: number; reasons: Set<string>; layers: number[] }>();
for (const a of m.assemblies) { const e = byType.get(a.type) ?? byType.set(a.type, { ok: 0, no: 0, reasons: new Set(), layers: [] }).get(a.type)!; e.ok++; e.layers.push(a.layerCount); }
for (const u of m.unsupported) { const e = byType.get(u.type) ?? byType.set(u.type, { ok: 0, no: 0, reasons: new Set(), layers: [] }).get(u.type)!; e.no++; e.reasons.add(u.reason.slice(0, 70)); }
for (const [t, e] of [...byType].sort()) console.log(t.padEnd(30), "supported", String(e.ok).padStart(4), "unsupported", String(e.no).padStart(4), e.layers.length ? `layers ${Math.min(...e.layers)}..${Math.max(...e.layers)}` : "", [...e.reasons].join(" | "));
console.log("unassembled", JSON.stringify(Object.fromEntries(Object.entries(m.unassembled).map(([k, v]) => [k, v.count]))));
const axes = new Map<string, number>(); for (const a of m.assemblies) axes.set(`${a.kind}:${a.axis?.join(",") ?? "radial"}:${a.axisSource.slice(0, 22)}`, (axes.get(`${a.kind}:${a.axis?.join(",") ?? "radial"}:${a.axisSource.slice(0, 22)}`) ?? 0) + 1);
console.log([...axes].sort());
for (const layout of ["row-x", "row-z", "grid"] as const) {
  const s = solveOffsets(m, { ...defaultParams(), mode: "systems", t: 1, layout });
  const b = displayedBounds(m, s);
  console.log(layout.padEnd(6), m.systems.map((sys, i) => `${sys}:(${s.systemOffset[i * 3]!.toFixed(1)},${s.systemOffset[i * 3 + 2]!.toFixed(1)})`).join(" "), "| displayed bounds x", b.min[0].toFixed(1), b.max[0].toFixed(1), "z", b.min[2].toFixed(1), b.max[2].toFixed(1));
}
const full = solveOffsets(m, { ...defaultParams(), mode: "cinematic", t: 1 });
const b = displayedBounds(m, full);
console.log("cinematic full bounds", b.min.map((v) => v.toFixed(1)), b.max.map((v) => v.toFixed(1)), "maxAsmDisp", full.maxAssemblyDisplacement.toFixed(2));
