/**
 * The 10-minute demo tour: used by presentation mode instead of the A5 guided demonstration while the demo project is loaded
 * (src/demo). Four steps, eleven scenes of about 55 s, one per module: the digital twin (model, exploded floors, services), inventory
 * and recovery (B1, B2), planning deconstruction (B3, B4, B5) and circular material flows (C1, C2, C3). Each scene is a plan for the
 * existing features; the captions quote the live stores' own counts and say the inputs are illustrative.
 */

import { registry } from "@/building/registry";
import { recoveryStore } from "../recovery/recoveryStore";
import { removalStore } from "../removal/removalStore";
import { scenarioStore } from "../scenarios/scenarioStore";
import { carbonStore } from "../carbon/carbonStore";
import { passportStore } from "../passport/passportStore";
import { reuseStore } from "../reuse/reuseStore";
import { trackingStore } from "../tracking/trackingStore";
import { presetById, type GuidedScene, type GuidedStep, type PresetId, type ScenePlan } from "./presets";

const n = (x: number) => x.toLocaleString("en-US");

const scene = (id: string, label: string, preset: PresetId, caption: GuidedScene["caption"], patch: Partial<ScenePlan> = {}): GuidedScene => ({
  id: `demo:${id}`,
  label,
  plan: (ctx) => ({ drawer: null, recoveryColour: false, ...presetById(preset).plan(ctx), ...patch }),
  caption,
});

/** The passport scene looks at the first component with a demo passport note (a south-facing balcony handrail), from close by. */
function passportScene(): GuidedScene {
  return {
    id: "demo:passport",
    label: "Passport",
    plan: (ctx) => {
      const base: ScenePlan = { drawer: null, recoveryColour: false, ...presetById("hero").plan(ctx) };
      const id = [...passportStore.get().meta.keys()][0];
      const rec = id ? registry.getById(id) : undefined;
      if (!id || !rec) return base;
      const p = rec.originalPosition;
      return { ...base, pose: { position: [p[0] + 7, p[1] + 2, p[2] - 10], target: [p[0], p[1], p[2]] }, select: id, details: true };
    },
    caption: () =>
      `Every component has a material passport composed from the modules: identity, quantities, recovery, removal step, carbon, reuse and tracking. ${n(passportStore.get().meta.size)} components carry demo inspection notes; the rest of each passport is derived.`,
  };
}

export const DEMO_STEPS: readonly GuidedStep[] = [
  {
    id: "twin",
    title: "The digital twin",
    scenes: [
      scene("hero", "Building", "hero", (f) => `A G+${f.storeys - 1} residential block, ${f.size[0].toFixed(0)} × ${f.size[2].toFixed(0)} m on plan: ${n(f.total)} components, each with a stable ID, geometry, material and links to its assembly.`),
      scene("exploded", "Exploded", "exploded", () => `Floors separated to show how the building is put together. A display transform only: positions, records and quantities are unchanged.`),
      scene("mep", "Services", "mep", (f) => `Plumbing and electrical modelled as real parts: ${n(f.bySystem.plumbing)} plumbing and ${n(f.bySystem.electrical)} electrical components (conceptual routing).`),
    ],
  },
  {
    id: "materials",
    title: "Inventory & recovery",
    scenes: [
      scene("inventory", "Inventory", "hero", () => `The material inventory is taken off the geometry: volumes, areas, lengths, counts and estimated mass by material, floor and system.`, { drawer: "inventory" }),
      scene("recovery", "Recovery", "hero", () => `Demo assessments on ${n(recoveryStore.get().assessments.size)} components: reuse, refurbishment, recycling or further assessment, with a recovery %. The model is coloured by classification.`, { drawer: "recovery", recoveryColour: true }),
    ],
  },
  {
    id: "planning",
    title: "Planning deconstruction",
    scenes: [
      scene("removal", "Sequence", "hero", () => {
        const p = removalStore.get().plans[0];
        return `A removal sequence for the top storey (${p ? n(p.entries.length) : 0} steps), ordered by the model's dependencies; the simulation hides what has been taken out so far.`;
      }, { drawer: "removal", removalStep: 40 }),
      scene("scenarios", "Scenarios", "hero", () => `${n(scenarioStore.get().scenarios.length)} end-of-life scenarios on the same quantities: conventional demolition, selective deconstruction and reuse-first, side by side.`, { drawer: "scenarios" }),
      scene("carbon", "Carbon", "hero", () => `Embodied-carbon estimates per scenario from ${n(carbonStore.get().factors.size)} emission factors. The factors here are the labelled illustrative set, not sourced values.`, { drawer: "carbon" }),
    ],
  },
  {
    id: "circular",
    title: "Circular material flows",
    scenes: [
      passportScene(),
      scene("reuse", "Reuse", "hero", () => {
        const r = reuseStore.get();
        return `${n(r.requirements.length)} needs of receiving projects matched against the recoverable stock; ${n(r.allocations.length)} components allocated, each with its match conditions.`;
      }, { drawer: "reuse", reuseTab: "allocation" }),
      scene("tracking", "Tracking", "hero", () => `Recovery tracked per component as an event history: ${n(Object.keys(trackingStore.get().records).length)} components on the top storeys, recovered, reused, recycled or in progress, with every quantity's source stated.`, { drawer: "tracking", trackingTab: "report" }),
    ],
  },
];
