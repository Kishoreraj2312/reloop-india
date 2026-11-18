// C1 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks select a component in the 3D view and open the
// passport; the rest drives form controls. Checked against the REAL building: the passport follows the app's selection, shows
// identity / material / B1 quantity with hand-checked numbers and honest status labels (model defaults "assumed", missing "not
// available"), B2 / B3 / B4 / B5 data appear read-only, user entries validate and persist (and survive corrupt / orphaned saved
// data), JSON and CSV downloads carry every field, the panel folds without touching selection or camera, invalid ids are safe,
// and B1 records, B2 / B3 / B4 / B5 stores and the rendered model are untouched.
// Screenshots go to docs/screenshots/c1. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/c1";
const KEY = "rematter.passports.v1";
const B5KEY = "rematter.carbon.v1";
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
const store = (expr) => b.evaluate(`(() => { const s = window.__passports; return ${expr}; })()`);
const cc = (expr) => b.evaluate(`(() => { const s = window.__carbon; return ${expr}; })()`);
const near = (a, c, tol = 1e-6) => a !== null && Math.abs(a - c) <= tol * Math.max(1, Math.abs(c));
const panel = "[data-testid=passport-panel]";
const row = (key) => `${panel} tr[data-field="${key}"]`;
const rowText = (key) => text(row(key));
const rowStatus = (key) => b.evaluate(`${q(row(key))}?.dataset.status ?? null`);
const rowCount = () => b.evaluate(`document.querySelectorAll(${JSON.stringify(panel + " tr[data-field]")}).length`);
const panelId = () => b.evaluate(`${q(panel)}?.dataset.id ?? null`);
const setTextarea = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; e.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); e.blur(); })()`);
const setTextInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; e.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); e.blur(); })()`);
const setDate = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const camera = () => b.evaluate(`JSON.stringify({ p: window.__reloop.camera.position.toArray(), q: window.__reloop.camera.quaternion.toArray() })`);
const COL = "STR-COL-F01-A1";
const BKEYS = { b2: "rematter.recovery.assessments.v1", b3: "rematter.removal.plans.v1", b4: "rematter.scenarios.v1", b5: "rematter.carbon.v1" };

// ── 0. start clean ────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`${JSON.stringify([KEY, ...Object.values(BKEYS)])}.forEach((k) => localStorage.removeItem(k))`);
await b.goto(`${BASE}/?view=full`);
const snap0 = await snap();
r.statsBefore = await b.evaluate(`window.__reloop.stats(false)`);
const recordsHash = () => raw(`(() => { let h = 0; for (const r of recs) { const s = r.id + r.floor + r.originalPosition.join() + r.quantity + r.unit + r.materialId + r.condition; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return h; })()`);
const rec0 = await recordsHash();
check("no passport without a selection", !(await exists(panel)));

// ── 1. a real click in the 3D view opens the passport of what was hit ───────────────────────────────
await b.evaluate(`window.__reloop.setView([60, 40, 60], [0, 8, 0])`);
await b.sleep(600);
const mid = await b.evaluate(`(() => { const c = window.__reloop.gl.domElement.getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2 }; })()`);
await b.click(mid.x, mid.y + 60); // a little below the centre of the viewport, over the building
await b.sleep(900);
const clicked = await inspectorId();
check("a real canvas click selects a component and opens ITS passport (same id as the inspector)", !!clicked && clicked.length > 3 && (await panelId()) === clicked, [clicked, await panelId()]);
check("the model stays in view: the passport is in the sidebar, clear of the viewport", await b.evaluate(`(() => { const r = ${q(panel)}.getBoundingClientRect(); const v = document.querySelector("[data-testid=viewport]").getBoundingClientRect(); return r.right <= v.left + 1 && r.left >= 0 && r.width > 0; })()`));
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(400);
check("clearing the selection closes the passport", !(await exists(panel)));

// ── 2. contents of a known component, hand-checked ───────────────────────────────────────────────
await select(COL);
const rec = await raw(`byId.get(${JSON.stringify(COL)})`);
check("passport follows the selection and is linked to the stable id", (await panelId()) === COL && (await text("[data-testid=passport-name]")) === rec.name && /STR-COL-F01-A1/.test((await text(panel)) ?? ""));
check("nine sections (the last is the C3 recovery tracking of the component)", (await all(`${panel} [data-testid=passport-section]`, "e.dataset.section")).join() === "identity,material,quantity,condition,recovery,removal,sustainability,provenance,tracking");
check("identity: floor F01, system, type from the record", /F01/.test(await rowText("floor")) && /structure/.test(await rowText("system")) && /column/.test(await rowText("type")));
check("material: name and category", /reinforced concrete/.test(await rowText("materialName")) && /Concrete/.test(await rowText("materialCategory")));
check("dimensions come from the record (length, width, height in m)", (await rowText("dim.height")).includes("3.6") && /\bm\b/.test(await rowText("dim.height")) && (await rowStatus("dim.height")) === "recorded");
check("B1 quantity 0.729 m³ (0.45 x 0.45 x 3.6), calculated, source B1", (await rowText("primary")).includes("0.729") && (await rowText("primary")).includes("m³") && (await rowStatus("primary")) === "calculated" && /B1/.test(await rowText("primary")), await rowText("primary"));
check("B1 mass 1,749.6 kg (0.729 x 2,400), estimated", (await rowText("mass")).includes("1,749.6") && (await rowStatus("mass")) === "estimated", await rowText("mass"));
check("the model's condition is labelled as an assumed default, not an inspection", (await rowStatus("modelCondition")) === "assumed" && /not an inspection/.test((await b.evaluate(`${q(row("modelCondition"))}.title`)) ?? ""));
check("nothing observed yet: observed condition and inspection are missing, not invented", (await rowStatus("observedCondition")) === "missing" && (await rowStatus("inspectionStatus")) === "missing");
check("B2 not assessed, B3 no plan, B5 not assessed: all missing with a reason", (await rowStatus("classification")) === "missing" && (await rowStatus("plan")) === "missing" && (await rowStatus("carbon")) === "missing" && /no emission factor/.test(await rowText("carbon")));
const counts = await all(`${panel} [data-testid=passport-quality] [data-count]`, "Number(e.textContent)");
check("data-quality counts add up to the number of fields", counts.reduce((a, c) => a + c, 0) === (await rowCount()), [counts, await rowCount()]);
await b.shot(`${OUT}/c1_passport.png`);

// a component B1 cannot give a mass for
const pipe = await raw(`recs.find((x) => x.system === "plumbing" && x.geometry.kind !== "group").id`);
await select(pipe);
check("no density: the mass is 'not available' with B1's reason and status missing", (await rowStatus("mass")) === "missing" && /not available/.test(await rowText("mass")));
await select(COL);

// ── 3. B2 through the real UI shows in the passport, read-only ─────────────────────────────────────
await click("[data-testid=open-recovery]");
await b.sleep(900);
await setSelect("[data-testid=rec-classification]", "recycling");
await b.sleep(300);
await setInput("[data-testid=rec-pct]", "60");
await enter("[data-testid=rec-pct]");
await b.sleep(400);
const b2Text = await b.evaluate(`localStorage.getItem(${JSON.stringify(BKEYS.b2)})`);
await click("[data-testid=recovery-toggle]");
await b.sleep(600);
check("B2 classification appears as the user's entry", /recycling/i.test(await rowText("classification")) && (await rowStatus("classification")) === "user");
check("B2 recovery 60 % is an estimate; recoverable 0.4374 m³ with B2's formula", (await rowStatus("recoveryPct")) === "estimated" && (await rowText("recoveryPct")).includes("60") && (await rowText("recoverable")).includes("0.4374") && /0\.729 m³ × 60% = 0\.437 m³/.test((await b.evaluate(`${q(row("recoverable"))}.title`)) ?? ""), await rowText("recoverable"));
check("B2 values have no input controls in the passport (read-only)", !(await exists(`${row("classification")} input, ${row("classification")} select, ${row("recoveryPct")} input`)));
check("a link leads to where B2 is edited", await exists("[data-testid=passport-open-b2]"));

// ── 4. editing the user's own entries ─────────────────────────────────────────────────────────────────
await setSelect("[data-testid=passport-inspectionStatus]", "inspected");
await setSelect("[data-testid=passport-observedCondition]", "fair");
await setDate("[data-testid=passport-inspectedOn]", "2026-03-14");
await setTextInput("[data-testid=passport-inspectedBy]", "A. Tester");
await setTextarea("[data-testid=passport-conditionNote]", "Hairline crack, 2 mm, north face");
await setTextarea("[data-testid=passport-provenanceNote]", "Cast 2009; supplier unknown");
await b.sleep(500);
const meta1 = await store(`s.get().meta.get(${JSON.stringify(COL)})`);
check("entries stored under the stable component id", meta1 && meta1.inspectionStatus === "inspected" && meta1.observedCondition === "fair" && meta1.inspectedOn === "2026-03-14" && meta1.inspectedBy === "A. Tester" && meta1.conditionNote === "Hairline crack, 2 mm, north face" && meta1.provenanceNote === "Cast 2009; supplier unknown" && /^\d{4}-\d{2}-\d{2}T/.test(meta1.updatedAt), meta1);
check("status chips of edited rows read 'user entry'", (await rowStatus("conditionNote")) === "user" && (await rowStatus("provenanceNote")) === "user" && (await rowStatus("observedCondition")) === "user");
check("'last edited' is recorded", (await rowStatus("updatedAt")) === "user");
const saved = JSON.parse(await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`));
check("saved to localStorage: only the user's entries", saved.version === 1 && saved.entries.length === 1 && saved.entries[0][0] === COL && !/0\.729|1749|recycling/.test(JSON.stringify(saved)), saved);
check("an invalid date is rejected and nothing changes", (await store(`s.edit(${JSON.stringify(COL)}, { inspectedOn: "2026-02-30" })`)) !== null && (await store(`s.get().meta.get(${JSON.stringify(COL)}).inspectedOn`)) === "2026-03-14");
check("an over-long note is rejected and nothing changes", (await store(`s.edit(${JSON.stringify(COL)}, { conditionNote: "x".repeat(2001) })`)) !== null && (await store(`s.get().meta.get(${JSON.stringify(COL)}).conditionNote.length`)) === 32);
check("an unknown status is rejected", (await store(`s.edit(${JSON.stringify(COL)}, { inspectionStatus: "done" })`)) !== null);
check("editing the passport changed no B1 record and no B2 assessment", (await recordsHash()) === rec0 && (await b.evaluate(`localStorage.getItem(${JSON.stringify(BKEYS.b2)})`)) === b2Text);

// ── 5. sustainability and removal data from B3 / B4 / B5, read-only ──────────────────────────────────
await b.evaluate(`window.__removal.createPlan("Context plan"); window.__removal.addEntries([${JSON.stringify(COL)}])`);
await sc(`s.createStarterSet()`);
await cc(`s.loadIllustrative()`);
await b.sleep(1200);
check("B3: the plan, the step and a planning state that does not claim removal", /Context plan/.test(await rowText("plan")) && /1 of 1/.test(await rowText("step")) && (await rowStatus("state")) !== "missing" && /does not show that anything has been removed/.test((await b.evaluate(`${q(row("state"))}.title`)) ?? ""), await rowText("step"));
const scen = await all(`${panel} tr[data-field^="scenario."]`, "e.dataset.field");
check("B4: the outcome in each compared scenario", scen.length === 3, scen);
check("B4: selective scenario shows the column's 60 % recycling from B2 (0.4374 m³), the rest disposal", /recycling 0\.4374/.test(await rowText("scenario.Selective deconstruction")), await rowText("scenario.Selective deconstruction"));
check("B5: illustrative factor is labelled as such, with a caution; value = 0.729 m³ x 2,400 kg/m³ x 0.13", /ILLUSTRATIVE/.test(await rowText("carbon")) && /ILLUSTRATIVE/.test((await text(`${panel} [data-testid=passport-body]`)) ?? "") && near(Number((await rowText("carbon")).match(/([\d.,]+)\s*kgCO₂e/)[1].replace(/,/g, "")), 0.729 * 2400 * 0.13, 5e-3), await rowText("carbon"));
await cc(`s.clearAllFactors()`);

// ── 6. exports ───────────────────────────────────────────────────────────────────────────────────
await b.evaluate(`window.__dl = []; const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (blob) => { window.__lastBlob = blob; return orig(blob); }; HTMLAnchorElement.prototype.click = function () { window.__dl.push({ name: this.download, blob: window.__lastBlob }); };`);
await click("[data-testid=passport-json]");
await b.sleep(400);
const dl1 = await b.evaluate(`(async () => ({ name: window.__dl[0]?.name, text: await window.__dl[0]?.blob.text(), type: window.__dl[0]?.blob.type }))()`);
const j = JSON.parse(dl1.text);
const nFields = await rowCount();
const jf = j.sections.flatMap((s) => s.fields);
check("JSON export: file name, type and schema", dl1.name === `passport_${COL}.json` && /json/.test(dl1.type) && j.schema === "rematter.passport/1" && j.component.id === COL && j.component.name === rec.name, dl1.name);
check("JSON export carries every field shown in the panel, with status and source", jf.length === nFields && jf.every((f) => "status" in f && "source" in f && "value" in f), [jf.length, nFields]);
check("JSON export: values, user entries and nulls for missing", jf.find((f) => f.key === "primary").value === 0.729 && jf.find((f) => f.key === "mass").value === 1749.6 && jf.find((f) => f.key === "conditionNote").value === "Hairline crack, 2 mm, north face" && jf.find((f) => f.key === "conditionNote").status === "user" && jf.find((f) => f.key === "destination").value === null && jf.find((f) => f.key === "destination").status === "missing");
await click("[data-testid=passport-csv]");
await b.sleep(400);
const dl2 = await b.evaluate(`(async () => ({ name: window.__dl[1]?.name, text: await window.__dl[1]?.blob.text(), type: window.__dl[1]?.blob.type }))()`);
const lines = dl2.text.split("\r\n");
const bom = await b.evaluate(`(async () => [...new Uint8Array(await window.__dl[1].blob.arrayBuffer()).slice(0, 3)])()`);
check("CSV export: name, type, UTF-8 byte-order mark, fixed header", dl2.name === `passport_${COL}.csv` && /csv/.test(dl2.type) && bom.join() === "239,187,191" && lines[0] === "section,field,value,unit,status,source,note", [bom, lines[0]]);
check("CSV export: one row per field plus the header and the component row", lines.filter(Boolean).length >= nFields + 2 && lines.some((l) => l.startsWith('condition,Condition note,"Hairline crack, 2 mm, north face"')) && lines.some((l) => l.startsWith("quantity,Quantity (B1),0.729,m³,calculated,B1")), lines.slice(0, 3));
await b.evaluate(`delete HTMLAnchorElement.prototype.click`);

// ── 7. fold the panel: selection, camera and model are untouched ───────────────────────────────────
const cam0 = await camera();
const stats0 = await b.evaluate(`window.__reloop.stats(false)`);
await click("[data-testid=passport-toggle]");
await b.sleep(500);
check("folded: only the header remains, selection and camera unchanged", !(await exists("[data-testid=passport-body]")) && (await exists(panel)) && (await inspectorId()) === COL && (await camera()) === cam0);
await b.shot(`${OUT}/c1_folded.png`);
await click("[data-testid=passport-toggle]");
await b.sleep(400);
const stats1 = await b.evaluate(`window.__reloop.stats(false)`);
check("expanded again with the same content; draw calls unchanged by the panel", (await exists("[data-testid=passport-body]")) && stats1.drawCalls === stats0.drawCalls && (await rowStatus("conditionNote")) === "user");

// ── 8. assembly, parent link, invalid id ─────────────────────────────────────────────────────────────────
await click(`${row("parent")} button`);
await b.sleep(600);
check("the parent link selects the parent and opens its passport", (await panelId()) === "STR-COL-G-A1" && (await inspectorId()) === "STR-COL-G-A1");
const asm = await raw(`recs.find((x) => x.componentType === "wall_assembly").id`);
await select(asm);
check("an assembly passport rolls up its parts (once) and has no quantity of its own", (await panelId()) === asm && Number((await rowText("parts")).match(/\d+/)[0]) > 1 && !(await exists(row("primary"))) && /0 of \d+/.test(await rowText("assessedParts")), await rowText("parts"));
await b.evaluate(`window.__reloop.select("NOT-A-COMPONENT-1")`);
await b.sleep(500);
check("an invalid id is reported safely: no crash, nothing changed", (await exists("[data-testid=passport-missing]")) && /not a component of the model/.test((await text("[data-testid=passport-missing]")) ?? ""));
await b.evaluate(`window.__reloop.select(null)`);
await b.sleep(300);

// ── 9. view state with the passport open ───────────────────────────────────────────────────────────────
await select(COL);
await setSelect("[data-testid=isolate]", "L2");
await b.sleep(700);
check("floor isolation keeps the selection and the passport", (await panelId()) === COL && (await exists("[data-testid=passport-body]")));
await setSelect("[data-testid=isolate]", "");
await b.sleep(400);
await click("[data-testid=present-toggle]");
await b.sleep(1200);
check("presentation mode shows the clean canvas: no passport, no stack", !(await exists(panel)));
await b.goto(`${BASE}/?view=full&select=${COL}`);
await b.sleep(900);

// ── 10. persistence, orphaned and corrupt saved data ───────────────────────────────────────────────────
const before = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
await select(COL);
const ta = (k) => b.evaluate(`document.querySelector("[data-testid=passport-${k}]")?.value ?? null`);
check("entries survive a reload", (await ta("conditionNote")).includes("Hairline crack") && (await ta("provenanceNote")).includes("Cast 2009") && (await b.evaluate(`document.querySelector("[data-testid=passport-inspectionStatus]").value`)) === "inspected" && (await b.evaluate(`document.querySelector("[data-testid=passport-inspectedOn]").value`)) === "2026-03-14");
check("loading did not rewrite the saved text", (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`)) === before);
await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, JSON.stringify({ version: 1, entries: [["GONE-1", { conditionNote: "from an older model" }], [${JSON.stringify(COL)}, { conditionNote: "kept", inspectionStatus: "bogus", inspectedOn: "2026-13-40" }], ["BAD", 5]] }))`);
await b.goto(`${BASE}/?view=full`);
await select(COL);
check("invalid saved fields are dropped, valid ones kept", (await ta("conditionNote")) === "kept" && (await rowStatus("inspectionStatus")) === "missing" && (await rowStatus("inspectedOn")) === "missing");
check("an entry for a component not in the model is reported, never silently lost", /1 saved entry refers/.test((await text("[data-testid=passport-orphans]")) ?? "") && (await store(`s.get().meta.has("GONE-1")`)));
await click("[data-testid=passport-orphans-remove]");
await b.sleep(300);
check("it can be removed on request; the real component's entry stays", !(await exists("[data-testid=passport-orphans]")) && (await store(`s.get().meta.has("GONE-1")`)) === false && (await store(`s.get().meta.has(${JSON.stringify(COL)})`)));
for (const [label, value] of [["not JSON", "{nope"], ["outdated version", JSON.stringify({ version: 0, entries: [[COL, { conditionNote: "x" }]] })]]) {
  await b.evaluate(`localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(value)})`);
  await b.goto(`${BASE}/?view=full`);
  await select(COL);
  check(`bad saved data (${label}) starts empty without errors`, (await store(`s.get().meta.size`)) === 0 && (await rowStatus("conditionNote")) === "missing" && (await ta("conditionNote")) === "");
}

// ── 11. nothing else changed ────────────────────────────────────────────────────────────────────────────
await b.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
await b.goto(`${BASE}/?view=full`);
await b.sleep(500);
check("B1: records and quantities unchanged", (await recordsHash()) === rec0);
check("B2: assessments exactly as the user left them", (await b.evaluate(`localStorage.getItem(${JSON.stringify(BKEYS.b2)})`)) === b2Text);
check("B4: scenarios hold only their own rules (no passport data)", !/passport|conditionNote|inspect/i.test((await b.evaluate(`localStorage.getItem(${JSON.stringify(BKEYS.b4)})`)) ?? ""));
check("B5: no factor was written by the passport", (await b.evaluate(`localStorage.getItem(${JSON.stringify(BKEYS.b5)})`)) === null || !/passport/i.test(await b.evaluate(`localStorage.getItem(${JSON.stringify(BKEYS.b5)})`)));
check("the model is exactly as at the start (materials, visibility, instance matrices, no tints)", (await snap()).hash === snap0.hash && (await snap()).tints === 0);
r.statsEnd = await b.evaluate(`window.__reloop.stats(false)`);
check("draw calls and triangles as at the start", r.statsEnd.drawCalls === r.statsBefore.drawCalls && r.statsEnd.triangles === r.statsBefore.triangles, [r.statsBefore.drawCalls, r.statsEnd.drawCalls]);

await finish(0);
