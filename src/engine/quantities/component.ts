/**
 * Quantities of ONE record (B1): primary (in the record's own unit), secondary measures and an
 * estimated mass. Pure function of the record; assemblies get a count of one and no physical
 * quantities (their parts carry them).
 */

import type { ComponentRecord } from "@/building/structure";
import { classify } from "./classify";
import { areaResult, countResult, issue, lengthResult, matchesRecord, prismPlanArea, rawVolume, result, unavailable, volumeResult } from "./geometry";
import { densityFor, type DensityLookup } from "./materialProps";
import type { Category, ComponentQuantities, QuantityIssue, QuantityResult } from "./types";

const withIssues = (r: QuantityResult, extra: readonly QuantityIssue[]): QuantityResult => (extra.length === 0 ? r : { ...r, issues: [...r.issues, ...extra] });

function primaryFor(rec: ComponentRecord): QuantityResult {
  switch (rec.unit) {
    case "m3":
      return volumeResult(rec);
    case "m2":
      return areaResult(rec);
    case "m":
      return lengthResult(rec);
    case "nr":
    case "pcs":
      return countResult(rec);
    default:
      return unavailable("count", "unsupported unit", [rec.id], [issue("INVALID_VALUE", `${rec.id}: unit "${rec.unit}" is not supported by the quantity engine`, rec.id)]);
  }
}

function assemblyQuantities(rec: ComponentRecord, category: Category): ComponentQuantities {
  return {
    id: rec.id,
    category,
    primary: result("count", 1, "calculated", "assembly counted as one item; physical quantities are summed from its parts", [rec.id]),
    secondary: [],
    mass: unavailable("mass", "assembly: roll up its parts", [rec.id], [issue("NOT_MODELLED", "an assembly has no mass of its own; see the roll-up of its parts", rec.id, "info")]),
    solidVolumeM3: null,
  };
}

function massFor(rec: ComponentRecord, category: Category, volume: number | null, lookup: DensityLookup): QuantityResult {
  const ids = [rec.id];
  if (lookup.densityKgM3 === null) {
    const policy = lookup.props !== undefined; // a documented "no mass" decision, not a missing table entry
    return unavailable("mass", "volume × density", ids, [issue("NO_DENSITY", lookup.reason, rec.id, policy ? "info" : "warning")], lookup.props ? [lookup.props.source] : []);
  }
  if (volume === null) return unavailable("mass", "volume × density", ids, [issue("INVALID_VALUE", `${rec.id}: no valid volume to multiply by density`, rec.id)]);
  const p = lookup.props!;
  const assumptions = [`density ${lookup.densityKgM3} kg/m3 (${p.basis}: ${p.source})`];
  if (p.note) assumptions.push(p.note);
  if (category === "concrete") assumptions.push("reinforcement steel is not modelled and not included");
  return result("mass", volume * lookup.densityKgM3, "estimated", "modelled solid volume × density", ids, assumptions);
}

export function computeComponent(rec: ComponentRecord): ComponentQuantities {
  const cls = classify(rec);
  if (rec.geometry.kind === "group") return assemblyQuantities(rec, cls.category);

  const extra: QuantityIssue[] = [];
  if (!cls.classified) extra.push(issue("UNCLASSIFIED", `${rec.id}: componentType "${rec.componentType}" has no category`, rec.id));
  let primary = primaryFor(rec);
  if (primary.value !== null && !matchesRecord(primary.value, rec.quantity)) {
    extra.push(issue("RECORD_MISMATCH", `${rec.id}: recomputed ${primary.value} ${primary.unit} differs from record.quantity ${rec.quantity} ${rec.unit}`, rec.id));
  }
  primary = withIssues(primary, extra);

  const vol = rawVolume(rec.geometry);
  const lookup = densityFor(rec.componentType, rec.geometry.kind, rec.materialId);
  const mass = massFor(rec, cls.category, vol, lookup);

  const secondary: QuantityResult[] = [];
  // A volume is only reported next to a non-volume primary when the item is a real solid (it has a density).
  if (rec.unit !== "m3" && lookup.densityKgM3 !== null && vol !== null) secondary.push(volumeResult(rec));
  const plan = rec.unit === "m3" ? prismPlanArea(rec.geometry) : null;
  if (plan !== null) secondary.push(result("area", plan, "calculated", "prism plan area (polygon, shoelace)", [rec.id]));

  return {
    id: rec.id,
    category: cls.category,
    primary,
    secondary,
    mass,
    solidVolumeM3: rec.geometry.kind === "part" ? null : vol,
  };
}
