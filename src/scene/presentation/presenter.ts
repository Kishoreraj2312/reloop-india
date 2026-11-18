/**
 * The presentation controller's side effects, kept out of the React component: take a snapshot of the application's view state when
 * presentation mode starts, apply a scene plan to the EXISTING features (view state, section plane, exploded view, drawers,
 * recovery colouring, camera), and restore the snapshot on exit. It drives the same stores the normal interface drives; it never
 * writes records, quantities, B2 assessments or B3 plans.
 */

import { PRESET_T, explodeStore, type ExplodeSnapshot } from "../explode/explodeStore";
import { explodeBridge } from "../explode/bridge";
import { inventoryUi } from "../inventory/inventoryStore";
import { recoveryStore } from "../recovery/recoveryStore";
import { removalStore } from "../removal/removalStore";
import { scenarioStore } from "../scenarios/scenarioStore";
import { carbonStore } from "../carbon/carbonStore";
import { reuseStore } from "../reuse/reuseStore";
import { trackingStore } from "../tracking/trackingStore";
import type { ClipSpec, Insets, V3 } from "../framing";
import type { FrameOptions } from "../explode/bridge";
import { HERO_DIR } from "../framing";
import type { ViewState } from "../viewState";
import { cameraBridge } from "./cameraBridge";
import type { Pose } from "./cameraPath";
import type { Drawer, ScenePlan } from "./presets";

/** What the application looked like before presentation mode, so exiting puts everything back. */
export interface Snapshot {
  readonly view: ViewState;
  readonly clip: ClipSpec | null | undefined;
  readonly selected: string | null;
  readonly pose: Pose | null;
  readonly explode: ExplodeSnapshot;
  readonly recoveryColour: boolean;
  readonly recoveryOpen: boolean;
  readonly removalOpen: boolean;
  readonly removalOverlay: boolean;
  readonly inventoryOpen: boolean;
  /** The B4 scenario workspace (wider than the other drawers): presentation mode closes it and exit reopens it. */
  readonly scenariosOpen: boolean;
  /** The B5 carbon workspace: closed while presenting, restored on exit. */
  readonly carbonOpen: boolean;
  /** The C2 reuse workspace: closed while presenting, restored on exit. */
  readonly reuseOpen: boolean;
  /** The C3 tracking workspace: closed while presenting, restored on exit. */
  readonly trackingOpen: boolean;
}

/** The React-owned state the presenter reads and writes through. */
export interface Host {
  setView(v: ViewState): void;
  setClip(c: ClipSpec | null | undefined): void;
  select(id: string | null): void;
}

export function takeSnapshot(view: ViewState, clip: ClipSpec | null | undefined, selected: string | null): Snapshot {
  const rec = recoveryStore.get();
  const rem = removalStore.get();
  return {
    view,
    clip,
    selected,
    pose: cameraBridge.current?.() ?? null,
    explode: explodeStore.snapshot(),
    recoveryColour: rec.colour,
    recoveryOpen: rec.open,
    removalOpen: rem.open,
    removalOverlay: rem.overlay,
    inventoryOpen: inventoryUi.get(),
    scenariosOpen: scenarioStore.get().open,
    carbonOpen: carbonStore.get().open,
    reuseOpen: reuseStore.get().open,
    trackingOpen: trackingStore.get().open,
  };
}

/** Put the application back exactly as it was; the camera glides home unless `instant`. */
export function restoreSnapshot(snap: Snapshot, host: Host, instant = false): void {
  host.setView(snap.view);
  host.setClip(snap.clip);
  host.select(snap.selected);
  explodeStore.restore(snap.explode);
  recoveryStore.setColour(snap.recoveryColour);
  recoveryStore.setOpen(snap.recoveryOpen);
  removalStore.setOpen(snap.removalOpen);
  removalStore.setOverlay(snap.removalOverlay);
  inventoryUi.set(snap.inventoryOpen);
  scenarioStore.setOpen(snap.scenariosOpen);
  carbonStore.setOpen(snap.carbonOpen);
  reuseStore.setOpen(snap.reuseOpen);
  trackingStore.setOpen(snap.trackingOpen);
  if (snap.pose) {
    if (instant) cameraBridge.jumpTo?.(snap.pose);
    else void cameraBridge.flyTo?.(snap.pose, 900);
  }
}

/**
 * Framing options for the exploded model. The bottom gets 28 px more than the toolbar strip: a tall stack is deeper than it is wide, and
 * sliding a perspective camera sideways moves the nearer corners further than the centre, so the exact fit alone would touch the bar.
 */
export function explodeFraming(insets: Insets, direction: V3): FrameOptions {
  return { bottomInset: (insets.bottom ?? 0) + 28, rightInset: insets.right ?? 0, leftInset: insets.left ?? 0, topInset: insets.top ?? 0, direction };
}

export function setDrawer(d: Drawer): void {
  scenarioStore.setOpen(false);
  carbonStore.setOpen(false);
  reuseStore.setOpen(false);
  trackingStore.setOpen(false);
  inventoryUi.set(d === "inventory");
  recoveryStore.setOpen(d === "recovery");
  removalStore.setOpen(d === "removal");
  // the wide workspaces last: C2 / C3 close themselves when another drawer opens after them
  if (d === "scenarios") scenarioStore.setOpen(true);
  else if (d === "carbon") carbonStore.setOpen(true);
  else if (d === "reuse") reuseStore.setOpen(true);
  else if (d === "tracking") trackingStore.setOpen(true);
}

/** True when any of the three drawers is open (they share the right-hand column). */
export const drawerOpenNow = (): boolean => inventoryUi.get() || recoveryStore.get().open || removalStore.get().open;

/** Resolve when the explode progress stops gliding (it also ends if anything else takes over the progress). */
function glideEnd(): Promise<void> {
  return new Promise((resolve) => {
    if (!explodeStore.get().gliding) return resolve();
    const off = explodeStore.subscribe(() => {
      if (!explodeStore.get().gliding) {
        off();
        resolve();
      }
    });
  });
}

export interface ApplyEnv {
  /** False once a newer request has superseded this one (long steps stop touching the app). */
  readonly isCurrent: () => boolean;
  /** The framing insets for the current UI (toolbar, an open drawer). */
  readonly insets: () => Insets;
}

/**
 * Apply a plan. Returns when the explode transition (if any) has finished; the camera flight runs alongside it. Mode changes inside
 * the exploded view first close the explosion in the old mode, so nothing jumps.
 */
export async function applyPlan(plan: ScenePlan, host: Host, env: ApplyEnv): Promise<void> {
  host.select(null);
  host.setView(plan.view);
  host.setClip(plan.clip);
  if (plan.drawer !== undefined) setDrawer(plan.drawer);
  if (plan.recoveryColour !== undefined) {
    // the B2 colouring only ever shows assessments the user entered: with none, it stays off rather than painting everything "unassessed"
    recoveryStore.setColour(plan.recoveryColour && recoveryStore.get().assessments.size > 0);
  }
  if (plan.removalStep !== undefined && removalStore.get().plans.length > 0) {
    // the B3 simulation of an EXISTING plan (never one created here), shown in the model
    removalStore.setOverlay(true);
    removalStore.goTo(plan.removalStep);
  }
  if (plan.reuseTab) reuseStore.setTab(plan.reuseTab);
  if (plan.trackingTab) trackingStore.setTab(plan.trackingTab);
  if (plan.select) host.select(plan.select);

  const ex = plan.explode;
  if (ex) {
    const wasOpen = explodeStore.get().open;
    explodeStore.setOpen(true);
    const exploded = wasOpen && explodeStore.liveT() > 0;
    const modeChange = explodeStore.get().params.mode !== ex.mode;
    // frame the FINAL exploded model and fly there while the explosion glides
    const finalParams = { ...explodeStore.get().params, mode: ex.mode, t: ex.play ? 1 : PRESET_T[ex.preset] };
    const fp = explodeBridge.fitPose?.(explodeFraming(env.insets(), plan.explodeDirection ?? HERO_DIR), finalParams);
    if (fp) void cameraBridge.flyTo?.({ position: fp.position, target: fp.target }, exploded && modeChange ? 2000 : 1500, fp.maxDistance);
    if (exploded && modeChange) {
      explodeStore.glidePreset("assembled", 0.6);
      await glideEnd();
      if (!env.isCurrent()) return;
    }
    explodeStore.setMode(ex.mode);
    if (ex.play) {
      explodeStore.setT(0);
      explodeStore.play();
    } else {
      explodeStore.glidePreset(ex.preset, 1.3);
      await glideEnd();
    }
    return;
  }

  if (plan.pose) void cameraBridge.flyTo?.(plan.pose);
  if (explodeStore.get().open) {
    if (explodeStore.liveT() > 0) {
      explodeStore.glidePreset("assembled", 1.0);
      await glideEnd();
      if (!env.isCurrent()) return;
    }
    explodeStore.setOpen(false); // closing resets to the canonical, assembled state
  }
}
