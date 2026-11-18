// Demo-data census: leaf components by system / type / material (counts), to design the demo project's rules.
import { DEFAULT_CONFIG } from "@/building/config";
import { getStructure } from "@/building/structure";
import { getArchitecture } from "@/building/architecture/generate";
import { getMep } from "@/building/mep/generate";

const records = [...getStructure(DEFAULT_CONFIG), ...getArchitecture(DEFAULT_CONFIG).records, ...getMep(DEFAULT_CONFIG).records];
const parents = new Set(records.map((r) => r.parentId).filter(Boolean));
const m = new Map<string, number>();
for (const r of records) {
  if (parents.has(r.id)) continue;
  const k = `${r.system}\t${r.componentType}\t${r.materialId}`;
  m.set(k, (m.get(k) ?? 0) + 1);
}
console.log([...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}\t${k}`).join("\n"));
console.log("leaves", [...m.values()].reduce((a, b) => a + b, 0), "records", records.length);
