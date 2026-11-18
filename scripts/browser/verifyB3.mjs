// B3 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the Removal drawer, create and
// step through plans; the rest drives form controls. Checks (all against the REAL building):
//   blocked step and its explanation, "add blocking prerequisites" producing a valid plan, dependency direction against the raw
//   records, 3D highlighting (which ids are tinted/hidden), stepping and exact restore (visibility + instance matrices),
//   closing the drawer, persistence across reloads, duplicate independence, reorder + suggested order, an instanced
//   window/wall plan, B2 colour overlay precedence and restore, floor isolation / layers / X-ray while simulating, user-defined
//   dependencies (reason required, cycle), reset/delete without stale state, bad saved data, B1/B2 data untouched, clean console.
// Screenshots go to docs/screenshots/b3. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/b3";
const KEY = "rematter.removal.plans.v1";
const B2KEY = "rematter.recovery.assessments.v1";
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
  r.checks = checks;
  r.failed = failures;
  r.passed = Object.values(checks).filter(Boolean).length;
  r.total = Object.keys(checks).length;
  console.log(JSON.stringify(r, null, 1));
  await b.close();
  process.exit(code);
};
process.on("uncaughtException", async (e) => { r.error = String(e); await finish(1); });

const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const all = (sel, expr) => b.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => ${expr})`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "center" })`); await b.sleep(120); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
const select = async (id) => { await b.evaluate(`window.__reloop.select(${JSON.stringify(id)})`); await b.sleep(450); };
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const meshColour = (id) => b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(id)})?.material?.color?.getHexString() ?? null`);
const plainVisible = (id) => b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(id)})?.visible`);
const chainVisible = (name) => b.evaluate(`(() => { const o = window.__reloop.scene.getObjectByName(${JSON.stringify(name)}); if (!o) return null; for (let c = o; c; c = c.parent) if (!c.visible) return false; return true; })()`);
const hasTint = (id) => b.evaluate(`!!window.__reloop.scene.getObjectByName(${JSON.stringify(id)})?.children.some((c) => c.name === "__removal")`);
const instScaleZero = (id) => b.evaluate(`(() => { let res = null; window.__reloop.scene.traverse((o) => { if (res !== null || !o.isInstancedMesh || !Array.isArray(o.userData.componentIds)) return; const i = o.userData.componentIds.indexOf(${JSON.stringify(id)}); if (i < 0) return; const a = o.instanceMatrix.array; res = a[i * 16] === 0 && a[i * 16 + 5] === 0 && a[i * 16 + 10] === 0; }); return res; })()`);
const applied = () => b.evaluate(`window.__removalOverlay ? JSON.parse(JSON.stringify(window.__removalOverlay)) : null`);
const sameSet = (a, c) => a.length === c.length && [...a].sort().join("|") === [...c].sort().join("|");
const store = (expr) => b.evaluate(`(() => { const s = window.__removal; return ${expr}; })()`);
const rows = () => all("[data-testid=removal-row]", "e.dataset.id");
const rowState = (i) => b.evaluate(`${q(`[data-testid=removal-row][data-index="${i}"]`)}?.dataset.state`);
const cursor = async () => Number(await text("[data-testid=removal-cursor]"));
const nextDisabled = () => b.evaluate(`${q("[data-testid=removal-next]")}.disabled`);
const openRemoval = async () => { if (!(await exists("[data-testid=removal-drawer]"))) { await click("[data-testid=removal-toggle]"); await b.sleep(900); } };
const closeRemoval = async () => { if (await exists("[data-testid=removal-drawer]")) { await click("[data-testid=removal-toggle]"); await b.sleep(500); } };
const snapExpr = `(() => {
  const root = window.__reloop.scene.getObjectByName("Building_G4");
  let h = 0, hidden = 0, meshes = 0, tints = 0, inst = 0;
  const mix = (v) => { h = (Math.imul(h, 31) + Math.round(v * 1e4)) | 0; };
  root.traverse((o) => {
    if (o.name === "__removal") { tints++; return; }
    if (o.name.endsWith("__selection")) return;
    if (o.isMesh) { meshes++; if (!o.visible) hidden++; mix(o.visible ? 1 : 0);
      if (o.isInstancedMesh && Array.isArray(o.userData.componentIds)) { inst++; const a = o.instanceMatrix.array; for (let i = 0; i < a.length; i++) mix(a[i]); mix(o.count); } }
  });
  return { meshes, inst, hiddenPlain: hidden, tints, hash: h };
})()`;
const snap = () => b.evaluate(snapExpr);
const raw = (expr) => b.evaluate(`(() => { const recs = window.__reloop.records; const byId = new Map(recs.map((r) => [r.id, r])); return ${expr}; })()`);

const COL = "STR-COL-G-A1";

// ── 0. start clean ────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)}); localStorage.removeItem(${JSON.stringify(B2KEY)})`);
await b.goto(`${BASE}/?view=full`);
const snap0 = await snap();
const col0 = await meshColour(COL);
r.statsBefore = await b.evaluate(`window.__reloop.stats(false)`);
const cam0 = await b.evaluate(`JSON.stringify({ p: window.__reloop.camera.position.toArray(), q: window.__reloop.camera.quaternion.toArray() })`);
r.snap0 = snap0;
const b1Before = await raw(`JSON.stringify(recs.slice(0, 6000).map((x) => [x.id, x.quantity, x.unit]))`);
const closure = await raw(`(() => { const rev = new Map(); for (const x of recs) if (x.system === "structure") for (const d of x.dependencies) (rev.get(d) ?? rev.set(d, []).get(d)).push(x.id); const out = new Set(); const st = [${JSON.stringify(COL)}]; while (st.length) { const c = st.pop(); for (const x of rev.get(c) ?? []) if (!out.has(x)) { out.add(x); st.push(x); } } return [...out]; })()`);
const colDirect = await raw(`recs.filter((x) => x.dependencies.includes(${JSON.stringify(COL)})).map((x) => x.id)`); // what bears on the column (raw, stored direction)
const colBearsOn = await raw(`byId.get(${JSON.stringify(COL)}).dependencies`); // what the column bears on
r.closureSize = closure.length;

// ── 1. open with a real click; nothing changes in the scene until a plan exists ──────────────
await click("[data-testid=removal-toggle]");
await b.sleep(1500);
check("drawer opens", await exists("[data-testid=removal-drawer]"));
const dw = await b.evaluate(`${q("[data-testid=removal-drawer]")}.getBoundingClientRect().width`);
check("the removal workspace is docked at the standard 560px width (the dock's 1px border included)", dw >= 559 && dw <= 561, dw);
check("empty state hint", /Create a plan/.test((await text("[data-testid=removal-hint]")) ?? ""));
r.statsOpen = await b.evaluate(`window.__reloop.stats(false)`);
check("opening the drawer does not change draw calls", r.statsOpen.drawCalls === r.statsBefore.drawCalls && r.statsOpen.triangles === r.statsBefore.triangles);
check("no overlay without a plan", (await applied()) === null && (await snap()).tints === 0);
await b.shot(`${OUT}/b3_empty.png`);

// ── 2. create + rename a plan ──────────────────────────────────────────────────────────────
await click("[data-testid=plan-new]");
await b.sleep(300);
check("plan created", (await text("[data-testid=removal-plan-select]"))?.includes("Removal plan 1 (0)"));
await click("[data-testid=plan-rename]");
await setInput("[data-testid=plan-name-input]", "Column G-A1 removal");
await b.evaluate(`${q("[data-testid=plan-name-input]")}.form.requestSubmit()`);
await b.sleep(300);
check("plan renamed", (await text("[data-testid=removal-plan-select]"))?.includes("Column G-A1 removal (0)"));

// ── 3. add the column: blocked, with an explanation from the model's own relationships ──────────
await select(COL);
check("inspector line: not planned", /removal: not planned/.test((await text("[data-testid=removal-info]")) ?? ""));
await click("[data-testid=detail-add]");
await b.sleep(500);
check("one step, blocked", (await rows()).length === 1 && (await b.evaluate(`${q("[data-testid=removal-row]")}.dataset.blocked`)) === "true");
check("Next is disabled for a blocked step", await nextDisabled());
const status = (await text("[data-testid=removal-status]")) ?? "";
check("status says the step is blocked", /Step 1 \(STR-COL-G-A1\) is blocked/.test(status), status);
const blockers = (await text("[data-testid=removal-blockers]")) ?? "";
check("blocker names the prerequisite and the relationship", /Blocking prerequisite .* is not in the plan/.test(blockers) && /bears on STR-COL-G-A1/.test(blockers), blockers);
const finding = await b.evaluate(`(() => { const f = ${q("[data-testid=removal-finding][data-level=error]")}; return f ? f.dataset.code : null; })()`);
check("finding code is PREREQ_NOT_IN_PLAN", finding === "PREREQ_NOT_IN_PLAN", finding);
check("inspector line shows step and blocked", /step 1 of 1 · Planned · blocked/.test((await text("[data-testid=removal-info]")) ?? ""), await text("[data-testid=removal-info]"));
const a1 = await applied();
check("3D: nothing hidden; the missing prerequisites are shown as related components", a1 && a1.hidden.length === 0 && a1.planned.length === 0 && sameSet(a1.prerequisite, colDirect.filter((x) => x !== COL)), a1); // the focused column is outlined, not tinted
await b.shot(`${OUT}/b3_blocked_step.png`);

// ── 4. add blocking prerequisites (explicit action) → a valid, correctly ordered plan ───────────
const addLabel = (await text("[data-testid=add-prerequisites]")) ?? "";
check("button offers every prerequisite the raw records imply", addLabel.includes(`(${closure.length})`), { addLabel, expected: closure.length });
await click("[data-testid=add-prerequisites]");
await b.sleep(600);
const ids = await rows();
check("plan now has the prerequisites plus the column", ids.length === closure.length + 1 && ids[ids.length - 1] === COL, ids.length);
check("the prerequisites are exactly the raw reverse closure", sameSet(ids.slice(0, -1), closure));
const counts = (await text("[data-testid=removal-counts]")) ?? "";
check("0 blocked, 0 warnings", /0 blocked/.test(counts) && /0 advisory warnings/.test(counts), counts);
const order = await b.evaluate(`(() => { const ids = [...document.querySelectorAll("[data-testid=removal-row]")].map((e) => e.dataset.id); const idx = new Map(ids.map((x, i) => [x, i])); const recs = window.__reloop.records; let pairs = 0, bad = 0; for (const x of recs) { if (!idx.has(x.id)) continue; for (const d of x.dependencies) if (idx.has(d)) { pairs++; if (idx.get(x.id) >= idx.get(d)) bad++; } } return { pairs, bad }; })()`);
check("every 'bears on' pair in the plan is ordered supported-first", order.pairs > 0 && order.bad === 0, order);
check("slab before the beam it loads", ids.indexOf("STR-SLAB-F01-P01") < ids.indexOf("STR-BM-F01-X-A1-B1") && ids.indexOf("STR-BM-F01-X-A1-B1") < ids.indexOf(COL));
check("every step is ready or planned, none blocked", (await all("[data-testid=removal-row]", "e.dataset.blocked")).every((x) => x === "false"));

// ── 5. highlighting: prerequisites / dependents of the selected step, against the raw records ────
await click(`[data-testid=removal-row][data-id="${COL}"]`);
await b.sleep(600);
check("row click selects the component", (await inspectorId()) === COL);
const a2 = await applied();
const expectPre = colDirect.filter((x) => x !== COL);
check("prerequisites tinted = what bears on the column", a2 && sameSet(a2.prerequisite, expectPre), { got: a2?.prerequisite, expectPre });
check("dependents tinted = what the column bears on", a2 && sameSet(a2.dependent, colBearsOn), { got: a2?.dependent, colBearsOn });
check("planned tint = the remaining steps (related components win over the plan colour)", a2 && sameSet(a2.planned, ids.filter((x) => x !== COL && !expectPre.includes(x))), { planned: a2?.planned.length });
check("tint children exist on the related meshes", (await hasTint("STR-BM-F01-X-A1-B1")) && (await hasTint("STR-PED-G-A1")));
check("the focused column is outlined, not tinted", !(a2?.planned.includes(COL)) && (await b.evaluate(`!!window.__reloop.scene.getObjectByName(${JSON.stringify(COL)})?.children.some((c) => c.name.endsWith("__selection"))`)));
check("detail lists prerequisites and dependents", (await all("[data-testid=rel-prerequisites] [data-edge]", "e.dataset.edge")).length > 0 && (await all("[data-testid=rel-dependents] [data-edge]", "e.dataset.edge")).length === 1);
// the plan-layers control drives the existing layer toggles
check("plan layers are named", /Plan uses: Structure/.test((await text("[data-testid=plan-layers]")) ?? ""), await text("[data-testid=plan-layers]"));
await click("[data-testid=layers-plan-only]");
await b.sleep(500);
const layerState = await all("input[data-layer]", "[e.dataset.layer, e.checked]");
check("only the structure layer stays on", layerState.every(([l, on]) => on === (l === "structure")), layerState);
check("architecture hidden in 3D, structure shown", (await chainVisible("L1_architecture_exteriorWalls")) === false && (await chainVisible(COL)) === true);
check("'plan layers only' is disabled once applied", await b.evaluate(`${q("[data-testid=layers-plan-only]")}.disabled`));
const colPos = await raw(`byId.get(${JSON.stringify(COL)}).originalPosition`);
const out = Math.hypot(colPos[0], colPos[2]) || 1;
const camAt = (d, h) => `window.__reloop.setView([${colPos[0]} + ${d} * ${colPos[0] / out}, ${colPos[1] + h}, ${colPos[2]} + ${d} * ${colPos[2] / out}], [${colPos[0]}, ${colPos[1] + 6}, ${colPos[2]}])`;
await b.evaluate(camAt(26, 12));
await b.sleep(600);
await b.shot(`${OUT}/b3_valid_plan_highlights.png`);

// ── 6. stepping through the simulation ──────────────────────────────────────────────────────
check("starts at step 0", (await cursor()) === 0);
check("first step is ready for review", (await rowState(0)) === "ready_for_review" && (await rowState(ids.length - 1)) === "planned");
for (let k = 1; k <= 3; k++) await click("[data-testid=removal-next]");
check("cursor 3", (await cursor()) === 3);
check("first three steps are hidden in 3D", (await Promise.all(ids.slice(0, 3).map(plainVisible))).every((v) => v === false) && (await plainVisible(ids[3])) === true);
check("hidden set reported by the overlay", sameSet((await applied()).hidden, ids.slice(0, 3)));
check("states follow the cursor", (await rowState(0)) === "simulated_removed" && (await rowState(2)) === "simulated_removed" && ["planned", "ready_for_review"].includes(await rowState(3)));
check("selection moves to the next step", (await inspectorId()) === ids[3], await inspectorId());
check("engine removed set matches", (await store(`s.removed().size`)) === 3);
check("hidden component outline is not left floating", (await b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(ids[0])})?.children.some((c) => c.name.endsWith("__selection"))`)) === false);
for (let k = 4; k <= 10; k++) await click("[data-testid=removal-next]");
await b.evaluate(camAt(26, 12));
await b.sleep(500);
await b.shot(`${OUT}/b3_simulation_midway.png`);
for (let k = 11; k <= ids.length; k++) await click("[data-testid=removal-next]");
check("simulation completes", (await cursor()) === ids.length && (await nextDisabled()) && /Simulation complete/.test((await text("[data-testid=removal-status]")) ?? ""));
check("everything planned is hidden", (await Promise.all(ids.map(plainVisible))).every((v) => v === false));
await click("[data-testid=removal-prev]");
check("Previous restores the last step", (await cursor()) === ids.length - 1 && (await plainVisible(COL)) === true && (await inspectorId()) === COL);
await setSelect("[data-testid=removal-step-select]", "5");
await b.sleep(400);
check("jump to a step", (await cursor()) === 5 && (await plainVisible(ids[4])) === false && (await plainVisible(ids[5])) === true);
await click("[data-testid=removal-reset-sim]");
await b.sleep(400);
await click("[data-testid=layers-all]");
await b.sleep(400);
check("'All layers' turns every layer back on", (await all("input[data-layer]", "e.checked")).every(Boolean));
const snapReset = await snap();
check("reset restores every component exactly", (await cursor()) === 0 && snapReset.hash === snap0.hash && snapReset.hiddenPlain === 0 && snapReset.meshes === snap0.meshes, { snapReset, snap0 });

// ── 7. closing the drawer restores the normal model ─────────────────────────────────────────
for (let k = 0; k < 4; k++) await click("[data-testid=removal-next]");
check("simulation active before closing", (await snap()).hiddenPlain === 4);
await closeRemoval();
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(500);
const snapClosed = await snap();
check("closing the drawer shows the whole model again", snapClosed.hash === snap0.hash && snapClosed.tints === 0 && snapClosed.hiddenPlain === 0, snapClosed);
const statsClosed = await b.evaluate(`(() => { const c = window.__reloop.camera, s = ${JSON.stringify(cam0)}; const o = JSON.parse(s); c.position.fromArray(o.p); c.quaternion.fromArray(o.q); c.updateMatrixWorld(true); return window.__reloop.stats(false); })()`); // same camera as the "before" measurement
check("draw calls back to the original", statsClosed.drawCalls === r.statsBefore.drawCalls && statsClosed.triangles === r.statsBefore.triangles, { statsClosed, before: r.statsBefore });
check("overlay hook cleared", (await applied()) === null);
await openRemoval();
check("reopening resumes the same plan and cursor", (await rows()).length === ids.length && (await cursor()) === 4 && (await snap()).hiddenPlain === 4);
await click("[data-testid=removal-reset-sim]");

// ── 8. B2 colour overlay precedence ─────────────────────────────────────────────────────────
await click("[data-testid=recovery-toggle]");
await b.sleep(700);
check("recovery drawer replaces the removal drawer", (await exists("[data-testid=recovery-drawer]")) && !(await exists("[data-testid=removal-drawer]")));
await select(COL);
await setSelect("[data-testid=rec-classification]", "direct_reuse");
await b.sleep(300);
await setInput("[data-testid=rec-pct]", "60");
await b.evaluate(`${q("[data-testid=rec-pct]")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
await b.sleep(300);
await click("[data-testid=recovery-colour]");
await b.sleep(900);
check("B2 colouring on", (await meshColour(COL)) === "009e73", await meshColour(COL));
const b2Before = await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`);
await click("[data-testid=removal-toggle]");
await b.sleep(1000);
check("removal drawer back, B2 overlay suspended (original colour restored)", (await exists("[data-testid=removal-drawer]")) && (await meshColour(COL)) === col0, await meshColour(COL));
await click("[data-testid=removal-next]");
await click("[data-testid=removal-next]");
check("simulation runs on the original materials", (await snap()).hiddenPlain === 2 && (await meshColour(COL)) === col0);
await b.evaluate(`window.__reloop.setView([26, 16, 26], [3, 6, 3])`);
await b.sleep(500);
await b.shot(`${OUT}/b3_b2_suspended.png`);
await closeRemoval();
await b.sleep(900);
check("closing the simulation resumes B2 colouring", (await meshColour(COL)) === "009e73", await meshColour(COL));
const snapB2 = await snap();
check("nothing left hidden", snapB2.hash === snap0.hash && snapB2.tints === 0);
await click("[data-testid=recovery-toggle]");
await b.sleep(700);
await click("[data-testid=recovery-colour]");
await b.sleep(900);
check("switching B2 colouring off restores the original colour", (await meshColour(COL)) === col0, await meshColour(COL));
check("B2 assessments untouched by the removal work", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2Before);
await click("[data-testid=recovery-toggle]"); // close
await b.sleep(300);
await b.evaluate(`window.__reloop.select(null)`);

// ── 9. persistence across a reload; duplicate independence ────────────────────────────────
const saved = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
check("plan saved to localStorage", !!saved && JSON.parse(saved).plans[0].entries.length === ids.length && !("cursor" in JSON.parse(saved).plans[0]));
await b.goto(`${BASE}/?view=full`);
await openRemoval();
check("plan restored after reload", (await text("[data-testid=removal-plan-select]"))?.includes(`Column G-A1 removal (${ids.length})`) && sameSet(await rows(), ids));
check("reload starts the simulation at step 0", (await cursor()) === 0 && (await snap()).hiddenPlain === 0);
check("order preserved", (await rows()).join("|") === ids.join("|"));
await click("[data-testid=plan-duplicate]");
await b.sleep(400);
const planIds = await store(`s.get().plans.map((p) => p.id)`);
check("duplicate creates a second plan with the same sequence", planIds.length === 2 && (await rows()).join("|") === ids.join("|") && /\(copy\)/.test((await text("[data-testid=removal-plan-select]")) ?? ""));
await click(`[data-testid=removal-row][data-index="0"] [data-testid=row-remove]`);
await b.sleep(400);
check("editing the copy leaves the original alone", (await rows()).length === ids.length - 1 && (await store(`s.get().plans.find((p) => p.id === ${JSON.stringify(planIds[0])}).entries.length`)) === ids.length);
await setSelect("[data-testid=removal-plan-select]", planIds[0]);
await b.sleep(300);
check("switching plans", (await rows()).length === ids.length);

// ── 10. a wrong order: blocked, explained, fixed by an explicit action ─────────────────────────
await store(`s.moveEntry(${ids.length - 1}, 0)`);
await b.sleep(500);
const blockedRow0 = await b.evaluate(`${q(`[data-testid=removal-row][data-index="0"]`)}.dataset.blocked`);
check("moving the column first blocks it", (await rows())[0] === COL && blockedRow0 === "true");
check("Next stays disabled", await nextDisabled());
const st2 = (await text("[data-testid=removal-status]")) ?? "";
check("status names the next available step", /Next available: step \d+/.test(st2), st2);
check("order violation explained", /scheduled before its blocking prerequisite/.test((await text("[data-testid=removal-blockers]")) ?? ""));
await click("[data-testid=suggest-toggle]");
check("a valid order is offered, not applied", (await exists("[data-testid=suggest-apply]")) && (await rows())[0] === COL);
await click("[data-testid=suggest-apply]");
await b.sleep(400);
check("applying the suggestion fixes the plan", (await rows())[0] !== COL && /0 blocked/.test((await text("[data-testid=removal-counts]")) ?? "") && !(await exists("[data-testid=suggest-toggle]")));
await store(`s.moveEntry(${ids.length - 1}, 0)`);
await b.sleep(400);
await click("[data-testid=move-available-up]");
await b.sleep(400);
check("'move it' brings an available step to the cursor", (await b.evaluate(`${q(`[data-testid=removal-row][data-index="0"]`)}.dataset.blocked`)) === "false");
await store(`s.reset()`);
await store(`s.addEntries(${JSON.stringify(ids)})`); // back to the original plan (suggestion order = original here)
await b.sleep(300);

// ── 11. floor isolation, layers and X-ray while simulating ───────────────────────────────────
for (let k = 0; k < 6; k++) await click("[data-testid=removal-next]");
const hiddenBefore = (await applied()).hidden.length;
await setSelect("[data-testid=isolate]", "L1");
await b.sleep(700);
check("floor isolation still works", (await b.evaluate(`window.__reloop.scene.getObjectByName("Floor_L2").visible`)) === false && (await b.evaluate(`window.__reloop.scene.getObjectByName("Floor_L1").visible`)) === true);
check("simulation state unchanged by isolation", (await cursor()) === 6 && (await applied()).hidden.length === hiddenBefore);
const l1beam = ids.find((x) => /^STR-BM-F01-/.test(x) && ids.indexOf(x) >= 6);
check("tinted F01 member visible while isolated", l1beam ? (await chainVisible(l1beam)) === true : true);
const l2member = ids.find((x) => /^STR-BM-F02-/.test(x) && ids.indexOf(x) >= 6) ?? ids.find((x) => /^STR-SLAB-F02-/.test(x) && ids.indexOf(x) >= 6);
check("tinted F02 member hidden with its floor", l2member ? (await chainVisible(l2member)) === false : true, l2member);
await b.shot(`${OUT}/b3_floor_isolation.png`);
await setSelect("[data-testid=isolate]", "");
await click("[data-layer=structure]");
await b.sleep(500);
check("structure layer off hides the plan with it", (await chainVisible(COL)) === false);
await click("[data-layer=structure]");
await click("[data-testid=xray]");
await b.sleep(500);
check("x-ray on with the simulation shown", (await cursor()) === 6 && (await applied()).hidden.length === hiddenBefore);
await click("[data-testid=xray]");
await click("[data-testid=removal-reset-sim]");
check("layer controls restored and simulation reset", (await chainVisible(COL)) === true && (await snap()).hash === snap0.hash);

// ── 12. an instanced plan: window assembly before its host wall assembly ───────────────────────
await click("[data-testid=plan-new]");
const [win, wall] = await raw(`(() => { const hosts = new Map(); for (const x of recs) if (x.componentType === "window_assembly" || x.componentType === "door_assembly" || x.componentType === "cased_opening_assembly") for (const d of x.dependencies) if (byId.get(d).componentType === "wall_assembly") (hosts.get(d) ?? hosts.set(d, []).get(d)).push(x.id); for (const x of recs) if (x.componentType === "window_assembly") { const w = x.dependencies.find((d) => byId.get(d).componentType === "wall_assembly"); if (w && hosts.get(w).length === 1) return [x.id, w]; } return null; })()`);
const winLeaves = await raw(`recs.filter((x) => x.parentId === ${JSON.stringify(win)} && x.geometry.kind !== "group").map((x) => x.id)`);
await select(win);
await click("[data-testid=add-selected]");
await select(wall);
await click("[data-testid=add-selected]");
await b.sleep(400);
check("window then wall: valid", (await rows()).join("|") === `${win}|${wall}` && /0 blocked/.test((await text("[data-testid=removal-counts]")) ?? ""));
await store(`s.moveEntry(0, 1)`);
await b.sleep(300);
check("wall before its window is blocked (hosted_in)", (await b.evaluate(`${q(`[data-testid=removal-row][data-index="0"]`)}.dataset.blocked`)) === "true" && /hosts it|hosted in/.test((await text("[data-testid=removal-blockers]")) ?? ""), await text("[data-testid=removal-blockers]"));
await store(`s.moveEntry(1, 0)`);
await b.sleep(300);
await select(win);
await click("[data-testid=removal-next]");
const aW = await applied();
check("all window parts hidden (instance matrices scaled to zero)", sameSet(aW.hidden, winLeaves) && (await Promise.all(winLeaves.map(instScaleZero))).every((v) => v === true), { hidden: aW.hidden.length, leaves: winLeaves.length });
check("the wall is not hidden yet", (await instScaleZero(wall)) !== true);
const wp = await raw(`byId.get(${JSON.stringify(winLeaves[0])}).originalPosition`);
await b.evaluate(`window.__reloop.setView([${wp[0]} + 7, ${wp[1]} + 3, ${wp[2]} + 7], [${wp[0]}, ${wp[1]}, ${wp[2]}])`);
await b.sleep(600);
await b.shot(`${OUT}/b3_window_wall.png`);
await click("[data-testid=removal-next]");
check("wall parts hidden after the second step", (await applied()).hidden.length > winLeaves.length);
await click("[data-testid=removal-reset-sim]");
const snapW = await snap();
check("instances restored exactly", snapW.hash === snap0.hash && snapW.hiddenPlain === 0, snapW);

// ── 13. user-defined dependencies, cycle ────────────────────────────────────────────────────
await click("[data-testid=plan-new]");
const wins = await raw(`recs.filter((x) => x.componentType === "window_assembly").slice(0, 2).map((x) => x.id)`);
for (const w of wins) { await select(w); await click("[data-testid=add-selected]"); }
await select(wins[0]);
await setInput("[data-testid=user-dep-other]", wins[1]);
await click("[data-testid=user-dep-add]");
check("a reason is required", /reason is required/.test((await text("[data-testid=user-dep-error]")) ?? ""));
await setInput("[data-testid=user-dep-other]", "NOT-A-COMPONENT");
await setInput("[data-testid=user-dep-reason]", "scaffold");
await click("[data-testid=user-dep-add]");
check("unknown component rejected", /Unknown component/.test((await text("[data-testid=user-dep-error]")) ?? ""));
await setInput("[data-testid=user-dep-other]", wins[1]);
await click("[data-testid=user-dep-add]");
await b.sleep(400);
check("user dependency added", (await all("[data-testid=user-dep]", "e.innerText")).length === 1);
check("plan [w0, w1] with 'w0 after w1' is blocked by the user dependency", (await b.evaluate(`${q(`[data-testid=removal-row][data-index="0"]`)}.dataset.blocked`)) === "true" && /scaffold/.test((await text("[data-testid=removal-blockers]")) ?? ""), await text("[data-testid=removal-blockers]"));
const srcChip = await b.evaluate(`[...document.querySelectorAll("[data-testid=removal-finding] span")].some((s) => s.innerText === "user")`);
check("finding shows the user source", srcChip);
await select(wins[1]);
await click("[data-testid=user-dep-pick]");
await select(wins[0]);
check("pick in model fills the other end and returns to the edited component", (await b.evaluate(`${q("[data-testid=user-dep-other]")}.value`)) === wins[0] && (await inspectorId()) === wins[1], await b.evaluate(`${q("[data-testid=user-dep-other]")}.value`));
await setInput("[data-testid=user-dep-reason]", "w1 first for access");
await click("[data-testid=user-dep-add]");
await b.sleep(400);
const cyc = (await text("[data-testid=removal-counts]")) ?? "";
check("a circular dependency is reported", /1 circular/.test(cyc) && (await exists("[data-testid=removal-finding][data-code=CYCLE]")), cyc);
await b.shot(`${OUT}/b3_user_dependency_cycle.png`);
const deletes = await all("[data-testid=user-dep-delete]", "1");
for (let k = 0; k < deletes.length; k++) await click("[data-testid=user-dep-delete]");
await b.sleep(300);
check("deleting user dependencies clears the blockers", /0 blocked/.test((await text("[data-testid=removal-counts]")) ?? "") && !(await exists("[data-testid=user-dep]")));

// ── 14. reset and delete leave no stale state ───────────────────────────────────────────────
await click("[data-testid=removal-next]");
check("a step is simulated", (await snap()).hiddenPlain + (await applied()).hidden.length > 0);
await click("[data-testid=plan-reset]");
await click("[data-testid=plan-confirm-yes]");
await b.sleep(400);
await b.evaluate(`window.__reloop.select(null)`); // a selected component's relatives stay highlighted while a plan is active; deselect first
await b.sleep(400);
const snapRs = await snap();
check("reset plan empties it and restores the model", (await rows()).length === 0 && snapRs.hash === snap0.hash && snapRs.tints === 0, snapRs);
const nPlans = await store(`s.get().plans.length`);
await click("[data-testid=plan-delete]");
await click("[data-testid=plan-confirm-yes]");
await b.sleep(400);
check("delete removes the plan", (await store(`s.get().plans.length`)) === nPlans - 1);
while ((await store(`s.get().plans.length`)) > 0) { await click("[data-testid=plan-delete]"); await click("[data-testid=plan-confirm-yes]"); await b.sleep(250); }
check("no plans, no overlay, no stale hidden state", (await snap()).hash === snap0.hash && (await snap()).tints === 0 && (await applied()) === null && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)) === null);

// ── 15. bad saved data ───────────────────────────────────────────────────────────────────────
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, "{not json")`);
await b.goto(`${BASE}/?view=full`);
await openRemoval();
check("corrupt JSON: app loads, no plan", (await exists("[data-testid=removal-hint]")) && (await store(`s.get().plans.length`)) === 0);
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ version: 0, plans: [{ id: "x", name: "old", entries: [] }] }))`);
await b.goto(`${BASE}/?view=full`);
check("outdated version ignored", (await store(`s.get().plans.length`)) === 0);
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ version: 1, activeId: "p", plans: [{ id: "p", name: "Stale", entries: ["GONE-1", ${JSON.stringify(COL)}, "GONE-1"], notes: {}, userEdges: [] }] }))`);
await b.goto(`${BASE}/?view=full`);
await openRemoval();
const staleRows = await rows();
check("obsolete references are kept and flagged, not dropped", staleRows.length === 3 && (await all("[data-testid=removal-row]", "e.dataset.blocked")).every((x) => x === "true") && /missing/.test((await text("[data-testid=removal-sequence]")) ?? ""));
await click(`[data-testid=removal-row][data-index="0"]`);
check("missing reference explained", /does not exist in the model/.test((await text("[data-testid=removal-detail]")) ?? ""), await text("[data-testid=removal-detail]"));
await b.shot(`${OUT}/b3_stale_references.png`);
await store(`s.delete()`);
await b.sleep(200);

// ── 16. B1 data, console ─────────────────────────────────────────────────────────────────────
const b1After = await raw(`JSON.stringify(recs.slice(0, 6000).map((x) => [x.id, x.quantity, x.unit]))`);
check("B1 quantities unchanged", b1After === b1Before);
const bad = b.logs.filter((l) => !/\[vite\]|React DevTools/.test(l));
check("console clean", bad.length === 0, bad.slice(0, 5));
r.logs = bad.slice(0, 5);

await finish(failures.length ? 1 : 0);
