/**
 * Bottom-left badge for the demo project (clear of the drawers' titles). Loaded: a persistent "Demo project · illustrative data" label (visible in every mode, so a
 * screenshot can never pass the demo off as an assessment) with Exit. Not loaded: nothing (presentation mode's card has the Load
 * button). An application that opens with nothing entered loads it on its own (autoLoadIfFresh); `?demo=1` forces it, `?demo=0` and Exit demo keep it off.
 */

import { useEffect, useState } from "react";
import { demoStore, useDemo } from "./demoStore";

const pill: React.CSSProperties = {
  position: "fixed",
  bottom: 52, // above the viewport's navigation hint
  left: 12,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "6px 8px 6px 12px",
  borderRadius: 999,
  font: "500 12px/1.2 var(--rm-font, system-ui, sans-serif)",
  boxShadow: "0 4px 14px rgba(20, 24, 28, 0.16)",
  pointerEvents: "auto",
};

/** The shared button style stretches to its panel; here it sizes to its label. */
const btn: React.CSSProperties = { width: "auto", flex: "none", padding: "4px 12px" };

export function DemoBadge() {
  const demo = useDemo();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    // after the first frame, so the model is on screen while the modules fill
    const t = window.setTimeout(() => {
      if (demoStore.get().active) return demoStore.restoreSession();
      if (new URLSearchParams(window.location.search).get("demo") === "1") demoStore.load();
      else demoStore.autoLoadIfFresh(); // an empty application opens with the demo project in it
    }, 300);
    return () => window.clearTimeout(t);
  }, []);

  if (!demo.active) {
    // not loaded: nothing on screen (the Load button lives in presentation mode's card); only a failed load is reported
    if (!demo.error) return null;
    return (
      <div style={{ ...pill, background: "var(--rm-surface, #fff)", color: "#a33", border: "1px solid var(--rm-border, #d9dde1)" }} data-testid="demo-badge">
        {demo.error}
      </div>
    );
  }
  if (demo.presenting) return null; // presentation mode shows its own compact label in its top bar
  const s = demo.summary;
  const tip = s
    ? `Demo inputs: ${s.assessments} recovery assessments, ${s.removalEntries} removal steps, ${s.scenarios} scenarios, ${s.factors} illustrative carbon factors, ${s.passports} passport notes, ${s.requirements} reuse requirements (${s.allocations} allocations), ${s.tracked} tracked components.`
    : "Demo inputs are loaded in every module.";
  return (
    <div style={{ ...pill, background: "#2b2f36", color: "#fff" }} data-testid="demo-badge" data-active="1" title={tip}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: "#f0a646", display: "inline-block" }} />
      <span>
        <b style={{ letterSpacing: 0.4 }}>DEMO PROJECT</b> <span style={{ opacity: 0.8, whiteSpace: "nowrap" }}>· illustrative data, not an assessment</span>
      </span>
      {confirming ? (
        <>
          <span style={{ opacity: 0.8 }}>Restore your own data?</span>
          <button type="button" className="rm-btn" style={btn} data-testid="demo-exit-confirm" onClick={() => demoStore.exit()}>
            Exit demo
          </button>
          <button type="button" className="rm-btn" style={btn} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="rm-btn" style={btn} data-testid="demo-exit" onClick={() => setConfirming(true)}>
          Exit demo
        </button>
      )}
    </div>
  );
}
