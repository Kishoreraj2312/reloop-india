/**
 * Removal-simulation colours (B3): Okabe–Ito, colour-blind safe, shared by the legend, the list chips and the
 * 3D overlay so they always agree. Simulated-as-removed components are hidden, not coloured.
 */

export const REMOVAL_COLOURS = {
  planned: 0x0072b2, // blue
  blocked: 0xd55e00, // vermillion
  prerequisite: 0x009e73, // bluish green
  dependent: 0xcc79a7, // reddish purple
  advisory: 0xf0e442, // yellow
} as const;

export type RemovalColourKey = keyof typeof REMOVAL_COLOURS;

export const REMOVAL_LEGEND: readonly { key: RemovalColourKey | "removed"; label: string; hint: string }[] = [
  { key: "planned", label: "Planned", hint: "In the sequence, not yet simulated as removed" },
  { key: "blocked", label: "Blocked", hint: "A hard error is attached to the step (missing prerequisite, wrong order, cycle ...)" },
  { key: "prerequisite", label: "Prerequisite", hint: "Must be addressed before the selected step (blocking)" },
  { key: "dependent", label: "Dependent", hint: "Waits for the selected step (blocking)" },
  { key: "advisory", label: "Advisory", hint: "Related to the selected step; warns but does not block" },
  { key: "removed", label: "Simulated as removed", hint: "Hidden in the model while the simulation is shown" },
];

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;
