/**
 * Tracking colours (C3): the Okabe–Ito hues B2 / B4 / C2 already use, so one colour keeps one meaning across the application: green =
 * reused, blue = recycled, vermillion = disposed, orange = work in hand. Stage tints are the 3D colours; the UI chips use darker shades of
 * the same hues (see tracking.css) so text stays legible. Every stage and quantity also has a label or a pattern: nothing is colour alone.
 */

import type { Status } from "@/engine/tracking";

export const STAGE_TINT: Readonly<Record<Status, number>> = {
  planned: 0x56b4e9, // sky blue: planned, nothing recorded
  in_progress: 0xe69f00, // orange: deconstruction under way
  recovered: 0xf0e442, // yellow: recovered, outcome pending
  inspected: 0xf0e442,
  allocated: 0xf0e442,
  reused: 0x009e73, // bluish green
  recycled: 0x0072b2, // blue
  disposed: 0xd55e00, // vermillion
  hold: 0x8c96a0, // grey: outcome unknown
};
/** A planned component nobody has started tracking, and a component with a flag in "flags" mode. */
export const UNTRACKED_TINT = 0xb9c6d2;
export const FLAG_TINT = { error: 0xd55e00, warning: 0xe69f00 } as const;

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
