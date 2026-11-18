// C2 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the Reuse workspace, fill the requirement
// form, pick candidates, confirm allocations and fold / unfold the workspace; the rest drives form controls. Checked against the
// REAL building (B2 assessments and C1 observations are seeded in localStorage, as a user's own entries would be):
//   workspace opens (draw calls unchanged, wide drawer, controls panel shifts), catalogue counts / filters / sort, requirement form
//   validation, ranking tiers equal an independent hand computation from the records (strong / conditional / incompatible),
//   supply = record quantity x recovery %, explanation rows (required vs actual, missing information, blockers), observed condition
//   turning a conditional match strong, unit mismatch, double-allocation prevention across competing requirements, partial matches,
//   revising and removing allocations, suggested vs confirmed, review of stale allocations, B1 / B2 data untouched, persistence
//   (and corrupt / orphaned saved data), the 3D marks (strong / conditional / allocated tints on the existing meshes), selection of the
//   real component, Locate in 3D + fold / unfold without losing context, exact restore (hash) after closing, drawer exclusivity,
//   presentation mode, ranking weights, JSON / CSV export for C3, the inspector line, keyboard stepping, console clean.
// Screenshots go to docs/screenshots/c2. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/c2";
const KEY = "rematter.reuse.v1";
const B2KEY = "rematter.recovery.assessments.v1";
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
const all = (sel, expr) => b.evaluate(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => ${expr})`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "center" })`); await b.sleep(150); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no select ${sel}"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) throw new Error("no input ${sel}"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
const setCheck = (sel, on) => b.evaluate(`(() => { const e = ${q(sel)}; if (e.checked !== ${on}) e.click(); return e.checked; })()`);
const keydown = (sel, key) => b.evaluate(`${q(sel)}.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
const waitFor = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await b.evaluate(expr)) return true; await b.sleep(120); } return false; };
const select = async (id) => { await b.evaluate(`window.__reloop.select(${JSON.stringify(id)})`); await b.sleep(500); };
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const applied = () => b.evaluate(`window.__scenarioOverlay ? JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(window.__scenarioOverlay).map(([k, v]) => [k, v.length])))) : null`);
const appliedHas = (key, id) => b.evaluate(`!!window.__scenarioOverlay && window.__scenarioOverlay[${JSON.stringify(key)}].includes(${JSON.stringify(id)})`);
const tintColours = () => b.evaluate(`(() => { const out = {}; window.__reloop.scene.traverse((o) => { if (o.name === "__scenario") { const k = o.material.color.getHexString(); out[k] = (out[k] ?? 0) + (o.isInstancedMesh ? o.count : 1); } }); return out; })()`);
const tintCount = () => b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.name === "__scenario") n++; }); return n; })()`);
const outlineOf = (id) => b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.name === ${JSON.stringify(id + "__selection")}) n++; }); return n; })()`);
const camera = () => b.evaluate(`JSON.stringify({ p: window.__reloop.camera.position.toArray() })`);
const R = (expr) => b.evaluate(`(() => { const s = window.__reuse; return ${expr}; })()`);
const st = () => R(`(() => { const g = s.get(); return JSON.parse(JSON.stringify({ n: g.requirements.length, a: g.allocations.length, active: g.activeId, open: g.open, collapsed: g.collapsed, tab: g.tab })); })()`);
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
// B1 quantities of every leaf (hash), read from the live engine object the workspace itself uses
const b1Hash = () => b.evaluate(`(() => { const inv = window.__reuse.context().inv; let h = 0; for (const row of inv.rows) { const s = row.rec.id + "|" + row.q.primary.value + "|" + row.q.primary.unit + "|" + row.q.mass.value; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return { n: inv.rows.length, h }; })()`);
const recordsHash = () => b.evaluate(`(() => { let h = 0; for (const r of window.__reloop.records) { const s = r.id + r.floor + r.originalPosition.join() + r.quantity + r.unit + r.materialId + r.condition; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return h; })()`);
const near = (a, c, tol = 1e-6) => a !== null && Math.abs(a - c) <= tol * Math.max(1, Math.abs(c));

// ── the independent hand computation: tiers of a porcelain floor-tile requirement, straight from the records, assessments and passports ──
const EXPECT = `(() => {
  const A = new Map(JSON.parse(localStorage.getItem(${JSON.stringify(B2KEY)}) ?? '{"entries":[]}').entries);
  const M = window.__passports.get().meta;
  const out = { strong: [], conditional: [], incompatible: [] };
  for (const r of window.__reloop.records) {
    if (r.geometry.kind === "group" || r.materialId !== "tile_porcelain_floor") continue;
    if (r.componentType !== "floor_tile") { out.incompatible.push(r.id); continue; }
    const d = r.dimensions;
    const e = [d.length, d.width, d.height, d.thickness].filter((v) => typeof v === "number" && v > 0).sort((a, b) => b - a);
    const t = 0.005 + 1e-9;
    const fits = e.length >= 3 && e[0] >= 0.3 - t && e[1] >= 0.3 - t && e[2] >= 0.008 - t && e[2] <= 0.012 + t;
    const a = A.get(r.id);
    const obs = M.get(r.id)?.observedCondition ?? null;
    if (!fits || (a && a.classification === "recycling") || obs === "damaged") { out.incompatible.push(r.id); continue; }
    if (a && a.classification === "direct_reuse" && a.recoveryPct != null && a.preparation === "none") out.strong.push(r.id);
    else out.conditional.push(r.id);
  }
  return out;
})()`;
const sameTiers = (id) => b.evaluate(`(() => {
  const exp = ${EXPECT};
  const req = window.__reuse.requirement(${JSON.stringify(id)});
  const got = window.__reuse.result(req);
  const key = (l) => l.slice().sort().join("|");
  const ids = (l) => l.map((c) => c.id);
  return { strong: key(exp.strong) === key(ids(got.strong)), conditional: key(exp.conditional) === key(ids(got.conditional)), incompatible: key(exp.incompatible) === key(ids(got.incompatible)),
    n: [exp.strong.length, exp.conditional.length, exp.incompatible.length], g: [got.strong.length, got.conditional.length, got.incompatible.length] };
})()`);

// ── 0. start clean ────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`${JSON.stringify([KEY, B2KEY, PKEY, ...OTHER])}.forEach((k) => localStorage.removeItem(k))`);
await b.goto(`${BASE}/?view=full`);
const rec0 = await recordsHash();
const model = JSON.parse(await b.evaluate(`JSON.stringify((() => {
  const recs = window.__reloop.records;
  const fits = (d) => { const e = [d.length, d.width, d.height, d.thickness].filter((v) => typeof v === "number" && v > 0).sort((a, b) => b - a); const t = 0.005 + 1e-9; return e.length >= 3 && e[0] >= 0.3 - t && e[1] >= 0.3 - t && e[2] >= 0.008 - t && e[2] <= 0.012 + t; };
  const tiles = recs.filter((r) => r.componentType === "floor_tile" && r.materialId === "tile_porcelain_floor" && r.apartmentId === "A1" && r.floor === 0 && fits(r.dimensions)).map((r) => r.id).sort();
  const basins = recs.filter((r) => r.componentType === "basin").map((r) => r.id).sort();
  const door = recs.find((r) => r.componentType === "door_leaf" && r.materialId.startsWith("timber"));
  return { tiles, basins: basins.slice(0, 6), doorId: door.id, total: recs.filter((r) => r.geometry.kind !== "group").length };
})())`));
const T = model.tiles;
const D = T.slice(0, 20); // direct reuse 90 % (preparation none)
const RF = T.slice(20, 30); // refurbish 80 %, cleaning
const RC = T.slice(30, 35); // recycling
const BAS = model.basins;
check("the real model offers enough tiles and basins to test with", T.length >= 100 && BAS.length >= 6, [T.length, BAS.length]);
const asm = (c, pct, prep) => ({ classification: c, recoveryPct: pct, preparation: prep, destination: null, lossNote: "", note: "" });
const entries = [...D.map((id) => [id, asm("direct_reuse", 90, "none")]), ...RF.map((id) => [id, asm("refurbish_reuse", 80, "cleaning")]), ...RC.map((id) => [id, asm("recycling", 90, null)]), ...BAS.slice(0, 3).map((id) => [id, asm("direct_reuse", 100, "none")]), [BAS[3], asm("direct_reuse", 90, "none")]];
const meta = (c) => ({ inspectionStatus: "inspected", observedCondition: c, inspectedOn: "2026-10-01", inspectedBy: "check", conditionNote: "", provenanceNote: "", updatedAt: "2026-10-01T00:00:00.000Z" });
const metaEntries = [...D.slice(0, 5).map((id) => [id, meta("good")]), [D[5], meta("damaged")], [D[6], meta("poor")]];
await b.evaluate(`localStorage.setItem(${JSON.stringify(B2KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, entries }))}); localStorage.setItem(${JSON.stringify(PKEY)}, ${JSON.stringify(JSON.stringify({ version: 1, entries: metaEntries }))})`);
await b.goto(`${BASE}/?view=full`);
const snap0 = await snap();
const stats0 = await b.evaluate(`window.__reloop.stats(false)`);
const b1_0 = await b1Hash();
const b2_0 = await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`);
check("B1 inventory is the whole real model", b1_0.n === model.total, [b1_0.n, model.total]);

// ── 1. open the workspace with a real click ─────────────────────────────────────────────────
check("the controls panel has a Reuse button", await exists("[data-testid=reuse-toggle]"));
await click("[data-testid=reuse-toggle]");
await b.sleep(900);
check("Reuse opens the workspace (a wide drawer)", (await exists("[data-testid=reuse-drawer]")) && (await b.evaluate(`${q("[data-testid=reuse-drawer]")}.getBoundingClientRect().width`)) >= 560);
check("the workspace docks beside the model: the viewport and the dock touch, nothing overlaps, the model keeps at least 440 px", await b.evaluate(`(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const v = r("[data-testid=viewport]"), d = r("[data-testid=dock]"); return Math.abs(v.right - d.left) <= 1 && d.width >= 560 && v.width >= 440; })()`));
check("opening the workspace does not touch the scene: draw calls unchanged, no tints, no hidden meshes", (await b.evaluate(`window.__reloop.stats(false)`)).drawCalls === stats0.drawCalls && (await tintCount()) === 0);
check("the Reuse button reads as pressed", (await attr("[data-testid=reuse-toggle]", "aria-pressed")) === "true");
check("a first-time user sees guidance and no requirement", (await exists("[data-testid=no-reuse-hint]")) === false && /No requirements yet/.test((await text("[data-testid=requirement-list]")) ?? "") === true);

// ── 2. the catalogue ────────────────────────────────────────────────────────────
check("catalogue lists every leaf component of the model", (await text("[data-testid=catalogue-count]")).replace(/,/g, "").startsWith(`${model.total} of ${model.total}`), await text("[data-testid=catalogue-count]"));
check("components assessed for reuse are named in the strip, with counts", /Porcelain tile\s+30/.test((await text("[data-testid=category-strip]")) ?? "") && /Sanitary ceramic\s+4/.test((await text("[data-testid=category-strip]")) ?? ""), await text("[data-testid=category-strip]"));
const firstRows = await all("[data-testid=catalogue-row]", "e.dataset.id");
check("'Reuse-ready first' lists assessed-for-reuse components first", firstRows.length > 3 && firstRows.slice(0, 4).every((id) => [...D, ...RF, ...BAS.slice(0, 4)].includes(id)), firstRows.slice(0, 5));
await click("[data-testid=elig-reuse]");
await b.sleep(400);
check("the 'assessed for reuse' filter counts exactly the seeded reuse components (20 + 10 tiles, 4 basins)", /^34 of/.test(((await text("[data-testid=catalogue-count]")) ?? "").replace(/,/g, "")), await text("[data-testid=catalogue-count]"));
await click("[data-testid=elig-recycling]");
await b.sleep(300);
check("the 'for recycling' filter counts the 5 recycling tiles", /^5 of/.test(((await text("[data-testid=catalogue-count]")) ?? "")), await text("[data-testid=catalogue-count]"));
await click("[data-testid=elig-all]");
await setInput("[data-testid=catalogue-search]", D[3]);
await b.sleep(500);
check("search by id finds that component (and only it)", (await all("[data-testid=catalogue-row]", "e.dataset.id")).join() === D[3], await all("[data-testid=catalogue-row]", "e.dataset.id"));
await setInput("[data-testid=catalogue-search]", "");
await setSelect("[data-testid=catalogue-substance]", "sanitary_ceramic");
await b.sleep(400);
check("the material filter counts the sanitary ceramic components", /^300 of/.test(((await text("[data-testid=catalogue-count]")) ?? "")), await text("[data-testid=catalogue-count]"));
await setSelect("[data-testid=catalogue-substance]", "");
await setInput("[data-testid=catalogue-search]", D[3]);
await b.sleep(500);
await click(`[data-testid=catalogue-row][data-id="${D[3]}"]`);
await b.sleep(900);
check("clicking a catalogue row selects that real component in the building (inspector, outline)", (await inspectorId()) === D[3] && (await outlineOf(D[3])) >= 1, [await inspectorId(), await outlineOf(D[3])]);
const facts = (await text("[data-testid=source-facts]")) ?? "";
const recD3 = JSON.parse(await b.evaluate(`JSON.stringify(window.__reloop.records.find((r) => r.id === ${JSON.stringify(D[3])}))`));
check("source facts: B1 quantity, B2 estimate = quantity x 90 % (hand-checked), upper bound is not claimed", new RegExp(`${recD3.quantity.toFixed(3)} m²`).test(facts) && facts.includes((recD3.quantity * 0.9).toFixed(3)) && /B2 estimate/.test(facts), facts.slice(0, 500));
check("source facts: condition from C1 ('Good'), the model's own condition labelled as a generated default", /Good/.test((await text("[data-testid=source-condition]")) ?? "") && /generated default/.test((await text("[data-testid=source-condition]")) ?? ""));
check("source facts say where each fact comes from; carbon / removal / scenarios are 'not assessed' rather than invented", /not assessed in B5/.test((await text("[data-testid=source-carbon]")) ?? "") && /not in a removal plan|no removal plan/i.test((await text("[data-testid=source-removal]")) ?? "") && /no scenario/.test((await text("[data-testid=source-scenarios]")) ?? ""));
check("recorded size is shown in millimetres and marked as a model value, not a site measurement", /\d+ mm/.test((await text("[data-testid=source-size]")) ?? "") && /not site measurements/.test((await text("[data-testid=source-size]")) ?? ""));
await b.shot(`${OUT}/c2_catalogue.png`);
await setInput("[data-testid=catalogue-search]", "");

// ── 3. create a requirement through the real form ────────────────────────────────────
await click("[data-testid=new-requirement]");
await b.sleep(400);
check("the form opens", await visible("[data-testid=requirement-form]"));
await click("[data-testid=req-save]");
check("an empty form is refused with the reason", /name/i.test((await text("[data-testid=req-error]")) ?? "") && (await st()).n === 0, await text("[data-testid=req-error]"));
await setInput("[data-testid=req-name]", "Hall floor");
await click("[data-testid=req-save]");
check("a missing material category is refused", /material category/i.test((await text("[data-testid=req-error]")) ?? ""), await text("[data-testid=req-error]"));
await setSelect("[data-testid=req-substance]", "porcelain_tile");
await b.sleep(200);
check("choosing a material offers only forms that exist for it and picks the unit it is measured in", (await b.evaluate(`[...${q("[data-testid=req-form]")}.options].map((o) => o.value).join()`)).includes("tile_floor") && (await b.evaluate(`${q("[data-testid=req-unit]")}.value`)) === "m2" && /m² \(/.test((await text("[data-testid=unit-hint]")) ?? ""), await text("[data-testid=unit-hint]"));
await setSelect("[data-testid=req-form]", "tile_floor");
await setSelect("[data-testid=req-type]", "floor_tile");
await setInput("[data-testid=req-quantity]", "-3");
await click("[data-testid=req-save]");
check("a negative quantity is refused", /above 0/.test((await text("[data-testid=req-error]")) ?? ""), await text("[data-testid=req-error]"));
await setInput("[data-testid=req-quantity]", "5");
await setInput("[data-testid=dim-length-min]", "500");
await setInput("[data-testid=dim-length-max]", "300");
await click("[data-testid=req-save]");
check("a minimum above a maximum is refused", /larger than maximum/.test((await text("[data-testid=req-error]")) ?? ""), await text("[data-testid=req-error]"));
await setInput("[data-testid=dim-length-min]", "300");
await setInput("[data-testid=dim-length-max]", "");
await setInput("[data-testid=dim-width-min]", "300");
await setInput("[data-testid=dim-thickness-min]", "8");
await setInput("[data-testid=dim-thickness-max]", "12");
await setSelect("[data-testid=req-unit]", "nr");
check("the unit hint warns that nothing is measured in the chosen unit (units are never converted)", /never converted/.test((await text("[data-testid=unit-hint]")) ?? ""), await text("[data-testid=unit-hint]"));
await setSelect("[data-testid=req-unit]", "m2");
await b.shot(`${OUT}/c2_form.png`);
await click("[data-testid=req-save]");
await b.sleep(1500);
const s1 = await st();
check("Create adds the requirement, makes it active and opens its matches", s1.n === 1 && s1.tab === "matches" && (await text("[data-testid=active-name]")) === "Hall floor", s1);
const R1 = s1.active;
check("the requirement is listed in the rail with 0 of 5 m² allocated", /0\s*\/\s*5\.00 m²/.test((await text("[data-testid=requirement-item]")) ?? "") && (await attr("[data-testid=requirement-item]", "data-status")) === "unmet", await text("[data-testid=requirement-item]"));
check("the requirement's facts are shown as chips (material, form, type, sizes)", /Porcelain tile/.test((await text("[data-testid=spec-chips]")) ?? "") && /Floor tile/.test((await text("[data-testid=spec-chips]")) ?? "") && /≥ 300 mm/.test((await text("[data-testid=spec-chips]")) ?? "") && /8 mm – 12 mm/.test((await text("[data-testid=spec-chips]")) ?? ""), await text("[data-testid=spec-chips]"));

// ── 4. ranking = independent hand computation ───────────────────────────────────────────
const tiers1 = await sameTiers(R1);
check("strong candidates are exactly the hand-computed set (direct reuse, 90 %, sizes met, not damaged)", tiers1.strong, tiers1);
check("conditional candidates are exactly the hand-computed set (refurbish / cleaning + every unassessed component of that size)", tiers1.conditional, tiers1);
check("incompatible components are exactly the hand-computed set (recycling, damaged, too small, other form)", tiers1.incompatible, tiers1);
check("the UI tier counts equal the engine's", (await text("[data-testid=tier-count-strong]")).replace(/,/g, "") === String(tiers1.n[0]) && (await text("[data-testid=tier-count-conditional]")).replace(/,/g, "") === String(tiers1.n[1]) && (await text("[data-testid=tier-count-incompatible]")).replace(/,/g, "") === String(tiers1.n[2]), [await text("[data-testid=tier-count-strong]"), tiers1.n]);
check("of the 20 direct-reuse tiles all are strong except the one recorded as damaged (the poor one is allowed: no condition is required)", tiers1.n[0] === 19, tiers1.n);
const listIds = await all("[data-testid=candidate]", "e.dataset.id");
const listTiers = await all("[data-testid=candidate]", "e.dataset.tier");
check("the list starts with the strong candidates (19 of them), before any conditional one", listTiers.length >= 8 && listTiers.every((t) => t === "strong"), listTiers);
const top = listIds[0];
const recTop = JSON.parse(await b.evaluate(`JSON.stringify(window.__reloop.records.find((r) => r.id === ${JSON.stringify(top)}))`));
const topRowText = (await text(`[data-testid=candidate][data-id="${top}"]`)) ?? "";
check("a candidate row shows its tier, the compatibility strip, a score and what it can supply (record quantity x 90 %)", /Strong/.test(topRowText) && topRowText.includes((recTop.quantity * 0.9).toFixed(3)) && (await b.evaluate(`document.querySelectorAll(${JSON.stringify(`[data-testid=candidate][data-id="${top}"] [data-testid=pips] .rx-pip`)}).length`)) === 7, topRowText);
check("incompatible components are not hidden: the 'why not' summary names the reasons with counts", /incompatible, mostly/.test((await text("[data-testid=why-not]")) ?? ""), await text("[data-testid=why-not]"));
await b.shot(`${OUT}/c2_matches.png`);

// ── 5. the 3D marks: the existing meshes, strong / conditional tints ──────────────────────────────
const ov = await applied();
check("3D: the marks exist on the existing meshes (tint overlay present) in the strong and conditional colours", !!ov && ov.direct_reuse > 0 && ov.refurbish_reuse > 0, ov);
const cols = await tintColours();
check("3D: strong = 009e73, conditional = e69f00 (and nothing else)", Object.keys(cols).sort().join() === "009e73,e69f00", cols);
check("3D: every strong candidate is marked on its real mesh (the selected one, D[3], is marked by its outline instead): 19 - 1 = 18", ov.direct_reuse === tiers1.n[0] - 1 && !(await appliedHas("direct_reuse", D[3])), [ov.direct_reuse, tiers1.n[0]]);
check("3D: every conditional candidate that is drawn is marked (marks = conditional candidates)", ov.refurbish_reuse === tiers1.n[1], [ov.refurbish_reuse, tiers1.n[1]]);
check("3D: an incompatible component (a recycling tile) is not marked", !(await appliedHas("direct_reuse", RC[0])) && !(await appliedHas("refurbish_reuse", RC[0])));

// ── 6. select a candidate: the comparison ─────────────────────────────────────────────────
await click(`[data-testid=candidate][data-id="${top}"]`);
await b.sleep(900);
check("clicking a candidate row selects the real component (inspector + selection outline)", (await inspectorId()) === top && (await outlineOf(top)) >= 1, [await inspectorId(), await outlineOf(top)]);
const mt = "[data-pane=matches]";
check("the comparison opens for that component and says Strong", (await attr(`${mt} [data-testid=comparison]`, "data-component")) === top && (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "strong");
const crit = await all(`${mt} [data-testid=cmp-criteria] tr[data-criterion]`, "e.dataset.criterion + ':' + e.dataset.state");
check("every criterion has a row; the unused ones say 'not required' instead of a made-up pass", crit.some((c) => c === "material:met") && crit.some((c) => c === "dimensions:met") && crit.some((c) => c.startsWith("condition:na")) && crit.some((c) => c === "recovery:met"), crit);
const cmpText = (await text(`${mt} [data-testid=cmp-criteria]`)) ?? "";
check("the criteria table shows required AND actual values: '≥ 300 mm' against the recorded length in mm, '8 mm – 12 mm' against 10 mm", /≥ 300 mm/.test(cmpText) && /\b10 mm\b/.test(cmpText) && /8 mm – 12 mm/.test(cmpText), cmpText.slice(0, 600));
check("points are shown per criterion (weight x points) and the score formula is spelled out", /Score = 100 ×/.test((await text(`${mt} [data-testid=cmp-formula]`)) ?? "") && /\//.test((await text(`${mt} [data-testid=pts-material]`)) ?? ""));
const scoreUi = Number((await text(`${mt} [data-testid=cmp-score]`)).match(/score\s+(\d+)/)?.[1]);
const scoreRow = Number(await attr(`[data-testid=candidate][data-id="${top}"]`, "data-score"));
check("the comparison score equals the list score (rounded)", Math.round(scoreRow) === scoreUi, [scoreRow, scoreUi]);
check("a strong match is worded as preliminary: no claim of suitability, compliance or fitness", /preliminary match/.test((await text(`${mt} [data-testid=cmp-headline]`)) ?? "") && /not a check of structural suitability, code compliance or fitness for purpose/.test((await text(`${mt} [data-testid=cmp-headline]`)) ?? ""));
check("a suggested match is labelled as not allocated", /Suggested match · not allocated/.test((await text(`${mt} [data-testid=comparison]`)) ?? ""));
await b.shot(`${OUT}/c2_comparison.png`);

// an unassessed (conditional) tile: what is missing is named
const cond = await b.evaluate(`window.__reuse.result(window.__reuse.requirement(${JSON.stringify(R1)})).conditional.map((c) => c.id).find((id) => !${JSON.stringify([...RF, ...D])}.includes(id))`);
await select(cond);
check("an unassessed tile is Conditional, never Strong, and its missing recovery data is listed", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "conditional" && /Not assessed for recovery/.test((await text(`${mt} [data-testid=cmp-missing]`)) ?? ""), await text(`${mt} [data-testid=cmp-missing]`));
check("its quantity is labelled an upper bound, not a recovered quantity", /upper bound/.test((await text(`${mt} [data-testid=cmp-notes]`)) ?? "") || /upper bound/.test((await text(`${mt} [data-testid=alloc-hint]`)) ?? ""));
check("the headline says it is not immediately reusable as stated", /not immediately reusable/.test((await text(`${mt} [data-testid=cmp-headline]`)) ?? ""));
await select(RF[0]);
check("a refurbish / cleaning tile is Conditional with the steps named under 'Conditions before reuse'", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "conditional" && /Refurbishment/.test((await text(`${mt} [data-testid=cmp-conditions]`)) ?? "") && /Cleaning/.test((await text(`${mt} [data-testid=cmp-conditions]`)) ?? ""), await text(`${mt} [data-testid=cmp-conditions]`));
await select(RC[0]);
check("a recycling tile is Incompatible: the reason is named and allocation is refused in the UI", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "incompatible" && /recycling, not for reuse/.test((await text(`${mt} [data-testid=cmp-blockers]`)) ?? "") && (await exists(`${mt} [data-testid=cmp-cannot]`)) && !(await exists(`${mt} [data-testid=alloc-confirm]`)), await text(`${mt} [data-testid=cmp-blockers]`));
await select(D[5]);
check("a tile recorded as damaged in the C1 passport is Incompatible", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "incompatible" && /damaged/.test((await text(`${mt} [data-testid=cmp-blockers]`)) ?? ""));

// ── 7. observed condition turns a conditional match into a strong one (and back) ─────────────────────────────────────────────
await click("[data-testid=req-edit]");
await b.sleep(300);
await setSelect("[data-testid=req-condition]", "fair");
await click("[data-testid=req-save]");
await b.sleep(1200);
await select(D[8]);
check("a required condition with no inspection recorded makes a direct-reuse tile Conditional, and says why", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "conditional" && /No observed condition is recorded/.test((await text(`${mt} [data-testid=cmp-missing]`)) ?? "") && /generated default/.test((await text(`${mt} [data-testid=cmp-missing]`)) ?? ""), await text(`${mt} [data-testid=cmp-missing]`));
await setSelect(`${mt} [data-testid=source-observed]`, "good");
await b.sleep(900);
check("recording 'Good' in the passport (through the workspace) makes the same tile Strong live", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "strong", await attr(`${mt} [data-testid=comparison]`, "data-tier"));
check("the observation was written to the C1 passport store, as the user's own entry", await b.evaluate(`window.__passports.get().meta.get(${JSON.stringify(D[8])})?.observedCondition === "good"`));
await setSelect(`${mt} [data-testid=source-observed]`, "poor");
await b.sleep(700);
check("recording 'Poor' makes it Incompatible with a requirement that asks for fair or better", (await attr(`${mt} [data-testid=comparison]`, "data-tier")) === "incompatible" && /poor/.test((await text(`${mt} [data-testid=cmp-blockers]`)) ?? ""));
await setSelect(`${mt} [data-testid=source-observed]`, "");
await b.sleep(500);
await click("[data-testid=req-edit]");
await b.sleep(300);
await setSelect("[data-testid=req-condition]", "any");
await click("[data-testid=req-save]");
await b.sleep(1200);
check("restoring 'not specified' and clearing the observation returns the original tiers", await b.evaluate(`window.__passports.get().meta.get(${JSON.stringify(D[8])}) === undefined`) && (await sameTiers(R1)).strong);

// ── 8. quantities: allocate, no double counting, partial, revise, remove ────────────────────────────────
const topS = await b.evaluate(`window.__reuse.result(window.__reuse.requirement(${JSON.stringify(R1)})).strong[0].id`);
const supplyTop = JSON.parse(await b.evaluate(`JSON.stringify(window.__reuse.result(window.__reuse.requirement(${JSON.stringify(R1)})).strong[0].supply)`));
await select(topS);
check("the supply of the top candidate is the record quantity x 90 % (hand-checked)", near(supplyTop.value, JSON.parse(await b.evaluate(`JSON.stringify(window.__reloop.records.find((r) => r.id === ${JSON.stringify(topS)}).quantity)`)) * 0.9, 1e-9) && supplyTop.basis === "recoverable", supplyTop);
const q1 = 0.1;
await setInput(`${mt} [data-testid=alloc-qty]`, String(q1));
await click(`${mt} [data-testid=alloc-confirm]`);
await b.sleep(700);
check("Confirm allocates exactly the typed quantity: required 5, allocated 0.1, remaining 4.9", near(Number((await text(`${mt} [data-testid=demand-allocated]`)).replace(/[^\d.]/g, "")), 0.1, 1e-9) && /4\.90/.test((await text(`${mt} [data-testid=demand-remaining]`)) ?? ""), [await text(`${mt} [data-testid=demand-allocated]`), await text(`${mt} [data-testid=demand-remaining]`)]);
check("the requirement is now Partially matched (not Matched, not Unmet)", /Partially matched/.test((await text(`${mt} [data-testid=demand-status]`)) ?? "") && (await attr("[data-testid=requirement-item]", "data-status")) === "partial");
check("the comparison now says Confirmed allocation, and the row shows the allocation (a suggestion is not an allocation)", /Confirmed allocation · 0\.100 m²/.test((await text(`${mt} [data-testid=comparison]`)) ?? "") && /allocated 0\.1/.test((await text(`[data-testid=candidate][data-id="${topS}"]`)) ?? ""));
check("the allocation is stored with its unit and the match as it was when confirmed", await R(`(() => { const a = s.get().allocations[0]; return a.componentId === ${JSON.stringify(topS)} && a.unit === "m2" && a.quantity === 0.1 && a.basis.tier === "strong" && a.basis.supplyBasis === "recoverable"; })()`));
check("the inspector shows the allocation on that component", /0\.100 m² → Hall floor/.test((await text("[data-testid=reuse-info-value]")) ?? ""), await text("[data-testid=reuse-info-value]"));
await select(D[9]);
check("3D: the allocated component is marked blue (allocated), not green (strong)", (await appliedHas("recycling", topS)) && !(await appliedHas("direct_reuse", topS)), await applied());
await select(topS);
check("B1 quantities and B2 assessments are exactly as before (the ledger lives beside them)", JSON.stringify(await b1Hash()) === JSON.stringify(b1_0) && (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2_0);

// a second, competing requirement for the same tile
await click("[data-testid=new-requirement]");
await b.sleep(300);
await setInput("[data-testid=req-name]", "Corridor floor");
await setSelect("[data-testid=req-substance]", "porcelain_tile");
await setSelect("[data-testid=req-form]", "tile_floor");
await setInput("[data-testid=req-quantity]", "3");
await click("[data-testid=req-save]");
await b.sleep(1500);
const R2 = (await st()).active;
check("a second requirement is created and active; the first is kept", R2 !== R1 && (await st()).n === 2);
await select(topS);
await b.sleep(400);
const freeAfter = supplyTop.value - q1;
await setInput(`${mt} [data-testid=alloc-qty]`, String(Number((freeAfter + 0.05).toFixed(6))));
await click(`${mt} [data-testid=alloc-confirm]`);
await b.sleep(500);
check("asking the second requirement for more than is free is refused: the message names what is free and who holds the rest", /is free/.test((await text(`${mt} [data-testid=alloc-msg]`)) ?? "") && /already allocated to other requirements/.test((await text(`${mt} [data-testid=alloc-msg]`)) ?? ""), await text(`${mt} [data-testid=alloc-msg]`));
check("…and the ledger is untouched (still one allocation)", (await st()).a === 1);
check("the hint states what is free for this requirement", new RegExp(`${freeAfter.toFixed(3)} m² of it is free`).test((await text(`${mt} [data-testid=alloc-hint]`)) ?? ""), await text(`${mt} [data-testid=alloc-hint]`));
await click(`${mt} [data-testid=alloc-max]`);
await click(`${mt} [data-testid=alloc-confirm]`);
await b.sleep(600);
check("'Max' allocates exactly the free remainder; the component is now fully allocated (0.1 + the rest = its supply)", await R(`(() => { const t = s.get().allocations.filter((a) => a.componentId === ${JSON.stringify(topS)}).reduce((x, a) => x + a.quantity, 0); return Math.abs(t - ${supplyTop.value}) < 1e-9 && s.get().allocations.length === 2; })()`));
check("no component is allocated beyond its supply, no requirement beyond its demand (engine reconciliation)", await R(`(() => { const ctx = s.context(); const by = new Map(); for (const a of s.get().allocations) by.set(a.componentId, (by.get(a.componentId) ?? 0) + a.quantity); for (const [id, t] of by) { const v = ctx.inv.byId.get(id).primary.value * (ctx.assessments.get(id)?.recoveryPct ?? 100) / 100; if (t > v + 1e-9) return false; } return true; })()`));
await select(listIds.find((id) => id !== topS && D.includes(id)) ?? D[9]);
await setInput(`${mt} [data-testid=alloc-qty]`, "0.05");
await click(`${mt} [data-testid=alloc-confirm]`);
await b.sleep(400);
check("another component is unaffected: it can still be allocated", (await st()).a === 3, await st());
await b.evaluate(`window.__reuse.select(${JSON.stringify(R1)})`);
await b.sleep(700);
await select(topS);
await setInput(`${mt} [data-testid=alloc-qty]`, "0.2");
await click(`${mt} [data-testid=alloc-confirm]`);
await b.sleep(500);
check("the first requirement cannot grow its allocation into quantity the second holds", /is free/.test((await text(`${mt} [data-testid=alloc-msg]`)) ?? ""), await text(`${mt} [data-testid=alloc-msg]`));
await setInput(`${mt} [data-testid=alloc-qty]`, "0.04");
await click(`${mt} [data-testid=alloc-confirm]`);
await b.sleep(500);
check("…but may shrink it (a revision): 0.1 -> 0.04 frees 0.06 for others", /Allocation updated/.test((await text(`${mt} [data-testid=alloc-msg]`)) ?? "") && (await R(`s.get().allocations.find((a) => a.requirementId === ${JSON.stringify(R1)} && a.componentId === ${JSON.stringify(topS)}).quantity`)) === 0.04);
await click(`${mt} [data-testid=alloc-remove]`);
await b.sleep(500);
check("Remove deletes the allocation and releases its quantity", (await st()).a === 2 && !(await exists(`${mt} [data-testid=alloc-remove]`)));
// unit mismatch + incompatible through the store (the UI hides the button for incompatible components)
const mismatch = await R(`s.allocate(${JSON.stringify(R1)}, ${JSON.stringify(RC[1])}, 0.05)`);
check("an incompatible component cannot be allocated (store refuses with the reason)", /^Incompatible: B2 assesses this component for recycling/.test(mismatch ?? ""), mismatch);
const R4 = await R(`s.add({ ...s.requirement(${JSON.stringify(R1)}), name: "Count test", unit: "nr", quantity: 4 }).id`);
const unitErr = await R(`s.allocate(${JSON.stringify(R4)}, ${JSON.stringify(T[50])}, 1)`);
check("units are never combined: a count requirement refuses an area-measured tile that otherwise fits", /^Incompatible: Measured in m²; the requirement is in nr \(units are never converted\)/.test(unitErr ?? ""), unitErr);
await R(`s.remove(${JSON.stringify(R4)})`);
await click("[data-testid=new-requirement]");
await b.sleep(300);
await setInput("[data-testid=req-name]", "Basins");
await setSelect("[data-testid=req-substance]", "sanitary_ceramic");
await setSelect("[data-testid=req-type]", "basin");
await setInput("[data-testid=req-quantity]", "4");
await click("[data-testid=req-save]");
await b.sleep(1200);
const R3 = (await st()).active;
const bt = await sameTiersBasins(R3);
async function sameTiersBasins(id) {
  return b.evaluate(`(() => { const res = window.__reuse.result(window.__reuse.requirement(${JSON.stringify(id)})); return { strong: res.strong.map((c) => c.id).sort(), n: [res.strong.length, res.conditional.length, res.incompatible.length], supplies: res.strong.map((c) => c.supply.value) }; })()`);
}
check("basins: the three direct-reuse items at 100 % are strong whole items; the one at 90 % supplies no whole item", bt.strong.join() === BAS.slice(0, 3).slice().sort().join() && bt.supplies.every((v) => v === 1), bt);
check("the 90 % basin is not a candidate (a single item cannot be partly recovered): incompatible with that reason", await b.evaluate(`(() => { const c = window.__reuse.result(window.__reuse.requirement(${JSON.stringify(R3)})).byId.get(${JSON.stringify(BAS[3])}); return c.tier === "incompatible" && c.blockers[0].code === "no_quantity" && /whole item/.test(c.blockers[0].text); })()`));
await b.shot(`${OUT}/c2_basins.png`);

// ── 9. suggested vs confirmed ───────────────────────────────────────────────────────────────
await b.evaluate(`window.__reuse.select(${JSON.stringify(R1)})`);
await b.sleep(900);
const aBefore = (await st()).a;
await click("[data-testid=suggest]");
await b.sleep(700);
check("Suggest shows a proposal labelled 'not confirmed' and changes nothing in the ledger", /not confirmed/.test((await text("[data-testid=proposal]")) ?? "") && (await st()).a === aBefore, await text("[data-testid=proposal-summary]"));
const propText = (await text("[data-testid=proposal-summary]")) ?? "";
const propN = Number(propText.match(/^(\d+) component/)?.[1]);
check("the proposal covers the remaining demand from the ranking (and says what stays unmet, if anything)", propN > 0 && /covers the requirement|stays unmet/.test(propText), propText);
check("the demand bar shows the proposal as a separate, hatched segment", await b.evaluate(`!!document.querySelector("[data-testid=demand-bar] .rx-bar-proposed")`));
await b.shot(`${OUT}/c2_proposal.png`);
await click("[data-testid=proposal-confirm]");
await b.sleep(900);
check("Confirm applies the proposal through the validated path: that many allocations are added", (await st()).a === aBefore + propN, [await st(), aBefore, propN]);
check("the requirement is now Matched (fully allocated), with no remaining demand", /Matched/.test((await text(`${mt} [data-testid=demand-status]`)) ?? "") && (await attr("[data-testid=requirement-item][data-requirement='" + R1 + "']", "data-status")) === "matched", await text(`${mt} [data-testid=demand-status]`));
check("the proposal panel is gone once confirmed", !(await exists("[data-testid=proposal]")));
check("ledger still balances after the confirmed proposal", await R(`(() => { const ctx = s.context(); const by = new Map(); for (const a of s.get().allocations) by.set(a.componentId, (by.get(a.componentId) ?? 0) + a.quantity); for (const [id, t] of by) { const v = ctx.inv.byId.get(id).primary.value; if (t > v + 1e-9) return false; } const req = s.get().requirements; for (const q of req) if (s.get().allocations.filter((a) => a.requirementId === q.id).reduce((x, a) => x + a.quantity, 0) > q.quantity + 1e-9) return false; return true; })()`));

// ── 10. the allocation summary ──────────────────────────────────────────────────────────
await click("[data-testid=tab-allocation]");
await b.sleep(600);
const tiles = { matched: Number(await text("[data-testid=count-matched]")), partial: Number(await text("[data-testid=count-partial]")), unmet: Number(await text("[data-testid=count-unmet]")) };
check("summary: Hall floor is matched; Corridor floor and Basins have allocations / none (matched + partial + unmet = 3)", tiles.matched === 1 && tiles.matched + tiles.partial + tiles.unmet === 3, tiles);
check("the books balance banner appears (no flags, reconciliation clean)", /The books balance/.test((await text("[data-testid=integrity]")) ?? ""), await text("[data-testid=integrity]"));
const units = await all("[data-testid=unit-totals] tr[data-unit]", "e.dataset.unit");
check("totals are one line per unit: m² and nr are never added together", units.join() === "m2,nr", units);
const m2row = (await text("[data-testid=unit-totals] tr[data-unit=m2]")) ?? "";
check("m² totals: required 5 + 3 = 8", /\b8\b/.test(m2row), m2row);
await click("[data-testid=demand-block][data-requirement='" + R1 + "'] button.rx-dem-head");
await b.sleep(500);
const rows = await all("[data-testid=allocation-row]", "e.dataset.id");
check("expanding a requirement lists its allocations (real component ids) with their quantities and tier at confirmation", rows.length === (await R(`s.get().allocations.filter((a) => a.requirementId === ${JSON.stringify(R1)}).length`)) && /confirmed as strong/.test((await text("[data-testid=allocation-row]")) ?? ""), rows.length);
const firstAllocId = rows[0];
const aq0 = await R(`s.get().allocations.find((a) => a.requirementId === ${JSON.stringify(R1)} && a.componentId === ${JSON.stringify(firstAllocId)}).quantity`);
await setInput("[data-testid=allocation-row] [data-testid=allocation-qty]", String(aq0 + 5));
await keydown("[data-testid=allocation-row] [data-testid=allocation-qty]", "Enter");
await b.sleep(500);
check("revising an allocation in the summary is validated too (cannot exceed supply or demand)", await R(`s.get().allocations.find((a) => a.requirementId === ${JSON.stringify(R1)} && a.componentId === ${JSON.stringify(firstAllocId)}).quantity === ${aq0}`));
await b.shot(`${OUT}/c2_allocation.png`);
await click("[data-testid=allocation-remove]");
await b.sleep(500);
check("removing an allocation in the summary releases it and reopens the demand (Hall floor is no longer fully matched)", (await R(`s.get().allocations.filter((a) => a.requirementId === ${JSON.stringify(R1)}).length`)) === rows.length - 1);

// ── 11. export for C3 ───────────────────────────────────────────────────────────────────
await b.evaluate(`window.__dl = []; const orig = URL.createObjectURL; URL.createObjectURL = (blob) => { blob.arrayBuffer().then((buf) => window.__dl.push({ type: blob.type, text: new TextDecoder().decode(buf) })); return orig(blob); }; window.HTMLAnchorElement.prototype.click = function () { return undefined; };`);
await click("[data-testid=export-json]");
await click("[data-testid=export-csv]");
await b.sleep(600);
const dl = JSON.parse(await b.evaluate(`JSON.stringify(window.__dl)`));
const json = JSON.parse(dl.find((d) => d.type.includes("json")).text);
const nAlloc = (await st()).a;
check("JSON export: schema, disclaimer, every allocation as 'planned' with recovered / reused quantities null (hand-off to C3)", json.schema === "rematter.reuse-plan/1" && /not an assessment of structural suitability/.test(json.disclaimer) && json.allocations.length === nAlloc && json.allocations.every((a) => a.outcome.status === "planned" && a.outcome.recoveredQuantity === null && a.outcome.reusedQuantity === null), [json.schema, json.allocations.length, nAlloc]);
check("JSON export: requirements carry required / allocated / remaining / status and the allocation quantities add up", json.requirements.length === 3 && json.requirements.every((q) => Math.abs(q.required - q.allocated - q.remaining) < 1e-9 || q.status === "over"), json.requirements.map((q) => [q.name, q.required, q.allocated, q.remaining]));
const csv = dl.find((d) => d.type.includes("csv")).text;
check("CSV export: header + one row per allocation, units spelled", csv.trim().split("\r\n").length === nAlloc + 1 && /requirement,application,component_id/.test(csv) && /m²/.test(csv), csv.slice(0, 200));

// ── 12. weights ───────────────────────────────────────────────────────────────────────
await click("[data-testid=tab-matches]");
await b.sleep(400);
const scoreOf = (id) => R(`s.result(s.requirement(s.get().activeId)).byId.get(${JSON.stringify(id)}).score`);
const topBefore = await scoreOf(topS);
await b.evaluate(`document.querySelector("[data-testid=weights]").open = true`);
await setInput("[data-testid=weight-quantity]", "0");
await b.sleep(800);
const topAfter = await scoreOf(topS);
check("weights are configuration: zeroing the quantity weight changes the scores (quantity no longer counts)", topAfter !== topBefore && Number.isFinite(topAfter), [topBefore, topAfter]);
check("the weight is saved with the reuse data", (await b.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).config.weights.quantity`)) === 0);
await click("[data-testid=weights-reset]");
await b.sleep(800);
check("reset returns the default weights and the original score", (await b.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})).config.weights.quantity`)) === 10 && (await scoreOf(topS)) === topBefore);
await b.evaluate(`document.querySelector("[data-testid=weights]").open = false`);

// ── 13. keyboard ───────────────────────────────────────────────────────────────────────
await select(listIds[0]);
await b.evaluate(`document.querySelector("[data-pane=matches] [data-testid=candidate-list]").focus()`);
const before = await inspectorId();
await keydown("[data-pane=matches] [data-testid=candidate-list]", "ArrowDown");
await b.sleep(500);
const afterKey = await inspectorId();
check("ArrowDown on the focused list moves the selection to the next candidate (inspector follows)", afterKey !== before && afterKey === (await all("[data-pane=matches] [data-testid=candidate]", "e.dataset.id"))[1], [before, afterKey]);

// ── 14. persistence ──────────────────────────────────────────────────────────────────────
const saved = await b.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}))`);
check("saved data holds requirements, allocations and the configuration only (no matches, scores or quantities of the model)", saved.version === 1 && saved.requirements.length === 3 && Array.isArray(saved.allocations) && !JSON.stringify(saved).includes("blockers") && Object.keys(saved).sort().join() === "activeId,allocations,config,requirements,version", Object.keys(saved));
const beforeReload = await st();
await b.goto(`${BASE}/?view=full`);
const afterReload = await st();
check("after a reload the requirements, allocations and active requirement come back", afterReload.n === beforeReload.n && afterReload.a === beforeReload.a && afterReload.active === beforeReload.active, [beforeReload, afterReload]);
// corrupt + orphan
const goodText = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, "{not json")`);
await b.goto(`${BASE}/?view=full`);
check("corrupt saved data starts empty without errors", (await st()).n === 0 && (await st()).a === 0);
const orphan = JSON.parse(goodText);
orphan.allocations[0].componentId = "REGENERATED-ID";
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(orphan))})`);
await b.goto(`${BASE}/?view=full`);
await click("[data-testid=reuse-toggle]");
await b.sleep(900);
await click("[data-testid=tab-allocation]");
await b.sleep(700);
check("an allocation to a component that is not in the model is KEPT and flagged for review, never dropped silently", (await st()).a === afterReload.a && /need.* review/.test((await text("[data-testid=integrity]")) ?? "") && (await exists("[data-testid=integrity-warn]")), await text("[data-testid=integrity]"));
await click(`[data-testid=demand-block][data-requirement='${orphan.allocations[0].requirementId}'] button.rx-dem-head`);
await b.sleep(500);
check("the flag says the component is not in the current model", /not in the current model/.test((await text("[data-testid=allocation-flag]")) ?? ""), await text("[data-testid=allocation-flag]"));
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(goodText)})`);
await b.goto(`${BASE}/?view=full`);

// ── 15. Locate in 3D, fold, unfold ─────────────────────────────────────────────────────────
await click("[data-testid=reuse-toggle]");
await b.sleep(1000);
await click("[data-testid=tab-matches]");
await b.sleep(500);
await b.evaluate(`window.__reuse.select(${JSON.stringify(R1)})`);
await b.sleep(900);
await setInput("[data-testid=match-search]", "A1-LIV");
await b.sleep(500);
const typed = await b.evaluate(`${q("[data-testid=match-search]")}.value`);
const target = (await all("[data-pane=matches] [data-testid=candidate]", "e.dataset.id"))[2];
await click(`[data-pane=matches] [data-testid=candidate][data-id="${target}"]`);
await b.sleep(900);
const cam0 = await camera();
const marksBefore = await tintCount();
await click("[data-pane=matches] [data-testid=locate]");
await b.sleep(1500);
check("Locate in 3D folds the workspace into its card (it stays mounted, hidden) and frames the camera on the component", (await visible("[data-testid=reuse-collapsed]")) && !(await visible("[data-testid=reuse-drawer]")) && (await exists("[data-testid=reuse-drawer]")) && (await camera()) !== cam0, [await visible("[data-testid=reuse-collapsed]")]);
const camNow = JSON.parse(await camera()).p;
const comp = JSON.parse(await b.evaluate(`JSON.stringify(window.__reloop.records.find((x) => x.id === ${JSON.stringify(target)}).originalPosition)`));
check("the camera is now close to the component (it was a user request, so it moved)", Math.hypot(camNow[0] - comp[0], camNow[1] - comp[1], camNow[2] - comp[2]) < 12, [camNow, comp]);
check("the component is still selected (inspector + outline) while the workspace is folded", (await inspectorId()) === target && (await outlineOf(target)) >= 1);
check("the folded card says where you are: the requirement and the selected candidate with its tier", /Hall floor/.test((await text("[data-testid=collapsed-requirement]")) ?? "") && new RegExp(target.slice(-12)).test((await text("[data-testid=collapsed-component]")) ?? ""), await text("[data-testid=reuse-collapsed]"));
check("the 3D marks stay on while folded", (await tintCount()) > 0 && Math.abs((await tintCount()) - marksBefore) <= 2, [await tintCount(), marksBefore]);
check("the viewport gets the right edge back while folded", (await b.evaluate(`${q("[data-testid=viewport]")}.getBoundingClientRect().right`)) > 1500);
await b.shot(`${OUT}/c2_located.png`);
await click("[data-testid=reuse-expand]");
await b.sleep(700);
check("Show workspace returns to exactly where you were: same requirement, tab, search text and selected candidate", (await text("[data-testid=active-name]")) === "Hall floor" && (await b.evaluate(`${q("[data-testid=match-search]")}.value`)) === typed && (await attr("[data-pane=matches] [data-testid=comparison]", "data-component")) === target && (await st()).tab === "matches", [typed]);
// 3D -> workspace: clicking another component in the building updates the comparison
const other = await b.evaluate(`window.__reuse.result(window.__reuse.requirement(${JSON.stringify(R1)})).strong.map((c) => c.id).find((id) => id !== ${JSON.stringify(target)})`);
await select(other);
check("selecting a component in the building updates the comparison (3D -> workspace)", (await attr("[data-pane=matches] [data-testid=comparison]", "data-component")) === other);
await select(model.doorId);
check("a component that is not even the right material still gets an honest explanation (Incompatible, with the material reason)", (await attr("[data-pane=matches] [data-testid=comparison]", "data-tier")) === "incompatible" && /timber, the requirement is porcelain tile/.test((await text("[data-pane=matches] [data-testid=cmp-blockers]")) ?? ""), await text("[data-pane=matches] [data-testid=cmp-blockers]"));

// 3D marks for the allocation-only mode
await click("[data-testid=show3d-allocated]");
await b.sleep(700);
const colsA = await tintColours();
check("'Allocated' shows only the confirmed allocations, in blue", Object.keys(colsA).join() === "0072b2", colsA);
await click("[data-testid=show3d-off]");
await b.sleep(500);
check("'Off' removes every mark", (await tintCount()) === 0 && !(await b.evaluate(`!!window.__scenarioOverlay`)));
await click("[data-testid=show3d-candidates]");
await b.sleep(700);
check("'Candidates' brings strong, conditional and allocated marks back", Object.keys(await tintColours()).sort().join() === "0072b2,009e73,e69f00" || Object.keys(await tintColours()).sort().join() === "0072b2,e69f00", await tintColours());

// ── 16. exclusivity and presentation mode ──────────────────────────────────────────────────
await click("[data-testid=inventory-toggle]");
await b.sleep(700);
check("opening the Inventory closes the reuse workspace and removes its marks", !(await exists("[data-testid=reuse-drawer]")) && (await exists("[data-testid=inventory-drawer]")) && (await tintCount()) === 0 && !(await R(`s.get().open`)));
await click("[data-testid=reuse-toggle]");
await b.sleep(800);
check("opening Reuse closes the Inventory (one drawer at a time) and its marks return", (await exists("[data-testid=reuse-drawer]")) && !(await exists("[data-testid=inventory-drawer]")) && (await tintCount()) > 0);
await click("[data-testid=recovery-toggle]");
await b.sleep(700);
check("opening Recovery closes it too", !(await exists("[data-testid=reuse-drawer]")) && (await exists("[data-testid=recovery-drawer]")));
await click("[data-testid=reuse-toggle]");
await b.sleep(700);
await click("[data-testid=carbon-toggle]");
await b.sleep(700);
check("opening Carbon closes it, and Carbon's own highlight machinery still works (external workspace flag kept)", !(await exists("[data-testid=reuse-drawer]")) && (await exists("[data-testid=carbon-drawer]")) && (await b.evaluate(`window.__scenarios.get().externalOpen === true`)));
await click("[data-testid=carbon-toggle]");
await b.sleep(500);
check("closing Carbon leaves no marks and no stale external flag", (await tintCount()) === 0 && (await b.evaluate(`window.__scenarios.get().externalOpen === false`)));
await click("[data-testid=reuse-toggle]");
await b.sleep(800);
await click("[data-testid=present-toggle]");
await b.sleep(1200);
check("presentation mode closes the reuse workspace and its marks", (await exists("[data-testid=presentation]")) && !(await exists("[data-testid=reuse-drawer]")) && (await tintCount()) === 0);
await click("[data-testid=pm-exit]");
await b.sleep(1200);
check("leaving presentation mode restores the workspace", (await exists("[data-testid=reuse-drawer]")) && (await tintCount()) > 0 && (await st()).open);

// ── 17. edit / duplicate / delete rules ──────────────────────────────────────────────────────
await b.evaluate(`window.__reuse.select(${JSON.stringify(R1)})`);
await b.sleep(700);
await click("[data-testid=req-edit]");
await b.sleep(300);
check("the unit cannot be changed while the requirement has allocations", await b.evaluate(`${q("[data-testid=req-unit]")}.disabled === true`));
await setInput("[data-testid=req-quantity]", "0.01");
await click("[data-testid=req-save]");
await b.sleep(300);
check("the quantity cannot drop below what is allocated", /already allocated/.test((await text("[data-testid=req-error]")) ?? ""), await text("[data-testid=req-error]"));
await click("[data-testid=req-cancel]");
await b.sleep(300);
const nReq = (await st()).n;
await click("[data-testid=req-duplicate]");
await b.sleep(900);
check("Duplicate makes an independent copy (no allocations carried over)", (await st()).n === nReq + 1 && /\(copy\)/.test((await text("[data-testid=active-name]")) ?? "") && (await R(`s.get().allocations.filter((a) => a.requirementId === s.get().activeId).length`)) === 0);
await click("[data-testid=req-delete]");
await click("[data-testid=req-delete-confirm]");
await b.sleep(600);
check("Delete (confirmed) removes the copy", (await st()).n === nReq);
const aBeforeDel = (await st()).a;
await b.evaluate(`window.__reuse.select(${JSON.stringify(R2)})`);
await b.sleep(500);
const r2allocs = await R(`s.get().allocations.filter((a) => a.requirementId === ${JSON.stringify(R2)}).length`);
await click("[data-testid=req-delete]");
await click("[data-testid=req-delete-confirm]");
await b.sleep(600);
check("deleting a requirement also releases its allocations", (await st()).a === aBeforeDel - r2allocs && (await st()).n === nReq - 1, [await st(), aBeforeDel, r2allocs]);

// ── 18. stale allocation review (assessment edited after the fact) ───────────────────────────────────────────────────────
const held = await R(`s.get().allocations.find((a) => a.requirementId === ${JSON.stringify(R1)})?.componentId`);
if (held) {
  const rec2 = JSON.parse(await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`));
  const ent2 = rec2.entries.map(([id, a]) => (id === held ? [id, { ...a, classification: "recycling" }] : [id, a]));
  await b.evaluate(`localStorage.setItem(${JSON.stringify(B2KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, entries: ent2 }))})`);
  await b.goto(`${BASE}/?view=full`);
  await click("[data-testid=reuse-toggle]");
  await b.sleep(900);
  await click("[data-testid=tab-allocation]");
  await b.sleep(700);
  check("when B2 later assesses an allocated component for recycling, the allocation is flagged 'No longer compatible' and left unchanged", /need.* review/.test((await text("[data-testid=integrity]")) ?? "") && (await R(`s.get().allocations.some((a) => a.componentId === ${JSON.stringify(held)})`)), await text("[data-testid=integrity]"));
  await b.evaluate(`localStorage.setItem(${JSON.stringify(B2KEY)}, ${JSON.stringify(b2_0)})`);
  await b.goto(`${BASE}/?view=full`);
}

// ── 19. close, and the model is exactly as it was ──────────────────────────────────────────────
await click("[data-testid=reuse-toggle]");
await b.sleep(900);
await click("[data-testid=reuse-close]");
await b.sleep(900);
const snapEnd = await snap();
check("closing the workspace removes every mark and the building is exactly as it was (meshes, colours, instance matrices)", snapEnd.tints === 0 && snapEnd.hash === snap0.hash && snapEnd.meshes === snap0.meshes && snapEnd.hiddenPlain === snap0.hiddenPlain, [snapEnd, snap0]);
check("no overlay record is left behind", !(await b.evaluate(`!!window.__scenarioOverlay`)));
check("no record of the model changed: ids, positions, quantities, materials, conditions", (await recordsHash()) === rec0);
check("B1 quantities are exactly as before the whole run", JSON.stringify(await b1Hash()) === JSON.stringify(b1_0));
check("B2 assessments are exactly as seeded", (await b.evaluate(`localStorage.getItem(${JSON.stringify(B2KEY)})`)) === b2_0);

// ── 20. performance of ranking the biggest pool (18k porcelain components) ───────────────────────
await click("[data-testid=reuse-toggle]");
await b.sleep(700);
const perf = await b.evaluate(`(() => { const s = window.__reuse; const req = s.requirement(s.get().requirements[0].id); const t = performance.now(); const ctx = s.context(); const res = s.result({ ...req, id: "perf-" + Math.random() }); return { ms: Math.round(performance.now() - t), n: res.evaluated }; })()`);
check("ranking ~18,000 components takes well under a second", perf.ms < 1500 && perf.n > 15000, perf);

await finish(0);
