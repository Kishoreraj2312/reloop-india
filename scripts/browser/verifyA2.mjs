// A2 browser verification (dev server must be running):
//   node scripts/browser/verifyA2.mjs [baseUrl] [outDir]
// Captures the A2 views, drives the controls with real mouse input (layer checkboxes,
// isolate, ceilings, reset, component clicks incl. instanced items, select-parent) and
// prints identity checks, renderer stats and console problems as JSON.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.argv[2] ?? "http://localhost:5173/";
const OUT = process.argv[3] ?? "docs/screenshots/a2";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const report = { shots: [], checks: {} };
const LAYERS = ["structure", "exteriorWalls", "interiorWalls", "openings", "flooring", "ceilings", "fixtures", "balconiesFacade", "roof"];
const FLOORS = ["FDN", "L0", "L1", "L2", "L3", "L4", "ROOF"];
const inspectorId = async () => (await b.evaluate(`document.querySelector('[data-testid=id-inspector]').innerText`)).split("\n")[1];

async function state({ isolate = null, hide = [], ceilings = false } = {}) {
  await b.evaluate(`window.__reloop.setViewState({ layers: ${JSON.stringify(Object.fromEntries(LAYERS.map((l) => [l, !hide.includes(l)])))},
    isolate: ${JSON.stringify(isolate)}, ceilingsInIsolation: ${ceilings}, floors: ${JSON.stringify(Object.fromEntries(FLOORS.map((f) => [f, true])))} })`);
  await b.sleep(250);
}
async function view(pos, target) {
  await b.evaluate(`window.__reloop.setView(${JSON.stringify(pos)}, ${JSON.stringify(target)})`);
  await b.sleep(900);
}
async function focus(id, dir, dist) {
  await b.evaluate(`(() => { const r = window.__reloop.records.find((x) => x.id === ${JSON.stringify(id)}); const c = r.originalPosition; const sz = r.geometry.size;
    const m = Math.max(sz[0], sz[2], 1.5); const d = ${JSON.stringify(dir)}; const l = Math.hypot(...d); const k = ${dist} * m / l;
    window.__reloop.setView([c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k], [c[0], c[1] - sz[1] * 0.15, c[2]]); })()`);
  await b.sleep(900);
}
async function shot(name, what) {
  await b.shot(`${OUT}/${name}.png`);
  report.shots.push({ name, what });
}
/** Screen position of a component's centre (plain mesh or instance). */
async function screenOf(id) {
  return b.evaluate(`(() => { const r = window.__reloop; const rec = r.records.find((x) => x.id === ${JSON.stringify(id)});
    const v = new (r.camera.position.constructor)(...rec.originalPosition); v.project(r.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight }; })()`);
}

await b.goto(`${BASE}?view=full`);

// ── Exterior ────────────────────────────────────────────────────────────────
await view([52, 36, -48], [0, 8, 0]);
await shot("ext_full_se", "full exterior from south-east");
report.checks.statsFullSteady = await b.evaluate(`window.__reloop.stats(false)`);
report.checks.statsFullShadowFrame = await b.evaluate(`window.__reloop.stats(true)`);
await view([-50, 30, 52], [0, 8, 0]);
await shot("ext_full_nw", "full exterior from north-west");
for (const [name, pos, tgt] of [
  ["facade_south", [3, 10, -62], [0, 9, -15]],
  ["facade_north", [-3, 10, 62], [0, 9, 15]],
  ["facade_east", [62, 10, 0], [18, 9, 0]],
  ["facade_west", [-62, 10, 0], [-18, 9, 0]],
]) {
  await view(pos, tgt);
  await shot(name, `${name.split("_")[1]} facade`);
}
await view([7, 3.4, -26], [3, 1.8, -15]);
await shot("entrance_canopy", "entrance steps, landing, canopy, number panel, wall lights");
await view([-8, 9.5, -22], [-15, 8.2, -16]);
await shot("balcony_closeup", "balcony: slab, soffit, kerb, posts, balusters, handrail, spout, fins");
await view([24, 30, -22], [3, 18, 0]);
await shot("roof", "roof: parapet + coping, finish, access enclosure + door, shaft upstand, drains");

// ── Interiors (isolated floors, ceilings hidden) ────────────────────────────
await state({ isolate: "L0" });
await view([0, 62, 0.01], [0, 0, 0]);
await shot("plan_ground", "ground floor plan view, ceilings hidden");
await state({ isolate: "L1" });
await view([0, 62, 0.01], [0, 3.6, 0]);
await shot("plan_typical", "typical floor (F01) plan view, ceilings hidden");
report.checks.statsIsolatedL1 = await b.evaluate(`window.__reloop.stats(false)`);
await focus("ARC-KIT-F01-A1-KIT", [-0.5, 1.3, -1], 1.3);
await shot("kitchen", "A1 kitchen (L-shaped run)");
await focus("ARC-KIT-F01-A5-KIT", [0.9, 1.4, -0.5], 1.4);
await shot("kitchen_galley", "A5 kitchen (galley)");
await focus("ARC-BATH-F01-A1-BATH2", [0.7, 1.5, -1], 1.4);
await shot("bathroom", "A1 common bath: shower, WC, basin, mirror");
await focus("ARC-BATH-F01-A5-BATH1", [-0.6, 1.8, 0.7], 1.6);
await shot("bathroom_ensuite", "A5 en-suite");
await state({ isolate: "L2" });
await view([8.5, 13.5, -9], [3, 7.5, 0]);
await shot("stair_core", "stair core at F02: lining walls, finishes, balustrades");
await state({ isolate: "L2", ceilings: true });
await view([-6, 15, -24], [-12, 7.2, -10]);
await shot("ceilings_on", "F02 with ceilings shown (cove and panel groups)");

// Section through a window: clip at the centre of the A1 master-bedroom window (F01, south)
const win = await b.evaluate(`window.__reloop.records.find((r) => r.id === "ARC-WIN-F01-A1-BED1-S-01-SIL").originalPosition`);
await b.goto(`${BASE}?view=full&clip=x:${win[0].toFixed(3)}`);
await state({});
await view([win[0] + 3.2, win[1] + 1.2, win[2] + 1.2], [win[0], win[1] + 0.6, win[2] - 0.1]);
await shot("section_window", "section through the A1 F01 master-bedroom window (clip x)");

// ── Interaction with real input ─────────────────────────────────────────────
await b.goto(`${BASE}?view=full`);
await view([3, 10, -40], [0, 9, -15]);
const clicks = [];
for (const id of ["ARC-WALL-F02-EXT-S-C1-D1-P01", "ARC-WIN-F02-A2-BED1-S-01-GLZ01", "ARC-FAC-F02-S-FIN-D1"]) {
  const p = await screenOf(id);
  await b.click(p.x, p.y);
  clicks.push({ expected: id, got: await inspectorId(), instanced: await b.evaluate(`!!window.__reloop.records.find((r) => r.id === ${JSON.stringify(id)}) && !window.__reloop.scene.getObjectByName(${JSON.stringify(id)})`) });
}
for (const c of clicks) c.ok = c.got === c.expected;
report.checks.clicks = clicks;
// Select-parent button (real click)
const btn = await b.evaluate(`(() => { const r = document.querySelector('[data-testid=select-parent]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await b.click(btn.x, btn.y);
report.checks.selectParent = { got: await inspectorId(), ok: (await inspectorId()) === "ARC-FAC-F02-S" };
await shot("selection_assembly", "selected assembly (facade F02 south) highlighted");

// Layer checkbox (real click): hide exterior walls, then the same pixel no longer resolves to the wall
const cb = async (sel) => b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const ext = await cb("input[data-layer=exteriorWalls]");
await b.click(ext.x, ext.y);
const groupVis = await b.evaluate(`window.__reloop.scene.getObjectByName("L2_architecture_exteriorWalls").visible`);
const pw = await screenOf("ARC-WALL-F02-EXT-S-C1-D1-P01");
await b.click(pw.x, pw.y);
const afterHide = await inspectorId();
report.checks.layerToggle = { groupVisibleAfterUncheck: groupVis, clickedThrough: afterHide, ok: groupVis === false && afterHide !== "ARC-WALL-F02-EXT-S-C1-D1-P01" };
await shot("layer_exterior_hidden", "exterior walls layer off");

// Isolate a floor via the select, toggle ceilings via checkbox, then reset
await b.evaluate(`(() => { const s = document.querySelector('[data-testid=isolate]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'L3'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await b.sleep(400);
const iso = await b.evaluate(`(() => { const s = window.__reloop.scene; return { L3: s.getObjectByName("Floor_L3").visible, L2: s.getObjectByName("Floor_L2").visible, ceilings: s.getObjectByName("L3_architecture_ceilings").visible }; })()`);
const ceil = await cb("[data-testid=ceilings]");
await b.click(ceil.x, ceil.y);
const ceilOn = await b.evaluate(`window.__reloop.scene.getObjectByName("L3_architecture_ceilings").visible`);
report.checks.isolate = { ...iso, ceilingsAfterToggle: ceilOn, ok: iso.L3 && !iso.L2 && !iso.ceilings && ceilOn };
const reset = await cb("[data-testid=reset]");
await b.click(reset.x, reset.y);
await b.sleep(300);
report.checks.reset = await b.evaluate(`(() => { const s = window.__reloop.scene; let hidden = 0; s.getObjectByName("Building_G4").traverse((o) => { if (o.isGroup && !o.visible) hidden++; });
  return { hiddenGroups: hidden, inspector: document.querySelector('[data-testid=id-inspector]').innerText.includes('click a member') }; })()`);
report.checks.reset.ok = report.checks.reset.hiddenGroups === 0 && report.checks.reset.inspector;

// Identity: every drawn component maps back to exactly one record
report.checks.identity = await b.evaluate(`(() => {
  const r = window.__reloop; const ids = new Set(r.records.map((x) => x.id)); const drawn = new Map(); let bad = 0, meshes = 0, instanced = 0, instances = 0;
  r.scene.traverse((o) => {
    if (o.isInstancedMesh) { instanced++; const list = o.userData.componentIds || []; if (list.length !== o.count) bad++; for (const id of list) { instances++; if (!ids.has(id)) bad++; drawn.set(id, (drawn.get(id) || 0) + 1); } }
    else if (o.isMesh && o.userData.componentId) { meshes++; if (!ids.has(o.userData.componentId)) bad++; drawn.set(o.userData.componentId, (drawn.get(o.userData.componentId) || 0) + 1); }
  });
  const solids = r.records.filter((x) => x.geometry.kind !== "group");
  const missing = solids.filter((x) => !drawn.has(x.id)).length; const dup = [...drawn.values()].filter((n) => n > 1).length;
  return { records: r.records.length, solidRecords: solids.length, plainMeshes: meshes, instancedMeshes: instanced, instances, unresolved: bad, notDrawn: missing, drawnTwice: dup };
})()`);
report.checks.identity.ok = report.checks.identity.unresolved === 0 && report.checks.identity.notDrawn === 0 && report.checks.identity.drawnTwice === 0;
report.renderer = await b.evaluate(`(() => { const gl = window.__reloop.gl.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.VERSION); })()`);
report.consoleProblems = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
console.log(JSON.stringify(report, null, 1));
await b.close();
const ok = report.checks.clicks.every((c) => c.ok) && report.checks.selectParent.ok && report.checks.layerToggle.ok && report.checks.isolate.ok && report.checks.reset.ok && report.checks.identity.ok && report.consoleProblems.length === 0;
process.exit(ok ? 0 : 1);
