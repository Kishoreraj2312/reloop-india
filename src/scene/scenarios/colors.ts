/**
 * Outcome colours (B4): the Okabe–Ito hues B2 already uses for direct reuse, refurbishment and recycling, plus vermillion for
 * disposal and a neutral grey for unknown (drawn with a hatch texture in charts, so no outcome is colour-alone). Shared by the
 * legend, the charts, the tables and the 3D highlight so they always agree. The four hues pass the data-viz palette check
 * (colour-blind separation, lightness band); the orange is below 3:1 on the panel, so every chart also carries visible labels
 * and a numeric table.
 */

import type { Pathway } from "@/engine/scenarios";

export const OUTCOME_COLOURS: Readonly<Record<Pathway, number>> = {
  direct_reuse: 0x009e73, // bluish green
  refurbish_reuse: 0xe69f00, // orange
  recycling: 0x0072b2, // blue
  disposal: 0xd55e00, // vermillion
  unknown: 0x8c96a0, // neutral grey
};

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
export const outcomeCss = (p: Pathway): string => hex(OUTCOME_COLOURS[p]);

/** CSS fill of an outcome: a solid colour, or a hatch for unknown. */
export const outcomeFill = (p: Pathway): string =>
  p === "unknown" ? `repeating-linear-gradient(135deg, ${hex(OUTCOME_COLOURS.unknown)} 0 2px, #dfe3e6 2px 5px)` : outcomeCss(p);
