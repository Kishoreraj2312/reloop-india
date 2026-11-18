// B5 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the Carbon workspace; the rest drives form
// controls. Everything is checked against the REAL building with small hand-computable cases built from real component quantities:
//   empty library = "Not assessed" (never 0), a user factor priced against an independent sum of the records' quantities, invalid
//   factors / assumptions rejected with the stored value unchanged, unit-incompatible factors not applied, the inspector line,
//   3D highlight identity (assessed / not assessed), exact restore, scenario terms priced by hand (Q x 80 % x 50 % x EF ...),
//   missing inputs shown as "Not assessed" with the missing list, incomplete reuse assumptions, density override, sensitivity,
//   persistence and corrupt saved data, workspace conflicts, floor isolation with the highlight on, B1 / B2 / B3 / B4 data untouched.
// Screenshots go to docs/screenshots/b5. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/b5";
const KEY = "rematter.carbon.v1";
const B4KEY = "rematter.scenarios.v1";
const B2KEY = "rematter.recovery.assessments.v1";
const B3KEY = "rematter.removal.plans.v1";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const r = {};
const checks = {};
const failures = [];
setTimeout(() => { console.error("WATCHDOG: the check did not finish in 9 minutes; last check:", [...Object.keys(checks)].pop()); process.exit(2); }, 540000).unref();
const check = (name, cond, detail) => {
  if (process.env.VERBOSE) console.error(cond ? "ok  " : "FAIL", name);
  checks[name] = !!cond;
  if (!cond) failures.push({ name, detail });
};
const finish = async (code) => {
  r.consoleErrors = b.logs.filter((l) => /\[(exception|console\.(error|warning))\]/.test(l));
  check("console clean", r.consoleErrors.length === 0, r.consoleErrors.slice(0, 5));
  r.checks = checks;
  r.failed = failures;
  r.passed = Object.values(checks).filter(Boolean).length;
  r.total = Object.keys(checks).length;
  console.log(JSON.stringify(r, null, 1));
  await b.close();
  process.exit(failures.length ? 1 : code);
};
process.on("uncaughtException", async (e) => { r.error = String(e); await finish(1); });

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const all = (sel, expr) => b.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => ${expr})`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "center" })`); await b.sleep(120); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
const enter = (sel) => b.evaluate(`${q(sel)}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
const typePct = async (sel, v) => { await setInput(sel, v); await enter(sel); await b.sleep(250); };
const clickAt = async (expr) => { const p = await b.evaluate(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); if (!p) throw new Error(`no element ${expr}`); await b.sleep(150); await b.click(p.x, p.y); };
const select = async (id) => { await b.evaluate(`window.__reloop.select(${JSON.stringify(id)})`); await b.sleep(450); };
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const meshColour = (id) => b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(id)})?.material?.color?.getHexString() ?? null`);
const chainVisible = (name) => b.evaluate(`(() => { const o = window.__reloop.scene.getObjectByName(${JSON.stringify(name)}); if (!o) return null; for (let c = o; c; c = c.parent) if (!c.visible) return false; return true; })()`);
const tintOf = (id) => b.evaluate(`(() => { const o = window.__reloop.scene.getObjectByName(${JSON.stringify(id)}); const t = o?.children.find((c) => c.name === "__scenario"); return t ? t.material.color.getHexString() : null; })()`);
const applied = () => b.evaluate(`window.__scenarioOverlay ? JSON.parse(JSON.stringify(window.__scenarioOverlay)) : null`);
const sameSet = (a, c) => a.length === c.length && [...a].sort().join("|") === [...c].sort().join("|");
const sc = (expr) => b.evaluate(`(() => { const s = window.__scenarios; return ${expr}; })()`);
const rm = (expr) => b.evaluate(`(() => { const s = window.__removal; return ${expr}; })()`);
const snapExpr = `(() => {
  const root = window.__reloop.scene.getObjectByName("Building_G4");
  let h = 0, hidden = 0, meshes = 0, tints = 0, inst = 0;
  const mix = (v) => { h = (Math.imul(h, 31) + Math.round(v * 1e4)) | 0; };
  root.traverse((o) => {
    if (o.name === "__scenario" || o.name === "__removal") { tints++; return; }
    if (o.name.endsWith("__selection")) return;
    if (o.isMesh) { meshes++; if (!o.visible) hidden++; mix(o.visible ? 1 : 0);
      if (o.material && o.material.color) { mix(o.material.color.r); mix(o.material.color.g); mix(o.material.color.b); }
      if (o.isInstancedMesh && Array.isArray(o.userData.componentIds)) { inst++; const a = o.instanceMatrix.array; for (let i = 0; i < a.length; i++) mix(a[i]); mix(o.count); } }
  });
  return { meshes, inst, hiddenPlain: hidden, tints, hash: h };
})()`;
const snap = () => b.evaluate(snapExpr);
const raw = (expr) => b.evaluate(`(() => { const recs = window.__reloop.records; const byId = new Map(recs.map((r) => [r.id, r])); return ${expr}; })()`);
const cc = (expr) => b.evaluate(`(() => { const s = window.__carbon; return ${expr}; })()`);
const frow = (cat, sub) => `[data-testid=factor-row][data-category="${cat}"] ${sub ? `[data-testid=${sub}]` : ""}`.trim();
const num = (t) => (t === null ? null : Number(String(t).split("\n")[0].replace(/[^0-9.\-]/g, "")));
const kg = (t) => { const m = /(-?[\d,.]+)\s*(t|kg)CO/.exec(t ?? ""); return m ? Number(m[1].replace(/,/g, "")) * (m[2] === "t" ? 1000 : 1) : null; };
const near = (a, c, tol = 1e-6) => a !== null && Math.abs(a - c) <= tol * Math.max(1, Math.abs(c));
const openCarbon = async () => { if (!(await exists("[data-testid=carbon-drawer]"))) { await click("[data-testid=carbon-toggle]"); await b.sleep(900); } };
const closeCarbon = async () => { if (await exists("[data-testid=carbon-drawer]")) { await click("[data-testid=carbon-close]"); await b.sleep(500); } };
const setField = async (testid, v) => { await setInput(`[data-testid=${testid}]`, v); await enter(`[data-testid=${testid}]`); await b.sleep(350); };

const COL = "STR-COL-F01-A1";
const BRICK = ["masonry_paint_ext", "masonry_paint_int", "masonry_paint_core"];
const CONCRETE = ["rcc_conceptual", "lintel_rcc_ext", "lintel_rcc_int", "concrete_fin", "concrete_band", "concrete_balcony"];

// ── 0. start clean ────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`["rematter.carbon.v1", "rematter.scenarios.v1", ${JSON.stringify(B2KEY)}, ${JSON.stringify(B3KEY)}].forEach((k) => localStorage.removeItem(k))`);
await b.goto(`${BASE}/?view=full`);
const snap0 = await snap();
r.statsBefore = await b.evaluate(`window.__reloop.stats(false)`);
const recordsHash = () => raw(`(() => { let h = 0; for (const r of recs) { const s = r.id + r.floor + r.originalPosition.join() + r.quantity + r.unit + r.materialId; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return h; })()`);
const rec0 = await recordsHash();
const leaf = (ids) => raw(`recs.filter((x) => x.geometry.kind !== "group" && ${JSON.stringify(ids)}.includes(x.materialId))`);
const brickLeaves = await leaf(BRICK);
const brickQ = brickLeaves.filter((x) => x.unit === "m3").reduce((n, x) => n + x.quantity, 0);
check("test fixture: all brick-masonry leaves are measured in m3", brickLeaves.length > 1000 && brickLeaves.every((x) => x.unit === "m3"), [brickLeaves.length]);
r.brickLeaves = brickLeaves.length;
r.brickM3 = brickQ;
await b.evaluate(`window.__removal.createPlan("Context plan"); window.__removal.addEntries([${JSON.stringify(COL)}])`);
const b3Before = await b.evaluate(`localStorage.getItem(${JSON.stringify(B3KEY)})`);

// ── 1. open with a real click: nothing is assessed, nothing is zero ───────────────────────────
await click("[data-testid=carbon-toggle]");
await b.sleep(1300);
check("workspace opens", await exists("[data-testid=carbon-drawer]"));
const dw = await b.evaluate(`${q("[data-testid=carbon-drawer]")}.getBoundingClientRect().width`);
check("wide workspace (900 px)", dw >= 899 && dw <= 901, dw);
r.statsOpen = await b.evaluate(`window.__reloop.stats(false)`);
check("opening the workspace does not change draw calls", r.statsOpen.drawCalls === r.statsBefore.drawCalls && r.statsOpen.triangles === r.statsBefore.triangles);
check("empty library: total is 'Not assessed', not 0", /Not assessed/.test((await text("[data-testid=carbon-total]")) ?? "") && (await b.evaluate(`${q("[data-testid=carbon-total]")}.dataset.kg`)) === "");
check("coverage: 0 components assessed", /^0 of 84,?365 components/.test((await text("[data-testid=carbon-coverage]")) ?? ""), await text("[data-testid=carbon-coverage]"));
check("warning: no emission factor is set", /No emission factor is set/.test((await text("[data-testid=carbon-warnings]")) ?? ""));
check("every category row reads not assessed", (await all("[data-testid=factor-row]", "e.dataset.assessed")).every((x) => x === "0"));
check("no illustrative banner, nothing saved", !(await exists("[data-testid=illustrative-banner]")) && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)) === null);
check("reinforcing / structural steel slots are listed as not in the model", (await exists(frow("reinforcing_steel"))) && /not in the model/.test((await text(frow("reinforcing_steel"))) ?? ""));
await b.shot(`${OUT}/b5_empty.png`);

// ── 2. a user factor, priced against an independent sum of record quantities ──────────────────────
await setSelect(frow("brick_masonry", "factor-basis"), "m3");
await b.sleep(300);
const valSel = `${frow("brick_masonry")} [data-testid=factor-value]`;
await setInput(valSel, "200");
await enter(valSel);
await b.sleep(900);
const f1 = await cc(`s.get().factors.get("brick_masonry")`);
check("factor stored: 200 kgCO2e per m3, origin 'assumed'", f1 && f1.value === 200 && f1.basis === "m3" && f1.origin === "assumed", f1);
const tot = Number(await b.evaluate(`${q("[data-testid=carbon-total]")}.dataset.kg`));
check("total = 200 x sum of the brick quantities (independent, from the records)", near(tot, 200 * brickQ, 2e-3), [tot, 200 * brickQ]);
check("coverage counts exactly the brick leaves", (await text("[data-testid=carbon-coverage]"))?.startsWith(`${brickLeaves.length.toLocaleString("en-US")} of`), await text("[data-testid=carbon-coverage]"));
check("brick is the only bar, with its share 100 %", (await all("[data-testid=carbon-bar-row]", "e.dataset.category")).join() === "brick_masonry" && /100\.0%/.test((await text("[data-testid=carbon-bar-row]")) ?? ""));
check("boundary not stated is shown, product-stage caveat shown", /boundary not stated/.test((await text("[data-testid=carbon-overview]")) ?? "") && /not a whole-life result/.test((await text("[data-testid=carbon-overview]")) ?? ""));
check("saved to localStorage (factors + assumptions only)", Object.keys(JSON.parse(await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`))).sort().join() === "assumptions,factors,version");

// invalid and unsourced input
for (const bad of ["abc", "-5"]) {
  await setInput(valSel, bad);
  await enter(valSel);
  await b.sleep(250);
  check(`factor "${bad}" rejected with a message; stored value unchanged`, !!(await text(`${frow("brick_masonry")} [data-testid=factor-value-error]`)) && (await cc(`s.get().factors.get("brick_masonry").value`)) === 200);
}
await setInput(valSel, "200");
await setSelect(frow("brick_masonry", "factor-origin"), "sourced");
await b.sleep(300);
check("a 'sourced' factor without a source name is rejected; origin unchanged", /needs a source name/.test((await text("[data-testid=factor-message]")) ?? "") && (await cc(`s.get().factors.get("brick_masonry").origin`)) === "assumed");
await click(`${frow("brick_masonry")} button`);
await b.sleep(300);
await setField("factor-source", "Test EPD 123");
await setField("factor-boundary", "A1–A3");
await setSelect(frow("brick_masonry", "factor-origin"), "sourced");
await b.sleep(400);
const f2 = await cc(`s.get().factors.get("brick_masonry")`);
check("with a named source it is accepted", f2.origin === "sourced" && f2.sourceName === "Test EPD 123" && f2.boundary === "A1–A3", f2);
check("the boundary is now shown with the total", /A1–A3/.test((await text("[data-testid=carbon-overview]")) ?? ""));
await click(`${frow("brick_masonry")} button`);

// unit compatibility: a mass-based factor on components that have no mass is not applied
await cc(`s.editFactor("pvc", { basis: "kg", value: 5 })`);
await b.sleep(700);
const pvcRow = await text(`[data-testid=unassessed-row][data-category=pvc]`);
check("mass factor on components without a mass: not assessed, reason given (never converted by guessing)", /no quantity in the factor's unit/.test(pvcRow ?? "") && (await cc(`s.baseline().rows.find((x) => x.category === "pvc").kgCO2e`)) === null, pvcRow);
await cc(`s.clearFactor("pvc")`);

// ── 3. inspector ──────────────────────────────────────────────────────────────────────────
const b1 = brickLeaves[0];
await select(b1.id);
const info = await text("[data-testid=carbon-info-value]");
check("inspector: component carbon = quantity x factor, with factor origin and boundary", near(kg(info), b1.quantity * 200, 2e-3) && /200 kgCO₂e\/m³/.test(info ?? "") && /sourced factor/.test(info ?? "") && /A1–A3/.test(info ?? ""), info);
const tile = await raw(`recs.find((x) => x.geometry.kind !== "group" && x.materialId === "tile_porcelain_floor").id`);
await select(tile);
check("inspector: an unassessed component says why", /not assessed: no emission factor/.test((await text("[data-testid=carbon-info-value]")) ?? ""));
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(300);

// ── 4. 3D highlight: assessed and not assessed ────────────────────────────────────────────────
await click(`[data-testid=carbon-bar-row][data-category=brick_masonry]`);
await b.sleep(1000);
const ov = await applied();
const ids = Object.values(ov ?? {}).flat();
check("assessed bar highlights exactly the brick leaf components", ov && ids.length === brickLeaves.length && sameSet(ids, brickLeaves.map((x) => x.id)), ids.length);
check("a carbon highlight keeps no B4 scenario in it", (await sc(`s.get().highlight.scenarioId`)) === "" && (await sc(`s.get().highlight.matches.length`)) === brickLeaves.length);
await click("[data-testid=carbon-highlight-clear]");
await b.sleep(300);
check("clear restores the model exactly", (await applied()) === null && (await snap()).hash === snap0.hash);
const porcelain = new Set(await raw(`recs.filter((x) => x.geometry.kind !== "group" && x.materialId === "tile_porcelain_floor").map((x) => x.id)`));
await click(`[data-testid=unassessed-row][data-category=porcelain_tile]`);
await b.sleep(1100);
const ov2 = await applied();
const ids2 = Object.values(ov2 ?? {}).flat();
check("a not-assessed category highlights its leaf components (grey)", ov2 && ids2.length > 1000 && ids2.every((id) => porcelain.has(id)), [ids2.length, porcelain.size]);
check("collapsing to see the model keeps the highlight", await (async () => { await click("[data-testid=carbon-collapse]"); await b.sleep(700); return (await exists("[data-testid=carbon-collapsed]")) && !(await exists("[data-testid=carbon-drawer]")) && (await applied()) !== null; })());
await b.evaluate(`window.__reloop.setView([46, 30, 52], [0, 9, 0])`);
await b.sleep(600);
await b.shot(`${OUT}/b5_highlight_3d.png`);
await click("[data-testid=carbon-expand]");
await b.sleep(600);
await click("[data-testid=carbon-highlight-clear]");
await b.sleep(300);

// ── 5. scenarios: pricing by hand, missing inputs shown as Not assessed ────────────────────────────
await sc(`s.createStarterSet()`);
const [conv] = await sc(`s.get().scenarios.map((x) => x.id)`);
await sc(`s.setCategoryRule("brick_masonry", { kind: "recycling", recoveryPct: 80, residual: null }, ${JSON.stringify(conv)})`);
await b.sleep(1200);
check("scenario section lists the compared scenarios", (await all("[data-testid=carbon-card]", "e.innerText")).length === 3);
let brickCell = () => b.evaluate(`(() => { const e = document.querySelector("[data-testid=carbon-category-row][data-category=brick_masonry] [data-field=net]"); return e ? { text: e.innerText, status: e.dataset.status, title: e.title } : null; })()`);
const card0 = () => b.evaluate(`document.querySelectorAll("[data-testid=carbon-card]")[0].innerText`);
let cell = await brickCell();
check("recycling recovered but no rate / processing / transport: net is NOT ASSESSED (not 0), the missing inputs are named", cell && cell.status === "not_assessed" && /substitution rate: recycling/.test(cell.title) && /recycling processing impact/.test(cell.title) && /Not assessed/.test(await card0()), cell);
check("card says no categories are assessed (not 'partial 0')", /0 categories assessed/.test(await card0()) && !/PARTIAL/.test(await card0()));
check("missing inputs listed for the scenario", /substitution rate: recycling/.test((await all("[data-testid=carbon-missing]", "e.innerText"))[0] ?? ""));
check("scenarios that recover nothing say so", (await all("[data-testid=carbon-card]", "e.innerText"))[1].includes("No material recovered"));
check("sensitivity has nothing to vary while nothing is assessed (no fabricated base 0)", await exists("[data-testid=sens-empty]"));
await setField("rate-recycling", "120");
check("rate 120 % rejected with a message; nothing stored", !!(await text("[data-testid=rate-recycling-error]")) && (await cc(`s.get().assumptions.replacement.recycling`)) === null);
await setField("rate-recycling", "50");
check("rate 50 % stored", (await cc(`s.get().assumptions.replacement.recycling`)) === 50);
cell = await brickCell();
check("still not assessed with only the rate", cell.status === "not_assessed" && !/substitution rate/.test(cell.title) && /transport factor/.test(cell.title), cell.title);
await setField("transport-recoveredKm", "-1");
check("negative distance rejected", !!(await text("[data-testid=transport-recoveredKm-error]")) && (await cc(`s.get().assumptions.transport.recoveredKm`)) === null);
await setField("transport-recoveredKm", "10");
await setField("transport-factorKgPerTonneKm", "0.1");
await setField("process-brick_masonry", "20");
await setField("density-brick_masonry", "0");
check("density 0 rejected", !!(await text("[data-testid=density-brick_masonry-error]")) && (await cc(`s.get().assumptions.densityKgM3.brick_masonry`)) === undefined);
await setField("density-brick_masonry", "2000");
await b.sleep(900);
cell = await brickCell();
const expectNet = 62.4 * brickQ; // 0.8Q x (50 % x 200 - 20) - 0.8Q x 2 t/m3 x 10 km x 0.1
const priced = await b.evaluate(`(() => { const sid = window.__scenarios.get().scenarios[0]; const r = window.__carbon.scenario(sid); return r.categories.find((c) => c.category === "brick_masonry"); })()`);
check("hand calculation: avoided = 0.8Q x 50 % x 200 = 80Q", near(priced.avoided, 80 * brickQ, 2e-3), [priced.avoided, 80 * brickQ]);
check("hand calculation: processing = 0.8Q x 20 = 16Q", near(priced.processing, 16 * brickQ, 2e-3), priced.processing);
check("hand calculation: transport = 1.6Q t x 10 km x 0.1 = 1.6Q (density override 2,000 kg/m3)", near(priced.transport, 1.6 * brickQ, 2e-3), priced.transport);
check("hand calculation: potential net benefit = 62.4Q", near(priced.net, expectNet, 2e-3) && priced.status === "assessed", [priced.net, expectNet]);
check("the UI shows the same figure (3 significant digits)", cell.status === "assessed" && near(kg(cell.text), expectNet, 0.01), cell.text);
check("card shows the net, 1 category assessed, no longer 'Not assessed'", /1 categories assessed/.test(await card0()) && near(kg(await b.evaluate(`document.querySelector("[data-testid=carbon-net]").innerText`)), expectNet, 0.01));
check("recovered quantity is B4's allocation: 0.8 x Q m3", near(priced.recovered.recycling, 0.8 * brickQ, 2e-3));
check("brick is the only category that recovers material in this scenario", (await all("[data-testid=carbon-category-row]", "e.dataset.category")).join() === "brick_masonry");
await b.shot(`${OUT}/b5_scenarios.png`);

// sensitivity
await b.sleep(400);
const hi = await text(`[data-testid=sens-table] tr[data-key="replacement.recycling"] td:nth-child(4)`);
const lo = await text(`[data-testid=sens-table] tr[data-key="replacement.recycling"] td:nth-child(3)`);
check("sensitivity: rate +20 % -> 0.8Q x (60 % x 200 - 20) - 1.6Q = 78.4Q", near(kg(hi), 78.4 * brickQ, 0.01), hi);
check("sensitivity: rate -20 % -> 46.4Q", near(kg(lo), 46.4 * brickQ, 0.01), lo);
check("only inputs that are set are varied (direct reuse rate is not listed)", !(await exists(`[data-testid=sens-table] tr[data-key="replacement.direct"]`)));
check("emission factor is varied as a factor", await exists(`[data-testid=sens-table] tr[data-key="factor.brick_masonry"]`));

// reuse with an incomplete replacement assumption
await sc(`s.setCategoryRule("brick_masonry", { kind: "direct_reuse", recoveryPct: 100, residual: null }, ${JSON.stringify(conv)})`);
await b.sleep(900);
cell = await brickCell();
check("direct reuse without a replacement rate: not assessed, named", cell.status === "not_assessed" && /replacement rate: direct reuse/.test(cell.title), cell.title);
await setField("rate-direct", "0");
await b.sleep(700);
cell = await brickCell();
check("explicit 0 % replacement is an assessed zero benefit: net = - transport = -2Q", cell.status === "assessed" && near(kg(cell.text), -2 * brickQ, 0.01), cell.text);
await setField("rate-direct", "60");
await b.sleep(700);
cell = await brickCell();
check("60 % replacement: net = Q x 60 % x 200 - 2Q = 118Q", near(kg(cell.text), 118 * brickQ, 0.01), cell.text);
await sc(`s.setCategoryRule("brick_masonry", { kind: "recycling", recoveryPct: 80, residual: null }, ${JSON.stringify(conv)})`);
await b.sleep(500);

// disposal-only and unknown get no credit
await sc(`s.setCategoryRule("brick_masonry", { kind: "disposal", recoveryPct: null, residual: null }, ${JSON.stringify(conv)})`);
await b.sleep(700);
check("disposal earns no automatic credit: nothing recovered, nothing priced", !(await exists("[data-testid=carbon-category-row][data-category=brick_masonry]")) && /No material recovered/.test(await card0()));
await sc(`s.setCategoryRule("brick_masonry", { kind: "recycling", recoveryPct: 80, residual: null }, ${JSON.stringify(conv)})`);

// ── 6. illustrative demo set ────────────────────────────────────────────────────────────────
await click("[data-testid=factors-illustrative]");
await b.sleep(1000);
check("illustrative factors are loaded only for categories without one; the user's brick factor is kept", (await cc(`s.get().factors.get("brick_masonry").value`)) === 200 && (await cc(`s.get().factors.get("concrete").origin`)) === "illustrative");
check("banner, hatched bars and warnings mark illustrative use", (await exists("[data-testid=illustrative-banner]")) && /ILLUSTRATIVE/.test((await text("[data-testid=carbon-warnings]")) ?? ""));
check("coverage is partial and stated (components without a factor or mass are outside)", /\(\d+\.\d%\)/.test((await text("[data-testid=carbon-coverage]")) ?? ""));
const covPct = num((await text("[data-testid=carbon-coverage]")).match(/\((\d+\.\d)%\)/)[1]);
check("assessed share of components is below 100 %", covPct > 20 && covPct < 100, covPct);
await setInput(frow("concrete", "factor-value"), "0.2");
await enter(frow("concrete", "factor-value"));
await b.sleep(500);
check("editing an illustrative value makes it the user's (origin assumed, demo note removed)", (await cc(`s.get().factors.get("concrete").origin`)) === "assumed" && (await cc(`s.get().factors.get("concrete").note`)) === "");
await b.evaluate(`document.querySelector("[data-testid=carbon-body]").scrollTo(0, 0)`);
await b.sleep(300);
await b.shot(`${OUT}/b5_overview.png`);

// ── 7. view state with the highlight on ───────────────────────────────────────────────────────
await click("[data-testid=carbon-collapse]");
await cc(`s.highlightCategory("concrete", "Concrete · assessed", true)`);
await b.sleep(900);
const hm = await sc(`s.get().highlight.matches.map((m) => m.id)`);
const recById = await raw(`Object.fromEntries(${JSON.stringify(hm.slice(0, 5000))}.map((id) => [id, [byId.get(id).floor, byId.get(id).system]]))`);
const l1 = hm.find((id) => recById[id]?.[0] === 1 && recById[id]?.[1] === "structure");
const l2 = hm.find((id) => recById[id]?.[0] === 2 && recById[id]?.[1] === "structure");
await click("[data-testid=carbon-expand]");
await b.sleep(500);
await setSelect("[data-testid=isolate]", "L1");
await b.sleep(700);
check("floor isolation: highlighted F01 member visible with its tint, F02 member hidden", !!l1 && !!l2 && (await chainVisible(l1)) === true && (await tintOf(l1)) !== null && (await chainVisible(l2)) === false, [l1, l2]);
await setSelect("[data-testid=isolate]", "");
await b.sleep(400);
check("tint colour of an assessed highlight = teal", (await b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(l1)}).children.find((c) => c.name === "__scenario")?.material.color.getHexString()`)) === "1b7f8c");
await click("[data-testid=carbon-highlight-clear]");

// ── 8. conflicts: other workspaces take over; no stale highlight ────────────────────────────────
await cc(`s.highlightCategory("brick_masonry", "Brick · assessed", true)`);
await b.sleep(700);
check("highlight active", (await applied()) !== null);
await click("[data-testid=scenario-toggle]");
await b.sleep(900);
check("opening Scenarios closes Carbon and removes its highlight", (await exists("[data-testid=scenario-drawer]")) && !(await exists("[data-testid=carbon-drawer]")) && (await applied()) === null && (await sc(`s.get().highlight`)) === null);
await click("[data-testid=carbon-toggle]");
await b.sleep(800);
check("opening Carbon closes Scenarios", (await exists("[data-testid=carbon-drawer]")) && !(await exists("[data-testid=scenario-drawer]")));
await select(COL);
await click("[data-testid=open-recovery]");
await b.sleep(800);
check("inspector link to B2 takes over from Carbon", (await exists("[data-testid=recovery-drawer]")) && !(await exists("[data-testid=carbon-drawer]")));
await click("[data-testid=recovery-toggle]");
await b.sleep(300);
await b.evaluate(`window.__reloop.select(null)`);
await click("[data-testid=carbon-toggle]");
await b.sleep(600);
await cc(`s.highlightCategory("brick_masonry", "Brick · assessed", true)`);
await click("[data-testid=removal-toggle]");
await b.sleep(1100);
check("B3 drawer takes over: no carbon tint remains, B3 overlay runs", (await b.evaluate(`window.__scenarioOverlay === undefined`)) && (await b.evaluate(`!!window.__removalOverlay`)) && !(await exists("[data-testid=carbon-drawer]")));
await click("[data-testid=removal-toggle]");
await b.sleep(700);
check("closing B3 restores the model exactly", (await snap()).hash === snap0.hash && (await snap()).tints === 0);

// ── 9. persistence and bad saved data ───────────────────────────────────────────────────────────
const saved = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
await b.goto(`${BASE}/?view=full`);
await b.sleep(500);
check("factors and assumptions survive a reload", (await cc(`s.get().factors.get("brick_masonry").value`)) === 200 && (await cc(`s.get().assumptions.replacement.recycling`)) === 50 && (await cc(`s.get().assumptions.densityKgM3.brick_masonry`)) === 2000 && (await cc(`s.get().assumptions.transport.recoveredKm`)) === 10);
check("the workspace starts closed; the stored text is unchanged by loading", !(await exists("[data-testid=carbon-drawer]")) && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)) === saved);
for (const [label, value] of [["not JSON", "{no"], ["outdated version", JSON.stringify({ version: 0, factors: [{ category: "x", basis: "kg", value: 5 }] })]]) {
  await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(value)})`);
  await b.goto(`${BASE}/?view=full`);
  await b.sleep(400);
  check(`bad saved data (${label}) starts empty without errors`, (await cc(`s.get().factors.size`)) === 0 && (await cc(`s.get().assumptions.replacement.direct`)) === null);
}
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, factors: [{ category: "concrete", basis: "kg", value: -3, origin: "sourced" }, { category: "glass", basis: "parsec", value: 2, origin: "sourced", sourceName: "x" }], assumptions: { replacement: { direct: 500, recycling: 30 }, transport: { recoveredKm: -4, factorKgPerTonneKm: 0.2 } } }))})`);
await b.goto(`${BASE}/?view=full`);
await b.sleep(400);
check("invalid saved values are dropped to 'not set', never repaired to a guess", (await cc(`s.get().factors.get("concrete").value`)) === null && (await cc(`s.get().factors.get("glass").basis`)) === "kg" && (await cc(`s.get().assumptions.replacement.direct`)) === null && (await cc(`s.get().assumptions.replacement.recycling`)) === 30 && (await cc(`s.get().assumptions.transport.recoveredKm`)) === null && (await cc(`s.get().assumptions.transport.factorKgPerTonneKm`)) === 0.2);

// ── 10. nothing else changed ────────────────────────────────────────────────────────────────────
await b.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
await b.goto(`${BASE}/?view=full`);
await b.sleep(500);
check("B1: records and quantities unchanged", (await recordsHash()) === rec0);
check("B2: no assessment was ever written by carbon work", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === null);
check("B3: plan unchanged", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B3KEY)})`)) === b3Before);
const b4now = JSON.parse(await b.evaluate(`localStorage.getItem(${JSON.stringify(B4KEY)})`));
check("B4: scenarios hold only what B4 put there (rules, no carbon)", b4now.scenarios.length === 3 && !/kgCO|factor|carbon/i.test(JSON.stringify(b4now)));
check("the model is exactly as at the start (materials, visibility, instance matrices, no tints)", (await snap()).hash === snap0.hash && (await snap()).tints === 0);
r.statsEnd = await b.evaluate(`window.__reloop.stats(false)`);
check("draw calls and triangles as at the start", r.statsEnd.drawCalls === r.statsBefore.drawCalls && r.statsEnd.triangles === r.statsBefore.triangles);

await finish(0);
