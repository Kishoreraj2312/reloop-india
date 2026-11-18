/**
 * Presentation mode (A5): an interface layer over the one running viewer, for live demonstrations. It is not a second viewer and
 * keeps no data of its own: every preset and guided step applies a plan (presets.ts) to the existing features through the same
 * stores and view state the normal interface uses, then hands the camera straight back to the presenter.
 *
 *   clean canvas      the top bar and the sidebar are hidden (a workspace docked on the right and the exploded view keep working), Exit restores
 *                     the previous view state, selection, exploded view, drawers, recovery colouring and camera
 *   camera presets    Hero, Front, Plan, Floor, Exploded, MEP, Section, framed from the actual scene bounds
 *   guided steps      five optional steps built from the live model; Next / Previous / Repeat / auto-advance (pauses on any
 *                     camera interaction or button press); nothing runs unless the presenter asks
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentRecord } from "@/building/structure";
import { DEFAULT_CONFIG } from "@/building/config";
import { ComponentInspector } from "../ComponentInspector";
import { NARROW_DOCK, WIDE_DOCK, layoutStore, shellGeometry } from "@/ui/shell/layoutStore";
import { inventoryUi, useInventoryOpen } from "../inventory/inventoryStore";
import { explodeBridge } from "../explode/bridge";
import { explodeStore, useExplode } from "../explode/explodeStore";
import { getExplodeModel } from "../explode/model";
import { recoveryStore, useRecovery } from "../recovery/recoveryStore";
import { removalStore, useRemoval } from "../removal/removalStore";
import { scenarioStore } from "../scenarios/scenarioStore";
import { carbonStore } from "../carbon/carbonStore";
import { reuseStore } from "../reuse/reuseStore";
import { trackingStore } from "../tracking/trackingStore";
import { HERO_DIR, VIEWER_FOV, type ClipSpec } from "../framing";
import { makeViewContext } from "../viewContext";
import type { ViewState } from "../viewState";
import { ComponentCard } from "./ComponentCard";
import { GUIDED_STEPS, PRESETS, WIDE_DRAWERS, modelFacts, planContextFor, presetById, type GuidedStep, type PlanContext, type PresetId, type ScenePlan } from "./presets";
import { DEMO_STEPS } from "./demoTour";
import { demoStore, useDemo } from "@/demo/demoStore";
import { PassportPanel } from "../passport/PassportPanel";
import { useScenarios } from "../scenarios/scenarioStore";
import { useCarbon } from "../carbon/carbonStore";
import { useReuse } from "../reuse/reuseStore";
import { useTracking } from "../tracking/trackingStore";
import { cameraBridge } from "./cameraBridge";
import { applyPlan, drawerOpenNow, explodeFraming, restoreSnapshot, setDrawer, takeSnapshot, type Host } from "./presenter";
import "./presentation.css";

const DWELL_MS = 9000;
/** Dev / test only: the browser check shortens the dwell through window.__pmDwell. Production always uses DWELL_MS. */
const dwellMs = (): number => (import.meta.env.DEV && typeof (window as { __pmDwell?: number }).__pmDwell === "number" ? (window as { __pmDwell?: number }).__pmDwell! : DWELL_MS);
const KEY_HINT: Record<PresetId, string> = { hero: "1", front: "2", plan: "3", floor: "4", exploded: "5", mep: "6", section: "7" };

type Cursor = { kind: "preset"; id: PresetId } | { kind: "scene"; si: number; ci: number };
/** The tour as a flat list of (step, scene) positions. */
const flatten = (steps: readonly GuidedStep[]) => steps.flatMap((s, si) => s.scenes.map((_, ci) => ({ si, ci })));

export interface PresentationProps {
  records: readonly ComponentRecord[];
  viewState: ViewState;
  onViewState: (v: ViewState) => void;
  /** The section plane override (null = explicitly none, undefined = the view's own). */
  clip: ClipSpec | null | undefined;
  onClip: (c: ClipSpec | null | undefined) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTrace: (ids: string[]) => void;
  traced: number;
  onExit: () => void;
}

export function PresentationMode({ records, viewState, onViewState, clip, onClip, selectedId, onSelect, onTrace, traced, onExit }: PresentationProps) {
  const snap = useRef<ReturnType<typeof takeSnapshot> | null>(null);
  if (snap.current === null) snap.current = takeSnapshot(viewState, clip, selectedId);
  // The B4 scenario, B5 carbon, C2 reuse and C3 tracking workspaces are wider than the drawers presentation mode plans for: they close while presenting and exit restores them.
  useEffect(() => (scenarioStore.setOpen(false), carbonStore.setOpen(false), reuseStore.setOpen(false), trackingStore.setOpen(false)), []);

  const [cursor, setCursor] = useState<Cursor>({ kind: "preset", id: "hero" });
  const [auto, setAuto] = useState(false);
  const [details, setDetails] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);
  const moved = useRef(false); // the presenter has taken the camera since the last view request
  const barRef = useRef<HTMLDivElement>(null);
  const run = useRef(0);

  const inventoryOpen = useInventoryOpen();
  const recoveryOpen = useRecovery().open;
  const removalOpen = useRemoval().open;
  const scenariosOpen = useScenarios().open;
  const carbonOpen = useCarbon().open;
  const reuseOpen = useReuse().open;
  const trackingOpen = useTracking().open;
  const wideOpen = scenariosOpen || carbonOpen || reuseOpen || trackingOpen;
  const ex = useExplode();
  // with the demo project loaded, the guided demonstration is the 10-minute demo tour (one scene per module)
  const demo = useDemo();
  const STEPS = demo.active ? DEMO_STEPS : GUIDED_STEPS;
  useEffect(() => (demoStore.setPresenting(true), () => demoStore.setPresenting(false)), []);
  const FLAT = useMemo(() => flatten(STEPS), [STEPS]);
  // loading or leaving the demo swaps the tour: the cursor goes back to the presets so it never points into the other tour
  useEffect(() => setCursor((c) => (c.kind === "scene" ? { kind: "preset", id: "hero" } : c)), [STEPS]);

  const base = useMemo(() => {
    const view = makeViewContext(DEFAULT_CONFIG);
    const ctx = planContextFor(records, view, VIEWER_FOV, 1600, 1000, {});
    return { ctx, facts: modelFacts(records, ctx.bounds) };
  }, [records]);

  const host: Host = useMemo(() => ({ setView: onViewState, setClip: onClip, select: onSelect }), [onViewState, onClip, onSelect]);
  const hostRef = useRef(host);
  hostRef.current = host;

  /**
   * Plan context for the screen as it is now. The viewport is the window minus the docked workspace (the top bar and the sidebar are
   * hidden while presenting), so `drawer` narrows the canvas the plan is framed for; there is no right-hand inset to reserve.
   */
  const ctxFor = useCallback(
    (drawer: boolean | "wide"): PlanContext => {
      const barH = (barRef.current?.getBoundingClientRect().height ?? 52) + 24;
      const dock = drawer ? shellGeometry(window.innerWidth, "auto", drawer === "wide" ? WIDE_DOCK : NARROW_DOCK, layoutStore.get().dockWidth, false).dockWidth : 0;
      return { ...base.ctx, width: window.innerWidth - dock, height: window.innerHeight, insets: { bottom: barH } };
    },
    [base],
  );

  /** A plan framed into the space that is free once ITS drawer choice is applied (a plan that opens a drawer leaves less room). */
  const planFor = useCallback(
    (build: (ctx: PlanContext) => ScenePlan): ScenePlan => {
      const wideNow = scenarioStore.get().open || carbonStore.get().open || reuseStore.get().open || trackingStore.get().open;
      let plan = build(ctxFor(wideNow ? "wide" : drawerOpenNow()));
      if (plan.drawer && WIDE_DRAWERS.has(plan.drawer)) plan = build(ctxFor("wide"));
      else if (plan.drawer) plan = build(ctxFor(true));
      else if (plan.drawer === null) plan = build(ctxFor(false));
      return plan;
    },
    [ctxFor],
  );

  const show = useCallback(
    (build: (ctx: PlanContext) => ScenePlan) => {
      const id = ++run.current;
      moved.current = false;
      const plan = planFor(build);
      setDetails(plan.details === true);
      void applyPlan(plan, hostRef.current, { isCurrent: () => run.current === id, insets: () => ctxFor(drawerOpenNow()).insets });
    },
    [ctxFor, planFor],
  );

  const goPreset = useCallback(
    (id: PresetId) => {
      setAuto(false);
      setCursor({ kind: "preset", id });
      show((ctx) => presetById(id).plan(ctx));
    },
    [show],
  );

  const goScene = useCallback(
    (si: number, ci: number) => {
      setCursor({ kind: "scene", si, ci });
      show((ctx) => STEPS[si]!.scenes[ci]!.plan(ctx));
    },
    [show, STEPS],
  );

  const flatIndex = cursor.kind === "scene" ? FLAT.findIndex((f) => f.si === cursor.si && f.ci === cursor.ci) : -1;
  const next = useCallback(() => {
    const k = cursor.kind === "scene" ? FLAT.findIndex((f) => f.si === cursor.si && f.ci === cursor.ci) : -1;
    const n = FLAT[k + 1];
    if (n) goScene(n.si, n.ci);
    else setAuto(false);
  }, [cursor, goScene, FLAT]);
  const prev = useCallback(() => {
    setAuto(false);
    const k = cursor.kind === "scene" ? FLAT.findIndex((f) => f.si === cursor.si && f.ci === cursor.ci) : 0;
    const p = FLAT[Math.max(0, k - 1)]!;
    goScene(p.si, p.ci);
  }, [cursor, goScene, FLAT]);
  const repeat = useCallback(() => {
    // start the transition again from the beginning: the exploded view goes back to assembled first
    if (explodeStore.get().open) explodeStore.preset("assembled");
    if (cursor.kind === "scene") goScene(cursor.si, cursor.ci);
    else goPreset(cursor.id);
  }, [cursor, goScene, goPreset]);

  const exit = useCallback(() => {
    run.current++;
    setAuto(false);
    if (document.fullscreenElement) void document.exitFullscreen?.();
    restoreSnapshot(snap.current!, hostRef.current);
    onExit();
  }, [onExit]);

  // build A4's grouping model while the presenter is on the first view, so the first exploded transition does not stall on it
  useEffect(() => {
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const h = idle ? idle(() => void getExplodeModel(), { timeout: 3000 }) : window.setTimeout(() => void getExplodeModel(), 1500);
    return () => (idle ? (window as { cancelIdleCallback?: (n: number) => void }).cancelIdleCallback?.(h) : window.clearTimeout(h));
  }, []);

  // first view: the hero axonometric
  useEffect(() => {
    show((ctx) => presetById("hero").plan(ctx));
    return () => {
      run.current++;
    };
  }, [show]);

  // optional auto-advance: a dwell per scene; any camera interaction or press pauses it
  useEffect(() => {
    if (!auto || cursor.kind !== "scene") return;
    const t = window.setTimeout(next, dwellMs());
    return () => window.clearTimeout(t);
  }, [auto, cursor, next]);
  useEffect(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    const pause = () => {
      moved.current = true;
      setAuto(false);
    };
    canvas.addEventListener("pointerdown", pause);
    canvas.addEventListener("wheel", pause, { passive: true });
    return () => {
      canvas.removeEventListener("pointerdown", pause);
      canvas.removeEventListener("wheel", pause);
    };
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  // a resize (window drag, full screen) re-frames the current view until the presenter has moved the camera
  useEffect(() => {
    let timer = 0;
    const reframe = () => {
      if (moved.current || cameraBridge.flying()) return;
      const plan = planFor((ctx) => (cursor.kind === "scene" ? STEPS[cursor.si]!.scenes[cursor.ci]!.plan(ctx) : presetById(cursor.id).plan(ctx)));
      if (plan.pose) cameraBridge.jumpTo?.(plan.pose);
      else if (plan.explode) {
        const fp = explodeBridge.fitPose?.(explodeFraming(ctxFor(drawerOpenNow()).insets, plan.explodeDirection ?? HERO_DIR), { ...explodeStore.get().params, t: explodeStore.liveT() });
        if (fp) cameraBridge.jumpTo?.({ position: fp.position, target: fp.target }, fp.maxDistance);
      }
    };
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(reframe, 260);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [cursor, planFor, ctxFor, STEPS]);

  const toggleFullscreen = () => (document.fullscreenElement ? void document.exitFullscreen?.() : void document.documentElement.requestFullscreen?.());

  // keyboard: arrows step, space plays / pauses, R repeats, 1-7 presets, D details, F fullscreen, Esc exits
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === "Escape") exit();
      else if (k === "ArrowRight" || k === "PageDown") (cursor.kind === "scene" ? next : () => goScene(0, 0))();
      else if (k === "ArrowLeft" || k === "PageUp") prev();
      else if (k === " ") {
        e.preventDefault();
        if (cursor.kind !== "scene") goScene(0, 0);
        else setAuto((a) => !a);
      } else if (k === "r" || k === "R") repeat();
      else if (k === "d" || k === "D") setDetails((d) => !d);
      else if (k === "f" || k === "F") toggleFullscreen();
      else {
        const p = PRESETS[Number(k) - 1];
        if (p) goPreset(p.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, exit, next, prev, repeat, goPreset, goScene]);

  const step = cursor.kind === "scene" ? (STEPS[cursor.si] ?? null) : null;
  const scene = step && cursor.kind === "scene" ? (step.scenes[cursor.ci] ?? null) : null;
  const sceneHasPlay = useMemo(() => scene?.plan(base.ctx).explode?.play === true, [scene, base]);
  const caption = scene ? scene.caption(base.facts) : cursor.kind === "preset" ? presetById(cursor.id).hint : "";
  const R = 12; // the docked workspace is outside this overlay
  const playingCine = ex.playing;

  const openDrawer = (which: "inventory" | "recovery" | "removal") => {
    const was = which === "inventory" ? inventoryOpen : which === "recovery" ? recoveryOpen : removalOpen;
    if (wideOpen) setDrawer(null);
    inventoryUi.set(which === "inventory" && !was);
    recoveryStore.setOpen(which === "recovery" && !was);
    removalStore.setOpen(which === "removal" && !was);
  };
  /** Demo project: the B4 / B5 / C2 / C3 workspaces from the toolbar (toggle). */
  const openWide = (which: "scenarios" | "carbon" | "reuse" | "tracking") => {
    const was = { scenarios: scenariosOpen, carbon: carbonOpen, reuse: reuseOpen, tracking: trackingOpen }[which];
    setDrawer(was ? null : which);
  };

  return (
    <div className="pm-root" data-testid="presentation" data-cursor={cursor.kind === "scene" ? `step:${cursor.si}:${cursor.ci}` : `preset:${cursor.id}`} data-auto={auto ? "on" : "off"}>
      {/* guided card */}
      <div className={cardOpen ? "pm-panel pm-card" : "pm-panel pm-card collapsed"} data-testid="pm-card" data-open={cardOpen ? "true" : "false"}>
        <div className="pm-eyebrow">
          <span>{step ? `${demo.active ? "Demo tour" : "Guided demonstration"} · ${cursor.kind === "scene" ? cursor.si + 1 : 0} of ${STEPS.length}` : "Presentation mode"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {step && <span data-testid="pm-position">{flatIndex + 1} / {FLAT.length}</span>}
            <button type="button" className="pm-btn" data-testid="pm-card-toggle" aria-label={cardOpen ? "Collapse the description" : "Expand the description"} title={cardOpen ? "Collapse" : "Expand"} onClick={() => setCardOpen((o) => !o)}>
              {cardOpen ? "–" : "+"}
            </button>
          </span>
        </div>
        {!cardOpen ? (
          <h3 className="pm-title" data-testid="pm-title">
            {step ? step.title : presetById(cursor.kind === "preset" ? cursor.id : "hero").label}
            {scene ? ` · ${scene.label}` : ""}
          </h3>
        ) : step ? (
          <>
            <div className="pm-steps" role="tablist" aria-label="Guided steps">
              {STEPS.map((s, i) => (
                <button key={s.id} type="button" data-testid={`pm-step-${s.id}`} title={s.title} aria-current={i === (cursor.kind === "scene" ? cursor.si : -1) ? "step" : undefined} className={i < (cursor.kind === "scene" ? cursor.si : 0) ? "done" : ""} onClick={() => (setAuto(false), goScene(i, 0))} />
              ))}
            </div>
            <h3 className="pm-title" data-testid="pm-title">
              {step.title}
            </h3>
            <div className="pm-chips">
              {step.scenes.map((sc, i) => (
                <button key={sc.id} type="button" className="pm-chip" data-testid={`pm-scene-${i}`} aria-pressed={cursor.kind === "scene" && cursor.ci === i} onClick={() => (setAuto(false), goScene(cursor.kind === "scene" ? cursor.si : 0, i))}>
                  {sc.label}
                </button>
              ))}
            </div>
            <p className="pm-caption" data-testid="pm-caption">
              {caption}
            </p>
            {auto && (
              <div className="pm-progress">
                <i key={flatIndex} style={{ animationDuration: `${dwellMs()}ms` }} />
              </div>
            )}
            <div className="pm-nav">
              <button type="button" className="pm-btn outline" data-testid="pm-prev" onClick={prev} disabled={flatIndex <= 0} title="Previous (←)">
                ‹ Prev
              </button>
              <button type="button" className="pm-btn primary" data-testid="pm-next" onClick={() => (setAuto(false), next())} disabled={flatIndex >= FLAT.length - 1} title="Next (→)">
                Next ›
              </button>
              <span className="grow" />
              {sceneHasPlay && (
                <button type="button" className="pm-btn outline" data-testid="pm-cine" onClick={() => explodeStore.togglePlay()}>
                  {playingCine ? "❚❚ Pause" : "▶ Play"}
                </button>
              )}
              <button type="button" className="pm-btn outline" data-testid="pm-auto" aria-pressed={auto} onClick={() => setAuto((a) => !a)} title="Advance every few seconds; any interaction pauses (Space)">
                {auto ? "❚❚ Pause" : "▶ Auto"}
              </button>
              <button type="button" className="pm-btn outline" data-testid="pm-repeat" onClick={repeat} title="Replay this view (R)">
                ↻ Repeat
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="pm-title">{presetById(cursor.kind === "preset" ? cursor.id : "hero").label}</h3>
            <p className="pm-caption" data-testid="pm-caption">
              {caption}
            </p>
            <div className="pm-nav" style={{ borderTop: "none", paddingTop: 0 }}>
              <button type="button" className="pm-btn primary" data-testid="pm-start" onClick={() => goScene(0, 0)}>
                {demo.active ? "Start 10-minute demo tour ›" : "Start guided demonstration ›"}
              </button>
              <span className="grow" />
              {demo.active ? (
                <span style={{ color: "var(--rm-muted)", fontSize: 11 }}>{STEPS.length} steps · {FLAT.length} scenes</span>
              ) : (
                <button type="button" className="pm-btn outline" data-testid="pm-demo-load" disabled={demo.busy} onClick={() => demoStore.load()} title="Fill every module with an illustrative demo project (your own entries are kept and come back on Exit demo), and switch the guided demonstration to the 10-minute tour">
                  {demo.busy ? "Loading…" : "Load demo project"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {/* mode label, fullscreen, exit */}
      <div className="pm-top" style={{ right: R }}>
        {/* with a wide workspace open the canvas is narrow: the mode label gives way so the bar never covers the guided card */}
        {!wideOpen && (
          <span className="pm-panel pm-badge" data-testid="pm-badge">
            <i /> Presentation
          </span>
        )}
        {demo.active && (
          <span className="pm-demo" data-testid="pm-demo-label" title="The demo project is loaded: every module shows illustrative inputs, not an assessment. Exit demo (after leaving presentation mode) restores your own entries.">
            <i /> Demo data <span>illustrative</span>
          </span>
        )}
        <button type="button" className="pm-btn outline pm-panel" data-testid="pm-fullscreen" aria-pressed={fullscreen} onClick={toggleFullscreen} title="Full screen (F)">
          ⤢
        </button>
        <button type="button" className="pm-btn primary" data-testid="pm-exit" onClick={exit} title="Return to the engineering interface (Esc)">
          Exit<span className="pm-kbd">Esc</span>
        </button>
      </div>

      {/* selected component: compact card, or the full inspector on request */}
      {selectedId && !details && <ComponentCard id={selectedId} style={{ top: 52, right: R }} detailsOpen={details} onDetails={() => setDetails(true)} onClose={() => onSelect(null)} />}
      {selectedId && details && (
        <div className="pm-details" style={{ right: R, width: 440 }}>
          <button type="button" className="pm-btn outline pm-panel" style={{ marginBottom: 6 }} data-testid="pm-details" aria-pressed onClick={() => setDetails(false)}>
            ‹ Back to summary
          </button>
          <ComponentInspector selectedId={selectedId} onSelect={onSelect} onTrace={onTrace} traced={traced} style={{ position: "relative", top: 0, left: 0 }} />
          {demo.active && (
            <div style={{ marginTop: 8 }}>
              <PassportPanel selectedId={selectedId} onSelect={onSelect} />
            </div>
          )}
        </div>
      )}

      {/* toolbar */}
      <div className="pm-bar" style={{ left: 12, right: R }}>
        <div ref={barRef} className="pm-panel pm-bar-inner" data-testid="pm-bar">
          <div className="pm-group" role="group" aria-label="Camera presets">
            <span className="pm-label">View</span>
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className="pm-btn" data-testid={`pm-preset-${p.id}`} aria-current={cursor.kind === "preset" && cursor.id === p.id} title={`${p.hint} (${KEY_HINT[p.id]})`} onClick={() => goPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="pm-sep" />
          <div className="pm-group" role="group" aria-label="Data">
            <span className="pm-label">Data</span>
            <button type="button" className="pm-btn" data-testid="pm-inventory" aria-pressed={inventoryOpen} onClick={() => openDrawer("inventory")}>
              Inventory
            </button>
            <button type="button" className="pm-btn" data-testid="pm-recovery" aria-pressed={recoveryOpen} onClick={() => openDrawer("recovery")}>
              Recovery
            </button>
            <button type="button" className="pm-btn" data-testid="pm-removal" aria-pressed={removalOpen} onClick={() => openDrawer("removal")}>
              Removal
            </button>
            {demo.active && (
              <>
                <button type="button" className="pm-btn" data-testid="pm-scenarios" aria-pressed={scenariosOpen} onClick={() => openWide("scenarios")}>
                  Scenarios
                </button>
                <button type="button" className="pm-btn" data-testid="pm-carbon" aria-pressed={carbonOpen} onClick={() => openWide("carbon")}>
                  Carbon
                </button>
                <button type="button" className="pm-btn" data-testid="pm-reuse" aria-pressed={reuseOpen} onClick={() => openWide("reuse")}>
                  Reuse
                </button>
                <button type="button" className="pm-btn" data-testid="pm-tracking" aria-pressed={trackingOpen} onClick={() => openWide("tracking")}>
                  Tracking
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
