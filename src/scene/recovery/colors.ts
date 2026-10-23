/**
 * Recovery colours (B2): the Okabe–Ito colour-blind-safe palette, one hue per classification, plus
 * neutrals for "not assessed" and "outside the current filter". Used by the legend, the table dots and
 * the 3D overlay, so they always agree.
 */

import type { Classification } from "@/engine/recovery";

export const STATUS_COLOURS: Readonly<Record<Classification | "unassessed" | "dimmed", number>> = {
  direct_reuse: 0x009e73, // bluish green
  refurbish_reuse: 0xe69f00, // orange
  recycling: 0x0072b2, // blue
  further_assessment: 0xcc79a7, // reddish purple
  insufficient_information: 0x7a7a7a, // dark grey (with a hatch-free, distinct lightness)
  unassessed: 0xbfc4c9, // light neutral
  dimmed: 0xe4e6e8, // outside the filter
};

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
