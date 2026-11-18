// A5 representative-view capture (dev server on :5173, or BASE=http://localhost:PORT). The same views are shot before
// and after the A5 changes so they can be compared:
//   node scripts/browser/shotsA5.mjs docs/screenshots/a5/baseline    (before)
//   node scripts/browser/shotsA5.mjs docs/screenshots/a5/final       (after)
// Every pose is derived from the real model (bounds from the records, entrance / balcony positions from their records).
// Prints renderer statistics (draw calls, triangles, frame cost) for the hero view. Nothing here writes engineering data.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.argv[2] ?? "docs/screenshots/a5/baseline";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const LAYERS = ["structure", "exteriorWalls", "interiorWalls", "openings", "flooring", "ceilings", "fixtures", "balconiesFacade", "roof", "plumbing", "electrical"];
const FLOORS = ["FDN", "L0", "L1", "L2", "L3", "L4", "ROOF"];

const load = async (query = "?view=full") => {
  await b.goto(`${BASE}/${query}`);
  await b.sleep(600);
};
const setState = (st = {}) =>
  b.evaluate(`(() => {
    const on = ${JSON.stringify(st.on ?? ["structure", "exteriorWalls", "interiorWalls", "openings", "flooring", "ceilings", "fixtures", "balconiesFacade", "roof"])};
    window.__reloop.setViewState({
      layers: Object.fromEntries(${JSON.stringify(LAYERS)}.map((l) => [l, on.includes(l)])),
      isolate: ${JSON.stringify(st.isolate ?? null)}, ceilingsInIsolation: ${JSON.stringify(st.ceilings ?? false)},
      floors: Object.fromEntries(${JSON.stringify(FLOORS)}.map((f) => [f, true])), xray: ${JSON.stringify(!!st.xray)},
    });
  })()`);
const view = (pos, tgt) => b.evaluate(`window.__reloop.setView(${JSON.stringify(pos)}, ${JSON.stringify(tgt)})`);
const rec = (id) => b.evaluate(`(() => { const r = window.__reloop.records.find((x) => x.id === ${JSON.stringify(id)}); return { p: r.originalPosition, s: r.geometry.size }; })()`);
const shoot = async (name, wait = 900) => {
  await b.sleep(wait);
  await b.shot(`${OUT}/${name}.png`);
  console.log("shot", name);
};

const out = { views: {} };
await load("");
await setState();
await shoot("00_hero_default", 1200); // no ?view=: the app's default presentation view (before A5 this was the north-east oblique)
await load();
await setState();
await b.sleep(900);
await shoot("01_exterior_full", 600);
out.heroStats = await b.evaluate(`window.__reloop.stats(false)`);
out.heroStatsShadow = await b.evaluate(`window.__reloop.stats(true)`);
// frame cost of the hero view (render() calls, shadow map frozen as in normal use)
out.heroFrameMs = await b.evaluate(`(() => { const r = window.__reloop; r.gl.shadowMap.needsUpdate = false; const t0 = performance.now(); for (let i = 0; i < 20; i++) r.gl.render(r.scene, r.camera); r.gl.getContext().finish(); return (performance.now() - t0) / 20; })()`);

// the entrance (south facade, z < 0) from the front, and a close-up of it
const ent = await rec("ARC-ENT-G-MAIN");
await view([ent.p[0] + 4, 6, ent.p[2] - 78], [0, 9.2, 0]);
await shoot("02_south_elevation");
await view([ent.p[0] + 6.5, 3.2, ent.p[2] - 8.5], [ent.p[0], 1.8, ent.p[2]]);
await shoot("03_entrance_closeup");
const bal = await rec("ARC-BAL-F01-A1-S");
await view([bal.p[0] + 7, bal.p[1] + 1.5, bal.p[2] - 9], [bal.p[0], bal.p[1] - 0.2, bal.p[2]]);
await shoot("04_balcony_closeup");
await view([-52, 30, -50], [0, 9.2, 0]);
await shoot("05_exterior_se_wide");

// typical floor, ceilings off
await setState({ isolate: "L2" });
await view([30, 26, -30], [0, 8.4, 0]);
await shoot("06_typical_floor");
await view([-6, 9.4, -8], [-12, 7.6, -13]);
await shoot("07_interior_closeup");

// structure only
await setState({ on: ["structure"] });
await view([48, 32, -52], [0, 9.2, 0]);
await shoot("08_structure");

// plumbing + electrical, building ghosted
await setState({ on: ["plumbing", "electrical"], isolate: "L1", xray: true });
await view([24, 18, -24], [0, 5.5, 0]);
await shoot("09_mep_inspection");
await setState({ on: ["plumbing", "electrical", "structure", "fixtures"], isolate: "L1", xray: true });
await view([-7, 5.6, -7], [-12, 4.4, -13]);
await shoot("10_mep_closeup");

// component selection (inspector, outline)
await load();
await setState();
const sel = "ARC-ENT-G-MAIN";
await b.evaluate(`window.__reloop.select(${JSON.stringify(sel)})`);
await view([ent.p[0] + 8, 4, ent.p[2] - 11], [ent.p[0], 1.8, ent.p[2]]);
await shoot("11_selection_inspector");

// exploded view (floors, fully)
await load();
await setState();
await b.evaluate(`(() => { const s = window.__explode.store; s.setOpen(true); s.setMode("floors"); s.setT(1); })()`);
await b.sleep(900);
await b.evaluate(`window.__explode.fit()`);
await shoot("12_exploded_floors", 1200);
out.explodedStats = await b.evaluate(`window.__reloop.stats(false)`);
await b.evaluate(`(() => { const s = window.__explode.store; s.setMode("systems"); s.setT(1); })()`);
await b.sleep(900);
await b.evaluate(`window.__explode.fit()`);
await shoot("13_exploded_systems", 1200);
await b.evaluate(`window.__explode.store.setOpen(false)`);

// B2 recovery colouring and B3 removal simulation
await load();
await setState({ on: ["structure"] });
await b.evaluate(`window.__reloop.select(null)`);
await b.evaluate(`(() => document.querySelector("[data-testid=recovery-toggle]").click())()`);
await b.sleep(600);
await b.evaluate(`(() => document.querySelector("[data-testid=recovery-colour]")?.click())()`);
await view([48, 32, -52], [0, 9.2, 0]);
await shoot("14_b2_recovery_colour", 1200);
await b.evaluate(`(() => { document.querySelector("[data-testid=recovery-colour]")?.click(); document.querySelector("[data-testid=recovery-toggle]").click(); })()`);
await b.sleep(300);
await b.evaluate(`(() => { const r = window.__removal; r.setOpen(true); r.createPlan("A5 capture"); const col = "STR-COL-G-A1"; r.addEntries([col]); r.insertPrerequisites(col); for (let i = 0; i < 6; i++) r.next(); })()`);
await b.sleep(800);
await view([18, 12, -26], [-14, 5.5, -14]);
await shoot("15_b3_removal", 1200);
await b.evaluate(`(() => { const r = window.__removal; r.resetSimulation(); r.delete(); r.setOpen(false); })()`);

out.console = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
console.log(JSON.stringify(out, null, 1));
await b.close();
