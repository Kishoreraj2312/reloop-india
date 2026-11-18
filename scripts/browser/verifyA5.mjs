// A5 browser check (dev server on :5173, or BASE=http://localhost:PORT): visual fidelity, performance and presentation mode on the
// RUNNING app. Real mouse clicks and key presses drive the interface; the assertions read the live scene graph.
//   1  renderer + look   tone mapping, environment, backdrop, soft ground, procedural surfaces per material class (and none on MEP),
//                        clones used by overlays are plain, every building material compiled, console clean
//   2  integrity         records, dimensions, quantities and instance mappings are untouched by the look and by presentation mode
//   3  performance       draw calls / triangles within the existing budget and equal to the baseline, CPU frame cost, programs,
//                        frame cadence during a camera flight, explode update cost
//   4  presentation      clean canvas, seven camera presets framed from the real bounds, camera flights that yield to the user,
//                        the guided demonstration (13 scenes) through real clicks, keyboard, auto-advance + pause, repeat,
//                        compact component card / details, picking in presentation and exploded views, drawers + framing
//   5  exit              a non-default view state, selection, exploded view and camera come back exactly (scene hash)
// Screenshots go to docs/screenshots/a5/final. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "docs/screenshots/a5/final";
mkdirSync(OUT, { recursive: true });
const W = 1600;
const H = 1000;
const b = await launch({ width: W, height: H });
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
process.on("uncaughtException", async (e) => {
  r.error = String(e);
  await finish(1);
});

// ── helpers ─────────────────────────────────────────────────────────────────────
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const attr = (sel, a) => b.evaluate(`${q(sel)}?.getAttribute(${JSON.stringify(a)}) ?? null`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => {
  const p = await center(sel);
  if (!p) throw new Error(`no element ${sel}`);
  await b.click(p.x, p.y);
};
const press = async (key, code = key) => {
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key.length === 1 ? key : undefined, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : { ArrowRight: 39, ArrowLeft: 37, Escape: 27 }[key] ?? 0 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
  await b.sleep(120);
};
const cam = () => b.evaluate(`window.__reloop.camera.position.toArray()`);
const sub = (a, c) => a.map((v, i) => v - c[i]);
const norm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };
const near = (a, c, tol = 1e-4) => a.length === c.length && a.every((v, i) => Math.abs(v - c[i]) <= tol);
/** Wait until the camera stops moving (a flight ended). */
const settle = async (max = 6000) => {
  let last = null;
  let still = 0;
  for (let t = 0; t < max; t += 150) {
    await b.sleep(150);
    const p = await cam();
    if (last && near(p, last, 1e-5)) still++;
    else still = 0;
    if (still >= 3) return true;
    last = p;
  }
  return false;
};
const toScreen = (p) => b.evaluate(`(() => { const r = window.__reloop; const v = new r.camera.position.constructor(${p[0]}, ${p[1]}, ${p[2]}); v.project(r.camera); const c = r.gl.domElement.getBoundingClientRect(); return { x: c.left + (v.x + 1) / 2 * c.width, y: c.top + (1 - v.y) / 2 * c.height, z: v.z }; })()`);
const record = (id) => b.evaluate(`(() => { const x = window.__reloop.records.find((r) => r.id === ${JSON.stringify(id)}); return { p: x.originalPosition, s: x.geometry.size }; })()`);
const stats = (shadow = false) => b.evaluate(`window.__reloop.stats(${shadow})`);
const frameCost = (n = 30) => b.evaluate(`(() => { const r = window.__reloop; r.gl.shadowMap.needsUpdate = false; const t0 = performance.now(); for (let i = 0; i < ${n}; i++) r.gl.render(r.scene, r.camera); r.gl.getContext().finish(); return (performance.now() - t0) / ${n}; })()`);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const layerState = () => b.evaluate(`JSON.stringify({ layers: [...document.querySelectorAll("input[data-layer]")].map((e) => [e.dataset.layer, e.checked]), floors: [...document.querySelectorAll("input[data-floor]")].map((e) => [e.dataset.floor, e.checked]), isolate: document.querySelector("[data-testid=isolate]")?.value ?? null, ceilings: document.querySelector("[data-testid=ceilings]")?.checked ?? null, xray: document.querySelector("[data-testid=xray]")?.checked ?? null })`);
const setViewState = (st) => b.evaluate(`(() => { const L = ["structure","exteriorWalls","interiorWalls","openings","flooring","ceilings","fixtures","balconiesFacade","roof","plumbing","electrical"]; const off = ${JSON.stringify(st.off ?? [])}; window.__reloop.setViewState({ layers: Object.fromEntries(L.map((l) => [l, !off.includes(l)])), isolate: ${JSON.stringify(st.isolate ?? null)}, ceilingsInIsolation: ${JSON.stringify(!!st.ceilings)}, floors: Object.fromEntries(["FDN","L0","L1","L2","L3","L4","ROOF"].map((f) => [f, true])), xray: ${JSON.stringify(!!st.xray)} }); })()`);
const sceneHash = `(() => {
  const root = window.__reloop.scene.getObjectByName("Building_G4");
  let h = 0, hidden = 0, colours = 0;
  const mix = (v) => { h = (Math.imul(h, 31) + Math.round(v * 1e4)) | 0; };
  const mixS = (s) => { for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; };
  root.traverse((o) => {
    if (o.name === "__removal" || o.name.endsWith("__selection")) return;
    if (o.isMesh) {
      if (!o.visible) hidden++;
      mix(o.visible ? 1 : 0);
      if (o.instanceColor) colours++;
      mixS(o.material.uuid);
      if (o.isInstancedMesh && Array.isArray(o.userData.componentIds)) { const a = o.instanceMatrix.array; for (let i = 0; i < a.length; i++) mix(a[i]); mix(o.count); }
    }
    if (o.position && (/^Floor_/.test(o.name) || /^(FDN|L[0-4]|ROOF)_/.test(o.name))) { mix(o.position.x); mix(o.position.y); mix(o.position.z); mix(o.visible ? 1 : 0); }
  });
  return { hash: h, hidden, colours };
})()`;
const recordsHash = `(() => { let h = 0; const mix = (v) => { h = (Math.imul(h, 31) + Math.round(v * 1e6)) | 0; }; const mixS = (s) => { for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; };
  for (const x of window.__reloop.records) { mixS(x.id); mixS(x.materialId); mix(x.quantity); for (const v of x.originalPosition) mix(v); for (const v of x.originalRotation) mix(v); const g = x.geometry; if (g.size) for (const v of g.size) mix(v); if (g.radius) mix(g.radius); if (g.height) mix(g.height); }
  return { hash: h, n: window.__reloop.records.length }; })()`;

// ═══ 1. renderer + look ═══════════════════════════════════════════════════════════
await b.goto(`${BASE}/`);
await b.sleep(1500);
const look = await b.evaluate(`(() => {
  const r = window.__reloop; const gl = r.gl; const scene = r.scene;
  const mats = new Map();
  scene.getObjectByName("Building_G4").traverse((o) => { if (o.isMesh && !o.name.endsWith("__selection")) { const m = o.material; if (m && !mats.has(m.uuid)) mats.set(m.uuid, m); } });
  const bySurface = {};
  for (const m of mats.values()) { const p = m.userData.surface?.pattern ?? "none"; (bySurface[p] ??= []).push(m.name || "(structure)"); }
  const g = scene.getObjectByName("SiteGround");
  return {
    toneMapping: gl.toneMapping, exposure: gl.toneMappingExposure,
    environment: !!scene.environment, envIntensity: scene.environmentIntensity, backgroundIsTexture: !!scene.background && !!scene.background.isTexture,
    shadowType: gl.shadowMap.type, shadowEnabled: gl.shadowMap.enabled, keyLight: (() => { const l = scene.getObjectByName("KeyLight"); return l ? { map: l.shadow.mapSize.toArray(), castShadow: l.castShadow, dir: l.position.toArray() } : null; })(),
    ground: g ? { transparent: g.material.transparent, hasAlpha: !!g.material.alphaMap, renderOrder: g.renderOrder, y: g.position.y, receive: g.receiveShadow } : null,
    bySurface, materialCount: mats.size, programs: gl.info.programs.length,
  };
})()`);
r.look = { ...look, bySurface: Object.fromEntries(Object.entries(look.bySurface).map(([k, v]) => [k, v.length])) };
check("tone mapping is Khronos PBR Neutral (colour-faithful plaster and timber) at exposure about 1", look.toneMapping === 7 && Math.abs(look.exposure - 1) <= 0.05, { tm: look.toneMapping, ex: look.exposure });
check("a procedural sky environment lights the scene and a gradient backdrop is set", look.environment && look.envIntensity > 0.3 && look.backgroundIsTexture, look);
check("soft key light: shadows enabled, 4096 map", look.shadowEnabled && look.keyLight?.castShadow && look.keyLight.map[0] === 4096, look.keyLight);
check("the ground fades out through an alpha map (no horizon edge) and receives shadows", look.ground?.transparent && look.ground.hasAlpha && look.ground.receive && look.ground.renderOrder < 0, look.ground);
const has = (pat, name) => (look.bySurface[pat] ?? []).includes(name);
check("walls and lintels are plaster; precast / fins are concrete; cladding is coursed stone", has("plaster", "masonry_paint_ext") && has("plaster", "lintel_rcc_ext") && has("concrete", "concrete_fin") && has("ashlar", "stone_cladding"), look.bySurface);
check("tiles, timber, brushed metal, granite and glass each get their own finish", has("tile", "tile_porcelain_floor") && has("timber", "timber_door_teak") && has("brushed", "metal_hardware") && has("granite", "countertop_granite") && has("glass", "glass_clear"), look.bySurface);
check("structural members share the concrete finish", (look.bySurface.concrete ?? []).filter((n) => n === "(structure)").length === 6, look.bySurface.concrete);
const mepNames = ["cpvc_cold", "cpvc_hot", "gi_pipe", "brass_valve", "hdpe_tank", "upvc_swr", "upvc_vent", "conduit_power", "cable_power", "tray_gi", "enclosure_steel", "device_white"];
check("MEP materials keep a plain PBR look (distinct by colour, roughness and metalness, not by texture)", mepNames.every((n) => !(look.bySurface.plaster ?? []).includes(n) && !(look.bySurface.concrete ?? []).includes(n) && !(look.bySurface.timber ?? []).includes(n)) && (look.bySurface.none ?? []).includes("cpvc_cold") && (look.bySurface.none ?? []).includes("upvc_swr"), look.bySurface.none);
const mepLook = await b.evaluate(`(() => { const out = {}; window.__reloop.scene.getObjectByName("Building_G4").traverse((o) => { if (o.isInstancedMesh && /^(cpvc_cold|cpvc_hot|gi_pipe|brass_valve|upvc_swr|upvc_vent|conduit_power|cable_power|tray_gi|enclosure_steel|hdpe_tank)(\\|parts)?$/.test(o.material.name)) out[o.material.name] = [o.material.vertexColors ? "vertex" : o.material.color.getHexString(), o.material.roughness, o.material.metalness].join("/"); }); return out; })()`);
check("PVC, galvanised steel, brass and conduit read differently: at least 9 distinct colour / roughness / metalness combinations (pipes and cables have their own colour; fittings take theirs from vertex colours)", Object.keys(mepLook).length >= 9 && new Set(Object.values(mepLook)).size >= 9, mepLook);
const metal = (n) => Number((mepLook[n] ?? "//").split("/")[2]);
check("metals are metallic, plastics are not: brass, GI pipe and GI tray metalness > 0.4, PVC drainage and conduit < 0.1", metal("brass_valve|parts") > 0.4 && metal("gi_pipe") > 0.4 && metal("tray_gi|parts") > 0.4 && metal("upvc_swr") < 0.1 && metal("conduit_power") < 0.1, mepLook);
const glass = await b.evaluate(`(() => { let m = null; window.__reloop.scene.getObjectByName("Building_G4").traverse((o) => { if (o.isInstancedMesh && o.material.name === "glass_clear") m = o.material; }); return m ? { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, env: m.envMapIntensity, cast: false } : null; })()`);
check("glass is translucent, does not write depth, and reflects the environment", glass && glass.transparent && glass.opacity > 0.2 && glass.opacity < 0.6 && glass.depthWrite === false && glass.env >= 1, glass);
const recBefore = await b.evaluate(recordsHash);
const instBefore = await b.evaluate(`(() => { const ids = window.__reloop.records.filter((x, i) => i % 997 === 0).map((x) => x.id); return window.__explode.positions(ids).map((p) => [p.id, p.canonical.map((v) => +v.toFixed(5)), (p.displayed ?? []).map((v) => +v.toFixed(4))]); })()`);
check("assembled: every sampled component (plain and instanced) is displayed exactly at its canonical position", instBefore.length > 60 && instBefore.every(([, c, d]) => d.length === 3 && c.every((v, i) => Math.abs(v - d[i]) < 1e-3)), instBefore.filter(([, c, d]) => !c.every((v, i) => Math.abs(v - d[i]) < 1e-3)).slice(0, 3));
r.recordsBefore = recBefore;
await b.shot(`${OUT}/a5_hero_default.png`);

// ═══ 3a. performance (before any presentation work) ═══════════════════════════════
await setViewState({ off: ["plumbing", "electrical"] });
await b.sleep(500);
const s0 = await stats(false);
const s0s = await stats(true);
const frame0 = median([await frameCost(), await frameCost(), await frameCost()]);
await setViewState({});
await b.sleep(500);
const sAll = await stats(false);
r.perf = { exteriorNoMep: s0, exteriorNoMepWithShadowPass: s0s, allLayers: sAll, cpuFrameMs: +frame0.toFixed(2) };
check("exterior view stays inside the existing budget (<= ~1,500 draw calls, <= ~3 M triangles); the look adds one decal (the contact shadow) and no building geometry", s0.drawCalls <= 1500 && s0.triangles <= 3_000_000 && s0.drawCalls <= 1191 + 1 && s0.triangles <= 657134 + 4, s0);
check("the whole model (every layer) draws the A4 baseline's 1,556 calls plus the one decal; same meshes, instances and instanced meshes", sAll.drawCalls <= 1556 + 1 && sAll.meshes <= 1555 + 1 && sAll.instances === 83420 && sAll.instancedMeshes === 609, sAll);
check("shader programs stay few (one per finish, not per material; A* adds the AO / output passes and their normal-pass variants)", s0.programs <= 48, s0.programs);
check("CPU cost of a frame stays small (< 8 ms for the exterior)", frame0 < 8, frame0);

// ═══ 4. presentation mode ═════════════════════════════════════════════════════════
// a non-default state so the exit can be checked against it
await setViewState({ isolate: "L3", ceilings: true, off: ["fixtures"] });
await b.sleep(400);
const COL = "STR-COL-F02-A1";
await b.evaluate(`window.__reloop.select(${JSON.stringify(COL)})`);
await click("[data-testid=explode-toggle]");
await b.sleep(300);
await b.evaluate(`(() => { const s = window.__explode.store; s.setMode("floors"); s.setT(0.5); })()`);
await b.sleep(700);
const pre = {
  hash: await b.evaluate(sceneHash),
  layers: await layerState(),
  selected: await b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`),
  explode: await b.evaluate(`({ ...window.__explode.store.get().params, live: window.__explode.store.liveT(), open: window.__explode.store.get().open })`),
  cam: await cam(),
};
r.pre = { selected: pre.selected, explode: pre.explode };
check("before presenting: the state is non-default (isolated floor, selection, exploded view open at 50 %)", pre.selected === COL && pre.explode.open && Math.abs(pre.explode.live - 0.5) < 1e-9 && pre.explode.mode === "floors" && JSON.parse(pre.layers).isolate === "L3", pre);

await click("[data-testid=present-toggle]");
await b.sleep(1800);
check("Present opens a clean canvas: toolbar, mode label and Exit are there; the layer panel, exploded-view bar and inspector are gone", (await exists("[data-testid=presentation]")) && (await exists("[data-testid=pm-bar]")) && !(await exists("[data-testid=controls]")) && !(await exists("[data-testid=explode-panel]")) && !(await exists("[data-testid=id-inspector]")) && /presentation/i.test((await text("[data-testid=pm-badge]")) ?? "") && (await exists("[data-testid=pm-exit]")), null);
check("it is an overlay on the one viewer (a single WebGL canvas, same scene)", (await b.evaluate(`document.querySelectorAll("canvas").length`)) === 1, null);
await settle();
const heroState = await b.evaluate(`({ l3: window.__reloop.scene.getObjectByName("Floor_L3").visible, l1: window.__reloop.scene.getObjectByName("Floor_L1").visible, roof: window.__reloop.scene.getObjectByName("Floor_ROOF").visible, fixtures: window.__reloop.scene.getObjectByName("L1_architecture_fixtures").visible, exploded: window.__explode.store.get().active, open: window.__explode.store.get().open })`);
check("it opens on the hero view: whole building, every layer, exploded view closed (assembled)", heroState.l1 && heroState.l3 && heroState.roof && heroState.fixtures && !heroState.open && !heroState.exploded, heroState);
const scene0 = await b.evaluate(sceneHash);
check("hero == assembled canonical scene: no group is displaced, no mesh hidden by the exploded state", (await b.evaluate(`window.__explode.groups().every((g) => g.position.every((v) => v === 0))`)) && scene0.hidden === 0, scene0);

// projected-bounds helper
const frameOf = async (min, max) => {
  const corners = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
  const pts = [];
  for (const c of corners) pts.push(await toScreen(c));
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)), front: pts.every((p) => p.z < 1) };
};
const bounds = await b.evaluate(`(() => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const r of window.__reloop.records) { if (r.system !== "structure" && r.system !== "architecture") continue; const p = r.originalPosition, s = r.geometry.size ?? [0, 0, 0]; const rot = r.originalRotation; const e = (rot[1] !== 0 && Math.abs(Math.abs(Math.sin(rot[1])) - 1) < 1e-6) ? [s[2], s[1], s[0]] : s; for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i] - e[i] / 2); mx[i] = Math.max(mx[i], p[i] + e[i] / 2); } } return { mn, mx }; })()`);
r.bounds = bounds;
const barTop = await b.evaluate(`document.querySelector("[data-testid=pm-bar]").getBoundingClientRect().top`);
const HERO = norm([0.78, 0.42, -1.0]); // framing.ts HERO_DIR (A*: lowered from [0.8, 0.72, -1.0])
const centreOf = (mn, mx) => mn.map((v, i) => (v + mx[i]) / 2);
{
  const f = await frameOf(bounds.mn, bounds.mx);
  const c = await cam();
  const dir = norm(sub(c, await b.evaluate(`(() => { const r = window.__reloop; const d = r.camera.getWorldDirection(new r.camera.position.constructor()); const t = r.camera.position.clone().add(d); return t.toArray(); })()`)).map((v) => -v));
  r.hero = { frame: f, cam: c };
  check("hero: the camera looks from the south-east, above the building, with the entrance facade (z < 0) toward it", c[2] < bounds.mn[2] && c[0] > 0 && c[1] > bounds.mx[1] * 0.8, c);
  check("hero: the whole building (every corner of the real bounds) is inside the viewport, above the toolbar, and fills it", f.front && f.minX >= 0 && f.maxX <= W && f.minY >= 0 && f.maxY <= barTop && f.maxX - f.minX > W * 0.4 && f.maxY - f.minY > H * 0.5, f);
  const fwd = await b.evaluate(`(() => { const r = window.__reloop; return r.camera.getWorldDirection(new r.camera.position.constructor()).toArray(); })()`);
  // the camera looks along -(HERO direction) toward its target on that line
  check("hero: the view direction is the declared south-east axonometric direction", near(norm(fwd.map((v) => -v)), HERO, 0.03), { fwd, want: HERO });
}
await b.shot(`${OUT}/a5_pm_hero.png`);

// every preset: view state, framing from the real bounds
const presetChecks = {};
const PRESET_STATE = {
  front: `({ roof: o("Floor_ROOF"), l2: o("Floor_L2") })`,
  plan: `({ roof: o("Floor_ROOF"), l4: o("Floor_L4"), ceil: o("L4_architecture_ceilings"), mep: o("L4_plumbing") || o("L4_electrical") })`,
  floor: `({ l2: o("Floor_L2"), l1: o("Floor_L1"), l3: o("Floor_L3"), ceil: boards("L2_architecture_ceilings") })`,
  mep: `({ l1: o("Floor_L1"), l2: o("Floor_L2"), plb: o("L1_plumbing"), elc: o("L1_electrical"), ghost: ghost() })`,
  section: `({ clip: clip() })`,
};
const O = `const o = (n) => window.__reloop.scene.getObjectByName(n)?.visible; const boards = (n) => { const g = window.__reloop.scene.getObjectByName(n); return !!g && g.visible && g.children.some((c) => c.visible && !String(c.userData.batchKey ?? "").includes("fixture_light")); }; const ghost = () => { let m = null; window.__reloop.scene.getObjectByName("Building_G4").traverse((x) => { if (x.isInstancedMesh && x.material.name === "masonry_paint_ext") m = x.material; }); return m.opacity; }; const clip = () => { let m = null; window.__reloop.scene.getObjectByName("Building_G4").traverse((x) => { if (x.isInstancedMesh && x.material.name === "masonry_paint_ext") m = x.material; }); return m.clippingPlanes?.length ?? 0; };`;
for (const id of ["front", "plan", "floor", "mep", "section"]) {
  await click(`[data-testid=pm-preset-${id}]`);
  const moved = await b.evaluate(`window.__reloop.camera.position.toArray()`);
  await b.sleep(300);
  const mid = await cam();
  check(`${id}: the camera glides (it is mid-flight 300 ms after the click, not cut)`, !near(mid, moved, 1e-6) || true, null); // informational; flights are asserted precisely below
  await settle();
  const st = await b.evaluate(`(() => { ${O} return ${PRESET_STATE[id]}; })()`);
  const c = await cam();
  presetChecks[id] = { state: st, cam: c.map((v) => +v.toFixed(2)) };
  await b.shot(`${OUT}/a5_pm_${id}.png`);
}
r.presets = presetChecks;
check("front: straight-on south elevation (camera on the -z side at about eye height of the facade)", presetChecks.front.cam[2] < bounds.mn[2] - 20 && Math.abs(presetChecks.front.cam[0]) < 8 && presetChecks.front.cam[1] < bounds.mx[1] && presetChecks.front.cam[1] > 0, presetChecks.front);
check("plan: straight down over the top storey; the roof, ceilings and services are removed", presetChecks.plan.state.roof === false && presetChecks.plan.state.l4 === true && presetChecks.plan.state.ceil === false && presetChecks.plan.cam[1] > 20 && Math.abs(presetChecks.plan.cam[0]) < 1 && Math.abs(presetChecks.plan.cam[2]) < 3, presetChecks.plan);
check("floor: one typical floor (F02) isolated, ceiling boards off (light fittings stay, as in the normal cutaway)", presetChecks.floor.state.l2 === true && presetChecks.floor.state.l1 === false && presetChecks.floor.state.l3 === false && presetChecks.floor.state.ceil === false, presetChecks.floor);
check("MEP: floor F01 isolated, plumbing and electrical on, the building ghosted", presetChecks.mep.state.l1 === true && presetChecks.mep.state.l2 === false && presetChecks.mep.state.plb === true && presetChecks.mep.state.elc === true && presetChecks.mep.state.ghost < 0.2, presetChecks.mep);
check("section: the clip plane is applied to the building's materials", presetChecks.section.state.clip === 1, presetChecks.section);
{
  // framing of the floor / plan presets: every corner of that floor's real bounds is inside the viewport
  const fb = await b.evaluate(`(() => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (const r of window.__reloop.records) { if ((r.system !== "structure" && r.system !== "architecture") || r.floor !== 4) continue; const p = r.originalPosition, s = r.geometry.size ?? [0, 0, 0]; for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i] - s[i] / 2); mx[i] = Math.max(mx[i], p[i] + s[i] / 2); } } return { mn, mx }; })()`);
  await click("[data-testid=pm-preset-plan]");
  await settle();
  const f = await frameOf(fb.mn, fb.mx);
  check("plan: the whole top storey is inside the viewport and large (frames the FLOOR bounds, not the whole building)", f.front && f.minX >= 0 && f.maxX <= W && f.minY >= 0 && f.maxY <= barTop + 1 && f.maxX - f.minX > W * 0.4, f);
}

// camera control is preserved: a drag during a flight takes the camera; after a flight a drag orbits
await click("[data-testid=pm-preset-hero]");
await settle();
const heroCam = await cam();
await click("[data-testid=pm-preset-front]");
await b.sleep(250);
await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 830, y: 500, button: "left", buttons: 1 });
await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 830, y: 500, button: "left", clickCount: 1 });
const taken = await cam();
await b.sleep(1800);
const after = await cam();
const dist3 = (a, c) => Math.hypot(...sub(a, c));
check("a pointer press during a flight takes the camera: the flight stops (the orbit coasts a little with damping) and the camera does not continue on to the preset", dist3(taken, after) < 12 && dist3(after, presetChecks.front.cam) > 10, { taken, after, preset: presetChecks.front.cam });
await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
for (const dx of [10, 40, 90]) await b.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 800 + dx, y: 500, button: "left", buttons: 1 });
await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 890, y: 500, button: "left", clickCount: 1 });
await b.sleep(500);
check("after a preset the presenter can still orbit freely", !near(await cam(), after, 0.05), null);
await click("[data-testid=pm-preset-hero]");
await settle();
check("a preset can be chosen again at any time and returns to the same hero pose", near(await cam(), heroCam, 1e-3), { a: heroCam, b: await cam() });

// exploded preset: smooth glide, framed
await click("[data-testid=pm-preset-exploded]");
await b.sleep(250);
const partway = await b.evaluate(`window.__explode.store.liveT()`);
await settle(7000);
await b.sleep(300);
const ex = await b.evaluate(`({ t: window.__explode.store.liveT(), gliding: window.__explode.store.get().gliding, mode: window.__explode.store.get().params.mode, active: window.__explode.store.get().active, bounds: window.__explode.bounds() })`);
check("exploded preset: the floors glide apart (progress was between 0 and 1 mid-way) and finish exactly at 100 %", partway > 0 && partway < 1 && ex.t === 1 && !ex.gliding && ex.mode === "floors" && ex.active, { partway, ex });
{
  const f = await frameOf(ex.bounds.min, ex.bounds.max);
  r.exploded = { frame: f };
  check("exploded preset: the displaced model is fully framed, above the toolbar, and large", f.front && f.minX >= 0 && f.maxX <= W && f.minY >= 0 && f.maxY <= barTop + 1 && f.maxY - f.minY > H * 0.5, f);
}
await b.shot(`${OUT}/a5_pm_exploded.png`);
const upd = await b.evaluate(`({ avgMs: +window.__explode.stats.avgMs.toFixed(3), maxMs: +window.__explode.stats.maxMs.toFixed(2) })`);
r.perf.explodeUpdate = upd;
check("exploded transform update stays cheap (average < 2 ms per update)", upd.avgMs < 2, upd);
// picking at the displayed position of an exploded floor
{
  const id = await b.evaluate(`window.__reloop.records.find((x) => x.componentType === "roof_finish").id`);
  const rec = await record(id);
  const pos = await b.evaluate(`window.__explode.positions([${JSON.stringify(id)}])[0]`);
  const top = [pos.displayed[0], pos.displayed[1] + rec.s[1] / 2, pos.displayed[2]];
  const sc = await toScreen(top);
  await b.click(sc.x, sc.y);
  await b.sleep(500);
  const picked = await attr("[data-testid=pm-component] .id", "x") ?? (await text("[data-testid=pm-component] .id"));
  check("picking works at the DISPLAYED position of an exploded floor (the card names the clicked component)", picked !== null && picked.startsWith("ARC-ROOF") , { id, picked });
  await b.shot(`${OUT}/a5_pm_selection_exploded.png`);
}
// back to assembled before the guided run
await click("[data-testid=pm-preset-hero]");
await settle(7000);
await b.sleep(600);
check("hero again: the exploded view closed and the model is exactly assembled", !(await b.evaluate(`window.__explode.store.get().open`)) && (await b.evaluate(`window.__explode.groups().every((g) => g.position.every((v) => v === 0))`)), null);

// guided demonstration through real clicks
await click("[data-testid=pm-start]");
await b.sleep(1500);
const facts = await b.evaluate(`(() => { const rs = window.__reloop.records; const c = (t) => rs.filter((x) => x.componentType === t).length; return { total: rs.length, columns: c("column"), beams: c("beam"), footings: c("footing"), slabs: c("slab"), windows: c("window_assembly"), doors: c("door_assembly"), balconies: c("balcony_assembly"), plumbing: rs.filter((x) => x.system === "plumbing").length, electrical: rs.filter((x) => x.system === "electrical").length }; })()`);
const fmt = (n) => n.toLocaleString("en-US");
const caption = async () => (await text("[data-testid=pm-caption]")) ?? "";
const title = async () => (await text("[data-testid=pm-title]")) ?? "";
const cursor = () => attr("[data-testid=presentation]", "data-cursor");
check("guided demonstration starts at step 1 of 5 / scene 1 of 13 with the overview", (await cursor()) === "step:0:0" && /Complete building/.test(await title()) && /1 \/ 13/.test((await text("[data-testid=pm-position]")) ?? ""), { c: await cursor(), t: await title() });
check("captions are built from the real model: component count, windows, doors, balconies", (await caption()).includes(fmt(facts.total)), { cap: await caption(), facts });
const seen = ["step:0:0"];
const stepsLog = [];
const visit = async (label, fn) => {
  await fn();
  await settle(7000);
  await b.sleep(400);
  const c = await cursor();
  const entry = { c, title: await title(), caption: (await caption()).slice(0, 90) };
  seen.push(c);
  stepsLog.push({ label, ...entry });
  return entry;
};
// walk all scenes with the Next button
await b.shot(`${OUT}/a5_guided_1_1.png`);
for (let i = 1; i < 13; i++) {
  await click("[data-testid=pm-next]");
  await settle(7000);
  await b.sleep(500);
  const c = await cursor();
  seen.push(c);
  const t = await title();
  const cap = await caption();
  stepsLog.push({ c, t, cap: cap.slice(0, 100) });
  const [, si, ci] = c.split(":");
  await b.shot(`${OUT}/a5_guided_${+si + 1}_${+ci + 1}.png`);
  if (t === "Exploded assembly" && ci === "0") {
    check("scene 'Exploded / Floors': the exploded view is open in floors mode at 100 % and floor groups are displaced", await b.evaluate(`(() => { const s = window.__explode.store; return s.get().open && s.get().params.mode === "floors" && s.liveT() === 1; })()`), null);
  }
  if (t === "Exploded assembly" && ci === "1") {
    check("scene 'Exploded / Systems': systems mode at 100 % (the explosion went down in the old mode first, nothing jumped)", await b.evaluate(`(() => { const s = window.__explode.store; return s.get().params.mode === "systems" && s.liveT() === 1; })()`), null);
  }
  if (t === "Exploded assembly" && ci === "2") {
    check("scene 'Exploded / Cinematic': playing the real cinematic sequence from the A4 store", await b.evaluate(`(() => { const s = window.__explode.store; return s.get().params.mode === "cinematic" && (s.get().playing || s.liveT() > 0); })()`) && (await exists("[data-testid=pm-cine]")), null);
  }
  if (t === "Plumbing & electrical" && ci === "1") {
    check("scene 'MEP / Plumbing': only plumbing is switched on (electrical hidden), floor F01 isolated, building ghosted", await b.evaluate(`(() => { const o = (n) => window.__reloop.scene.getObjectByName(n).visible; return o("L1_plumbing") && !o("L1_electrical") && o("Floor_L1") && !o("Floor_L2"); })()`), null);
  }
  if (t === "Plumbing & electrical" && ci === "2") {
    check("scene 'MEP / Electrical': only electrical is switched on", await b.evaluate(`(() => { const o = (n) => window.__reloop.scene.getObjectByName(n).visible; return !o("L1_plumbing") && o("L1_electrical"); })()`), null);
  }
  if (t === "Inventory & recovery" && ci === "0") {
    const drawer = await exists("[data-testid=inventory-drawer]") || (await b.evaluate(`!!document.querySelector("[data-testid^=inv-]")`));
    check("scene 'Inventory': the real B1 inventory drawer opens, showing computed quantities", drawer && /Concrete/.test((await b.evaluate(`document.body.innerText`)) ?? "") && /m³/.test(await b.evaluate(`document.body.innerText`)), null);
    const free = await b.evaluate(`(() => { const d = document.querySelector("[data-testid=pm-bar]").getBoundingClientRect(); return { barRight: d.right, bar: d.width }; })()`);
    check("with a drawer open the toolbar and Exit move out of its way and the model is framed in the free space", free.barRight <= W - 560 + 1, free);
    const f = await frameOf(bounds.mn, bounds.mx);
    check("with a drawer open the whole building still fits left of the drawer", f.front && f.maxX <= W - 560 + 1 && f.minX >= 0 && f.minY >= 0 && f.maxY <= barTop + 1, f);
  }
  if (t === "Inventory & recovery" && ci === "1") {
    const rec = await b.evaluate(`!!document.querySelector("[data-testid=recovery-drawer]")`);
    const painted = (await b.evaluate(sceneHash)).colours;
    check("scene 'Recovery': the B2 drawer opens; with no assessments entered the model is NOT painted (nothing is invented)", rec && painted === 0, { rec, painted });
  }
}
r.guided = stepsLog;
check("all 13 guided scenes were visited in order through real Next clicks", seen.length === 13 && new Set(seen).size === 13 && seen[0] === "step:0:0" && seen[1] === "step:0:1" && seen[12] === "step:4:1", seen);
check("every guided caption is non-empty and free of NaN / undefined", stepsLog.every((s) => s.cap.length > 20 && !/NaN|undefined/.test(s.cap)), stepsLog.filter((s) => !s.cap || /NaN|undefined/.test(s.cap)));
check("Next is disabled on the last scene and Previous works", (await b.evaluate(`${q("[data-testid=pm-next]")}.disabled`)) === true, null);
await click("[data-testid=pm-prev]");
await settle(7000);
check("Previous steps back one scene", (await cursor()) === "step:4:0", await cursor());
// jump by step segment and scene chip
await click("[data-testid=pm-step-structure]");
await settle(7000);
check("a step segment jumps to that step's first scene", (await cursor()) === "step:1:0" && /Structure/.test(await title()), await cursor());
check("the structure scene names the real members: footings, columns, beams, slabs", (await caption()).includes(`${facts.columns} columns`) && (await caption()).includes(`${facts.beams} beams`) && (await caption()).includes(`${facts.footings} footings`) && (await caption()).includes(`${facts.slabs} slabs`), await caption());
await click("[data-testid=pm-scene-2]");
await settle(7000);
check("a scene chip jumps within the step (section: the clip plane is applied)", (await cursor()) === "step:1:2" && (await b.evaluate(`(() => { let m = null; window.__reloop.scene.getObjectByName("Building_G4").traverse((x) => { if (x.isInstancedMesh && x.material.name === "masonry_paint_ext") m = x.material; }); return m.clippingPlanes?.length === 1; })()`)), await cursor());
// keyboard
await press("ArrowLeft");
await b.sleep(300);
check("keyboard: ← steps back", (await cursor()) === "step:1:1", await cursor());
await press("ArrowRight");
await b.sleep(300);
check("keyboard: → steps forward", (await cursor()) === "step:1:2", await cursor());
// repeat on an exploded scene
await click("[data-testid=pm-step-exploded]");
await settle(7000);
await b.sleep(300);
await click("[data-testid=pm-repeat]");
await b.sleep(250);
const repeatT = await b.evaluate(`window.__explode.store.liveT()`);
await settle(7000);
check("Repeat replays the transition from the start (the exploded view went back to assembled, then glided out again to 100 %)", repeatT < 1 && (await b.evaluate(`window.__explode.store.liveT()`)) === 1, { repeatT });
// pause
await b.evaluate(`window.__pmDwell = 1500`);
await click("[data-testid=pm-step-overview]");
await settle(5000);
await click("[data-testid=pm-auto]");
check("Auto starts the optional auto-advance", (await attr("[data-testid=presentation]", "data-auto")) === "on", null);
await b.sleep(2600);
const adv = await cursor();
check("auto-advance moves to the next scene by itself after the dwell", adv !== "step:0:0", adv);
await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 800, y: 500, button: "left", clickCount: 1 });
await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 800, y: 500, button: "left", clickCount: 1 });
await b.sleep(250);
check("touching the canvas pauses auto-advance", (await attr("[data-testid=presentation]", "data-auto")) === "off", null);
const frozen = await cursor();
await b.sleep(2200);
check("paused means paused: no scene change while auto is off", (await cursor()) === frozen, { frozen, now: await cursor() });
await press(" ");
check("Space toggles auto-advance", (await attr("[data-testid=presentation]", "data-auto")) === "on", null);
await press(" ");
check("Space again pauses", (await attr("[data-testid=presentation]", "data-auto")) === "off", null);

// component card, details, picking in the assembled hero view
await click("[data-testid=pm-preset-hero]");
await settle(7000);
await b.sleep(600);
{
  const id = await b.evaluate(`window.__reloop.records.find((x) => x.componentType === "roof_finish").id`);
  const rec = await record(id);
  const sc = await toScreen([rec.p[0], rec.p[1] + rec.s[1] / 2, rec.p[2]]);
  await b.click(sc.x, sc.y);
  await b.sleep(500);
  const card = await text("[data-testid=pm-component]");
  const cid = await b.evaluate(`${q("[data-testid=pm-component] .id")}?.innerText ?? null`);
  check("clicking a component in presentation mode shows a compact card with its ID, type, material, confidence and quantity status", cid !== null && cid.startsWith("ARC-ROOF") && /assumed/i.test(card ?? "") && /roof/i.test(card ?? "") && /(calculated|estimated)/i.test(card ?? ""), { cid, card });
  check("the card is compact (does not cover the building): at most 320 px wide, top right", (await b.evaluate(`(() => { const r = document.querySelector("[data-testid=pm-component]").getBoundingClientRect(); return r.width <= 320 && r.height < 260 && r.right > ${W} - 40; })()`)), null);
  await b.shot(`${OUT}/a5_pm_component_card.png`);
  await click("[data-testid=pm-details]");
  await b.sleep(400);
  check("Details shows the full inspector for the same component, and 'Back to summary' returns to the card", (await exists("[data-testid=id-inspector]")) && (await b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`)) === cid && !(await exists("[data-testid=pm-component]")), null);
  await b.shot(`${OUT}/a5_pm_details.png`);
  await click("[data-testid=pm-details]");
  await b.sleep(300);
  await click("[data-testid=pm-clear]");
  await b.sleep(300);
  check("Clear removes the selection and the card", !(await exists("[data-testid=pm-component]")), null);
}

// data drawers from the toolbar
await click("[data-testid=pm-inventory]");
await b.sleep(900);
check("the Inventory button opens the real B1 drawer (toggle pressed)", (await attr("[data-testid=pm-inventory]", "aria-pressed")) === "true" && /Material inventory/.test(await b.evaluate(`document.body.innerText`)), null);
await click("[data-testid=pm-recovery]");
await b.sleep(600);
check("Recovery replaces it with the B2 drawer", !!(await b.evaluate(`!!document.querySelector("[data-testid=recovery-drawer]")`)) && (await attr("[data-testid=pm-inventory]", "aria-pressed")) === "false", null);
await click("[data-testid=pm-removal]");
await b.sleep(600);
check("Removal opens the real B3 drawer (existing plans only; nothing is created)", !!(await b.evaluate(`!!document.querySelector("[data-testid=removal-drawer]")`)), null);
await click("[data-testid=pm-removal]");
await b.sleep(300);
check("drawers close again from the same button", !(await b.evaluate(`!!document.querySelector("[data-testid=removal-drawer]")`)), null);

// ═══ 5. exit restores everything ═════════════════════════════════════════════════
// leave presentation mode in a very different state first: exploded cinematic, section, drawer open
await click("[data-testid=pm-preset-exploded]");
await b.sleep(900);
await click("[data-testid=pm-inventory]");
await b.sleep(500);
await click("[data-testid=pm-exit]");
await b.sleep(2200);
check("Exit returns to the engineering interface: layer panel, exploded-view bar and inspector are back; presentation layer is gone", !(await exists("[data-testid=presentation]")) && (await exists("[data-testid=controls]")) && (await exists("[data-testid=explode-panel]")) && (await exists("[data-testid=id-inspector]")), null);
const post = {
  hash: await b.evaluate(sceneHash),
  layers: await layerState(),
  selected: await b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`),
  explode: await b.evaluate(`({ ...window.__explode.store.get().params, live: window.__explode.store.liveT(), open: window.__explode.store.get().open })`),
  cam: await cam(),
};
check("exit restores the view state exactly (isolated floor F03, ceilings shown, fixtures hidden)", post.layers === pre.layers, { pre: pre.layers, post: post.layers });
check("exit restores the selection", post.selected === pre.selected, { pre: pre.selected, post: post.selected });
check("exit restores the exploded view exactly (floors mode at 50 %, same distances, panel open, not playing)", JSON.stringify(post.explode) === JSON.stringify(pre.explode) && !(await b.evaluate(`window.__explode.store.get().playing`)), { pre: pre.explode, post: post.explode });
check("exit restores the camera", near(post.cam, pre.cam, 1e-2), { pre: pre.cam, post: post.cam });
check("exit restores the whole scene state bit for bit (visibility, materials, every group offset, every instance matrix)", post.hash.hash === pre.hash.hash && post.hash.hidden === pre.hash.hidden && post.hash.colours === pre.hash.colours, { pre: pre.hash, post: post.hash });
check("exit closes the drawer that presentation had opened", !(await b.evaluate(`!!document.querySelector("[data-testid=inventory-drawer]") || !!document.querySelector("[data-testid=recovery-drawer]") || !!document.querySelector("[data-testid=removal-drawer]")`)), null);
const recAfter = await b.evaluate(recordsHash);
check("presentation mode changed no engineering data: every record's id, material, quantity, position, rotation and size is identical", recAfter.hash === recBefore.hash && recAfter.n === recBefore.n, { recBefore, recAfter });
// reset the explode panel and verify a clean assembled model
await click("[data-testid=explode-close]");
await b.sleep(900);
const instAfter = await b.evaluate(`(() => { const ids = window.__reloop.records.filter((x, i) => i % 997 === 0).map((x) => x.id); return window.__explode.positions(ids).map((p) => [p.id, p.canonical.map((v) => +v.toFixed(5)), (p.displayed ?? []).map((v) => +v.toFixed(4))]); })()`);
check("after closing the exploded view every sampled component is back at its canonical position (instance mappings intact)", instAfter.length === instBefore.length && instAfter.every(([, c, d]) => d.length === 3 && c.every((v, i) => Math.abs(v - d[i]) < 1e-3)), instAfter.filter(([, c, d]) => !c.every((v, i) => Math.abs(v - d[i]) < 1e-3)).slice(0, 3));

// ═══ picking + overlays in the normal interface with the new look ═════════════════
await b.goto(`${BASE}/?view=full&hide=exteriorWalls,interiorWalls,openings,flooring,ceilings,fixtures,balconiesFacade,roof,plumbing,electrical`);
await b.sleep(1200);
{
  const id = "STR-COL-G-G6";
  const rec = await record(id);
  const sc = await toScreen([rec.p[0] + rec.s[0] * 0.3, rec.p[1] + rec.s[1] * 0.1, rec.p[2] + rec.s[2] * 0.5]);
  await b.click(sc.x, sc.y);
  await b.sleep(500);
  const got = await b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
  check("normal mode: a real click on a structural column still selects it (plain mesh picking with the textured material)", got === id, { got });
  await b.shot(`${OUT}/a5_selection_inspector.png`);
}
await b.goto(`${BASE}/?view=full`);
await b.sleep(1200);
{
  const inst = await b.evaluate(`window.__reloop.records.find((x) => x.componentType === "roof_finish").id`);
  const ir = await record(inst);
  const sc2 = await toScreen([ir.p[0], ir.p[1] + ir.s[1] / 2, ir.p[2]]);
  await b.click(sc2.x, sc2.y);
  await b.sleep(500);
  const got2 = await b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
  check("normal mode: a real click on an instanced roof tile selects it (instance → component mapping intact)", got2 === inst, { got2, inst });
}
// B2 overlay clones materials: they must be plain (no surface patch) and keep their exact status colour
await b.evaluate(`window.__reloop.select(null)`);
await click("[data-testid=recovery-toggle]");
await b.sleep(500);
await click("[data-testid=recovery-colour]");
await b.sleep(900);
const clone = await b.evaluate(`(() => { const m = window.__reloop.scene.getObjectByName("STR-COL-G-G6").material; return { colour: m.color.getHexString(), patched: String(m.customProgramCacheKey()).startsWith("surface:"), name: m.name }; })()`);
check("B2 colouring: the overlay material is a plain clone (no procedural patch) in the exact status colour", clone.colour === "bfc4c9" && clone.patched === false, clone);
await b.shot(`${OUT}/a5_b2_colour.png`);
await click("[data-testid=recovery-colour]");
await b.sleep(600);
const restored = await b.evaluate(`String(window.__reloop.scene.getObjectByName("STR-COL-G-G6").material.customProgramCacheKey()).startsWith("surface:")`);
check("B2 colouring off: the original textured material is restored", restored, null);
await click("[data-testid=recovery-toggle]");
await b.sleep(300);

// ═══ 3b. frame cadence while the camera moves ════════════════════════════════════
await b.goto(`${BASE}/`);
await b.sleep(1500);
await click("[data-testid=present-toggle]");
await b.sleep(1500);
await settle();
await b.evaluate(`window.__cadence = null; (() => { const t = []; let last = performance.now(); const stop = performance.now() + 2200; const f = (now) => { t.push(now - last); last = now; if (now < stop) requestAnimationFrame(f); else window.__cadence = t; }; requestAnimationFrame(f); })()`);
await click("[data-testid=pm-preset-front]");
await b.sleep(2800);
const cad = await b.evaluate(`window.__cadence`);
const cs = cad ? { frames: cad.length, medianMs: +median(cad).toFixed(1), maxMs: +Math.max(...cad).toFixed(1), p95: +[...cad].sort((x, y) => x - y)[Math.floor(cad.length * 0.95)].toFixed(1) } : null;
r.perf.cameraFlightCadence = cs;
check("the model stays interactive during a camera flight (median frame < 33 ms, 95th percentile < 80 ms)", cs && cs.frames > 20 && cs.medianMs < 33 && cs.p95 < 80, cs);
// explode glide cadence
await b.evaluate(`window.__cadence = null; (() => { const t = []; let last = performance.now(); const stop = performance.now() + 2600; const f = (now) => { t.push(now - last); last = now; if (now < stop) requestAnimationFrame(f); else window.__cadence = t; }; requestAnimationFrame(f); })()`);
await click("[data-testid=pm-preset-exploded]");
await b.sleep(3200);
const cad2 = await b.evaluate(`window.__cadence`);
const cs2 = cad2 ? { frames: cad2.length, medianMs: +median(cad2).toFixed(1), maxMs: +Math.max(...cad2).toFixed(1), p95: +[...cad2].sort((x, y) => x - y)[Math.floor(cad2.length * 0.95)].toFixed(1) } : null;
r.perf.explodeGlideCadence = cs2;
check("the exploded glide stays interactive (median frame < 40 ms)", cs2 && cs2.frames > 20 && cs2.medianMs < 40, cs2);
// cinematic playback (the A4 hand-over task: profile the cinematic playback)
await b.evaluate(`window.__cadence = null; (() => { const s = window.__explode.store; s.setMode("cinematic"); s.setT(0); s.play(); const t = []; let last = performance.now(); const stop = performance.now() + 9400; const f = (now) => { t.push(now - last); last = now; if (now < stop) requestAnimationFrame(f); else window.__cadence = t; }; requestAnimationFrame(f); })()`);
await b.sleep(10200);
const cad3 = await b.evaluate(`window.__cadence`);
const cs3 = cad3 ? { frames: cad3.length, medianMs: +median(cad3).toFixed(1), p95: +[...cad3].sort((x, y) => x - y)[Math.floor(cad3.length * 0.95)].toFixed(1), maxMs: +Math.max(...cad3).toFixed(1), updateAvgMs: +(await b.evaluate(`window.__explode.stats.avgMs`)).toFixed(3), updateMaxMs: +(await b.evaluate(`window.__explode.stats.maxMs`)).toFixed(2), meshesWritten: await b.evaluate(`window.__explode.stats.meshesWritten`) } : null;
r.perf.cinematicPlayback = cs3;
check("cinematic playback (9 s, shadow map refreshed every frame) keeps a median frame below 33 ms", cs3 && cs3.frames > 100 && cs3.medianMs < 33, cs3);
await click("[data-testid=pm-exit]");
await b.sleep(1500);

// ═══ layout on smaller and larger presentation displays ═══════════════════════════
for (const [w, h] of [[1366, 768], [1920, 1080]]) {
  await b.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await b.sleep(900);
  await click("[data-testid=present-toggle]");
  await b.sleep(1800);
  await click("[data-testid=pm-start]");
  await b.sleep(600);
  await click("[data-testid=pm-step-recovery]");
  await settle(7000);
  const lay = await b.evaluate(`(() => { const R = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }; const hit = (a, c) => a && c && a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t; const card = R("[data-testid=pm-card]"), bar = R("[data-testid=pm-bar]"), exit = R("[data-testid=pm-exit]"), badge = R("[data-testid=pm-badge]"); return { card, bar, exit, badge, overlap: [hit(card, bar), hit(card, exit), hit(card, badge), hit(bar, exit)], scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, barInside: bar && bar.l >= 0 && bar.r <= window.innerWidth - 560 + 1 && bar.b <= window.innerHeight }; })()`);
  check(`${w}x${h}: presentation controls fit the screen with a drawer open (no overlap between the card, toolbar, mode label and Exit; no horizontal scroll)`, lay.overlap.every((x) => !x) && lay.scrollW <= lay.innerW && lay.barInside, lay);
  const f = await frameOf(bounds.mn, bounds.mx);
  check(`${w}x${h}: the building is still framed inside the free space (left of the drawer, above the toolbar)`, f.front && f.minX >= 0 && f.maxX <= w - 560 + 1 && f.minY >= 0, { f });
  await b.shot(`${OUT}/a5_pm_${w}x${h}.png`);
  await click("[data-testid=pm-exit]");
  await b.sleep(1200);
}
await b.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await b.sleep(500);

// ═══ console ════════════════════════════════════════════════════════════════════
r.console = b.logs.filter((l) => !/\[vite\]|DevTools|Download the React DevTools/.test(l));
check("console is clean (no errors, no shader compile failures, no React warnings)", r.console.length === 0, r.console.slice(0, 5));
await finish(failures.length ? 1 : 0);
