/**
 * Generic starting suggestions per component category (B2). They are rules of thumb about what is
 * commonly feasible for that kind of material, shown as a hint the user can accept or ignore. They
 * carry no recovery rate and are not an assessment of any actual component.
 */

import type { ComponentRecord } from "@/building/structure";
import type { Category } from "@/engine/quantities";
import type { Classification } from "./types";

export interface Suggestion {
  readonly classification: Classification;
  /** Proposed recovery method. */
  readonly method: string;
  /** Potential reuse or recycling pathway. */
  readonly pathway: string;
  readonly rationale: string;
}

const s = (classification: Classification, method: string, pathway: string, rationale: string): Suggestion => ({ classification, method, pathway, rationale });

const STRUCTURAL = s("further_assessment", "Careful dismantling or saw-cutting after a structural survey", "Reuse as structural element only after qualified assessment; otherwise crush for aggregate", "Structural reuse needs evidence (drawings, testing, a qualified engineer); this tool cannot judge it");

const BY_CATEGORY: Readonly<Record<Category, Suggestion>> = {
  concrete: s("recycling", "Demolish, remove reinforcement, crush", "Recycled aggregate (sub-base, fill, new concrete where permitted)", "Plain or lightly reinforced concrete is commonly crushed for aggregate"),
  masonry: s("recycling", "Selective demolition; sort bricks from rubble", "Reclaimed brick if mortar can be cleaned, otherwise crushed fill", "Mortar and plaster limit brick reuse; crushed masonry is a common fallback"),
  stone: s("refurbish_reuse", "Lift carefully, clean, check for cracks", "Reclaimed stone for paving, sills or cladding", "Stone is durable and often reusable after cleaning or re-cutting"),
  tile_floor: s("recycling", "Scrape off screed bond; collect as ceramic waste", "Ceramic aggregate; reuse only if tiles lift unbroken", "Bonded tiles rarely survive removal intact"),
  tile_wall: s("recycling", "Remove with adhesive; collect as ceramic waste", "Ceramic aggregate", "Bonded wall tiles rarely survive removal intact"),
  screed: s("recycling", "Break out and crush with the slab finish", "Crushed fill / aggregate", "Cement screed has no direct reuse"),
  plaster: s("recycling", "Remove with the substrate", "Crushed fill", "Plaster is bonded to its substrate"),
  ceiling_board: s("recycling", "Unscrew boards, keep dry and separate", "Gypsum take-back / recycling", "Dry-lining boards can be recycled if kept clean and dry"),
  skirting: s("recycling", "Lever off, collect with floor tile", "Ceramic aggregate", "Same material and bond as floor tile"),
  glazing: s("recycling", "Remove panes intact, keep separate from frames", "Glass recycling; reuse of whole panes only if size and condition suit", "Glass is fully recyclable when separated"),
  glass_fixture: s("recycling", "Remove carefully, separate", "Glass recycling", "Mirrors and screens are glass with coatings or fixings"),
  timber: s("direct_reuse", "Unhang doors and frames without damage", "Reuse in another project or the same building", "Doors and frames are commonly re-hung; condition must be inspected"),
  board: s("refurbish_reuse", "Unhang, inspect, repair edges and finish", "Refurbish and reuse, else board recycling", "Laminate or composite leaves need repair before reuse"),
  metal: s("refurbish_reuse", "Unbolt or unscrew frames and rails", "Refurbish and reuse, else scrap metal recycling", "Aluminium and steel are readily recycled; frames can be refurbished"),
  sanitary: s("further_assessment", "Disconnect and remove whole", "Reuse if undamaged and meets current standards; else ceramic recycling", "Condition and standards compliance are unknown"),
  kitchen_unit: s("refurbish_reuse", "Detach units whole", "Refurbish and reuse, else board recycling", "Carcasses can be reused if undamaged"),
  appliance: s("further_assessment", "Disconnect and remove whole", "Reuse if tested; else WEEE recycling", "Function and age are unknown"),
  fitting: s("further_assessment", "Unscrew and remove", "Reuse if intact; else metal or plastics recycling", "Condition unknown"),
  pipe: s("recycling", "Cut out sections; sort by material", "Metal or plastics recycling", "Pipes are generally recycled by material"),
  cable: s("recycling", "Pull out and strip", "Copper and PVC recovery", "Conductor metal is commonly recovered"),
  containment: s("refurbish_reuse", "Unfasten trays and conduit", "Reuse trays if undamaged, else scrap metal / plastics recycling", "Trays are modular and can often be re-used"),
  mep_equipment: s("further_assessment", "Isolate, disconnect, remove whole", "Reuse if tested; else equipment or metal recycling", "Function is unknown; safety isolation is required"),
  mep_stub: s("insufficient_information", "-", "-", "A connection point has no recoverable material of its own"),
  roof_finish: s("recycling", "Strip layers", "Bitumen and aggregate recovery where available", "Composite layers are hard to separate"),
  assembly: s("further_assessment", "Assess the parts", "-", "Assessments are made on parts, not assemblies"),
  other: s("insufficient_information", "-", "-", "Category not recognised"),
};

export function suggestFor(rec: ComponentRecord, category: Category): Suggestion {
  if (rec.system === "structure") return STRUCTURAL;
  return BY_CATEGORY[category];
}
