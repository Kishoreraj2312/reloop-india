/**
 * Recycle guide (pure): six material groups with short, general suggestions for how each can be recycled, and how much of each the
 * model holds (B1 components and estimated mass). The suggestions are common practice written for orientation, NOT an assessment of
 * this building's material, and local rules, available plants and the material's actual condition decide what is possible.
 */

import type { Category, Inventory } from "@/engine/quantities";

export interface RecycleGroup {
  readonly id: string;
  readonly name: string;
  /** The B1 categories of the model that belong to this group. */
  readonly categories: readonly Category[];
  /** One line: the best route. */
  readonly route: string;
  /** Typical ways to recycle it. */
  readonly ways: readonly string[];
  /** What to watch for. */
  readonly watch: string;
}

export const RECYCLE_GROUPS: readonly RecycleGroup[] = [
  {
    id: "concrete",
    name: "Concrete",
    categories: ["concrete", "screed"],
    route: "Crush to recycled aggregate",
    ways: ["Crushed and graded as sub-base for roads, paths and car parks", "Part-replaces new aggregate in non-structural concrete, blocks and paving", "Clean fill and drainage layers"],
    watch: "Pull out the reinforcement first (sold as steel scrap) and keep plaster, wood and plastics out of the crusher feed.",
  },
  {
    id: "masonry",
    name: "Brick & masonry",
    categories: ["masonry"],
    route: "Reuse whole bricks first, crush the rest",
    ways: ["Whole bricks cleaned of mortar and reused in garden walls and infill", "Crushed for sub-base, levelling and landscaping fill", "Brick dust (surkhi) as an additive in lime mortar and plaster"],
    watch: "Lime mortar cleans off far more easily than cement mortar; sort brick from concrete before crushing.",
  },
  {
    id: "metals",
    name: "Metals",
    categories: ["metal"],
    route: "Sort by type and sell as scrap",
    ways: ["Steel frames and rails to a steel mill or scrap dealer for remelting", "Aluminium frames remelted into new profiles (it keeps its value indefinitely)", "Copper, brass and stainless steel kept apart for the highest scrap price"],
    watch: "Remove glass, gaskets and coatings, and keep different metals separate: mixed loads are worth much less.",
  },
  {
    id: "glass",
    name: "Glass",
    categories: ["glazing", "glass_fixture"],
    route: "Keep panes whole and clean for the glass recycler",
    ways: ["Clear flat glass remelted into new glass", "Mixed or broken glass crushed into cullet for bottles and glass fibre", "Cullet as a filler in tiles and some paving"],
    watch: "Laminated, wired and coated glass must be separated or sent to a specialist; frames and sealant come off first.",
  },
  {
    id: "timber",
    name: "Timber & board joinery",
    categories: ["timber", "board"],
    route: "Reuse sound joinery, chip the rest",
    ways: ["Doors and frames refurbished and rehung", "Clean offcuts chipped for particleboard and MDF", "Chips as mulch or biomass fuel where the wood is untreated"],
    watch: "Painted or preservative-treated wood must not go to mulch or open burning; remove hardware and glue-heavy laminate first.",
  },
  {
    id: "ceramics",
    name: "Tiles, ceramics & stone",
    categories: ["tile_floor", "tile_wall", "stone", "sanitary"],
    route: "Reuse stone, crush ceramics",
    ways: ["Stone sills, coping and paving cleaned and reused whole", "Crushed tiles and sanitary ware as aggregate, drainage fill and sub-base", "Sound tiles sold on or reused for paths and landscaping"],
    watch: "Keep tile adhesive and cement out of the stone for reuse; the mixed crush is best used as fill, not in concrete.",
  },
];

export interface GroupTotals {
  readonly components: number;
  /** Estimated mass in tonnes (B1 densities x modelled volume); components without a mass estimate add nothing. */
  readonly tonnes: number;
  /** How many of the components have a mass estimate. */
  readonly withMass: number;
  /** True when most components have a mass estimate; otherwise the tonnage would understate the group, so it is not shown. */
  readonly massReliable: boolean;
}

/** What the model holds of each group (B1 leaves; nothing is recomputed, and a group with no mass estimate says so). */
export function groupTotals(inv: Inventory): ReadonlyMap<string, GroupTotals> {
  const of = new Map<Category, string>();
  for (const g of RECYCLE_GROUPS) for (const c of g.categories) of.set(c, g.id);
  const acc = new Map<string, { components: number; kg: number; withMass: number }>(RECYCLE_GROUPS.map((g) => [g.id, { components: 0, kg: 0, withMass: 0 }]));
  for (const r of inv.rows) {
    const id = of.get(r.q.category);
    if (!id) continue;
    const a = acc.get(id)!;
    a.components++;
    const kg = r.q.mass.value;
    if (kg !== null && Number.isFinite(kg)) {
      a.kg += kg;
      a.withMass++;
    }
  }
  return new Map([...acc].map(([id, a]) => [id, { components: a.components, tonnes: a.kg / 1000, withMass: a.withMass, massReliable: a.withMass >= a.components * 0.5 }]));
}
