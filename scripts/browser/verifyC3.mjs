// C3 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the Tracking workspace, start tracking, move a
// component through its stages, record recovery and outcomes through the forms, void a mistake, open the passport and locate the component in
// 3D; the rest drives form controls. Checked against the REAL building (B2 assessments, a C2 requirement with allocations and a B3 removal
// plan are seeded through the real stores, as a user's own entries would be):
//   the planned scope (B2 / B3 / C2) against an independent computation, planned quantity = B1 quantity x recovery % (hand-checked), the
//   whole workflow planned -> in progress -> recovered -> inspected -> allocated -> reused with partial recovery, stage guards that refuse to
//   call material reused because it was recovered or allocated, quantity validation (sign, source required, more than available, whole items,
//   future dates), documented variance, unknown vs recorded zero, on hold, voiding (and the revert it logs), C2 allocation created / changed /
//   cancelled / fulfilled logged in the history, the planned-versus-actual report equal to an independent computation from the event
//   histories, units never added, every component counted once, batches, assemblies tracked through their parts, passport section, inspector
//   line, 3D marks by stage / flags on the existing meshes, Locate in 3D and fold / unfold, exports for C3, persistence (corrupt, broken
//   accounting, orphans, allocations changed while closed), exclusivity with the other drawers and presentation mode, B1 / B2 / C2 data
//   untouched, the closed workspace leaving the building bit-identical, console clean.
// Screenshots go to docs/screenshots/c3. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/c3";
const KEY = "rematter.tracking.v1";
const B2KEY = "rematter.recovery.assessments.v1";
const C2KEY = "rematter.reuse.v1";
const PKEY = "rematter.passports.v1";
const OTHER = ["rematter.removal.plans.v1", "rematter.scenarios.v1", "rematter.carbon.v1"];
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
const attr = (sel, a) => b.evaluate(`${q(sel)}?.getAttribute(${JSON.stringify(a)}) ?? null`);
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const visible = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; })()`);
const disabled = (sel) => b.evaluate(`${q(sel)}?.disabled ?? null`);
const all = (sel, expr) => b.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => ${expr})`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "center" })`); await b.sleep(150); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no select ${sel}"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no input ${sel}"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
const setTextarea = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const keydown = (sel, key) => b.evaluate(`${q(sel)}.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
const select = async (id) => { await b.evaluate(`window.__reloop.select(${JSON.stringify(id)})`); await b.sleep(600); };
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const applied = () => b.evaluate(`window.__scenarioOverlay ? JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(window.__scenarioOverlay).map(([k, v]) => [k, v.length])))) : null`);
const tintColours = () => b.evaluate(`(() => { const out = {}; window.__reloop.scene.traverse((o) => { if (o.name === "__scenario") { const k = o.material.color.getHexString(); out[k] = (out[k] ?? 0) + (o.isInstancedMesh ? o.count : 1); } }); return out; })()`);
const tintCount = () => b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.name === "__scenario") n++; }); return n; })()`);
const outlineOf = (id) => b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.name === ${JSON.stringify(id + "__selection")}) n++; }); return n; })()`);
const camera = () => b.evaluate(`JSON.stringify({ p: window.__reloop.camera.position.toArray() })`);
const T = (expr) => b.evaluate(`(() => { const s = window.__tracking; return ${expr}; })()`);
const C = (expr) => b.evaluate(`(() => { const s = window.__reuse; return ${expr}; })()`);
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
const b1Hash = () => b.evaluate(`(() => { const inv = window.__tracking.context().inv; let h = 0; for (const row of inv.rows) { const s = row.rec.id + "|" + row.q.primary.value + "|" + row.q.primary.unit + "|" + row.q.mass.value; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return { n: inv.rows.length, h }; })()`);
const recordsHash = () => b.evaluate(`(() => { let h = 0; for (const r of window.__reloop.records) { const s = r.id + r.floor + r.originalPosition.join() + r.quantity + r.unit + r.materialId + r.condition; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return h; })()`);
const near = (a, c, tol = 1e-6) => a !== null && Number.isFinite(a) && Math.abs(a - c) <= tol * Math.max(1, Math.abs(c));
// the engine's number format, re-implemented independently
const fq = (v, unit) => { if (v === 0) return "0"; const a = Math.abs(v); const d = unit === "nr" ? 0 : unit === "m3" ? 3 : a >= 100 ? 1 : a >= 1 ? 2 : 3; return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }); };

// ── an independent replay of every record's history, straight from the stored events ──────────────────
const INDEP = `(() => {
  const recs = window.__tracking.get().records;
  const out = {};
  for (const [id, r] of Object.entries(recs)) {
    const voided = new Set(r.events.filter((e) => e.kind === "void").map((e) => e.voids));
    let R = null, U = null, C = null, X = null, L = null, plan = null, status = "planned", variance = 0;
    for (const e of r.events) {
      if (e.kind === "void" || voided.has(e.id)) continue;
      if (e.kind === "track") plan = e.plan.quantity;
      else if (e.kind === "plan") plan = e.quantity;
      else if (e.kind === "status") status = e.status;
      else if (e.kind === "recovered") R = (R ?? 0) + e.quantity;
      else if (e.kind === "outcome") { if (e.outcome === "reused") U = (U ?? 0) + e.quantity; else if (e.outcome === "recycled") C = (C ?? 0) + e.quantity; else X = (X ?? 0) + e.quantity; }
      else if (e.kind === "unrecovered") L = (L ?? 0) + e.quantity;
      else if (e.kind === "variance") variance += e.quantity;
    }
    out[id] = { R, U, C, X, L, plan, status, variance, unit: r.unit };
  }
  return out;
})()`;
/** totals per unit from the independent replay + B1 quantities */
const INDEP_TOTALS = `(() => {
  const rep = ${INDEP};
  const inv = window.__tracking.context().inv;
  const t = {};
  for (const [id, x] of Object.entries(rep)) {
    const q = inv.byId.get(id)?.primary.value ?? 0;
    const o = (t[x.unit] ??= { records: 0, available: 0, planned: 0, recovered: 0, reused: 0, recycled: 0, disposed: 0, unrecovered: 0, unaccounted: 0, pairedP: 0, pairedR: 0, notRecorded: 0 });
    o.records++;
    const eff = q + x.variance;
    o.available += eff;
    if (x.plan !== null) o.planned += x.plan;
    if (x.R !== null) o.recovered += x.R; else o.notRecorded++;
    if (x.plan !== null && x.plan > 1e-9 && x.R !== null) { o.pairedP += x.plan; o.pairedR += x.R; }
    o.reused += x.U ?? 0; o.recycled += x.C ?? 0; o.disposed += x.X ?? 0; o.unrecovered += x.L ?? 0;
    o.unaccounted += eff - (x.U ?? 0) - (x.C ?? 0) - (x.X ?? 0) - (x.L ?? 0);
  }
  return t;
})()`;

// ── 0. start clean and seed ────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`${JSON.stringify([KEY, B2KEY, C2KEY, PKEY, ...OTHER])}.forEach((k) => localStorage.removeItem(k))`);
await b.goto(`${BASE}/?view=full`);
const rec0 = await recordsHash();
const model = JSON.parse(await b.evaluate(`JSON.stringify((() => {
  const recs = window.__reloop.records;
  const area = (r) => r.quantity;
  const tiles = recs.filter((x) => x.componentType === "floor_tile" && x.materialId === "tile_porcelain_floor" && x.apartmentId === "A1" && x.floor === 0 && area(x) > 0.35).map((x) => x.id).sort();
  const basins = recs.filter((x) => x.componentType === "basin").map((x) => x.id).sort().slice(0, 6);
  const groups = recs.filter((x) => x.geometry.kind === "group");
  const kids = new Map();
  for (const x of recs) if (x.parentId) (kids.get(x.parentId) ?? kids.set(x.parentId, []).get(x.parentId)).push(x);
  const asm = groups.find((g) => { const k = kids.get(g.id) ?? []; return k.length >= 3 && k.length <= 8 && k.every((c) => c.geometry.kind !== "group"); });
  return { tiles, basins, asm: asm.id, asmKids: (kids.get(asm.id) ?? []).map((c) => c.id).sort(), total: recs.filter((x) => x.geometry.kind !== "group").length };
})())`));
const TL = model.tiles;
const D = TL.slice(0, 12); // direct reuse 90 %
const RCY = TL.slice(12, 15); // recycling 85 %
const BAS = model.basins; // first 3: direct reuse 100 %
check("the real model offers tiles, basins and an assembly with 3 - 8 parts to test with", TL.length >= 25 && BAS.length >= 6 && model.asmKids.length >= 3, [TL.length, BAS.length, model.asmKids.length]);
const asm = (c, pct, prep) => ({ classification: c, recoveryPct: pct, preparation: prep, destination: null, lossNote: "", note: "" });
const entries = [...D.map((id) => [id, asm("direct_reuse", 90, "none")]), ...RCY.map((id) => [id, asm("recycling", 85, null)]), ...BAS.slice(0, 3).map((id) => [id, asm("direct_reuse", 100, "none")])];
await b.evaluate(`localStorage.setItem(${JSON.stringify(B2KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, entries }))})`);
await b.goto(`${BASE}/?view=full`);
// a C2 requirement with two allocations (D0 and D6), a B3 plan with two assessed and two unassessed components
const reqDraft = { name: "Community hall flooring", application: "Flooring", substance: "porcelain_tile", form: "tile_floor", componentType: "floor_tile", materialId: null, quantity: 3, unit: "m2", dims: { length: { min: null, max: null }, width: { min: null, max: null }, thickness: { min: null, max: null }, diameter: { min: null, max: null } }, toleranceMm: 5, minCondition: "any", accept: { cleaning: true, refurbishment: true, cutting: false, testing: true }, includeStructural: false, includeUnassessed: true, extraSpecs: [], note: "" };
const RID = await C(`s.add(${JSON.stringify(reqDraft)}).id`);
check("seed: the C2 allocations were accepted", (await C(`s.allocate(${JSON.stringify(RID)}, ${JSON.stringify(D[0])}, 0.3)`)) === null && (await C(`s.allocate(${JSON.stringify(RID)}, ${JSON.stringify(D[6])}, 0.3)`)) === null);
await C(`s.setOpen(false)`);
const planned = await b.evaluate(`(() => { const r = window.__removal.addEntries(${JSON.stringify([D[1], D[2], TL[20], TL[21]])}); return r.plan.entries.length; })()`);
check("seed: the B3 plan has the four entries", planned === 4, planned);
const snap0 = await snap();
const stats0 = await b.evaluate(`window.__reloop.stats(false)`);
const b1_0 = await b1Hash();
const b2_0 = await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`);
const c2_0 = await b.evaluate(`localStorage.getItem(${JSON.stringify(C2KEY)})`);
const SCOPE = new Set([...D, ...RCY, ...BAS.slice(0, 3), TL[20], TL[21]]);
const q0 = await b.evaluate(`window.__tracking.context().inv.byId.get(${JSON.stringify(D[0])}).primary.value`);
const P0 = q0 * 0.9;
const mt = "[data-pane=register]";

// ── 1. open with a real click ──────────────────────────────────────────────────────────
check("the controls panel has a Tracking button", await exists("[data-testid=tracking-toggle]"));
await click("[data-testid=tracking-toggle]");
await b.sleep(1000);
check("Tracking opens the workspace (a wide drawer) docked beside the model: nothing overlaps", (await exists("[data-testid=tracking-drawer]")) && (await b.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const v = r("[data-testid=viewport]"), d = r("[data-testid=dock]"); return Math.abs(v.right - d.left) <= 1 && d.width >= 560 && v.width >= 440; })()`)));
check("opening the workspace does not touch the scene: draw calls unchanged, no marks (nothing is tracked yet)", (await b.evaluate(`window.__reloop.stats(false)`)).drawCalls === stats0.drawCalls && (await tintCount()) === 0);
check("with nothing tracked the register says so and offers the planned scope", /Nothing is tracked yet/.test((await text("[data-testid=register-list]")) ?? "") && /Nothing is planned for recovery yet|planned components tracked/.test((await text("[data-testid=coverage]")) ?? ""));
check("the overview already knows what is planned: 0 of 20 planned components tracked (B2 reuse / recycling, B3 plan, C2 allocations)", /0\s+of 20 planned components tracked/.test((await text("[data-testid=coverage]")) ?? ""), await text("[data-testid=coverage]"));

// ── 2. the planned scope ───────────────────────────────────────────────────────────────
await click("[data-testid=scope-planned]");
await b.sleep(800);
const plannedIds = await all(`${mt} [data-testid=register-row]`, "e.dataset.id");
check("the Planned scope lists exactly the planned components (independent set: B2 reuse / recycling ∪ C2 ∪ B3 = 20)", /^20 of 20/.test((await text("[data-testid=register-count]")) ?? "") && plannedIds.every((id) => SCOPE.has(id)), [await text("[data-testid=register-count]"), plannedIds.slice(0, 3)]);
const rowText = async (id) => { await setInput("[data-testid=register-search]", id); await b.sleep(600); return text(`${mt} [data-testid=register-row][data-id="${id}"]`); };
check("a planned row shows its B2 planned quantity (quantity × 90 %, hand-checked) and that it carries a C2 allocation", (await rowText(D[0]))?.includes(fq(P0, "m2")) && /C2/.test((await text(`${mt} [data-testid=register-row][data-id="${D[0]}"]`)) ?? ""), await text(`${mt} [data-testid=register-row]`));
check("a planned row shows its place in the B3 removal order", /B3 #/.test((await rowText(D[1])) ?? ""));
await b.shot(`${OUT}/c3_planned.png`);

// ── 3. select a planned component: what is planned for it, then start tracking ───────────────
await setInput("[data-testid=register-search]", D[0]);
await b.sleep(600);
await click(`${mt} [data-testid=register-row][data-id="${D[0]}"]`);
await b.sleep(900);
check("a real click on a row selects the real component (inspector + outline) and opens its panel", (await inspectorId()) === D[0] && (await outlineOf(D[0])) >= 1 && (await attr(`${mt} [data-testid=record-panel]`, "data-tracked")) === "false", [await inspectorId(), await outlineOf(D[0])]);
const up = (await text(`${mt} [data-testid=untracked-plan]`)) ?? "";
check("the untracked panel shows the B2 plan (quantity × 90 %), the C2 allocation and that nothing is recorded yet", up.includes(fq(P0, "m2")) && /Community hall flooring/.test(up) && /B2 estimate/.test(up) && /90 % recovery/.test(up), up.slice(0, 400));
check("starting tracking records the plan as it stands and nothing else: no recovery, no reuse", await (async () => { await click(`${mt} [data-testid=start-tracking]`); await b.sleep(900); return true; })());
const rec1 = await T(`JSON.parse(JSON.stringify(s.get().records[${JSON.stringify(D[0])}]))`);
check("a record exists for the component: planned, unit m², plan snapshot = B2 estimate, the existing C2 allocation logged", rec1 && rec1.unit === "m2" && rec1.events[0].kind === "track" && near(rec1.events[0].plan.quantity, P0, 1e-9) && rec1.events[0].plan.basis === "b2_estimate" && rec1.events[1].kind === "allocation" && rec1.events[1].by === "system", rec1?.events?.map((e) => e.kind));
check("the panel is now the tracking panel: stage Planned, nothing recovered (not recorded), nothing reused", (await attr(`${mt} [data-testid=record-panel]`, "data-tracked")) === "true" && /Planned/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && /not recorded/.test((await text(`${mt} [data-testid=viz-recovered]`)) ?? ""));
check("B1 is untouched by starting to track", JSON.stringify(await b1Hash()) === JSON.stringify(b1_0));
check("starting tracking again (bulk) does not create a duplicate: the record count stays 1", (await T(`s.start([${JSON.stringify(D[0])}])`)).alreadyTracked === 1 && (await T(`Object.keys(s.get().records).length`)) === 1);

// ── 4. the whole workflow of one component ─────────────────────────────────────────────
const stageBtn = (st) => `${mt} [data-testid=stage-${st}]`;
check("the stage guards: Recovered / Inspected need a recovered quantity, Reused needs a recorded outcome (recovered or allocated is not reused)", (await disabled(stageBtn("recovered"))) === true && (await disabled(stageBtn("reused"))) === true && /recovered quantity first/.test((await attr(stageBtn("recovered"), "title")) ?? "") && /does not make material reused/.test((await attr(stageBtn("reused"), "title")) ?? ""), [await attr(stageBtn("reused"), "title")]);
await click(stageBtn("in_progress"));
await b.sleep(500);
check("quick stage update: Planned -> In progress with one click", /In progress/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && (await T(`s.get().records[${JSON.stringify(D[0])}].events.at(-1).status`)) === "in_progress");
// recovery form
await click(`${mt} [data-testid=quick-recover]`);
await b.sleep(300);
await setInput(`${mt} [data-testid=rec-qty]`, "0.2");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
check("a quantity needs an explicit source: nothing is recorded without one", /measured, estimated or assumed/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? "") && (await T(`s.get().records[${JSON.stringify(D[0])}].events.filter((e) => e.kind === "recovered").length`)) === 0);
await click(`${mt} [data-testid=source-measured]`);
await setInput(`${mt} [data-testid=rec-method]`, "weighed on site");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("recording 0.2 m² (measured): recovered 0.200, the plan is unchanged, completion = 0.2 ÷ planned", (await text(`${mt} [data-testid=viz-recovered]`))?.includes("0.200") && (await text(`${mt} [data-testid=viz-planned]`))?.includes(fq(P0, "m2")) && new RegExp(`${((0.2 / P0) * 100).toFixed(0)} % of planned`).test((await text(`${mt} [data-testid=viz-legend]`)) ?? ""), [await text(`${mt} [data-testid=viz-legend]`)]);
check("partial recovery keeps the record In progress (not Recovered) and says what is left", /In progress/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && /neither recovered nor written off|in hand/.test((await text(`${mt} [data-testid=hint]`)) ?? ""), await text(`${mt} [data-testid=hint]`));
await setInput(`${mt} [data-testid=rec-qty]`, "0.2");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(400);
check("recovering more than is available is refused, naming the available quantity, and nothing is booked", new RegExp(`More booked \\(0\\.4.*than the available ${fq(q0, "m2")}`).test((await text(`${mt} [data-testid=rec-msg]`)) ?? "") && near(await T(`${INDEP}[${JSON.stringify(D[0])}].R`), 0.2, 1e-12), await text(`${mt} [data-testid=rec-msg]`));
await setInput(`${mt} [data-testid=rec-qty]`, "-1");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(250);
check("a negative quantity is refused", /negative|above 0/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? ""));
await setInput(`${mt} [data-testid=rec-qty]`, "0.09");
await click(`${mt} [data-testid=rec-complete]`);
await setInput(`${mt} [data-testid=rec-date]`, "2099-01-01");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
check("a recovery dated in the future is refused", /future/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? ""));
await setInput(`${mt} [data-testid=rec-date]`, new Date().toISOString().slice(0, 10));
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("recording the rest and marking recovery complete moves the record to Recovered: cumulative 0.290", /Recovered/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && (await text(`${mt} [data-testid=viz-recovered]`))?.includes("0.290"), await text(`${mt} [data-testid=viz-recovered]`));
check("recovered 0.29 of planned 0.32: the difference is shown as a number, and it is within the 10 % tolerance so it is NOT flagged as below plan", new RegExp(`Actual − planned: −${fq(P0 - 0.29, "m2")} m²`).test((await text(`${mt} [data-testid=viz-difference]`)) ?? "") && !/Recovered less than planned/.test((await text(`${mt} [data-testid=flag-list]`)) ?? ""), [await text(`${mt} [data-testid=viz-difference]`), await text(`${mt} [data-testid=flag-list]`)]);
await click(stageBtn("inspected"));
await b.sleep(400);
check("Recovered -> Inspected", /Inspected/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? ""));
check("Allocated for reuse is available because C2 has an allocation for this component; Reused is still refused", (await disabled(stageBtn("allocated"))) === false && (await disabled(stageBtn("reused"))) === true);
await click(stageBtn("allocated"));
await b.sleep(400);
check("Inspected -> Allocated for reuse", /Allocated/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? ""));
check("allocated is a stage, not an outcome: nothing is reused, the passport-style figures show reused as not recorded", /not recorded/.test((await text(`${mt} [data-testid=viz-legend] .tk-key:nth-child(2)`)) ?? "") && (await T(`${INDEP}[${JSON.stringify(D[0])}].U`)) === null);
// outcome: reused against the C2 allocation
await click(`${mt} [data-testid=quick-outcome]`);
await b.sleep(300);
await click(`${mt} [data-testid=outcome-reused]`);
check("the outcome form offers the unfulfilled C2 allocation to fulfil", /Community hall flooring/.test((await b.evaluate(`${q(mt + " [data-testid=rec-allocation]")}.innerText`)) ?? ""));
await setInput(`${mt} [data-testid=rec-qty]`, "0.35");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
check("reusing more than the recovered material in hand is refused", /Only 0\.29 m² of the recovered material is still in hand/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? ""), await text(`${mt} [data-testid=rec-msg]`));
const alloc0 = await C(`s.get().allocations.find((a) => a.componentId === ${JSON.stringify(D[0])}).id`);
await setSelect(`${mt} [data-testid=rec-allocation]`, alloc0);
await setInput(`${mt} [data-testid=rec-qty]`, "0.2");
await setInput(`${mt} [data-testid=rec-destination]`, "Community hall, floor of the main room");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("0.2 m² recorded as reused against the C2 allocation: reused 0.200, in hand 0.090; the stage stays Allocated (partial)", (await text(`${mt} [data-testid=viz-legend]`))?.includes("0.200") && /Allocated/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? ""), await text(`${mt} [data-testid=viz-legend]`));
check("the C2 link shows the allocation, what was recorded as reused against it and that it is only partly fulfilled", /Community hall flooring/.test((await text(`${mt} [data-testid=link-c2]`)) ?? "") && /0\.200 m²/.test((await text(`${mt} [data-testid=alloc-fulfilled]`)) ?? "") && /partly fulfilled/.test((await text(`${mt} [data-testid=link-c2]`)) ?? ""), await text(`${mt} [data-testid=link-c2]`));
check("the allocation is not fulfilled by being recovered: C2's own allocation quantity is unchanged (0.3)", await C(`s.get().allocations.find((a) => a.id === ${JSON.stringify(alloc0)}).quantity === 0.3`));
// recycled for the rest -> closes
await click(`${mt} [data-testid=quick-outcome]`);
await b.sleep(250);
await click(`${mt} [data-testid=outcome-recycled]`);
await click(`${mt} [data-testid=qty-fill]`);
await click(`${mt} [data-testid=source-estimated]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("recording the rest (0.09) as recycled leaves nothing in hand and closes the record with the outcome that holds most of it: Reused", /Reused/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && near(await T(`${INDEP}[${JSON.stringify(D[0])}].C`), 0.09, 1e-12), await text(`${mt} [data-testid=stepper] .cur`));
check("it is closed with material still unaccounted: 0.356 − 0.2 − 0.09 = 0.066 neither recovered nor written off — flagged, shown in the legend", /Closed with material still unaccounted/.test((await text(`${mt} [data-testid=flag-list]`)) ?? "") && (await text(`${mt} [data-testid=viz-legend]`))?.includes(fq(q0 - 0.29, "m2")), await text(`${mt} [data-testid=flag-list]`));
check("reuse planned but 0.09 recycled: the outcome difference and the unfulfilled allocation are flagged", /Outcome differs from the plan/.test((await text(`${mt} [data-testid=flag-list]`)) ?? "") && /allocation not fully fulfilled/i.test((await text(`${mt} [data-testid=flag-list]`)) ?? ""));
await click(`${mt} [data-testid=quick-unrecovered]`);
await b.sleep(250);
await click(`${mt} [data-testid=qty-fill]`);
await click(`${mt} [data-testid=source-estimated]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
check("writing off the remainder needs a reason", /why it was not recovered/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? ""));
await setInput(`${mt} [data-testid=rec-reason]`, "broken on removal");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
const s0 = await T(`${INDEP}[${JSON.stringify(D[0])}]`);
check("the balance closes exactly: recovered + not recovered = available, reused + recycled + disposed = recovered (independent replay)", near(s0.R + s0.L, q0, 1e-9) && near(s0.U + s0.C + s0.X, s0.R, 1e-12) && near(s0.L, q0 - 0.29, 1e-9), s0);
check("the closed record no longer says anything is unaccounted", !/Closed with material still unaccounted/.test((await text(`${mt} [data-testid=flag-list]`)) ?? "") && /Unaccounted\s*0\b/.test(((await text(`${mt} [data-testid=viz-legend]`)) ?? "").replace(/\n/g, " ")), await text(`${mt} [data-testid=viz-legend]`));
await b.shot(`${OUT}/c3_record.png`);
const hist = await all(`${mt} [data-testid=history-event]`, "e.dataset.kind + ':' + e.dataset.by");
check("the history lists every step in order with who recorded it: user entries and system entries (automatic stage changes, the C2 allocation) are distinguished", hist.length >= 12 && hist.includes("allocation:system") && hist.includes("status:system") && hist.includes("recovered:user") && hist.includes("outcome:user") && hist.includes("unrecovered:user") && hist.includes("track:user"), hist);
check("quantity events carry their source (measured / estimated) as a visible chip in the history", /measured/.test((await text(`${mt} [data-testid=history]`)) ?? "") && /estimated/.test((await text(`${mt} [data-testid=history]`)) ?? ""));
const hist0 = await T(`s.get().records[${JSON.stringify(D[0])}].events.length`);
check("B1, B2 and C2 data are exactly as before the whole workflow", JSON.stringify(await b1Hash()) === JSON.stringify(b1_0) && (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2_0 && (await b.evaluate(`localStorage.getItem(${JSON.stringify(C2KEY)})`)) === c2_0);

// ── 5. history is append-only: void a mistake ─────────────────────────────────────────────
await setInput("[data-testid=register-search]", D[4]);
await b.sleep(500);
await click(`${mt} [data-testid=register-row][data-id="${D[4]}"]`);
await b.sleep(700);
await click(`${mt} [data-testid=start-tracking]`);
await b.sleep(600);
for (const [fn, qty, extra] of [["recover", "0.3", true], ["outcome", "0.3", false]]) {
  if (fn === "recover") {
    await click(`${mt} [data-testid=quick-recover]`);
    await setInput(`${mt} [data-testid=rec-qty]`, qty);
    await click(`${mt} [data-testid=source-measured]`);
    await click(`${mt} [data-testid=rec-complete]`);
  } else {
    await click(`${mt} [data-testid=quick-outcome]`);
    await click(`${mt} [data-testid=outcome-reused]`);
    await setInput(`${mt} [data-testid=rec-qty]`, qty);
    await click(`${mt} [data-testid=source-measured]`);
  }
  await click(`${mt} [data-testid=rec-submit]`);
  await b.sleep(450);
}
check("D4: recovered 0.3 and reused 0.3 closes it as Reused", /Reused/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? ""));
// void the recovered event first: refused because the outcome depends on it
const eventIdOf = (kind) => T(`s.get().records[${JSON.stringify(D[4])}].events.find((e) => e.kind === ${JSON.stringify(kind)} && e.by === "user").id`);
const evRecovered = await eventIdOf("recovered");
const evOutcome = await eventIdOf("outcome");
const voidViaUi = async (id, reason) => {
  await b.evaluate(`(() => { const lis = [...document.querySelectorAll("[data-pane=register] [data-testid=history-event]")]; const li = lis.find((e) => e.dataset.kind === ${JSON.stringify(id.kind)} && e.dataset.by === "user" && e.dataset.voided === "false" && e.querySelector("[data-testid=void-open]")); li.querySelector("[data-testid=void-open]").scrollIntoView({ block: "center" }); li.querySelector("[data-testid=void-open]").click(); })()`);
  await b.sleep(250);
  await setInput(`${mt} [data-testid=void-reason]`, reason);
  await click(`${mt} [data-testid=void-confirm]`);
  await b.sleep(500);
};
await voidViaUi({ kind: "recovered" }, "wrong tile");
check("voiding the recovery that an outcome rests on is refused, with the reason and what to void first", /cannot be voided/.test((await text(`${mt} [data-testid=void-error]`)) ?? "") && /Void the events that depend on it first/.test((await text(`${mt} [data-testid=void-error]`)) ?? "") && (await T(`s.get().records[${JSON.stringify(D[4])}].events.every((e) => e.kind !== "void")`)), await text(`${mt} [data-testid=void-error]`));
await b.evaluate(`document.querySelector("[data-pane=register] [data-testid=void-form] .rx-btn:last-child")?.click()`);
await b.sleep(200);
await voidViaUi({ kind: "outcome" }, "recorded against the wrong tile");
const d4 = await T(`${INDEP}[${JSON.stringify(D[4])}]`);
check("voiding the outcome removes it from the totals, and the stage falls back to Recovered through a logged SYSTEM event", d4.U === null && d4.status === "recovered" && (await T(`(() => { const ev = s.get().records[${JSON.stringify(D[4])}].events; const last = ev.at(-1); return ev.at(-2).kind === "void" && last.kind === "status" && last.by === "system" && /reverted/.test(last.note); })()`)), d4);
check("the voided entry stays in the history, struck through, with its reason (history is never deleted)", (await all(`${mt} [data-testid=history-event][data-voided=true]`, "e.dataset.kind")).includes("outcome") && /recorded against the wrong tile/.test((await text(`${mt} [data-testid=history]`)) ?? ""));
check("system events cannot be voided (no void control on them)", await b.evaluate(`[...document.querySelectorAll("[data-pane=register] [data-testid=history-event][data-by=system]")].every((e) => !e.querySelector("[data-testid=void-open]"))`));

// ── 6. unknown vs zero, on hold, documented variance ─────────────────────────────────────
await T(`s.start(${JSON.stringify([D[1], D[2], D[3], D[5]])})`);
await T(`s.apply(${JSON.stringify(D[1])}, { type: "recover", quantity: 0, source: "measured", method: "checked the pallet" })`);
await b.sleep(400);
const rows = async (id) => { await setInput("[data-testid=register-search]", id); await b.sleep(500); return text(`${mt} [data-testid=register-row][data-id="${id}"]`); };
check("an explicit zero is a recorded zero: the register shows 0 recovered (stage In progress)", /\n0\n/.test(`\n${((await rows(D[1])) ?? "").replace(/\n+/g, "\n")}\n`) && /In progress/.test((await rows(D[1])) ?? ""), await rows(D[1]));
check("never recording is unknown, not zero: the register shows 'not recorded' for a started component", /not recorded/.test((await rows(D[2])) ?? ""));
check("D2 put on hold through the store for the report and the marks (a reason is mandatory there too)", (await T(`s.apply(${JSON.stringify(D[2])}, { type: "status", status: "hold" })`)) !== null && (await T(`s.apply(${JSON.stringify(D[2])}, { type: "status", status: "hold", note: "outcome depends on the client" })`)) === null);
await setInput("[data-testid=register-search]", D[3]);
await b.sleep(500);
await click(`${mt} [data-testid=register-row][data-id="${D[3]}"]`);
await b.sleep(700);
await click(stageBtn("hold"));
await click(`${mt} [data-testid=hold-confirm]`);
await b.sleep(300);
check("On hold needs a reason", /Say why/.test((await text(`${mt} [data-testid=stage-error]`)) ?? "") && /Planned/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? ""));
await setInput(`${mt} [data-testid=hold-reason]`, "waiting for the contractor");
await click(`${mt} [data-testid=hold-confirm]`);
await b.sleep(500);
check("On hold / outcome unknown is a stage of its own, with the reason in the history, flagged, and recovery stays 'not recorded' (not 0)", /On hold/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && /On hold: outcome unknown/.test((await text(`${mt} [data-testid=flag-list]`)) ?? "") && /waiting for the contractor/.test((await text(`${mt} [data-testid=history]`)) ?? "") && /not recorded/.test((await text(`${mt} [data-testid=viz-recovered]`)) ?? ""));
await click(stageBtn("in_progress"));
await b.sleep(400);
check("a held record can be resumed", /In progress/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? ""));
// documented variance on D5: B1 is 0.356, the real tile area was measured larger
await setInput("[data-testid=register-search]", D[5]);
await b.sleep(500);
await click(`${mt} [data-testid=register-row][data-id="${D[5]}"]`);
await b.sleep(700);
await click(`${mt} [data-testid=quick-recover]`);
await setInput(`${mt} [data-testid=rec-qty]`, "0.4");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
const q5 = await b.evaluate(`window.__tracking.context().inv.byId.get(${JSON.stringify(D[5])}).primary.value`);
check("exceeding the available quantity is only possible through a documented reconciliation: refused, and the message says so", /documented variance/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? "") && q5 < 0.4, await text(`${mt} [data-testid=rec-msg]`));
await click(`${mt} [data-testid=form-variance]`);
await setInput(`${mt} [data-testid=rec-qty]`, "0.05");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
check("a variance without a reason is refused", /needs its reason/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? ""));
await setInput(`${mt} [data-testid=rec-reason]`, "tile area re-measured on site");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("the variance raises the effective available quantity (B1 + 0.05) and is shown next to B1's figure; B1 itself is unchanged", new RegExp(`${fq(q5 + 0.05, "m2")} m²`).test((await text(`${mt} [data-testid=viz-available]`)) ?? "") && /variance/.test((await text(`${mt} [data-testid=viz-available]`)) ?? "") && JSON.stringify(await b1Hash()) === JSON.stringify(b1_0), await text(`${mt} [data-testid=viz-available]`));
await click(`${mt} [data-testid=form-recover]`);
await setInput(`${mt} [data-testid=rec-qty]`, "0.4");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("0.4 m² can now be recorded as recovered", near(await T(`${INDEP}[${JSON.stringify(D[5])}].R`), 0.4, 1e-12));

// whole items: basins
await T(`s.start(${JSON.stringify(BAS.slice(0, 3))})`);
await setInput("[data-testid=register-search]", BAS[0]);
await b.sleep(500);
await click(`${mt} [data-testid=register-row][data-id="${BAS[0]}"]`);
await b.sleep(700);
await click(`${mt} [data-testid=quick-recover]`);
await setInput(`${mt} [data-testid=rec-qty]`, "0.5");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(300);
check("a count is recorded in whole items", /whole items/.test((await text(`${mt} [data-testid=rec-msg]`)) ?? ""));
await setInput(`${mt} [data-testid=rec-qty]`, "1");
await click(`${mt} [data-testid=rec-complete]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(400);
await click(`${mt} [data-testid=quick-outcome]`);
await click(`${mt} [data-testid=outcome-disposed]`);
await setInput(`${mt} [data-testid=rec-qty]`, "1");
await click(`${mt} [data-testid=source-measured]`);
await setInput(`${mt} [data-testid=rec-destination]`, "Landfill");
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(500);
check("a basin recovered whole and disposed closes as Disposed", /Disposed/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && near(await T(`${INDEP}[${JSON.stringify(BAS[0])}].X`), 1));

// ── 7. C2 follows: changed and cancelled allocations are logged, never silently overwritten ────────────
await setInput("[data-testid=register-search]", D[6]);
await b.sleep(500);
await click(`${mt} [data-testid=register-row][data-id="${D[6]}"]`);
await b.sleep(700);
await click(`${mt} [data-testid=start-tracking]`);
await b.sleep(500);
await click(`${mt} [data-testid=quick-recover]`);
await setInput(`${mt} [data-testid=rec-qty]`, "0.3");
await click(`${mt} [data-testid=source-measured]`);
await click(`${mt} [data-testid=rec-complete]`);
await click(`${mt} [data-testid=rec-submit]`);
await b.sleep(400);
await click(stageBtn("allocated"));
await b.sleep(400);
check("D6: recovered and allocated for reuse (stage), nothing reused", /Allocated/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && (await T(`${INDEP}[${JSON.stringify(D[6])}].U`)) === null);
const alloc6 = await C(`s.get().allocations.find((a) => a.componentId === ${JSON.stringify(D[6])}).id`);
await C(`s.allocate(${JSON.stringify(RID)}, ${JSON.stringify(D[6])}, 0.25)`);
await b.sleep(600);
check("C2 changes the allocation (0.3 -> 0.25): the record logs it as a system event with the old and new quantity", await T(`(() => { const e = s.get().records[${JSON.stringify(D[6])}].events.filter((x) => x.kind === "allocation").at(-1); return e.change === "changed" && e.by === "system" && e.previous === 0.3 && e.quantity === 0.25; })()`));
check("…and the panel shows the new allocated quantity", /allocated 0\.250 m²/.test((await text(`${mt} [data-testid=link-c2]`)) ?? ""), await text(`${mt} [data-testid=link-c2]`));
await C(`s.removeAllocation(${JSON.stringify(alloc6)})`);
await b.sleep(700);
const ev6 = await T(`s.get().records[${JSON.stringify(D[6])}].events.map((e) => e.kind + ":" + (e.change ?? e.status ?? "") + ":" + e.by)`);
check("C2 cancels the allocation: logged as cancelled, and the 'Allocated' stage steps back by a logged system event; the earlier 'allocated' entry stays in the history", ev6.includes("allocation:cancelled:system") && ev6.at(-1).startsWith("status:") && ev6.at(-1).endsWith(":system") && ev6.includes("status:allocated:user"), ev6);
check("the stage is no longer Allocated, and nothing was marked reused", !/Allocated/.test((await text(`${mt} [data-testid=stepper] .cur`)) ?? "") && (await T(`${INDEP}[${JSON.stringify(D[6])}].U`)) === null && (await disabled(stageBtn("allocated"))) === true);
check("the cancelled allocation is shown struck through in the C2 link, not hidden", /no longer in C2/.test((await text(`${mt} [data-testid=link-c2]`)) ?? ""));

// ── 8. the planned-versus-actual report equals an independent computation ───────────────────────────
await setInput("[data-testid=register-search]", "");
await T(`s.setFilters({ scope: "tracked", status: "", text: "" })`);
await click("[data-testid=tab-report]");
await b.sleep(700);
const ind = await b.evaluate(INDEP_TOTALS);
const m2 = ind.m2;
const nr = ind.nr;
await click("[data-testid=report-unit-m2]");
await b.sleep(400);
const summaryText = ((await text("[data-testid=report-summary]")) ?? "").replace(/\n/g, " ");
check("report: tracked components per unit, planned total = Σ B2 estimates (independent replay)", new RegExp(`${m2.records} tracked components`).test(summaryText) && new RegExp(`planned ${fq(m2.planned, "m2")} m²`).test(summaryText), [summaryText, m2]);
check("report: recovered total, completion (Σ recovered ÷ Σ planned over records with both), reused, recycled, disposed and unaccounted match the independent replay", new RegExp(`recovered ${fq(m2.recovered, "m2")} m²`).test(summaryText) && new RegExp(`${((m2.pairedR / m2.pairedP) * 100).toFixed(0)} % of the plan`).test(summaryText) && new RegExp(`reused ${fq(m2.reused, "m2")} m²`).test(summaryText) && new RegExp(`recycled ${fq(m2.recycled, "m2")} m²`).test(summaryText) && new RegExp(`unaccounted ${fq(m2.unaccounted, "m2")} m²`).test(summaryText), [summaryText, m2]);
check("report: records with no recovered quantity are counted as 'not recorded' (unknown), not as zero recovered", new RegExp(`${m2.notRecorded} records? (has|have) no recovered quantity recorded`).test(summaryText) || m2.notRecorded === 0, [summaryText, m2.notRecorded]);
const catRow = ((await text("[data-testid=by-category] tr[data-key=porcelain_tile]")) ?? "").replace(/\n/g, " ");
check("report by material category: the porcelain tile row equals the replay (records, planned, recovered)", catRow.includes(String(m2.records)) && catRow.includes(fq(m2.planned, "m2")) && catRow.includes(fq(m2.recovered, "m2")), [catRow, m2]);
const floorRows = await all("[data-testid=by-floor] tbody tr", "e.dataset.key + ':' + e.querySelector('td:nth-child(2)').textContent");
check("report by floor and by stage each cover every m² record exactly once", floorRows.reduce((s, x) => s + Number(x.split(":")[1]), 0) === m2.records && (await all("[data-testid=by-stage] tbody tr", "Number(e.querySelector('td:nth-child(2)').textContent)")).reduce((s, x) => s + x, 0) === m2.records, floorRows);
const stageKeys = await all("[data-testid=by-stage] tbody tr", "e.dataset.key");
check("report: the stage rows are in workflow order", stageKeys.join() === ["planned", "in_progress", "recovered", "inspected", "allocated", "reused", "recycled", "disposed", "hold"].filter((x) => stageKeys.includes(x)).join(), stageKeys);
await click("[data-testid=report-unit-nr]");
await b.sleep(400);
const nrText = ((await text("[data-testid=report-summary]")) ?? "").replace(/\n/g, " ");
check("units are never added: the nr (basins) report is separate and equals its replay", new RegExp(`${nr.records} tracked components`).test(nrText) && new RegExp(`disposed ${fq(nr.disposed, "nr")} nr`).test(nrText) && new RegExp(`recovered ${fq(nr.recovered, "nr")} nr`).test(nrText), [nrText, nr]);
check("report integrity: every component is counted once and every breakdown adds up", /counted once and every breakdown adds up/.test((await text("[data-testid=report-integrity]")) ?? ""));
const diffIds = await all("[data-testid=difference]", "e.dataset.id");
check("report differences: the closed record with an outcome that differs from its plan (D0) and the held record (D2) are listed with their causes", diffIds.includes(D[0]) && diffIds.includes(D[2]) && /Outcome differs from the plan/.test((await text(`[data-testid=difference][data-id="${D[0]}"]`)) ?? ""), diffIds);
const open = await all("[data-testid=unresolved-row]", "e.dataset.id");
check("report unresolved: components not closed say why (D2 on hold, D4 recovered with no outcome); closed D0 and the disposed basin are not listed", open.includes(D[2]) && open.includes(D[4]) && !open.includes(D[0]) && !open.includes(BAS[0]) && /On hold/.test((await text(`[data-testid=unresolved-row][data-id="${D[2]}"]`)) ?? "") && /no outcome yet/.test((await text(`[data-testid=unresolved-row][data-id="${D[4]}"]`)) ?? ""), open);
await b.shot(`${OUT}/c3_report.png`);
// exports
await b.evaluate(`window.__dl = []; const orig = URL.createObjectURL; URL.createObjectURL = (blob) => { blob.arrayBuffer().then((buf) => window.__dl.push({ type: blob.type, text: new TextDecoder().decode(buf) })); return orig(blob); }; window.HTMLAnchorElement.prototype.click = function () { return undefined; };`);
await click("[data-testid=export-json]");
await click("[data-testid=export-csv]");
await b.sleep(600);
const dl = JSON.parse(await b.evaluate(`JSON.stringify(window.__dl)`));
const json = JSON.parse(dl.find((d) => d.type.includes("json")).text);
const nTracked = await T(`Object.keys(s.get().records).length`);
check("JSON export: schema, disclaimer (no environmental saving asserted), one record per tracked component with its full history", json.schema === "rematter.recovery-tracking/1" && /No environmental saving is asserted/.test(json.disclaimer) && json.records.length === nTracked && json.records.every((x) => Array.isArray(x.history) && x.history.length >= 1), [json.schema, json.records.length, nTracked]);
const jD2 = json.records.find((x) => x.componentId === D[2]);
const jD0 = json.records.find((x) => x.componentId === D[0]);
check("JSON export: a never-recorded quantity is null (not 0) and a recorded one is exact", jD2.recovered === null && jD2.reused === null && near(jD0.reused, 0.2, 1e-12) && near(jD0.recycled, 0.09, 1e-12) && near(jD0.notRecovered, q0 - 0.29, 1e-9) && jD0.unaccounted === 0, [jD2, jD0]);
const csv = dl.find((d) => d.type.includes("csv")).text;
const csvLines = csv.trim().split("\r\n");
check("CSV export: header + one row per tracked component; unknown stays empty", csvLines.length === nTracked + 1 && /component_id,name,material_category/.test(csvLines[0]) && csvLines.find((l) => l.startsWith(D[2])).split(",")[csvLines[0].split(",").indexOf("recovered")] === "", csvLines.length);

// ── 9. the overview ─────────────────────────────────────────────────────────────────────
const figs = await b.evaluate(`({ unit: ${q("[data-testid=figures]")}.dataset.unit })`);
await click("[data-testid=unit-m2]");
await b.sleep(300);
check("overview figures (m²) equal the independent replay: planned, recovered, reused, recycled, disposed, unaccounted", (await text("[data-testid=fig-planned]")) === fq(m2.planned, "m2") && (await text("[data-testid=fig-recovered]")) === fq(m2.recovered, "m2") && (await text("[data-testid=fig-reused]")) === fq(m2.reused, "m2") && (await text("[data-testid=fig-recycled]")) === fq(m2.recycled, "m2") && (await text("[data-testid=fig-unaccounted]")) === fq(m2.unaccounted, "m2"), [figs, await text("[data-testid=fig-recovered]"), m2]);
check("the stage legend counts equal the stored records' stages", await b.evaluate(`(() => { const rep = ${INDEP}; const c = {}; for (const x of Object.values(rep)) c[x.status] = (c[x.status] ?? 0) + 1; return [...document.querySelectorAll("[data-testid=stage-bar] [data-stage]")].every((e) => Number(e.querySelector("b").textContent) === (c[e.dataset.stage] ?? 0)); })()`));
await click("[data-testid=tab-register]");
await b.sleep(400);

// ── 10. batches and bulk work ─────────────────────────────────────────────────────────
await T(`s.setFilters({ scope: "planned", text: "" })`);
await b.sleep(600);
const bulkIds = await all(`${mt} [data-testid=register-row]`, "e.dataset.id");
await b.evaluate(`document.querySelectorAll("[data-pane=register] [data-testid=register-row] input[type=checkbox]").forEach((c, i) => { if (i < 3) c.click(); })`);
await b.sleep(300);
check("selecting rows shows the bulk bar with the count", /3 selected/.test((await text("[data-testid=bulk-bar]")) ?? ""));
await click("[data-testid=batch-new]");
await setInput("[data-testid=batch-name]", "Living tiles");
await click("[data-testid=batch-save]");
await b.sleep(400);
check("Save as batch creates a named batch that holds the ids only (no quantities)", await T(`(() => { const b = s.get().batches; return b.length === 1 && b[0].name === "Living tiles" && b[0].componentIds.length === 3 && Object.keys(b[0]).sort().join() === "componentIds,createdAt,id,name"; })()`));
check("the rail lists the batch with its size, and filtering by it lists exactly its components", await (async () => { await click("[data-testid=facet-batch]"); await b.sleep(500); return true; })() && (await all(`${mt} [data-testid=register-row]`, "e.dataset.id")).length === 3);
await click("[data-testid=facet-batch]");
await b.sleep(300);
await T(`s.createBatch("Overlap", ${JSON.stringify(bulkIds.slice(1, 5))})`);
const totalsBefore = await b.evaluate(INDEP_TOTALS);
check("overlapping batches change no figure: a component in two batches is still counted once in every report", JSON.stringify(await b.evaluate(INDEP_TOTALS)) === JSON.stringify(totalsBefore) && (await T(`s.get().batches.length`)) === 2);
check("a duplicate batch name is refused", /exists/.test((await T(`s.createBatch("living tiles", ${JSON.stringify(bulkIds.slice(0, 2))}).error`)) ?? ""));
await T(`s.deleteBatch(s.get().batches[1].id)`);
check("deleting a batch leaves every record untouched", (await T(`s.get().batches.length`)) === 1 && (await T(`Object.keys(s.get().records).length`)) === nTracked);
// bulk stage on records that cannot move: refused ones are counted with the reason
const bulk = await T(`s.bulkStatus([${JSON.stringify(D[0])}, ${JSON.stringify(D[2])}], "recovered")`);
check("bulk stage change applies where the quantities allow it and refuses the rest with the reason (D2 has no recovery, D0 is closed)", bulk.changed === 0 && bulk.refused === 2 && /recovered quantity first|already has an outcome/.test(bulk.firstError ?? ""), bulk);
// assembly: its parts, never the assembly
await select(model.asm);
await b.sleep(500);
check("selecting an assembly offers to track its parts (and says how many)", new RegExp(`Start tracking its ${model.asmKids.length} parts`).test((await text(`${mt} [data-testid=start-tracking]`)) ?? ""), await text(`${mt} [data-testid=start-tracking]`));
await click(`${mt} [data-testid=start-tracking]`);
await b.sleep(700);
check("tracking an assembly tracks each part once and never the assembly itself", await T(`(() => { const r = s.get().records; return ${JSON.stringify(model.asmKids)}.every((id) => r[id]) && !r[${JSON.stringify(model.asm)}]; })()`));
check("the inspector says how many parts of the assembly are tracked", new RegExp(`${model.asmKids.length} of ${model.asmKids.length} parts tracked`).test((await text("[data-testid=tracking-info]")) ?? ""), await text("[data-testid=tracking-info]"));
check("tracking an assembly again creates no duplicates", (await T(`s.start([${JSON.stringify(model.asm)}])`)).started === 0);

// ── 11. C1 passport and the inspector ──────────────────────────────────────────────────
await select(D[0]);
await T(`s.setFilters({ scope: "tracked", text: "" })`);
await b.sleep(500);
await click(`${mt} [data-testid=open-passport]`);
await b.sleep(700);
const pp = "[data-testid=passport-panel]";
check("Passport opens the C1 passport of the same component", (await attr(pp, "data-id")) === D[0] && (await visible(pp)));
check("the passport has a Recovery tracking section (C3) after provenance", (await all(`${pp} [data-testid=passport-section]`, "e.dataset.section")).at(-1) === "tracking");
const prow = (k) => `${pp} tr[data-field="${k}"]`;
check("passport: stage, recovered 0.290 (user entry, measured), reused 0.200, planned from B2 (an estimate)", /Reused/.test((await text(prow("stage"))) ?? "") && (await attr(prow("recovered"), "data-status")) === "estimated" /* the weakest source of D0 is 'estimated' (the recycled part) */ && /0\.29/.test((await text(prow("recovered"))) ?? "") && /0\.2/.test((await text(prow("reused"))) ?? "") && (await attr(prow("planned"), "data-status")) === "estimated" && /B2/.test((await text(prow("planned"))) ?? ""), [await attr(prow("recovered"), "data-status"), await text(prow("recovered"))]);
check("passport: the C2 allocation is shown with what was reused against it", /Reuse allocation: Community hall flooring/.test((await text(`${pp} tr[data-field="allocation.0"]`)) ?? "") && /reused against it \(C3\): 0\.2/.test((await attr(`${pp} tr[data-field="allocation.0"]`, "title")) ?? ""), [await text(`${pp} tr[data-field="allocation.0"]`), await attr(`${pp} tr[data-field="allocation.0"]`, "title")]);
check("passport: material never recorded is 'not available' with a reason (here the not-yet-recorded disposed quantity of D0), not 0", (await attr(prow("disposed"), "data-status")) === "missing" && /not recorded|unknown/.test((await attr(prow("disposed"), "title")) ?? ""));
check("passport: the unaccounted quantity of the closed record is calculated and 0", (await attr(prow("unaccounted"), "data-status")) === "calculated");
check("the passport links to the tracking workspace", await exists("[data-testid=passport-open-tracking]"));
check("the inspector shows the stage and recovered-against-planned of a tracked component", /Reused/.test((await text("[data-testid=tracking-info-value]")) ?? "") && /recovered 0\.290 m² of/.test((await text("[data-testid=tracking-info-value]")) ?? ""), await text("[data-testid=tracking-info]"));
await select(TL[30]);
check("…and 'not tracked' for a component nobody tracks", /not tracked/.test((await text("[data-testid=tracking-info-value]")) ?? ""));
await select(D[0]);

// ── 12. 3D: marks by stage, flags, selection, Locate, fold ────────────────────────────────
await T(`s.setFilters({ scope: "planned", status: "", substance: "", floor: "", text: "", batchId: "", flaggedOnly: false })`);
await b.sleep(1200);
await select(D[8]); // keep the marked set clear of the selection
const marks = await tintColours();
const stageColours = { planned: "56b4e9", in_progress: "e69f00", recovered: "f0e442", reused: "009e73", disposed: "d55e00", hold: "8c96a0", untracked: "b9c6d2" };
check("3D marks follow the register by stage: every tracked stage in use and the planned-but-not-started components has its colour on the existing meshes", Object.values(stageColours).every((c) => marks[c] > 0), marks);
check("3D: only stage colours are drawn (nothing else is tinted)", Object.keys(marks).every((c) => Object.values(stageColours).includes(c)), marks);
const trackedIds = await T(`Object.keys(s.get().records)`);
const listed = new Set([...trackedIds, ...SCOPE]).size;
const tintedUnknown = await b.evaluate(`window.__scenarioOverlay ? window.__scenarioOverlay.unknown.length : 0`);
check("3D: every listed component is tinted on its real mesh (tracked ∪ planned; the selected one, D8, is marked by its outline instead)", tintedUnknown === listed - 1, [tintedUnknown, listed]);
await click("[data-testid=show3d-flags]");
await b.sleep(900);
const fl = await tintColours();
check("3D 'Flags' mode marks only the records that need attention (vermillion = error, orange = warning)", Object.keys(fl).length > 0 && Object.keys(fl).every((c) => c === "d55e00" || c === "e69f00"), fl);
await click("[data-testid=show3d-off]");
await b.sleep(500);
check("3D 'Off' removes every mark", (await tintCount()) === 0 && !(await b.evaluate(`!!window.__scenarioOverlay`)));
await click("[data-testid=show3d-status]");
await b.sleep(700);
// search state to survive the fold
await T(`s.setFilters({ scope: "tracked", text: "" })`);
await b.sleep(500);
await setInput("[data-testid=register-search]", "A1-BED1");
await b.sleep(600);
const typed = await b.evaluate(`${q("[data-testid=register-search]")}.value`);
await click(`${mt} [data-testid=register-row]`);
await b.sleep(700);
const selected = await inspectorId();
const cam0 = await camera();
const marksN = await tintCount();
await click(`${mt} [data-testid=locate]`);
await b.sleep(1500);
check("Locate in 3D folds the workspace into its card (still mounted, hidden), frames the camera on the component", (await visible("[data-testid=tracking-collapsed]")) && !(await visible("[data-testid=tracking-drawer]")) && (await exists("[data-testid=tracking-drawer]")) && (await camera()) !== cam0);
check("the component is still selected and the card says where you are (stage and recovery)", (await inspectorId()) === selected && (await outlineOf(selected)) >= 1 && new RegExp(selected.slice(-10)).test((await text("[data-testid=collapsed-component]")) ?? ""), await text("[data-testid=tracking-collapsed]"));
check("the 3D marks stay on while folded", (await tintCount()) > 0 && Math.abs((await tintCount()) - marksN) <= 3, [await tintCount(), marksN]);
await b.shot(`${OUT}/c3_located.png`);
await click("[data-testid=tracking-expand]");
await b.sleep(700);
check("Show workspace returns to exactly where you were: same search text, scope, selected record", (await b.evaluate(`${q("[data-testid=register-search]")}.value`)) === typed && (await attr(`${mt} [data-testid=record-panel]`, "data-id")) === selected && (await T(`s.get().filters.scope`)) === "tracked");
await select(D[0]);
check("selecting a component in the building opens its tracking panel (3D -> workspace)", (await attr(`${mt} [data-testid=record-panel]`, "data-id")) === D[0]);
await click("[data-testid=tab-register]");
await b.evaluate(`document.querySelector("[data-pane=register] [data-testid=register-list]").focus()`);
const before = await inspectorId();
await keydown(`${mt} [data-testid=register-list]`, "ArrowDown");
await b.sleep(500);
check("ArrowDown on the focused list moves the selection (inspector follows)", (await inspectorId()) !== before);

// ── 13. C2 sees C3 ──────────────────────────────────────────────────────────────────────
await b.shot(`${OUT}/c3_register.png`);
await click("[data-testid=reuse-toggle]");
await b.sleep(900);
check("opening Reuse closes Tracking (one drawer at a time) and removes its marks", !(await exists("[data-testid=tracking-drawer]")) && (await exists("[data-testid=reuse-drawer]")));
await click("[data-testid=tab-allocation]");
await b.sleep(600);
await click("[data-testid=demand-block] button.rx-dem-head");
await b.sleep(500);
const ful = await all("[data-testid=allocation-fulfilled]", "e.textContent");
check("the C2 allocation rows show how much was recorded as reused (C3): D0's allocation 0.200 of 0.300", ful.some((t) => /reused 0\.200 of 0\.300/.test(t)), ful);
await click("[data-testid=tracking-toggle]");
await b.sleep(900);
check("opening Tracking closes Reuse, and the tracking records are all still there", (await exists("[data-testid=tracking-drawer]")) && !(await exists("[data-testid=reuse-drawer]")) && (await T(`Object.keys(s.get().records).length`)) === nTracked + model.asmKids.length);

// ── 14. persistence ──────────────────────────────────────────────────────────────────────
const stored = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
const canon = `(() => { const r = window.__tracking.get().records; return JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]])); })()`;
const before2 = JSON.parse(await b.evaluate(canon));
const batchesBefore = JSON.parse(await T(`JSON.stringify(s.get().batches)`));
const sd = JSON.parse(stored);
check("saved data holds only records (histories) and batches: no status, balance or report is stored", sd.version === 1 && Object.keys(sd).sort().join() === "batches,records,version" && !/"completion"|"unaccounted"|"inHand"/.test(stored), Object.keys(sd));
await b.goto(`${BASE}/?view=full`);
const after2 = JSON.parse(await b.evaluate(canon));
check("after a reload every record comes back with its complete history, and the batches too", JSON.stringify(after2) === JSON.stringify(before2) && JSON.stringify(JSON.parse(await T(`JSON.stringify(s.get().batches)`))) === JSON.stringify(batchesBefore));
check("a record's derived state after the reload equals the independent replay (same stage, same balances)", JSON.stringify(await T(`${INDEP}[${JSON.stringify(D[0])}]`)) === JSON.stringify(s0), await T(`${INDEP}[${JSON.stringify(D[0])}]`));
// broken accounting, corrupt, orphan
const broken = JSON.parse(stored);
const rb = broken.records.find((x) => x.componentId === D[0]);
rb.events.find((e) => e.kind === "outcome" && e.outcome === "recycled").quantity = 5;
broken.records.push({ componentId: "JUNK", unit: "m2" }, "junk");
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(broken))})`);
await b.goto(`${BASE}/?view=full`);
check("a history that breaks the accounting (outcomes above what was recovered) is dropped, not repaired; the other records survive", (await T(`s.get().records[${JSON.stringify(D[0])}]`)) === undefined && (await T(`Object.keys(s.get().records).length`)) === before2.length - 1);
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, "{not json")`);
await b.goto(`${BASE}/?view=full`);
check("corrupt saved data starts empty without errors", (await T(`Object.keys(s.get().records).length`)) === 0 && (await T(`s.get().batches.length`)) === 0);
const orphan = JSON.parse(stored);
const ro = orphan.records.find((x) => x.componentId === D[2]);
ro.componentId = "REGENERATED-ID";
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(orphan))})`);
await b.goto(`${BASE}/?view=full`);
check("a record of a component that is not in the model is KEPT and flagged, never dropped silently", (await T(`s.get().records["REGENERATED-ID"] !== undefined`)));
await click("[data-testid=tracking-toggle]");
await b.sleep(900);
await T(`s.setFilters({ scope: "tracked", text: "REGENERATED" })`);
await b.sleep(500);
await click(`${mt} [data-testid=register-row]`);
await b.sleep(600);
check("…and the panel says so", /not in the current model/.test((await text(`${mt} [data-testid=flag-list]`)) ?? "") || /not in the current model/.test((await text(`${mt} [data-testid=record-panel]`)) ?? ""));
// allocations changed while the app was closed are logged on load
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(stored)})`);
const c2doc = JSON.parse(c2_0);
const half = JSON.parse(await b.evaluate(`localStorage.getItem(${JSON.stringify(C2KEY)})`));
half.allocations = half.allocations.filter((a) => a.componentId !== D[0]);
await b.evaluate(`localStorage.setItem(${JSON.stringify(C2KEY)}, ${JSON.stringify(JSON.stringify(half))})`);
await b.goto(`${BASE}/?view=full`);
check("an allocation cancelled in C2 while the app was closed is logged in the record's history on load (reuse already recorded against it is kept)", await T(`(() => { const r = s.get().records[${JSON.stringify(D[0])}]; const e = r.events.filter((x) => x.kind === "allocation").at(-1); return e.change === "cancelled" && e.by === "system" && r.events.filter((x) => x.kind === "outcome" && x.allocationId).length === 1; })()`));
await b.evaluate(`localStorage.setItem(${JSON.stringify(C2KEY)}, ${JSON.stringify(c2_0)})`);

// ── 15. exclusivity, presentation mode ──────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await click("[data-testid=tracking-toggle]");
await b.sleep(900);
await click("[data-testid=inventory-toggle]");
await b.sleep(700);
check("opening the Inventory closes the tracking workspace and removes its marks", !(await exists("[data-testid=tracking-drawer]")) && (await exists("[data-testid=inventory-drawer]")) && (await tintCount()) === 0 && !(await T(`s.get().open`)));
await click("[data-testid=tracking-toggle]");
await b.sleep(800);
check("opening Tracking closes the Inventory and its marks return", (await exists("[data-testid=tracking-drawer]")) && !(await exists("[data-testid=inventory-drawer]")));
await click("[data-testid=carbon-toggle]");
await b.sleep(700);
check("opening Carbon closes it, and Carbon's own highlight flag is kept", !(await exists("[data-testid=tracking-drawer]")) && (await b.evaluate(`window.__scenarios.get().externalOpen === true`)));
await click("[data-testid=carbon-toggle]");
await b.sleep(400);
await click("[data-testid=tracking-toggle]");
await b.sleep(800);
await click("[data-testid=present-toggle]");
await b.sleep(1200);
check("presentation mode closes the tracking workspace and its marks", (await exists("[data-testid=presentation]")) && !(await exists("[data-testid=tracking-drawer]")) && (await tintCount()) === 0);
await click("[data-testid=pm-exit]");
await b.sleep(1200);
check("leaving presentation mode restores the workspace", (await exists("[data-testid=tracking-drawer]")) && (await T(`s.get().open`)));

// ── 16. close: the building is exactly as it was ─────────────────────────────────────────────
await click("[data-testid=tracking-close]");
await b.sleep(900);
const snapEnd = await snap();
check("closing the workspace removes every mark and the building is exactly as it was (meshes, colours, instance matrices)", snapEnd.tints === 0 && snapEnd.hash === snap0.hash && snapEnd.meshes === snap0.meshes && snapEnd.hiddenPlain === snap0.hiddenPlain, [snapEnd, snap0]);
check("no overlay record is left behind", !(await b.evaluate(`!!window.__scenarioOverlay`)));
check("no record of the model changed", (await recordsHash()) === rec0);
check("B1 quantities are exactly as before the whole run", JSON.stringify(await b1Hash()) === JSON.stringify(b1_0));
check("B2 assessments and C2 requirements / allocations are exactly as seeded", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2_0 && (await b.evaluate(`localStorage.getItem(${JSON.stringify(C2KEY)})`)) === c2_0);

// ── 17. scale ───────────────────────────────────────────────────────────────────────────
await click("[data-testid=tracking-toggle]");
await b.sleep(900);
const big = await b.evaluate(`(() => { const t = performance.now(); const ids = window.__tracking.context().inv.rows.slice(0, 3000).map((r) => r.rec.id); const res = window.__tracking.start(ids); return { ms: Math.round(performance.now() - t), started: res.started }; })()`);
await click("[data-testid=tab-report]");
await b.sleep(1500);
check("tracking 3,000 components at once is fast, and the report still reconciles with every component counted once", big.ms < 4000 && big.started > 2900 && /counted once/.test((await text("[data-testid=report-integrity]")) ?? ""), [big, await text("[data-testid=report-integrity]")]);
await T(`s.setFilters({ scope: "all", text: "" })`);
await b.sleep(1500);
check("the 'All components' scope is usable: the count is the whole model", (await text("[data-testid=register-count]"))?.includes(`of ${model.total.toLocaleString("en-US")}`), await text("[data-testid=register-count]"));

await finish(0);
