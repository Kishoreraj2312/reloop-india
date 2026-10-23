// B2 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the Recovery drawer and
// pick rows; the rest drives the form controls. Checks: hand-calculated recoverable quantity (0.729 m3 x 60 % =
// 0.4374 m3), invalid and missing input, the recovery inventory updating, 3D colouring (and restore), filters + floor
// isolation, row -> 3D selection, assembly and bulk edits, persistence across a reload, reset, unchanged draw calls
// and a clean console. Screenshots go to docs/screenshots/b2. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/b2";
const KEY = "rematter.recovery.assessments.v1";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const r = {};
process.on("uncaughtException", async (e) => { r.error = String(e); console.log(JSON.stringify(r, null, 1)); await b.close(); process.exit(1); });
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "center" })`); await b.sleep(120); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value, enter = true) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); ${enter ? `e.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));` : ""} return e.value; })()`);
const scrollBodyTo = (sel) => b.evaluate(`(() => { const body = ${q("[data-testid=recovery-body]")}; body.scrollTop = ${q(sel)}.offsetTop - 8; })()`);
const select = async (id) => { await b.evaluate(`window.__reloop.select(${JSON.stringify(id)})`); await b.sleep(500); };
const count = () => b.evaluate(`Number(${q("[data-testid=recovery-count]")}.dataset.count)`);
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const meshColour = (id) => b.evaluate(`(() => { const m = window.__reloop.scene.getObjectByName(${JSON.stringify(id)}); return m?.material?.color?.getHexString() ?? null; })()`);
const groupCell = (key, unit, field) => b.evaluate(`(() => { const tr = ${q(`[data-testid=recovery-groups] tr[data-group="${key}"][data-unit="${unit}"]`)}; return tr?.querySelector('[data-field="${field}"]')?.innerText ?? null; })()`);
const totalCell = (unit, field) => b.evaluate(`(() => { const tr = ${q(`[data-testid=recovery-totals] tr[data-unit="${unit}"]`)}; return tr?.querySelector('[data-field="${field}"]')?.innerText ?? null; })()`);
const counts = () => text("[data-testid=recovery-counts]");

await b.goto(`${BASE}/?view=full`);
await b.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
await b.goto(`${BASE}/?view=full`);
r.statsBefore = await b.evaluate(`window.__reloop.stats(false)`);

// 1. open with a real click
await click("[data-testid=recovery-toggle]");
await b.sleep(1500);
r.drawerOpen = await b.evaluate(`!!${q("[data-testid=recovery-drawer]")}`);
r.drawerWidth = await b.evaluate(`${q("[data-testid=recovery-drawer]")}.getBoundingClientRect().width`);
r.statsOpen = await b.evaluate(`window.__reloop.stats(false)`);
r.drawCallsUnchanged = r.statsBefore.drawCalls === r.statsOpen.drawCalls && r.statsBefore.triangles === r.statsOpen.triangles;
r.initialCounts = await counts();
r.initialAllUnassessed = /^0 of 84,365 components assessed/.test(r.initialCounts);
await b.shot(`${OUT}/b2_drawer_empty.png`);

// 2. a structural column: hand calc 0.729 m3 x 60 % = 0.4374 m3
const COL = "STR-COL-F01-A1";
await select(COL);
r.inspectorBlock = await text("[data-testid=recovery-info]");
r.available = await text("[data-testid=rec-available]");
r.notAssessedFormula = await text("[data-testid=rec-formula]");
await setSelect("[data-testid=rec-classification]", "direct_reuse");
await b.sleep(300);
r.pctEnabled = await b.evaluate(`!${q("[data-testid=rec-pct]")}.disabled`);
r.formulaWithoutPct = await text("[data-testid=rec-formula]");
await setInput("[data-testid=rec-pct]", "120");
await b.sleep(200);
r.invalidPctError = await text("[data-testid=rec-pct-error]");
await setInput("[data-testid=rec-pct]", "-3");
r.negativePctError = await text("[data-testid=rec-pct-error]");
await setInput("[data-testid=rec-pct]", "60");
await b.sleep(300);
r.formula = await text("[data-testid=rec-formula]");
r.formulaOk = /0\.729 m³ × 60% = 0\.437 m³/.test(r.formula);
r.inspectorAfter = await text("[data-testid=recovery-info]");
r.suggestionShown = /Generic suggestion/.test((await text("[data-testid=rec-suggestion]")) ?? "");
r.assumptionsShown = /not an established rate/.test((await text("[data-testid=rec-assumptions]")) ?? "");
await setSelect("[data-testid=rec-destination]", "reuse_same_building");
await b.shot(`${OUT}/b2_component_assessment.png`);

// 3. the recovery inventory updates (group by component category: concrete, m3)
await setSelect("[data-testid=recovery-groupby]", "componentCategory");
await b.sleep(400);
r.groupConcrete = { available: await groupCell("concrete", "m3", "available"), recoverable: await groupCell("concrete", "m3", "recoverable") };
r.totalM3 = { recoverable: await totalCell("m3", "recoverable") };
r.groupUpdated = r.groupConcrete.recoverable === "0.437" && r.totalM3.recoverable === "0.437";
r.countsAfter = await counts();
r.counted1 = /^1 of 84,365 components assessed · 1 with a recoverable estimate/.test(r.countsAfter);
r.unitsNotMixed = await b.evaluate(`[...document.querySelectorAll("[data-testid=recovery-totals] tr[data-unit]")].map((tr) => tr.dataset.unit)`);

// 4. missing data: a WC pan classified as recycling with no %: Not available, not 0
await select("ARC-BATH-G-A1-BATH1-WC-P");
await setSelect("[data-testid=rec-classification]", "recycling");
await b.sleep(300);
r.missingPctFormula = await text("[data-testid=rec-formula]");
r.missingPctOk = /Not available: recovery % not set/.test(r.missingPctFormula);
await setInput("[data-testid=rec-pct]", "100");
await b.sleep(300);
r.nrFormula = await text("[data-testid=rec-formula]");
await setSelect("[data-testid=rec-classification]", "further_assessment");
await b.sleep(300);
r.furtherPctDisabled = await b.evaluate(`${q("[data-testid=rec-pct]")}.disabled`);
r.furtherFormula = await text("[data-testid=rec-formula]");

// 5. 3D colouring: on, check, filter -> dimmed, off -> restored
r.colourBefore = await meshColour(COL);
await click("[data-testid=recovery-colour]");
await b.sleep(900);
r.colourOn = await meshColour(COL);
r.colourOk = r.colourOn === "009e73" && r.colourBefore !== "009e73";
r.otherUnassessed = await meshColour("STR-COL-F01-B1");
r.unassessedGrey = r.otherUnassessed === "bfc4c9";
await b.evaluate(`window.__reloop.select(${JSON.stringify(COL)})`);
await b.evaluate(`window.__reloop.setView([34, 22, 34], [0, 6, 0])`);
await b.sleep(600);
await b.shot(`${OUT}/b2_colour_model.png`);

// 6. filters: status direct reuse -> 1 row; the others are dimmed in 3D
await scrollBodyTo("[data-testid=recovery-filter-floor]");
await setSelect("[data-testid=recovery-filter-status]", "direct_reuse");
await b.sleep(800);
r.statusFilterCount = await count();
r.dimmedOutside = await meshColour("STR-COL-F01-B1");
r.dimmedOk = r.dimmedOutside === "e4e6e8" && (await meshColour(COL)) === "009e73";
await setSelect("[data-testid=recovery-filter-status]", "");
await setSelect("[data-testid=recovery-filter-floor]", "1");
await setSelect("[data-testid=recovery-filter-material]", "concrete");
await b.sleep(800);
r.floorMaterialCount = await count();
r.floorMaterialRowsMatch = await b.evaluate(`[...document.querySelectorAll("[data-testid=rec-row]")].every((row) => row.innerText.includes("F01"))`);
// row -> 3D selection with a real click
const rowId = await b.evaluate(`${q("[data-testid=rec-row]")}.dataset.id`);
const rp = await b.evaluate(`(() => { const r = ${q("[data-testid=rec-row]")}.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 }; })()`);
await b.click(rp.x, rp.y);
await b.sleep(600);
r.rowClick = { rowId, inspectorId: await inspectorId() };
r.rowClickOk = r.rowClick.rowId === r.rowClick.inspectorId;
await b.shot(`${OUT}/b2_filtered_list.png`);

// 7. existing floor isolation still works with the colour overlay on
await b.send("Runtime.evaluate", { expression: `1` });
await setSelect("[data-testid=isolate]", "L2");
await b.sleep(700);
r.isolate = await b.evaluate(`({ l1: window.__reloop.scene.getObjectByName("Floor_L1").visible, l2: window.__reloop.scene.getObjectByName("Floor_L2").visible, colourKept: window.__reloop.scene.getObjectByName("STR-COL-F01-A1").material.color.getHexString() })`);
r.isolateOk = r.isolate.l1 === false && r.isolate.l2 === true;
await setSelect("[data-testid=isolate]", "");
await b.sleep(400);
await b.evaluate(`window.__reloop.setView([34, 22, 34], [0, 6, 0])`);
await click("[data-testid=recovery-clear-filters]");

// 8. assembly edit: a window's 26 parts are assessed once each
const WIN = "ARC-WIN-G-A1-LIV-S-01";
await select(WIN);
r.assemblyHeader = await text("[data-testid=recovery-assembly]");
await setSelect("[data-testid=assembly-bulk-class]", "refurbish_reuse");
await setInput("[data-testid=assembly-bulk-pct]", "50", false);
await click("[data-testid=assembly-bulk-apply]");
await b.sleep(500);
r.assemblyMsg = await text("[data-testid=assembly-bulk-msg]");
r.assemblyInspector = await text("[data-testid=recovery-info]");
r.assemblyCounts = await counts();
await click("[data-testid=assembly-bulk-apply]"); // applying again changes nothing
await b.sleep(300);
r.assemblyMsgAgain = await text("[data-testid=assembly-bulk-msg]");
r.assemblyOk = /26 of 26 components changed/.test(r.assemblyMsg) && /26 of 26 parts assessed/.test(r.assemblyInspector) && /0 of 26 components changed/.test(r.assemblyMsgAgain);

// 9. bulk on a filtered list (floor tiles on F02) + group row drill-down
await scrollBodyTo("[data-testid=recovery-filter-floor]");
await setSelect("[data-testid=recovery-filter-floor]", "2");
await setSelect("[data-testid=recovery-filter-category]", "tile_floor");
await b.sleep(800);
r.tileCount = await count();
await setSelect("[data-testid=filtered-bulk-class]", "recycling");
await setInput("[data-testid=filtered-bulk-pct]", "40", false);
await click("[data-testid=filtered-bulk-apply]");
await b.sleep(600);
r.tileMsg = await text("[data-testid=filtered-bulk-msg]");
r.tileBulkOk = new RegExp(`^${r.tileCount} of ${r.tileCount} components changed`).test(r.tileMsg);
await click("[data-testid=recovery-clear-filters]");
await setSelect("[data-testid=recovery-groupby]", "status");
await b.sleep(400);
r.m2TotalRecoverable = await totalCell("m2", "recoverable");
r.statusRows = await b.evaluate(`[...document.querySelectorAll("[data-testid=recovery-groups] tr[data-group]")].map((tr) => tr.dataset.group + "/" + tr.dataset.unit)`);
await b.evaluate(`${q("[data-testid=recovery-groups] tr[data-group=recycling][data-unit=m2]")}.click()`);
await b.sleep(600);
r.groupChip = await text("[data-testid=recovery-group-chip]");
r.groupDrillCount = await count();
r.groupDrillOk = r.groupDrillCount === r.tileCount;
await click("[data-testid=recovery-clear-filters]");

// 10. persistence across a reload
r.stored = await b.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)}) ?? "null")?.entries?.length ?? 0`);
r.assessedBeforeReload = await counts();
await b.goto(`${BASE}/?view=full`);
await click("[data-testid=recovery-toggle]");
await b.sleep(1200);
r.assessedAfterReload = await counts();
await select(COL);
r.reloadFormula = await text("[data-testid=rec-formula]");
r.reloadClass = await b.evaluate(`${q("[data-testid=rec-classification]")}.value`);
r.persistOk = r.assessedAfterReload === r.assessedBeforeReload && /0\.437 m³/.test(r.reloadFormula) && r.reloadClass === "direct_reuse";
await b.shot(`${OUT}/b2_after_reload.png`);

// 11. mass basis: kg only
await setSelect("[data-testid=recovery-basis]", "mass");
await b.sleep(500);
r.massUnits = await b.evaluate(`[...document.querySelectorAll("[data-testid=recovery-totals] tr[data-unit]")].map((tr) => tr.dataset.unit)`);
r.massRecoverable = await totalCell("kg", "recoverable");
r.massFormula = await text("[data-testid=rec-formula]");
r.massOk = r.massUnits.length === 1 && r.massUnits[0] === "kg" && /1,749\.6|1,750/.test((await text("[data-testid=rec-available]")) ?? "") && /1,050 kg/.test(r.massFormula);
await setSelect("[data-testid=recovery-basis]", "quantity");

// 10b. a worked example: pathways by category, coloured in the model (screenshot), then removed again
const bulk = async (patchSel, cat, system, cls, pct) => {
  await scrollBodyTo("[data-testid=recovery-filter-floor]");
  await setSelect("[data-testid=recovery-filter-system]", system);
  await setSelect("[data-testid=recovery-filter-category]", cat);
  await b.sleep(500);
  await setSelect("[data-testid=filtered-bulk-class]", cls);
  await setInput("[data-testid=filtered-bulk-pct]", pct, false);
  await click("[data-testid=filtered-bulk-apply]");
  await b.sleep(400);
};
await bulk("", "masonry", "architecture", "recycling", "70");
await bulk("", "stone", "architecture", "refurbish_reuse", "60");
await bulk("", "timber", "architecture", "direct_reuse", "80");
await bulk("", "metal", "architecture", "refurbish_reuse", "50");
await bulk("", "concrete", "structure", "further_assessment", "");
await click("[data-testid=recovery-clear-filters]");
await click("[data-testid=recovery-colour]");
await b.sleep(900);
r.demoCounts = await counts();
await b.evaluate(`window.__reloop.select(null)`);
await b.evaluate(`window.__reloop.setView([46, 26, 46], [0, 6, 0])`);
await b.sleep(800);
await b.shot(`${OUT}/b2_demo_pathways.png`);
await scrollBodyTo("[data-testid=recovery-groups]");
await setSelect("[data-testid=recovery-groupby]", "materialCategory");
await b.sleep(500);
await b.evaluate(`${q("[data-testid=recovery-body]")}.scrollTop = ${q("[data-testid=recovery-totals]")}.offsetTop - 40`);
await b.sleep(300);
await b.shot(`${OUT}/b2_recovery_inventory.png`);
r.materialRows = await b.evaluate(`[...document.querySelectorAll("[data-testid=recovery-groups] tr[data-group]")].map((tr) => tr.innerText.replace(/\\s+/g, " "))`);
await click("[data-testid=recovery-colour]");

// 12. reset, close, restore
await click("[data-testid=recovery-reset]");
await click("[data-testid=recovery-reset-confirm]");
await b.sleep(500);
r.afterReset = await counts();
r.storageCleared = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY)}) === null`);
r.resetOk = /^0 of 84,365/.test(r.afterReset) && r.storageCleared;
r.colourAfterReload = await meshColour(COL); // colour mode is a view setting: off after a reload
await click("[data-testid=recovery-colour]");
await b.sleep(700);
r.colourOnAfterReset = await meshColour(COL); // everything is unassessed again: neutral
await click("[data-testid=recovery-colour]");
await b.sleep(700);
r.colourRestored = r.colourAfterReload === r.colourBefore && r.colourOnAfterReset === "bfc4c9" && (await meshColour(COL)) === r.colourBefore;
await click("[data-testid=recovery-close]");
await b.sleep(500);
r.closed = await b.evaluate(`!${q("[data-testid=recovery-drawer]")}`);
r.statsClosed = await b.evaluate(`window.__reloop.stats(false)`);

r.console = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
r.checks = {
  drawerOpen: r.drawerOpen, drawerWidth: r.drawerWidth >= 540 && r.drawerWidth <= 580, drawCallsUnchanged: r.drawCallsUnchanged, initialAllUnassessed: r.initialAllUnassessed,
  notAssessedUnavailable: /Not available/.test(r.notAssessedFormula), pctEnabled: r.pctEnabled, missingPct: /Not available: recovery % not set/.test(r.formulaWithoutPct),
  invalidPct: /exceed 100/.test(r.invalidPctError), negativePct: /negative/.test(r.negativePctError), handCalc: r.formulaOk, suggestionShown: r.suggestionShown, assumptionsShown: r.assumptionsShown,
  groupUpdated: r.groupUpdated, counted1: r.counted1, unitsNotMixed: r.unitsNotMixed.join() === "m3,m2,m,nr", missingPctWc: r.missingPctOk, nrFormula: /1 nr × 100% = 1 nr/.test(r.nrFormula),
  furtherPctDisabled: r.furtherPctDisabled, furtherUnavailable: /Not available/.test(r.furtherFormula), colourOk: r.colourOk, unassessedGrey: r.unassessedGrey, statusFilter: r.statusFilterCount === 1, dimmedOk: r.dimmedOk,
  floorMaterial: r.floorMaterialCount > 0, floorMaterialRows: r.floorMaterialRowsMatch, rowClick: r.rowClickOk, isolate: r.isolateOk, assembly: r.assemblyOk, tileBulk: r.tileBulkOk, groupDrill: r.groupDrillOk,
  stored: r.stored > 0, persist: r.persistOk, mass: r.massOk, demoAssessed: /^14,2\d\d of 84,365/.test(r.demoCounts), reset: r.resetOk, colourRestored: r.colourRestored, closed: r.closed, consoleClean: r.console.length === 0,
};
r.ok = Object.values(r.checks).every(Boolean);
console.log(JSON.stringify(r, null, 1));
await b.close();
process.exit(r.ok ? 0 : 1);
