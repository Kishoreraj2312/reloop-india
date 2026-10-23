/**
 * Product counts (B1). Products are counted by their ASSEMBLY (a window is one window, not its
 * frame + sashes + glass + handles), or by the single part that is the product (a WC pan).
 * Segment counts (balusters, posts) are reported separately and labelled as segments.
 */

import type { ComponentRecord } from "@/building/structure";
import { result } from "./geometry";
import type { QuantityResult } from "./types";

export interface CountRule {
  readonly key: string;
  readonly label: string;
  readonly segments?: true;
  readonly rule: string;
  readonly match: (r: ComponentRecord) => boolean;
}

const group = (assemblyType: string) => (r: ComponentRecord) => r.geometry.kind === "group" && r.assemblyType === assemblyType;
const part = (componentType: string) => (r: ComponentRecord) => r.geometry.kind !== "group" && r.componentType === componentType;

export const COUNT_RULES: readonly CountRule[] = [
  { key: "doors", label: "Doors", rule: "door assemblies (assemblyType door; cased openings counted separately)", match: group("door") },
  { key: "cased_openings", label: "Cased openings", rule: "cased-opening assemblies (no leaf)", match: group("cased_opening") },
  { key: "windows", label: "Windows", rule: "window assemblies", match: group("window") },
  { key: "kitchens", label: "Kitchens", rule: "kitchen assemblies", match: group("kitchen") },
  { key: "wc", label: "WC pans", rule: "wc_pan parts", match: part("wc_pan") },
  { key: "basins", label: "Wash basins", rule: "basin parts", match: part("basin") },
  { key: "shower_trays", label: "Shower trays", rule: "shower_tray parts", match: part("shower_tray") },
  { key: "washers", label: "Washing machines", rule: "appliance_washer parts", match: part("appliance_washer") },
  { key: "balcony_railings", label: "Balconies with railing", rule: "balcony assemblies (assemblyType balcony; canopies excluded)", match: group("balcony") },
  { key: "stair_balustrades", label: "Stair balustrades", rule: "stair_handrail parts (one handrail per flight side)", match: part("stair_handrail") },
  { key: "light_fittings", label: "Light fittings", rule: "parts whose componentType starts with light_", match: (r) => r.geometry.kind !== "group" && r.componentType.startsWith("light_") },
  { key: "balusters", label: "Balusters (segments)", segments: true, rule: "balcony_baluster + stair_baluster parts; segments, not products", match: (r) => r.geometry.kind !== "group" && (r.componentType === "balcony_baluster" || r.componentType === "stair_baluster") },
  { key: "posts", label: "Railing posts (segments)", segments: true, rule: "balcony_post parts; segments, not products", match: part("balcony_post") },
];

export interface ProductCount {
  readonly key: string;
  readonly label: string;
  readonly segments: boolean;
  readonly result: QuantityResult;
}

export type ProductCounts = readonly ProductCount[];

/** Counts for any set of records (the whole building, or the descendants of one assembly). */
export function countProducts(records: Iterable<ComponentRecord>): ProductCounts {
  const ids = COUNT_RULES.map<string[]>(() => []);
  for (const r of records) COUNT_RULES.forEach((c, i) => c.match(r) && ids[i]!.push(r.id));
  return COUNT_RULES.map((c, i) => ({
    key: c.key,
    label: c.label,
    segments: c.segments === true,
    result: result("count", ids[i]!.length, "calculated", `count: ${c.rule}`, ids[i]!),
  }));
}

export const countOf = (counts: ProductCounts, key: string): number => counts.find((c) => c.key === key)?.result.value ?? 0;
