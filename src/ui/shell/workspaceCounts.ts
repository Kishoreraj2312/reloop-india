/**
 * The small count on a top-bar tab: how many things the user has saved in that workspace (components assessed, removal plans,
 * scenarios, reuse requirements, components tracked). Only counts of saved items, shown when above zero; no figure is computed or
 * judged here, so a badge can never claim more than the workspace itself holds.
 */

import { useMemo, useSyncExternalStore } from "react";
import { recoveryStore } from "@/scene/recovery/recoveryStore";
import { removalStore } from "@/scene/removal/removalStore";
import { scenarioStore } from "@/scene/scenarios/scenarioStore";
import { reuseStore } from "@/scene/reuse/reuseStore";
import { trackingStore } from "@/scene/tracking/trackingStore";
import { subscribeAll, type WorkspaceId } from "./workspaces";

export interface TabCount {
  readonly count: number;
  /** "12 components assessed": the badge's tooltip and accessible text. */
  readonly label: string;
}

const NOUNS: Partial<Record<WorkspaceId, readonly [string, string]>> = {
  recovery: ["component assessed", "components assessed"],
  removal: ["removal plan", "removal plans"],
  scenarios: ["scenario", "scenarios"],
  reuse: ["reuse requirement", "reuse requirements"],
  tracking: ["component tracked", "components tracked"],
};

const key = (): string =>
  [recoveryStore.get().assessments.size, removalStore.get().plans.length, scenarioStore.get().scenarios.length, reuseStore.get().requirements.length, Object.keys(trackingStore.get().records).length].join("|");

export function useWorkspaceCounts(): Partial<Record<WorkspaceId, TabCount>> {
  const k = useSyncExternalStore(subscribeAll, key);
  return useMemo(() => {
    const [recovery, removal, scenarios, reuse, tracking] = k.split("|").map(Number) as [number, number, number, number, number];
    const raw: Partial<Record<WorkspaceId, number>> = { recovery, removal, scenarios, reuse, tracking };
    const out: Partial<Record<WorkspaceId, TabCount>> = {};
    for (const id of Object.keys(raw) as WorkspaceId[]) {
      const n = raw[id]!;
      const noun = NOUNS[id];
      if (n > 0 && noun) out[id] = { count: n, label: `${n.toLocaleString("en-US")} ${n === 1 ? noun[0] : noun[1]}` };
    }
    return out;
  }, [k]);
}
