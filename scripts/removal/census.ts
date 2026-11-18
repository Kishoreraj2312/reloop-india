/**
 * B3 relationship census: tabulates every `dependencies`, `parentId` and `connectedTo` edge of the generated
 * model by (source kind -> target kind), and checks referential integrity, symmetry and cycles.
 * Run: npx vite-node scripts/removal/census.ts
 */
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { getMep } from "@/building/mep/generate";

const records = [...getStructure(DEFAULT_CONFIG), ...getArchitecture(DEFAULT_CONFIG).records, ...getMep(DEFAULT_CONFIG).records];
const byId = new Map(records.map((r) => [r.id, r]));
const kind = (id: string): string => {
  const r = byId.get(id);
  if (!r) return "MISSING";
  return `${r.system}/${r.componentType}`;
};

function tally(field: "dependencies" | "parentId" | "connectedTo") {
  const t = new Map<string, number>();
  let missing = 0;
  let edges = 0;
  for (const r of records) {
    const targets = field === "parentId" ? (r.parentId ? [r.parentId] : []) : (r[field] ?? []);
    for (const x of targets) {
      edges++;
      if (!byId.has(x)) missing++;
      const k = `${kind(r.id)}  ->  ${kind(x)}`;
      t.set(k, (t.get(k) ?? 0) + 1);
    }
  }
  console.log(`\n=== ${field}: ${edges} edges, ${missing} dangling ===`);
  for (const [k, n] of [...t].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(7), k);
}
console.log("records", records.length);
for (const f of ["dependencies", "parentId", "connectedTo"] as const) tally(f);

// symmetry of connectedTo
let asym = 0;
for (const r of records) for (const x of r.connectedTo ?? []) if (!byId.get(x)?.connectedTo?.includes(r.id)) asym++;
console.log("\nconnectedTo asymmetric edges:", asym);

// self-references and cycles in dependencies / parentId
function cycles(next: (id: string) => readonly string[]): string[][] {
  const state = new Map<string, 0 | 1 | 2>();
  const out: string[][] = [];
  for (const r of records) {
    if (state.get(r.id)) continue;
    const stack: [string, number][] = [[r.id, 0]];
    const path: string[] = [];
    state.set(r.id, 1);
    path.push(r.id);
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const ns = next(top[0]).filter((n) => byId.has(n));
      if (top[1] < ns.length) {
        const n = ns[top[1]++]!;
        const s = state.get(n);
        if (s === 1) out.push([...path.slice(path.indexOf(n)), n]);
        else if (!s) {
          state.set(n, 1);
          path.push(n);
          stack.push([n, 0]);
        }
      } else {
        state.set(top[0], 2);
        path.pop();
        stack.pop();
      }
    }
  }
  return out;
}
const dc = cycles((id) => byId.get(id)!.dependencies);
const pc = cycles((id) => (byId.get(id)!.parentId ? [byId.get(id)!.parentId!] : []));
console.log("dependency cycles:", dc.length, dc.slice(0, 3));
console.log("parentId cycles:", pc.length);
// examples
const ex = new Map<string, string>();
for (const r of records) for (const x of r.dependencies) { const k = `${kind(r.id)} -> ${kind(x)}`; if (!ex.has(k)) ex.set(k, `${r.id} -> ${x}`); }
console.log("\nexamples (dependencies):");
for (const [k, v] of ex) console.log("  ", k.padEnd(60), v);
const exp = new Map<string, string>();
for (const r of records) if (r.parentId) { const k = `${kind(r.id)} -> ${kind(r.parentId)}`; if (!exp.has(k)) exp.set(k, `${r.id} -> ${r.parentId}`); }
console.log("\nexamples (parentId):");
for (const [k, v] of exp) console.log("  ", k.padEnd(60), v);

// ── how the B3 adapters classify every raw relationship ─────────────────────────────────────
import { dependencyEdge, getModelGraph } from "@/engine/removal";
const graph = getModelGraph();
const cls = new Map<string, number>();
for (const r of records) {
  const s = graph.node(r.id)!;
  for (const d of r.dependencies) {
    const e = dependencyEdge(s, graph.node(d));
    const k = e ? `${e.relationship} / ${e.severity}${e.directed ? "" : " (undirected)"}` : "dropped";
    cls.set(k, (cls.get(k) ?? 0) + 1);
  }
}
console.log("\n=== adapter classification of the raw `dependencies` edges ===");
for (const [k, n] of [...cls].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(7), k);
const pairs = new Set<string>();
for (const r of records) for (const c of r.connectedTo ?? []) pairs.add(r.id < c ? `${r.id}|${c}` : `${c}|${r.id}`);
console.log("connectedTo unique physical joints (undirected, no order):", pairs.size);
const groups = records.filter((r) => graph.isGroup(r.id));
let contained = 0;
for (const r of records) if (graph.containerOf(r.id)) contained++;
console.log(`assemblies (group records): ${groups.length}; records contained in one: ${contained}; parentId edges that are NOT containment: ${records.filter((r) => r.parentId && !graph.containerOf(r.id)).length}`);
const structParent = records.filter((r) => r.system === "structure" && r.parentId);
console.log("structure parentId edges:", structParent.length, "- all also listed in dependencies:", structParent.every((r) => r.dependencies.includes(r.parentId!)));
