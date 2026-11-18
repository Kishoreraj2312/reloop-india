// B4 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the Scenarios workspace, create the three
// templates and set the B2 assessment of one real column; the rest drives form controls. Checks (all against the REAL building):
//   workspace opens (draw calls unchanged, wide drawer, controls panel shifts), the three templates compare, numbers in the UI match the
//   hand calculation (column 0.729 m3 x 60 % = 0.4374 m3) and the engine, outcomes reconcile, missing recovery % stays visible as
//   unavailable/unknown, invalid % is rejected with the stored rule untouched, residual destination, component and assembly overrides,
//   rename / duplicate (independent) / reset / delete, persistence across reloads (and corrupt saved data), 3D highlight identity (the
//   tinted ids are exactly the matched leaf ids, with the right materials), exact restore (hash) after clear / close, B2 colouring
//   suspended and resumed, B3 simulation taking priority, floor isolation / layers / X-ray / exploded view with the highlight on,
//   B1 / B2 / B3 data untouched, console clean.
// Screenshots go to docs/screenshots/b4. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/b4";
const KEY = "rematter.scenarios.v1";
const B2KEY = "rematter.recovery.assessments.v1";
const B3KEY = "rematter.removal.plans.v1";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const r = {};
const checks = {};
const failures = [];
const check = (name, cond, detail) => {
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
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no select ${sel}"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no input ${sel}"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
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
const rowSel = (id) => `[data-testid=scenario-row][data-id="${id}"]`;
const openScenarios = async () => { if (!(await exists("[data-testid=scenario-drawer]"))) { await click("[data-testid=scenario-toggle]"); await b.sleep(900); } };
const closeScenarios = async () => { if (await exists("[data-testid=scenario-drawer]")) { await click("[data-testid=scenario-close]"); await b.sleep(500); } };
const cell = (table, pathway, scenarioIdx, field) => text(`[data-testid=${table}] tr[data-pathway=${pathway}] td[data-field=${field}][data-scenario="${scenarioIdx}"]`);
const num = (t) => (t === null ? null : Number(String(t).split("\n")[0].replace(/[^0-9.\-]/g, ""))); // first line: a cell may carry a delta line under its value
const near = (a, bb, tol = 1e-6) => a !== null && Math.abs(a - bb) <= tol * Math.max(1, Math.abs(bb));
const flowText = (i) => b.evaluate(`[...document.querySelectorAll("[data-testid=flow-row]")][${i}]?.innerText ?? null`);

const COL = "STR-COL-F01-A1"; // 0.729 m3 concrete column
const CONCRETE_MATERIALS = ["rcc_conceptual", "lintel_rcc_ext", "lintel_rcc_int", "concrete_fin", "concrete_band", "concrete_balcony"];

// ── 0. start clean ────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`[${JSON.stringify(KEY)}, ${JSON.stringify(B2KEY)}, ${JSON.stringify(B3KEY)}].forEach((k) => localStorage.removeItem(k))`);
await b.goto(`${BASE}/?view=full`);
const snap0 = await snap();
const col0 = await meshColour(COL);
r.statsBefore = await b.evaluate(`window.__reloop.stats(false)`);
const recordsHash = () => raw(`(() => { let h = 0; for (const r of recs) { const s = r.id + r.floor + r.originalPosition.join() + r.quantity + r.unit + r.materialId; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return h; })()`);
const rec0 = await recordsHash();
const leafIds = await raw(`recs.filter((x) => x.geometry.kind !== "group").map((x) => x.id)`);
// the category rows below are on the m3 tab, so the highlight is the concrete components measured in m3
const drawnConcrete = await raw(`recs.filter((x) => x.geometry.kind !== "group" && x.unit === "m3" && ${JSON.stringify(CONCRETE_MATERIALS)}.includes(x.materialId)).map((x) => x.id)`);
const m3Leaves = await raw(`recs.filter((x) => x.geometry.kind !== "group" && x.unit === "m3" && x.quantity > 0).map((x) => x.id)`);
r.leafCount = leafIds.length;
r.concreteLeafCount = drawnConcrete.length;

// ── 1. a B3 plan exists (planning context) and one real column gets a B2 assessment through the real UI ───────────────
await b.evaluate(`window.__removal.createPlan("Context plan"); window.__removal.addEntries([${JSON.stringify(COL)}])`);
const b3Before = await b.evaluate(`localStorage.getItem(${JSON.stringify(B3KEY)})`);
await select(COL);
await click("[data-testid=open-recovery]");
await b.sleep(900);
await setSelect("[data-testid=rec-classification]", "recycling");
await b.sleep(300);
await typePct("[data-testid=rec-pct]", "60");
const b2Before = await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`);
check("B2 assessment saved through the real UI", !!b2Before && JSON.parse(b2Before).entries.some(([id, a]) => id === COL && a.classification === "recycling" && a.recoveryPct === 60));
await click("[data-testid=recovery-toggle]");
await b.sleep(500);
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(300);

// ── 2. open the workspace with a real click ──────────────────────────────────────────────
await click("[data-testid=scenario-toggle]");
await b.sleep(1200);
check("workspace opens", await exists("[data-testid=scenario-drawer]"));
const dw = await b.evaluate(`${q("[data-testid=scenario-drawer]")}.getBoundingClientRect().width`);
check("wide workspace (900 px at this viewport)", dw >= 899 && dw <= 901, dw);
const lay = await b.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const v = r("[data-testid=viewport]"), d = r("[data-testid=dock]"), l = r("[data-testid=controls]"); return { vl: v.left, vr: v.right, vw: v.width, dl: d.left, dr: d.right, lr: l.right, iw: innerWidth }; })()`);
check("the model's viewport sits beside the workspace: the columns touch, nothing overlaps, the model keeps at least 440 px", Math.abs(lay.vr - lay.dl) <= 1 && Math.abs(lay.lr - lay.vl) <= 1 && Math.abs(lay.dr - lay.iw) <= 1 && lay.vw >= 440, lay);
check("empty state offers the templates; nothing saved yet", (await exists("[data-testid=scenario-empty]")) && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)) === null);
r.statsOpen = await b.evaluate(`window.__reloop.stats(false)`);
check("opening the workspace does not change draw calls", r.statsOpen.drawCalls === r.statsBefore.drawCalls && r.statsOpen.triangles === r.statsBefore.triangles);
check("the other drawers closed (one drawer at a time)", !(await exists("[data-testid=recovery-drawer]")) && !(await exists("[data-testid=removal-drawer]")));

// ── 3. the three templates ──────────────────────────────────────────────────────────────
await click("[data-testid=scenario-starter]");
await b.sleep(1500);
const ids = await sc(`s.get().scenarios.map((x) => x.id)`);
const [conv, sel, rf] = ids;
const names = await sc(`s.get().scenarios.map((x) => x.name)`);
check("three scenarios created from the templates", ids.length === 3 && names.join("|") === "Conventional demolition|Selective deconstruction|Reuse-first", names);
check("all three are compared", (await sc(`s.get().compareIds.length`)) === 3 && sameSet(await all("[data-testid=scenario-compare]:checked", "1"), ["1", "1", "1"]));
const sel0 = await sc(`s.scenario(${JSON.stringify(sel)})`);
check("selective scope = the categories assessed in B2 (concrete only)", JSON.stringify(sel0.scope) === '["concrete"]', sel0.scope);
check("template defaults: residual / baseline", (await sc(`s.scenario(${JSON.stringify(conv)}).residual`)) === "disposal" && (await sc(`s.scenario(${JSON.stringify(rf)}).residual`)) === "unknown" && (await sc(`s.scenario(${JSON.stringify(rf)}).scope`)) === null);
const saved1 = JSON.parse(await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`));
check("saved as assumptions only (no quantities or results)", saved1.scenarios.length === 3 && Object.keys(saved1.scenarios[0]).sort().join() === "baseline,categoryRules,componentRules,id,name,residual,scope,template", Object.keys(saved1.scenarios[0]));
await b.shot(`${OUT}/b4_overview.png`);

// ── 4. the numbers in the UI ────────────────────────────────────────────────────────────
const engine = (id) => sc(`(() => { const r = s.result(s.scenario(${JSON.stringify(id)})); return r.quantity.totals.map((t) => ({ unit: t.unit, available: t.available, div: t.diversionPct, dis: t.disposalPct, unk: t.unknownPct })); })()`);
const eConv = await engine(conv);
const eSel = await engine(sel);
const eRf = await engine(rf);
await setSelect("[data-testid=scenario-basis]", "quantity");
const m3Tab = await exists("[data-testid=unit-tab][data-unit=m3]");
check("one tab per unit (units never added together)", m3Tab && (await all("[data-testid=unit-tab]", "e.dataset.unit")).sort().join() === "m,m2,m3,nr", await all("[data-testid=unit-tab]", "e.dataset.unit"));
await click("[data-testid=unit-tab][data-unit=m3]");
await b.sleep(400);
const f0 = await flowText(0);
const f1 = await flowText(1);
const f2 = await flowText(2);
const m3 = (e) => e.find((t) => t.unit === "m3");
check("conventional: 0.0% diverted, 100% disposal (no recovery rate invented)", /0\.0% diverted · 100\.0% disposal · 0\.0% unknown/.test(f0 ?? ""), f0);
check("reuse-first with one assessment: ~0% diverted, rest unknown, no disposal", /\b0\.0% disposal/.test(f2 ?? "") && /unknown/.test(f2 ?? ""), f2);
check("UI flow figures equal the engine's (m3, three scenarios)", [[f0, eConv], [f1, eSel], [f2, eRf]].every(([f, e]) => (f ?? "").includes(`${m3(e).div.toFixed(1)}% diverted`) && (f ?? "").includes(`${m3(e).dis.toFixed(1)}% disposal`) && (f ?? "").includes(`${m3(e).unk.toFixed(1)}% unknown`)), [f0, f1, f2]);
check("same B1 quantity under every scenario", [eSel, eRf].every((e) => m3(e).available === m3(eConv).available));

// whole-building indicator
const wb = await all("[data-testid=wb-card]", "({ reliable: e.dataset.reliable, text: e.innerText })");
check("whole-building indicator shown with its data coverage (mass covers >= 90 % of solid volume)", wb.length === 3 && wb.every((w) => w.reliable === "true" && /solid volume/.test(w.text) && /of \d+ components|components \(/.test(w.text)), wb[0]?.text);

// category row -> detail, hand calculation
await click("[data-testid=category-row][data-category=concrete]");
await b.sleep(900);
check("category detail opens", await exists("[data-testid=category-detail][data-category=concrete]"));
const rec1 = num(await cell("detail-table", "recycling", 1, "outcome"));
const disp1 = num(await cell("detail-table", "disposal", 1, "outcome"));
check("selective: column 0.729 m3 x 60 % = 0.437 m3 recycled", near(rec1, 0.437, 1e-3), rec1);
check("selective: unrecovered 40 % of 0.729 = 0.292 m3 to disposal (the rest of the selected category is unassessed, hence unknown)", near(disp1, 0.292, 1e-3), disp1);
const avail = num(await text(`[data-testid=detail-table] td[data-field=available]`));
const unk1 = num(await cell("detail-table", "unknown", 1, "outcome"));
check("selective: unknown = available - 0.729", near(unk1, avail - 0.729, 2e-3), [avail, unk1]);
check("outcomes reconcile in every scenario column", (await all("[data-testid=detail-table] td[data-field=reconciled]", "e.dataset.ok")).every((x) => x === "true"));
check("conventional: disposal = available", near(num(await cell("detail-table", "disposal", 0, "outcome")), avail, 1e-6));
const allocRec = num(await cell("detail-table", "recycling", 1, "allocated"));
check("allocated (before recovery) 0.729 m3 vs outcome 0.437 m3 shown separately", near(allocRec, 0.729, 1e-3), allocRec);
check("a category click highlights the real components", !!(await sc(`s.get().highlight`)) && (await text("[data-testid=highlight-label]")).includes("Concrete"));
await b.sleep(500);
await b.shot(`${OUT}/b4_category_detail.png`);

// ── 5. 3D highlight identity ───────────────────────────────────────────────────────────
const hl = await sc(`s.get().highlight`);
const ovl = await applied();
const allApplied = ovl ? Object.values(ovl).flat() : [];
const matches = await sc(`s.matches(s.get().highlight, "quantity").map((m) => m.id)`);
check("category highlight (Concrete · m3) = exactly the concrete leaf components measured in m3", sameSet(matches, drawnConcrete), [matches.length, drawnConcrete.length]);
check("every tinted component is a concrete leaf with a drawn mesh", allApplied.length > 0 && allApplied.every((id) => drawnConcrete.includes(id)) && sameSet(allApplied, matches.filter((id) => allApplied.includes(id))));
check("tinted ids are leaf components, never assemblies", allApplied.every((id) => leafIds.includes(id)));
check("the column mesh carries a tint child coloured by its outcome (conventional: disposal)", (await tintOf(COL)) === "d55e00", await tintOf(COL));
check("highlight bar shows the count", /\d/.test(await text("[data-testid=highlight-count]")));
// an outcome click on the selective scenario's flow bar: only the column recycles
await click("[data-testid=highlight-clear]");
await b.sleep(300);
check("clear removes every tint and restores the model exactly", (await applied()) === null && (await snap()).hash === snap0.hash && (await snap()).tints === 0);
await clickAt(`document.querySelectorAll("[data-testid=flow-bar]")[0].querySelector("[data-outcome=disposal]")`);
await b.sleep(900);
const ovlBar = await applied();
check("clicking the disposal segment of the conventional bar highlights exactly the m3 components (all disposal)", ovlBar && sameSet(ovlBar.disposal, m3Leaves) && ovlBar.recycling.length === 0 && /Conventional demolition: Disposal/.test((await text("[data-testid=highlight-label]")) ?? ""), ovlBar && ovlBar.disposal.length);
await click("[data-testid=highlight-clear]");
await b.sleep(300);
await click("[data-testid=totals-table] tr[data-pathway=recycling] td[data-field=outcome][data-scenario=\"1\"]");
await b.sleep(900);
const ovl2 = await applied();
check("selective: outcome 'recycling' highlights exactly the assessed column", ovl2 && sameSet(ovl2.recycling, [COL]) && ovl2.disposal.length === 0 && ovl2.unknown.length === 0, ovl2 && { r: ovl2.recycling.length });
check("tint colour = recycling blue", (await tintOf(COL)) === "0072b2", await tintOf(COL));

// ── 6. the selected component: existing inspector + B2 + its outcomes + an override ────────
await select(COL);
check("selecting the component opens the existing inspector", (await inspectorId()) === COL);
check("inspector shows the B2 assessment line and the scenario outcomes", /Recycling/.test((await text("[data-testid=recovery-info]")) ?? "") && /Selective deconstruction: recycling 0\.437 m³/.test((await text("[data-testid=scenario-info]")) ?? ""), await text("[data-testid=scenario-info]"));
check("selected component card lists each scenario's outcome", (await exists("[data-testid=selected-component]")) && (await all("[data-testid=selected-outcomes] tr[data-scenario]", "e.innerText")).length === 3);
check("the outline replaces the tint on the selected component", (await tintOf(COL)) === null);
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(300);

// ── 7. B2 colouring and B3 simulation conflicts ────────────────────────────────────────
await click("[data-testid=highlight-clear]");
await closeScenarios();
await click("[data-testid=recovery-toggle]");
await b.sleep(700);
await click("[data-testid=recovery-colour]");
await b.sleep(900);
check("B2 colouring on (recycling blue)", (await meshColour(COL)) === "0072b2", await meshColour(COL));
await click("[data-testid=scenario-toggle]");
await b.sleep(900);
check("workspace replaces the recovery drawer; B2 colouring continues while nothing is highlighted", (await exists("[data-testid=scenario-drawer]")) && !(await exists("[data-testid=recovery-drawer]")) && (await meshColour(COL)) === "0072b2");
await click("[data-testid=category-row][data-category=concrete]");
await b.sleep(900);
check("highlight on: B2 colouring suspended (original material back), tint drawn", (await meshColour(COL)) === col0 && (await tintOf(COL)) !== null, [await meshColour(COL), await tintOf(COL)]);
await click("[data-testid=highlight-clear]");
await b.sleep(700);
check("highlight cleared: B2 colouring resumes", (await meshColour(COL)) === "0072b2" && (await applied()) === null);
await click("[data-testid=category-row][data-category=concrete]");
await b.sleep(700);
await closeScenarios();
await b.sleep(700);
check("closing the workspace removes the highlight and B2 colouring resumes", (await applied()) === null && (await snap()).tints === 0 && (await meshColour(COL)) === "0072b2");
await click("[data-testid=recovery-toggle]");
await b.sleep(700);
await click("[data-testid=recovery-colour]");
await b.sleep(900);
check("B2 colouring off restores the original colour", (await meshColour(COL)) === col0);
await click("[data-testid=recovery-toggle]");
await b.sleep(400);

// B3: simulation takes priority; workspace and highlight leave no trace
await openScenarios();
await b.sleep(900);
check("reopening the workspace restores the highlight selection", (await applied()) !== null);
await click("[data-testid=removal-toggle]");
await b.sleep(1200);
check("removal drawer replaces the workspace; no scenario tint remains", (await exists("[data-testid=removal-drawer]")) && !(await exists("[data-testid=scenario-drawer]")) && (await applied()) === null && (await b.evaluate(`window.__scenarioOverlay === undefined`)));
check("B3 overlay runs: the planned column is marked by B3 alone", (await b.evaluate(`!!window.__removalOverlay && [...window.__removalOverlay.planned, ...window.__removalOverlay.blocked].includes(${JSON.stringify(COL)})`)));
check("only B3 tints are on the column", (await b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(COL)}).children.filter((c) => c.name === "__scenario").length`)) === 0);
await click("[data-testid=removal-toggle]"); // close B3
await b.sleep(700);
check("closing B3 restores the model exactly", (await snap()).hash === snap0.hash && (await snap()).tints === 0);
check("the B3 plan is untouched by B4", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B3KEY)})`)) === b3Before);
// inspector link from an open workspace
await openScenarios();
await select(COL);
await click("[data-testid=open-recovery]");
await b.sleep(800);
check("inspector 'assess recovery' link takes over from the workspace", (await exists("[data-testid=recovery-drawer]")) && !(await exists("[data-testid=scenario-drawer]")));
await click("[data-testid=recovery-toggle]");
await b.sleep(300);
await b.evaluate(`window.__reloop.select(null)`);

// ── 8. view state with the highlight on: floor isolation, layers, X-ray, exploded view ─────────
await openScenarios();
if (await exists("[data-testid=highlight-clear]")) await click("[data-testid=highlight-clear]"); // the earlier selection is restored on reopening; start from a known state
await click("[data-testid=category-row][data-category=concrete]");
await b.sleep(900);
const hlIds = (await sc(`s.matches(s.get().highlight, "quantity").map((m) => m.id)`));
const recById = await raw(`Object.fromEntries(${JSON.stringify(hlIds.slice(0, 4000))}.map((id) => [id, [byId.get(id).floor, byId.get(id).system]]))`);
// fold the workspace to see the whole model: the highlight stays on, the dock is gone and the viewport gets the right edge back
await click("[data-testid=scenario-collapse]");
await b.sleep(900);
const folded = await b.evaluate(`(() => { const v = document.querySelector("[data-testid=viewport]").getBoundingClientRect(); const l = document.querySelector("[data-testid=controls]").getBoundingClientRect(); const c = document.querySelector("[data-testid=scenario-collapsed]")?.getBoundingClientRect(); return { vr: v.right, iw: innerWidth, cardLeft: c ? c.left : null, sidebarRight: l.right }; })()`);
check("folding the workspace keeps the highlight, returns the right edge to the viewport and keeps the summary card clear of the sidebar", (await exists("[data-testid=scenario-collapsed]")) && !(await exists("[data-testid=scenario-drawer]")) && (await applied()) !== null && folded.vr >= folded.iw - 1 && folded.cardLeft !== null && folded.cardLeft >= folded.sidebarRight && /Concrete/.test((await text("[data-testid=collapsed-label]")) ?? ""), [folded, await text("[data-testid=collapsed-label]")]);
await b.evaluate(`window.__reloop.setView([46, 30, 52], [0, 9, 0])`);
await b.sleep(700);
await b.shot(`${OUT}/b4_highlight_3d.png`);
await click("[data-testid=scenario-expand]");
await b.sleep(700);
check("expanding brings the workspace back with the same highlight", (await exists("[data-testid=scenario-drawer]")) && (await applied()) !== null);
const l1 = hlIds.find((id) => recById[id]?.[0] === 1 && recById[id]?.[1] === "structure");
const l2 = hlIds.find((id) => recById[id]?.[0] === 2 && recById[id]?.[1] === "structure");
check("test components found", !!l1 && !!l2, [l1, l2]);
await setSelect("[data-testid=isolate]", "L1");
await b.sleep(700);
check("floor isolation: highlighted F01 member visible with its tint, F02 member hidden", (await chainVisible(l1)) === true && (await tintOf(l1)) !== null && (await chainVisible(l2)) === false);
await setSelect("[data-testid=isolate]", "");
await b.sleep(500);
await click("[data-layer=structure]");
await b.sleep(500);
check("layer off: highlighted structure follows its layer (hidden)", (await chainVisible(l1)) === false);
await click("[data-layer=structure]");
await b.sleep(500);
check("layer back on: visible again with its tint", (await chainVisible(l1)) === true && (await tintOf(l1)) !== null);
await click("[data-testid=xray]");
await b.sleep(600);
check("X-ray on: highlight still drawn", (await applied()) !== null && (await tintOf(l1)) !== null);
await click("[data-testid=xray]");
await b.sleep(400);
// exploded view: the highlight must follow its sources. Instanced tints are checked on a tile category.
await click("[data-testid=highlight-clear]");
await b.evaluate(`window.__explode.store.setT(1)`);
await b.sleep(1200);
await click("[data-testid=unit-tab][data-unit=m2]");
await b.sleep(400);
await click("[data-testid=category-row][data-category=porcelain_tile]");
await b.sleep(1500);
const follow = await b.evaluate(`(() => {
  const root = window.__reloop.scene.getObjectByName("Building_G4"); let tints = 0, ok = 0, bad = 0; const key = (a, o) => { let s = ""; for (let i = 0; i < 16; i++) s += a[o + i].toFixed(4) + ","; return s; };
  root.traverse((o) => { if (!o.isInstancedMesh || o.name !== "__scenario") return; tints++; const src = o.parent; const have = new Set(); const sa = src.instanceMatrix.array; for (let i = 0; i < src.count; i++) have.add(key(sa, i * 16)); const ta = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) { if (have.has(key(ta, i * 16))) ok++; else bad++; } });
  return { tints, ok, bad };
})()`);
r.follow = follow;
check("exploded view (t = 1): instanced tints sit exactly on their displaced sources", follow.tints > 0 && follow.ok > 0 && follow.bad === 0, follow);
await click("[data-testid=scenario-collapse]");
await b.evaluate(`window.__reloop.setView([60, 45, 70], [0, 14, 0])`);
await b.sleep(900);
await b.shot(`${OUT}/b4_exploded_highlight.png`);
await click("[data-testid=scenario-expand]");
await b.sleep(500);
await click("[data-testid=highlight-clear]");
await b.evaluate(`window.__explode.store.setT(0)`);
await b.sleep(1200);
await click("[data-testid=unit-tab][data-unit=m3]");
await b.sleep(400);
const snapEx = await snap();
check("exploded view back to 0 and highlight cleared: exact restore", snapEx.tints === 0 && snapEx.hash === snap0.hash, snapEx);

// ── 9. management: rename, duplicate (independent), reset, delete ────────────────────────────
await b.evaluate(`window.__reloop.setView([60, 40, 60], [0, 8, 0])`);
await click(`${rowSel(sel)} [data-testid=scenario-rename]`);
await setInput("[data-testid=scenario-name-input]", "   ");
await click("[data-testid=scenario-rename-ok]");
check("empty name rejected, name unchanged", (await sc(`s.scenario(${JSON.stringify(sel)}).name`)) === "Selective deconstruction" && /name/.test((await text("[data-testid=scenario-message]")) ?? ""));
await setInput("[data-testid=scenario-name-input]", "Selective, concrete");
await click("[data-testid=scenario-rename-ok]");
check("rename", (await sc(`s.scenario(${JSON.stringify(sel)}).name`)) === "Selective, concrete");
await click(`${rowSel(sel)} [data-testid=scenario-duplicate]`);
await b.sleep(500);
const dupId = await sc(`s.get().activeId`);
check("duplicate is a new scenario, now being edited", dupId !== sel && (await sc(`s.get().scenarios.length`)) === 4 && (await sc(`s.scenario(${JSON.stringify(dupId)}).name`)) === "Selective, concrete (copy)");
check("three scenarios are already compared, so the copy is not added to the comparison", (await sc(`s.get().compareIds.length`)) === 3 && !(await sc(`s.get().compareIds.includes(${JSON.stringify(dupId)})`)));
// edit the copy through the real controls
await setSelect("[data-testid=cat-timber-kind]", "recycling");
await b.sleep(300);
await typePct("[data-testid=cat-timber-pct]", "30");
const dupRules = await sc(`s.scenario(${JSON.stringify(dupId)}).categoryRules`);
const origRules = await sc(`s.scenario(${JSON.stringify(sel)}).categoryRules`);
check("editing the copy leaves the original untouched", dupRules.timber?.kind === "recycling" && dupRules.timber?.recoveryPct === 30 && Object.keys(origRules).length === 0, [dupRules, origRules]);
check("a rule's pathway select writes the rule (recycling at 30 %)", dupRules.timber.residual === null);
// reset the copy
await click(`${rowSel(dupId)} [data-testid=scenario-reset]`);
await click("[data-testid=scenario-confirm]");
await b.sleep(300);
check("reset clears the overrides and restores the template defaults (id, name kept)", Object.keys(await sc(`s.scenario(${JSON.stringify(dupId)}).categoryRules`)).length === 0 && JSON.stringify(await sc(`s.scenario(${JSON.stringify(dupId)}).scope`)) === '["concrete"]');
check("the original was never touched by the copy's edits or reset", JSON.stringify(await sc(`s.scenario(${JSON.stringify(sel)}).categoryRules`)) === "{}");
await click(`${rowSel(dupId)} [data-testid=scenario-delete]`);
await click("[data-testid=scenario-confirm]");
await b.sleep(400);
check("delete removes the copy only", (await sc(`s.get().scenarios.length`)) === 3 && (await sc(`s.get().scenarios.every((x) => x.id !== ${JSON.stringify(dupId)})`)) && (await sc(`s.get().activeId`)) !== dupId);
await click(`${rowSel(sel)} [data-testid=scenario-name]`);
await b.sleep(300);

// ── 10. category rule: missing %, invalid %, residual, component / assembly override ─────────
await click(`${rowSel(conv)} [data-testid=scenario-name]`);
await b.sleep(400);
check("editing the conventional scenario", (await sc(`s.get().activeId`)) === conv);
await setSelect("[data-testid=cat-concrete-kind]", "recycling");
await b.sleep(600);
const concreteRule = await sc(`s.scenario(${JSON.stringify(conv)}).categoryRules.concrete`);
check("recycling chosen without a % keeps the % unset", concreteRule?.kind === "recycling" && concreteRule.recoveryPct === null, concreteRule);
await click("[data-testid=category-row][data-category=concrete]");
await b.sleep(300);
if (!(await exists("[data-testid=category-detail][data-category=concrete]"))) await click("[data-testid=category-row][data-category=concrete]");
await b.sleep(800);
const availC = num(await text(`[data-testid=detail-table] td[data-field=available]`));
check("no % set: recovered quantity shown as unavailable (n/a), not 0", (await exists("[data-testid=detail-table] [data-testid=recovered-unavailable]")), await text("[data-testid=detail-table]"));
check("no % set: the whole quantity is unknown", near(num(await cell("detail-table", "unknown", 0, "outcome")), availC, 1e-6) && near(num(await text(`[data-testid=detail-table] td[data-field=unconfigured]`)), availC, 1e-6));
const missText = await text("[data-testid=missing-list]");
check("missing assumption listed for the conventional scenario", /no recovery % set/.test(missText ?? ""), missText);
for (const bad of ["120", "-3", "abc"]) {
  await setInput("[data-testid=cat-concrete-pct]", bad);
  await enter("[data-testid=cat-concrete-pct]");
  await b.sleep(250);
  const err = await text("[data-testid=cat-concrete-error]");
  const stored = await sc(`s.scenario(${JSON.stringify(conv)}).categoryRules.concrete`);
  check(`invalid % "${bad}" rejected with a message; the stored rule is unchanged`, !!err && stored.recoveryPct === null && stored.kind === "recycling", [err, stored]);
}
await typePct("[data-testid=cat-concrete-pct]", "80");
check("80 % accepted", (await sc(`s.scenario(${JSON.stringify(conv)}).categoryRules.concrete.recoveryPct`)) === 80);
await b.sleep(700);
const rec80 = num(await cell("detail-table", "recycling", 0, "outcome"));
const dis80 = num(await cell("detail-table", "disposal", 0, "outcome"));
check("80 % recovery: recycled = 80 % of available, the 20 % residual to disposal", near(rec80, availC * 0.8, 2e-3) && near(dis80, availC * 0.2, 2e-3), [rec80, dis80, availC]);
await setSelect("[data-testid=cat-concrete-residual]", "unknown");
await b.sleep(600);
check("residual destination: 20 % to unknown, none to disposal", near(num(await cell("detail-table", "unknown", 0, "outcome")), availC * 0.2, 2e-3) && num(await cell("detail-table", "disposal", 0, "outcome")) === 0);
check("outcomes still reconcile", (await all("[data-testid=detail-table] td[data-field=reconciled]", "e.dataset.ok")).every((x) => x === "true"));
// 0 % and 100 %
await typePct("[data-testid=cat-concrete-pct]", "0");
await b.sleep(500);
check("0 % recovers nothing: all residual to unknown", num(await cell("detail-table", "recycling", 0, "outcome")) === 0 && near(num(await cell("detail-table", "unknown", 0, "outcome")), availC, 1e-6));
await typePct("[data-testid=cat-concrete-pct]", "100");
await b.sleep(500);
check("100 % recovers everything", near(num(await cell("detail-table", "recycling", 0, "outcome")), availC, 1e-6) && num(await cell("detail-table", "unknown", 0, "outcome")) === 0);
await typePct("[data-testid=cat-concrete-pct]", "80");
await b.sleep(500);
// component override through the selected-component card
await select(COL);
await b.sleep(600);
const recBefore = num(await cell("detail-table", "recycling", 0, "outcome"));
await setSelect("[data-testid=override-kind]", "disposal");
await b.sleep(900);
const recAfter = num(await cell("detail-table", "recycling", 0, "outcome"));
check("component override beats the category rule: the column's 80 % (0.583 m3) moves out of recycling", near(recBefore - recAfter, 0.729 * 0.8, 2e-3), [recBefore, recAfter]);
check("override stored in the scenario only", JSON.stringify(await sc(`s.scenario(${JSON.stringify(conv)}).componentRules`)) === JSON.stringify({ [COL]: { kind: "disposal", recoveryPct: null, residual: null } }));
check("B1 quantity and B2 assessment untouched by the override", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2Before);
await setSelect("[data-testid=override-kind]", "");
await b.sleep(700);
check("removing the override restores the category rule's result", near(num(await cell("detail-table", "recycling", 0, "outcome")), recBefore, 1e-9));
// assembly override: parts counted once
const asm = await raw(`recs.find((x) => x.componentType === "wall_assembly").id`);
const totalsBefore = await sc(`s.result(s.scenario(${JSON.stringify(conv)})).quantity.totals.map((t) => t.available)`);
const recycledTotal = () => sc(`s.result(s.scenario(${JSON.stringify(conv)})).quantity.rows.reduce((n, x) => n + x.outcome.recycling, 0)`);
const recycledBefore = await recycledTotal();
await select(asm);
await b.sleep(600);
check("assembly selected: card explains parts are counted individually", /parts are counted individually/.test((await text("[data-testid=selected-component]")) ?? ""));
await setSelect("[data-testid=override-kind]", "recycling");
await b.sleep(500);
await typePct("[data-testid=override-pct]", "50");
await b.sleep(900);
const totalsAfter = await sc(`s.result(s.scenario(${JSON.stringify(conv)})).quantity.totals.map((t) => t.available)`);
check("assembly override applies to its parts without double counting (available unchanged)", JSON.stringify(totalsBefore) === JSON.stringify(totalsAfter));
check("the wall's parts are recycled at 50 % under the assembly rule", (await recycledTotal()) > recycledBefore, [recycledBefore, await recycledTotal()]);
await setSelect("[data-testid=override-kind]", "");
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(400);

// ── 11. mass basis ──────────────────────────────────────────────────────────────────────
await setSelect("[data-testid=scenario-basis]", "mass");
await b.sleep(900);
check("mass basis: a single kg table (no unit tabs)", !(await exists("[data-testid=unit-tab]")) && /kg/.test((await text("[data-testid=totals-table]")) ?? ""));
await setSelect("[data-testid=scenario-basis]", "quantity");
await b.sleep(600);

// ── 12. what differs, missing assumptions, B3 context ─────────────────────────────────────
const diff = await text("[data-testid=differences]");
check("'what differs' states real assumption and result changes", /Template: /.test(diff ?? "") && /diverted/.test(diff ?? ""), diff?.slice(0, 300));
check("'what differs' compares each scenario with the first", (await all("[data-testid=difference-group]", "e.innerText")).length === 2);
check("'what differs' never invents causes", !/because|due to|therefore/i.test(diff ?? ""));
check("missing assumptions listed per scenario", (await all("[data-testid=missing-card]", "e.innerText")).length === 3 && /not assessed/.test(await text("[data-testid=missing-list]")));
check("B3 plan context: planning only, no claim of removal", /Context plan/.test((await text("[data-testid=removal-context]")) ?? "") && /does not show that anything has been removed/.test((await text("[data-testid=removal-context]")) ?? ""));
await click(`[data-testid=missing-item][data-code=not_assessed] button`);
await b.sleep(900);
const naIds = (await applied())?.unknown ?? [];
const naMatches = await sc(`s.matches(s.get().highlight, "quantity").map((m) => m.id)`);
check("a missing assumption highlights its components (grey = unknown)", naMatches.length > 1000 && naIds.length > 0 && naIds.every((id) => naMatches.includes(id)), [naMatches.length, naIds.length]);
await click("[data-testid=highlight-clear]");
await b.sleep(300);
await b.shot(`${OUT}/b4_three_way.png`);

// ── 13. persistence and bad saved data ───────────────────────────────────────────────────
const saved2 = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
await b.goto(`${BASE}/?view=full`);
await b.sleep(500);
check("scenarios survive a reload; the workspace starts closed", (await sc(`s.get().scenarios.map((x) => x.name).join("|")`)) === "Conventional demolition|Selective, concrete|Reuse-first" && !(await exists("[data-testid=scenario-drawer]")) && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)) === saved2);
check("rules and compare selection survive", (await sc(`s.scenario(${JSON.stringify(conv)}).categoryRules.concrete.recoveryPct`)) === 80 && (await sc(`s.get().compareIds.length`)) === 3);
await openScenarios();
check("saved scenarios compare immediately", (await all("[data-testid=flow-row]", "1")).length === 3);
await closeScenarios();
for (const [label, value] of [["not JSON", "{not json"], ["outdated version", JSON.stringify({ version: 0, scenarios: [{ id: "x", name: "old" }] })], ["invalid items", JSON.stringify({ version: 1, scenarios: [{ id: "a", name: "ok", template: "conventional", residual: "disposal", baseline: { kind: "disposal", recoveryPct: null, residual: null }, scope: null, categoryRules: { concrete: { kind: "recycling", recoveryPct: 900, residual: null } }, componentRules: { GONE: { kind: "disposal", recoveryPct: null, residual: null } } }, { id: "b", name: "bad", template: "nope" }] })]]) {
  await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(value)})`);
  await b.goto(`${BASE}/?view=full`);
  await b.sleep(400);
  const n = await sc(`s.get().scenarios.length`);
  const cr = await sc(`s.get().scenarios[0]?.categoryRules?.concrete ?? null`);
  if (label === "invalid items") check("bad saved data: invalid scenario dropped, invalid % cleared (never guessed), stale override kept", n === 1 && cr.recoveryPct === null && (await sc(`Object.keys(s.get().scenarios[0].componentRules).join()`)) === "GONE", [n, cr]);
  else check(`bad saved data (${label}) starts empty without errors`, n === 0);
}
await openScenarios();
await b.sleep(900);
check("a stale override is reported as a missing assumption, not silently applied", /Overrides that match no component/.test((await text("[data-testid=missing-list]")) ?? ""), await text("[data-testid=missing-list]"));
await closeScenarios();

// ── 14. nothing else changed ─────────────────────────────────────────────────────────────
await b.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
await b.goto(`${BASE}/?view=full`);
await b.sleep(400);
check("B1: records and quantities unchanged", (await recordsHash()) === rec0);
check("B2: assessments unchanged by all of the above", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2Before);
check("B3: plan unchanged", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B3KEY)})`)) === b3Before);
const snapEnd = await snap();
check("the model is exactly as it was at the start (materials, visibility, instance matrices, no tints)", snapEnd.hash === snap0.hash && snapEnd.tints === 0, snapEnd);
r.statsEnd = await b.evaluate(`window.__reloop.stats(false)`);
check("draw calls and triangles as at the start", r.statsEnd.drawCalls === r.statsBefore.drawCalls && r.statsEnd.triangles === r.statsBefore.triangles, [r.statsBefore.drawCalls, r.statsEnd.drawCalls]);

await finish(0);
