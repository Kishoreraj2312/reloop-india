// A4 browser check (dev server on :5173, or BASE=http://localhost:PORT). Real clicks open the panel, pick modes and
// press Play / Fit / Isolate; range inputs get real input events; picking uses real mouse clicks at the projected
// DISPLAYED position of each component. Everything is asserted against the running app's scene graph through the dev-only
// hook window.__explode (canonical record position vs displayed position read from groups / instance matrices):
//   assembled == canonical (exact), floor / system / cinematic / assembly offsets (independent formulas), monotonic sweeps,
//   zero drift after a random sweep + Reset (bit-exact), picking and inspector after displacement, floor isolation, layer
//   toggles, X-ray, section clip, B2 colouring and B3 removal overlay on/off in both orders (hidden stays hidden, tints and
//   outlines follow), camera untouched by parameter changes and framed by Fit, reload leaves canonical data intact,
//   draw calls / triangles / frame cost before, during and after, clean console.
// Screenshots go to docs/screenshots/a4. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/a4";
const KEY_B3 = "rematter.removal.plans.v1";
const KEY_B2 = "rematter.recovery.assessments.v1";
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

// ── helpers ─────────────────────────────────────────────────────────────────────
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const disabled = (sel) => b.evaluate(`${q(sel)}?.disabled ?? null`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "nearest" })`); await b.sleep(80); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setRange = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(String(value))}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
const setRangeIfEnabled = async (sel, value) => { if ((await b.evaluate(`${q(sel)}?.disabled`)) === false) await setRange(sel, value); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const setInput = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; })()`);
const frame = (ms = 450) => b.sleep(ms);
const select = async (id) => { await b.evaluate(`window.__reloop.select(${JSON.stringify(id)})`); await frame(); };
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const sameSet = (a, c) => a.length === c.length && [...a].sort().join("|") === [...c].sort().join("|");
const near = (a, c, tol = 1e-4) => a.length === c.length && a.every((v, i) => Math.abs(v - c[i]) <= tol);
const exact = (a, c) => a.length === c.length && a.every((v, i) => Object.is(v, c[i]));
const positions = (ids) => b.evaluate(`window.__explode.positions(${JSON.stringify(ids)})`);
const groups = () => b.evaluate(`window.__explode.groups()`);
const cam = () => b.evaluate(`window.__reloop.camera.position.toArray()`);
const stats = (shadow = false) => b.evaluate(`window.__reloop.stats(${shadow})`);
const st = () => b.evaluate(`({ t: window.__explode.store.liveT(), ...window.__explode.store.get().params, playing: window.__explode.store.get().playing })`);
const sub = (a, c) => a.map((v, i) => v - c[i]);

const snapExpr = `(() => {
  const root = window.__reloop.scene.getObjectByName("Building_G4");
  let h = 0, hidden = 0, tints = 0, colours = 0, mats = 0;
  const mix = (v) => { h = (Math.imul(h, 31) + Math.round(v * 1e4)) | 0; };
  const mixS = (s) => { for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; };
  root.traverse((o) => {
    if (o.name === "__removal") { tints++; return; }
    if (o.name.endsWith("__selection")) return;
    if (o.isMesh) {
      if (!o.visible) hidden++;
      mix(o.visible ? 1 : 0);
      if (o.instanceColor) colours++;
      mixS(o.material.uuid); mats++;
      if (o.isInstancedMesh && Array.isArray(o.userData.componentIds)) { const a = o.instanceMatrix.array; for (let i = 0; i < a.length; i++) mix(a[i]); mix(o.count); }
    }
    if (o.position && (/^Floor_/.test(o.name) || /^(FDN|L[0-4]|ROOF)_/.test(o.name))) { mix(o.position.x); mix(o.position.y); mix(o.position.z); }
  });
  return { hash: h, hidden, tints, colours, mats };
})()`;
const snap = () => b.evaluate(snapExpr);
const ease = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const windowed = (t, [a, c]) => Math.min(1, Math.max(0, (t - a) / (c - a)));
const FLOOR_REL = (rec) => Math.max(-1, rec.floor);

// ── 0. baseline: A4 has never been opened ────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await b.evaluate(`localStorage.removeItem(${JSON.stringify(KEY_B3)}); localStorage.removeItem(${JSON.stringify(KEY_B2)})`);
await b.goto(`${BASE}/?view=full`);
await frame(900);
const snap0 = await snap();
r.statsBefore = await stats(false);
r.statsBeforeShadow = await stats(true);
const renderMs = (shadow, n = 15) => b.evaluate(`(() => { const { gl, scene, camera } = window.__reloop; const ctx = gl.getContext(); const ts = []; for (let i = 0; i < ${n}; i++) { gl.shadowMap.needsUpdate = ${shadow}; const t0 = performance.now(); gl.render(scene, camera); ctx.finish(); ts.push(performance.now() - t0); } ts.sort((a, b) => a - b); return +ts[Math.floor(ts.length / 2)].toFixed(1); })()`);
r.renderMsBefore = await renderMs(false);
const idleBefore = await b.evaluate(`(async () => { let n = 0; const g = window.__reloop.gl; const o = g.render.bind(g); g.render = (...a) => { n++; return o(...a); }; await new Promise((r) => setTimeout(r, 800)); g.render = o; return n; })()`);
check("A4 hook is available and the viewer is idle (0 frames) before A4 is opened", idleBefore === 0 && (await exists("[data-testid=explode-toggle]")), { idleBefore });
const cam0 = await cam();
const sample = await b.evaluate(`(() => {
  const m = window.__explode.model(); const drawn = m.records.filter((r) => r.geometry.kind !== "group"); const out = new Set();
  for (let i = 0; i < drawn.length; i += Math.floor(drawn.length / 56)) out.add(drawn[i].id);
  for (const id of ["STR-FTG-G-A1", "STR-COL-G-A1", "STR-COL-F02-A1", "STR-SLAB-RF-P01", "ARC-WALL-F02-EXT-S-C1-D1-P01", "ARC-FAC-F02-S-FIN-D1", "PLB-CW-F01-A1-P001", "ELC-CND-F03-A1-J001"]) out.add(id);
  for (const t of ["window_assembly", "door_assembly", "kitchen_assembly", "floor_finish_assembly", "bathroom_assembly", "balcony_assembly", "wall_tiling_assembly", "distribution_board_assembly"]) { const a = m.assemblies.find((x) => x.type === t); out.add(a.members[1] ?? a.members[0]); out.add(a.members[a.members.length - 1]); }
  return [...out];
})()`);
const rec = await b.evaluate(`Object.fromEntries(${JSON.stringify(sample)}.map((id) => { const r = window.__explode.model().byId.get(id); return [id, { floor: r.floor, system: r.system, type: r.componentType, asm: window.__explode.model().memberAssembly.get(id) ?? null }]; }))`);
const asmOf = (id) => b.evaluate(`(() => { const m = window.__explode.model(); const a = m.memberAssembly.get(${JSON.stringify(id)}); return a === undefined ? null : { layers: m.assemblies[a].layerCount, strategy: m.assemblies[a].strategy, unit: m.memberUnit.get(${JSON.stringify(id)}) }; })()`);
const disp0 = await positions(sample);
const recordsHash = () => b.evaluate(`(() => { let h = 0; for (const r of window.__explode.model().records) { const s = r.id + r.floor + r.originalPosition.join() + r.dependencies.join() + (r.parentId ?? "") + r.quantity; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return h; })()`);
const rec0 = await recordsHash();
check("sample covers all four systems, plain and instanced components, and decomposable members", sample.length > 60 && ["structure", "architecture", "plumbing", "electrical"].every((s) => Object.values(rec).some((x) => x.system === s)) && Object.values(rec).filter((x) => x.asm !== null).length >= 12, { n: sample.length });
r.sampleSize = sample.length;

// ── 1. open A4 (real click); the assembled view is untouched ───────────────────────────────────
await click("[data-testid=explode-toggle]");
await frame(900);
check("panel opens", await exists("[data-testid=explode-panel]"));
const openStats = await stats(false);
check("opening at progress 0 changes neither draw calls nor triangles", openStats.drawCalls === r.statsBefore.drawCalls && openStats.triangles === r.statsBefore.triangles, { openStats, before: r.statsBefore });
const dOpen = await positions(sample);
check("assembled: every displayed position is exactly the position before A4 was opened", dOpen.every((p, i) => exact(p.displayed, disp0[i].displayed)));
check("assembled: every group is at exactly (0, 0, 0)", (await groups()).every((g) => g.position.every((v) => Object.is(v, 0))));
check("the mode buttons and the explanation are present", (await exists("[data-testid=explode-mode-cinematic]")) && /display transform/.test((await text("[data-testid=explode-panel]")) ?? ""));
check("progress is disabled while assembled, with a one-line reason", (await disabled("[data-testid=explode-progress]")) === true && /Choose Floors, Systems/.test((await text("[data-testid=explode-why]")) ?? ""), await text("[data-testid=explode-why]"));
check("distance controls are disabled while assembled", (await disabled("[data-testid=explode-floor-gap]")) === true && (await disabled("[data-testid=explode-system-gap]")) === true);
await b.shot(`${OUT}/a4_assembled.png`);

// ── 2. floors ─────────────────────────────────────────────────────────────────────────────────
await click("[data-testid=explode-mode-floors]");
await setRange("[data-testid=explode-progress]", 500);
await frame();
let d = await positions(sample);
let t = (await st()).t;
check("floors: slider moved the progress to 50 %", Math.abs(t - 0.5) < 1e-9 && /50%/.test((await text("[data-testid=explode-progress-label]")) ?? ""));
check("floors @50 %: every component moved by exactly floorIndex x 6 m x ease(0.5), vertically only (plain meshes and instances)", d.every((p, i) => near(sub(p.displayed, disp0[i].displayed), [0, FLOOR_REL(rec[p.id]) * 6 * ease(0.5), 0], 1e-4)), d.filter((p, i) => !near(sub(p.displayed, disp0[i].displayed), [0, FLOOR_REL(rec[p.id]) * 6 * ease(0.5), 0], 1e-4)).slice(0, 3));
await b.shot(`${OUT}/a4_floors_partial.png`);
await setRange("[data-testid=explode-progress]", 1000);
await frame();
d = await positions(sample);
check("floors @100 %: offsets are floorIndex x 6 m (foundation down, roof up)", d.every((p, i) => near(sub(p.displayed, disp0[i].displayed), [0, FLOOR_REL(rec[p.id]) * 6, 0], 1e-4)));
check("floors: the engine's offset and the scene agree for every sample (hook)", d.every((p, i) => near(sub(p.displayed, disp0[i].displayed), p.offset, 1e-4)));
const gr = await groups();
check("floors: only the Floor_* groups moved; no system group did", gr.filter((g) => !/^Floor_/.test(g.name)).every((g) => g.position.every((v) => v === 0)) && gr.find((g) => g.name === "Floor_ROOF").position[1] === 30 && gr.find((g) => g.name === "Floor_FDN").position[1] === -6, gr.filter((g) => /^Floor_/.test(g.name)));
await click("[data-testid=explode-fit]");
await frame(700);
await b.shot(`${OUT}/a4_floors_full.png`);

// ── 3. systems ────────────────────────────────────────────────────────────────────────────────
await click("[data-testid=explode-mode-systems]");
await frame();
d = await positions(sample);
const sysDelta = {};
for (const p of d) {
  const o = sub(p.displayed, disp0[d.indexOf(p)].displayed);
  const sys = rec[p.id].system;
  if (!sysDelta[sys]) sysDelta[sys] = o;
  sysDelta[sys].ok = (sysDelta[sys].ok ?? true) && near(o, sysDelta[sys].slice(0, 3), 1e-4);
}
check("systems @100 %: all components of a system move by the same horizontal vector, whatever floor they are on", Object.values(sysDelta).every((v) => v.ok) && Object.values(sysDelta).every((v) => Math.abs(v[1]) < 1e-9), sysDelta);
const deltas = Object.values(sysDelta).map((v) => v.slice(0, 3).map((x) => Math.round(x * 100)).join(","));
check("systems: the four systems are displaced to four different places", new Set(deltas).size === 4 && Object.keys(sysDelta).length === 4, deltas);
await setRange("[data-testid=explode-progress]", 300);
await frame();
const d3 = await positions(sample);
check("systems @30 %: the same vectors scaled by ease(0.3)", d3.every((p, i) => { const s = rec[p.id].system; return near(sub(p.displayed, disp0[i].displayed), sysDelta[s].slice(0, 3).map((x) => x * ease(0.3)), 1e-4); }));
await setRange("[data-testid=explode-progress]", 1000);
await frame();
const grS = await groups();
check("systems: only the <floor>_<system> groups moved, identical for every floor", grS.filter((g) => /^Floor_/.test(g.name)).every((g) => g.position.every((v) => v === 0)) && ["structure", "architecture", "plumbing", "electrical"].every((s) => new Set(grS.filter((g) => g.name.endsWith("_" + s)).map((g) => g.position.join())).size === 1));
await click("[data-testid=explode-fit]");
await frame(700);
await b.shot(`${OUT}/a4_systems_full.png`);
await setSelect("[data-testid=explode-layout]", "row-x");
await frame();
const dRow = await positions(sample);
check("systems: switching the layout to a row along X moves systems along X only", dRow.every((p, i) => { const o = sub(p.displayed, disp0[i].displayed); return Math.abs(o[1]) < 1e-9 && Math.abs(o[2]) < 1e-9; }));
await b.shot(`${OUT}/a4_systems_row.png`);
await setSelect("[data-testid=explode-layout]", "grid");
await frame();

// ── 4. cinematic: staged and monotonic ──────────────────────────────────────────────────────────
await click("[data-testid=explode-mode-cinematic]");
const ph = await b.evaluate(`window.__explode.store.config.phases`);
const undecomposed = sample.filter((id) => rec[id].asm === null);
const decomposed = sample.filter((id) => rec[id].asm !== null);
const unitsOf = {};
for (const id of decomposed) unitsOf[id] = await asmOf(id);
let prevY = -1, prevSpread = -1, prevAsm = -1, stagedOk = true, monoOk = true;
const stagedFails = [];
for (let i = 0; i <= 20; i++) {
  const tt = i / 20;
  await setRange("[data-testid=explode-progress]", Math.round(tt * 1000));
  await b.sleep(120);
  const dd = await positions(sample);
  const top = dd.find((p) => p.id === "STR-SLAB-RF-P01");
  const topY = top.displayed[1] - disp0[sample.indexOf(top.id)].displayed[1];
  const ex = { f: ease(windowed(tt, ph.floors)), s: ease(windowed(tt, ph.systems)), a: ease(windowed(tt, ph.assemblies)) };
  // independent expectation for the undecomposed components: floor y + system xz
  for (const id of undecomposed) {
    const p = dd.find((x) => x.id === id); const o = sub(p.displayed, disp0[sample.indexOf(id)].displayed);
    const want = [sysDelta[rec[id].system][0] * ex.s, FLOOR_REL(rec[id]) * 6 * ex.f, sysDelta[rec[id].system][2] * ex.s];
    if (!near(o, want, 1e-3)) { stagedOk = false; stagedFails.push({ tt, id, o, want }); break; }
  }
  const spread = Math.hypot(...sub(dd.find((p) => p.id === "STR-COL-G-A1").displayed, dd.find((p) => p.id === "PLB-CW-F01-A1-P001").displayed));
  // assembly decomposition of members: displaced along their unit axis by the independent factor
  let asmMax = 0;
  for (const id of decomposed) {
    const p = dd.find((x) => x.id === id); const o = sub(sub(p.displayed, disp0[sample.indexOf(id)].displayed), [sysDelta[rec[id].system][0] * ex.s, FLOOR_REL(rec[id]) * 6 * ex.f, sysDelta[rec[id].system][2] * ex.s]);
    const u = unitsOf[id]; const k = (u.strategy === "layers" ? Math.min(0.3, 1.5 / Math.max(1, u.layers - 1)) : 0.3 * 2) * ex.a;
    const want = u.unit.map((x) => x * k);
    if (!near(o, want, 2e-3)) { stagedOk = false; stagedFails.push({ tt, id, o, want, type: rec[id].type }); break; }
    asmMax = Math.max(asmMax, Math.hypot(...o));
  }
  if (topY < prevY - 1e-9 || spread < prevSpread - 1e-9 || asmMax < prevAsm - 1e-9) monoOk = false;
  prevY = topY; prevSpread = spread; prevAsm = asmMax;
  if (tt === 0.2) check("cinematic @20 %: floors are moving, systems and assemblies have not started", ex.f > 0 && ex.s === 0 && ex.a === 0 && ease(windowed(0.2, ph.floors)) > 0.4);
}
check("cinematic sweep (21 steps): every component sits at its independently computed displaced position (floor, then system, then assembly)", stagedOk, stagedFails.slice(0, 2));
check("cinematic sweep: separation grows monotonically (roof lift, system spread, assembly spread)", monoOk);
await setRange("[data-testid=explode-progress]", 1000);
await frame();
await click("[data-testid=explode-fit]");
await frame(700);
await b.shot(`${OUT}/a4_cinematic_full.png`);
r.cinematicFullBounds = await b.evaluate(`window.__explode.bounds()`);

// fit frames the displayed model inside the free area above the bar
const projCorners = () => b.evaluate(`(() => { const bx = window.__explode.bounds(); const cam = window.__reloop.camera; const V = new (cam.position.constructor)(); const out = []; for (const x of [bx.min[0], bx.max[0]]) for (const y of [bx.min[1], bx.max[1]]) for (const z of [bx.min[2], bx.max[2]]) { V.set(x, y, z).project(cam); out.push({ x: (V.x * 0.5 + 0.5) * window.__reloop.gl.domElement.getBoundingClientRect().width + window.__reloop.gl.domElement.getBoundingClientRect().left, y: (-V.y * 0.5 + 0.5) * window.__reloop.gl.domElement.getBoundingClientRect().height + window.__reloop.gl.domElement.getBoundingClientRect().top }); } return out; })()`);
// the shell's viewport is the free area (the panels live in the sidebar and the dock beside it, not over the canvas)
const vpRect = () => b.evaluate(`(() => { const r = document.querySelector("[data-testid=viewport]").getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })()`);
const vp = await vpRect();
const corners = await projCorners();
check("fit: every corner of the displayed bounds is on screen, inside the viewport", corners.every((c) => c.x >= vp.left && c.x <= vp.right && c.y >= vp.top && c.y <= vp.bottom), { vp, corners: corners.map((c) => [Math.round(c.x), Math.round(c.y)]) });
const camFit = await cam();
await setRange("[data-testid=explode-progress]", 400);
await frame();
await setRange("[data-testid=explode-progress]", 1000);
await frame();
check("changing the explosion never moves the camera (only Fit / Focus do)", exact(await cam(), camFit));

// ── 5. assembly focus ───────────────────────────────────────────────────────────────────────────
await click("[data-testid=explode-mode-assembly]");
await frame();
check("assembly mode without a chosen assembly: progress disabled and says why", (await disabled("[data-testid=explode-progress]")) === true && /Choose an assembly first/.test((await text("[data-testid=explode-why]")) ?? ""));
const win = await b.evaluate(`window.__explode.model().assemblies.find((a) => a.type === "window_assembly" && a.floor === "L2")`);
const winMember = win.members.find((id) => id.endsWith("GLZ01")) ?? win.members[0];
await select(winMember);
const note = (await text("[data-testid=explode-selection-note]")) ?? "";
check("selecting a window part names its assembly, member count, layers and rule", note.includes(win.id) && note.includes(`${win.members.length} members`) && note.includes(`can be decomposed: ${win.layerCount} layers`) && /host wall/.test(note), note);
await click("[data-testid=explode-focus-assembly]");
await frame(300);
check("Focus this assembly chooses it and enables the progress", /focused:/.test((await text("[data-testid=explode-focus]")) ?? "") && (await disabled("[data-testid=explode-progress]")) === false);
await setRange("[data-testid=explode-progress]", 1000);
await frame();
const memPos = await positions(win.members);
const outsiders = await positions(sample.filter((id) => !win.members.includes(id)));
check("assembly focus: the window's members moved (3+ distinct offsets along the wall normal); nothing else did", memPos.filter((p) => !near(p.offset, [0, 0, 0], 1e-9)).length >= 12 && new Set(memPos.map((p) => p.offset.map((v) => v.toFixed(3)).join())).size >= 3 && outsiders.every((p) => near(p.offset, [0, 0, 0], 1e-9)), memPos.map((p) => p.offset));
const ax = win.axis.findIndex((v) => v !== 0);
check("window layers move along the host wall's normal axis only", memPos.every((p) => p.offset.every((v, k) => k === ax || v === 0)), { axis: win.axis });
const lookFromOutside = (id) => b.evaluate(`(() => { const m = window.__explode.model(); const p = window.__explode.positions([${JSON.stringify(id)}])[0].displayed; window.__reloop.setView([p[0] + 8, p[1] + 3, p[2] - 9], p); })()`); // south-east of the facade, looking north-west: the layers (which run along the wall normal) show side-on
await lookFromOutside(winMember);
await frame(500);
const camBeforeFrame = await cam();
await click("[data-testid=explode-frame-assembly]");
await frame(700);
check("Frame assembly moved the camera (a user request) and keeps the view direction", !exact(await cam(), camBeforeFrame));
await click("[data-testid=explode-assembly] summary");
const memberList = (await text("[data-testid=explode-members]")) ?? "";
check("the members list shows all members of the focused assembly", memberList.split("\n").length === win.members.length && memberList.includes(winMember), { listed: memberList.split("\n").length, members: win.members.length });
await click("[data-testid=explode-members] button");
await frame();
check("clicking a member in the list selects it (inspector)", (await inspectorId()) === memberList.split("\n")[0], await inspectorId());
await select(winMember);
await b.shot(`${OUT}/a4_assembly_window.png`);
const traceLines = () => b.evaluate(`(() => { let n = null; window.__reloop.scene.traverse((o) => { if (o.name === "__explode_trace") n = { lines: o.geometry.getAttribute("position").count / 2, visible: o.visible }; }); return n; })()`);
check("trace lines are off by default", (await traceLines()) === null);
await click("[data-testid=explode-traces]");
await frame(500);
const tl = await traceLines();
check("trace lines (opt-in): one line per member of the focused assembly, only while it is decomposed", tl && tl.lines === win.members.length && tl.visible === true, tl);
await b.shot(`${OUT}/a4_traces.png`);
await click("[data-testid=explode-traces]");
await frame(300);
check("switching trace lines off removes them", (await traceLines()) === null);
const kit = await b.evaluate(`window.__explode.model().assemblies.find((a) => a.type === "kitchen_assembly" && a.floor === "L1").id`);
await select(kit);
await click("[data-testid=explode-focus-assembly]");
await frame(300);
await b.evaluate(`(() => { const p = window.__explode.positions([${JSON.stringify(kit)}].length ? window.__explode.model().assemblyMembers.get(${JSON.stringify(kit)}).slice(0, 1) : [])[0].displayed; window.__reloop.setView([p[0] + 6, p[1] + 5, p[2] + 6], p); })()`);
await frame(400);
await click("[data-testid=explode-frame-assembly]");
await frame(700);
await b.shot(`${OUT}/a4_assembly_kitchen.png`);
const unsupportedId = "STR-COL-F02-A1";
await select(unsupportedId);
check("a structural member: decomposition is disabled with the reason (no assembly records)", (await disabled("[data-testid=explode-focus-assembly]")) === true && /no assembly records/.test((await text("[data-testid=explode-selection-note]")) ?? ""), await text("[data-testid=explode-selection-note]"));
await select("ARC-WALL-F02-EXT-S-C1-D1");
check("a wall assembly: disabled with its reason", (await disabled("[data-testid=explode-focus-assembly]")) === true && /single plane/.test((await text("[data-testid=explode-selection-note]")) ?? ""), await text("[data-testid=explode-selection-note]"));
await select("PLB-DR-F02-A2-P010");
check("a pipe: disabled with the network-container reason", (await disabled("[data-testid=explode-focus-assembly]")) === true && /network container/.test((await text("[data-testid=explode-selection-note]")) ?? ""), await text("[data-testid=explode-selection-note]"));
await click("[data-testid=explode-more]");
check("'what can be decomposed' lists the supported count and every unsupported group with its reason", /1,406 of 3,015 assemblies/.test((await text("[data-testid=explode-support]")) ?? "") && /945 structure components/.test((await text("[data-testid=explode-support]")) ?? "") && /902 wall assembly/.test((await text("[data-testid=explode-support]")) ?? ""), (await text("[data-testid=explode-support]"))?.slice(0, 300));
await click("[data-testid=explode-more]");

// ── 6. picking and inspector after displacement (real clicks at the displayed position) ──────────
await click("[data-testid=explode-mode-cinematic]");
await setRange("[data-testid=explode-progress]", 1000);
await frame();
const LAYER_ONLY = { "STR-COL-F02-A1": ["structure"], "ARC-WALL-F02-EXT-S-C1-D1-P01": ["exteriorWalls"], "ARC-WIN-F02-A2-BED1-S-01-GLZ01": ["openings"], "ARC-FAC-F02-S-FIN-D1": ["balconiesFacade"], "PLB-CW-F01-A1-P001": ["plumbing"], "ELC-CND-F03-A1-J001": ["electrical"] };
const setLayers = async (on) => {
  for (const l of await b.evaluate(`[...document.querySelectorAll("input[data-layer]")].map((e) => e.dataset.layer)`)) {
    const want = on.includes(l);
    if ((await b.evaluate(`${q(`input[data-layer=${l}]`)}.checked`)) !== want) await click(`input[data-layer=${l}]`);
  }
};
const picks = [];
for (const [id, layers] of Object.entries(LAYER_ONLY)) {
  await select(null);
  await setLayers(layers);
  const p = (await positions([id]))[0];
  await b.evaluate(`window.__reloop.setView([${p.displayed[0]} - 1.2, ${p.displayed[1]} + 1.1, ${p.displayed[2]} - 3.2], [${p.displayed[0]}, ${p.displayed[1]}, ${p.displayed[2]}])`);
  await frame(700);
  const s = await b.evaluate(`(() => { const c = window.__reloop.camera; const V = new (c.position.constructor)(${p.displayed[0]}, ${p.displayed[1]}, ${p.displayed[2]}); V.project(c); return { x: (V.x * 0.5 + 0.5) * window.__reloop.gl.domElement.getBoundingClientRect().width + window.__reloop.gl.domElement.getBoundingClientRect().left, y: (-V.y * 0.5 + 0.5) * window.__reloop.gl.domElement.getBoundingClientRect().height + window.__reloop.gl.domElement.getBoundingClientRect().top }; })()`);
  await b.click(s.x, s.y);
  const got = await inspectorId();
  const info = (await text("[data-testid=explode-info]")) ?? "";
  picks.push({ id, got, ok: got === id, info });
}
check("picking: a real click at each component's DISPLAYED position selects that component (plain mesh and instances, 4 systems)", picks.every((x) => x.ok), picks);
check("the inspector shows the exploded-view line with the displacement", picks.every((x) => /exploded view:/.test(x.info) && /Δ \(/.test(x.info)), picks.map((x) => x.info));
// the canonical position no longer picks the component
await select(null);
await setLayers(["structure"]);
const pc = (await positions(["STR-COL-F02-A1"]))[0];
await b.evaluate(`window.__reloop.setView([${pc.canonical[0]} - 1.2, ${pc.canonical[1]} + 1.1, ${pc.canonical[2]} - 3.2], [${pc.canonical[0]}, ${pc.canonical[1]}, ${pc.canonical[2]}])`);
await frame(600);
const mid = await b.evaluate(`(() => { const c = window.__reloop.gl.domElement.getBoundingClientRect(); return { x: c.left + c.width / 2, y: c.top + c.height / 2 }; })()`); // the camera is aimed at the column's old position: the centre of the viewport
await b.click(mid.x, mid.y);
check("picking is exact: clicking where the column used to be no longer selects it", (await inspectorId()) !== "STR-COL-F02-A1", await inspectorId());
await setLayers(await b.evaluate(`[...document.querySelectorAll("input[data-layer]")].map((e) => e.dataset.layer)`));

// ── 7. isolate a floor while exploded, layer toggles, X-ray ────────────────────────────────────────
await click("[data-testid=explode-fit]");
await frame(600);
await select("STR-COL-F02-A1");
const beforeIso = (await positions(["STR-COL-F02-A1"]))[0];
await click("[data-testid=explode-isolate-floor]");
await frame(600);
const afterIso = (await positions(["STR-COL-F02-A1"]))[0];
check("isolating a floor (existing mechanism) hides the others and keeps it at its exploded position", (await b.evaluate(`window.__reloop.scene.getObjectByName("Floor_L2").visible`)) === true && (await b.evaluate(`window.__reloop.scene.getObjectByName("Floor_L3").visible`)) === false && exact(beforeIso.displayed, afterIso.displayed) && afterIso.displayed[1] - afterIso.canonical[1] > 11.9);
check("selection survives the isolation", (await inspectorId()) === "STR-COL-F02-A1");
await click("[data-testid=explode-fit]");
await frame(700);
const isoBox = await b.evaluate(`(() => { const m = window.__explode.model(); const s = window.__explode.solver(); const o = s.floorOffsetOf("L2"); const bx = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; for (const c of m.cells) if (c.floor === "L2") for (let i = 0; i < 3; i++) { bx.min[i] = Math.min(bx.min[i], c.bounds.min[i] + o[i] + s.systemOffsetOf(c.system)[i]); bx.max[i] = Math.max(bx.max[i], c.bounds.max[i] + o[i] + s.systemOffsetOf(c.system)[i]); } const cam = window.__reloop.camera; const V = new (cam.position.constructor)(); const ys = [], xs = []; for (const x of [bx.min[0], bx.max[0]]) for (const y of [bx.min[1], bx.max[1]]) for (const z of [bx.min[2], bx.max[2]]) { V.set(x, y, z).project(cam); xs.push((V.x * 0.5 + 0.5) * window.__reloop.gl.domElement.getBoundingClientRect().width + window.__reloop.gl.domElement.getBoundingClientRect().left); ys.push((-V.y * 0.5 + 0.5) * window.__reloop.gl.domElement.getBoundingClientRect().height + window.__reloop.gl.domElement.getBoundingClientRect().top); } return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; })()`);
const vpIso = await vpRect();
check("fit with floor 2 isolated (and a component selected) frames that floor alone inside the viewport, filling most of it", isoBox.x0 >= vpIso.left - 2 && isoBox.x1 <= vpIso.right && isoBox.y0 >= vpIso.top && isoBox.y1 <= vpIso.bottom && ((isoBox.x1 - isoBox.x0) / (vpIso.right - vpIso.left) > 0.6 || (isoBox.y1 - isoBox.y0) / (vpIso.bottom - vpIso.top) > 0.6), { isoBox, vpIso });
await b.shot(`${OUT}/a4_floor_isolated.png`);
await click("[data-testid=explode-isolate-system]");
await frame(500);
check("isolating the system of the selection switches the other layers off (existing layer toggles)", (await b.evaluate(`[...document.querySelectorAll("input[data-layer]")].filter((e) => e.checked).map((e) => e.dataset.layer)`)).join() === "structure");
await click("[data-testid=explode-show-all]");
await frame(500);
check("Show all restores every floor and layer and keeps the selection", (await b.evaluate(`[...document.querySelectorAll("input[data-layer]")].every((e) => e.checked)`)) && (await b.evaluate(`window.__reloop.scene.getObjectByName("Floor_L3").visible`)) && (await inspectorId()) === "STR-COL-F02-A1" && (await disabled("[data-testid=explode-show-all]")) === true);
const dLayer0 = await positions(sample);
await click("input[data-layer=exteriorWalls]");
await frame();
const dLayer1 = await positions(sample);
check("a layer toggle hides its groups and moves nothing", (await b.evaluate(`window.__reloop.scene.getObjectByName("L2_architecture_exteriorWalls").visible`)) === false && dLayer0.every((p, i) => exact(p.displayed, dLayer1[i].displayed)));
await click("input[data-layer=exteriorWalls]");
await click("[data-testid=xray]");
await frame(600);
const dX = await positions(sample);
check("X-ray ghosts the materials and moves nothing", (await b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.isMesh && o.material && o.material.opacity < 0.2 && o.material.transparent) n++; }); return n; })()`)) > 20 && dLayer0.every((p, i) => exact(p.displayed, dX[i].displayed)));
await click("[data-testid=explode-fit]");
await frame(600);
await b.shot(`${OUT}/a4_xray_exploded.png`);
await click("[data-testid=xray]");

// ── 8. B2 colouring and the B3 removal overlay, on and off, in both orders ───────────────────────────
const sCol = "STR-COL-F02-A1";
await select(sCol);
await click("[data-testid=recovery-toggle]");
await frame(700);
await select(sCol);
await setSelect("[data-testid=rec-classification]", "direct_reuse");
await frame(300);
await setInput("[data-testid=rec-pct]", "60");
await b.evaluate(`${q("[data-testid=rec-pct]")}.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
await frame(300);
await click("[data-testid=recovery-colour]");
await frame(900);
const colourOf = (id) => b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(id)})?.material?.color?.getHexString() ?? null`);
check("B2 colouring is on while exploded (the column is green) and the explosion is unchanged", (await colourOf(sCol)) === "009e73" && near((await positions([sCol]))[0].displayed, afterIso.displayed, 1e-9));
const instColour = await b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.isInstancedMesh && o.instanceColor && Array.isArray(o.userData.componentIds)) n++; }); return n; })()`);
check("B2 colours the instanced batches too while their members are displaced", instColour > 100, instColour);
await click("[data-testid=explode-fit]");
await frame(700);
await b.shot(`${OUT}/a4_b2_colour_exploded.png`);
const b2Stored = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY_B2)})`);
await click("[data-testid=recovery-toggle]");
await frame(300);

// B3: a plan with a window assembly (instanced, decomposed), a door assembly (instanced) and a slab (plain mesh)
await click("[data-testid=removal-toggle]");
await frame(900);
await click("[data-testid=plan-new]");
await frame(500);
check("B2 colouring is suspended by the B3 overlay (exactly as before A4) while the view is exploded", (await colourOf(sCol)) !== "009e73", await colourOf(sCol));
const door = await b.evaluate(`window.__explode.model().assemblies.find((a) => a.type === "door_assembly" && a.floor === "L2")`);
for (const id of [win.id, door.id, "STR-SLAB-F02-P01"]) {
  await select(id);
  await click("[data-testid=add-selected]");
}
check("the B3 plan holds a window assembly and a door assembly (instanced) and a slab (plain mesh)", sameSet(await b.evaluate(`window.__removal.activePlan().entries`), [win.id, door.id, "STR-SLAB-F02-P01"]));
await b.evaluate(`window.__explode.store.setT(1)`);
await frame(500);
await click("[data-testid=removal-next]"); // the first entry (the window assembly) is simulated as removed: its 19 members are hidden
await frame(700);
const hiddenIds = await b.evaluate(`window.__removalOverlay?.hidden ?? null`);
check("B3 hides the window's members while the view is exploded", hiddenIds && sameSet(hiddenIds, win.members), hiddenIds?.length);
const zeroScale = (id) => b.evaluate(`(() => { let res = null; window.__reloop.scene.traverse((o) => { if (res !== null || !o.isInstancedMesh || !Array.isArray(o.userData.componentIds)) return; const i = o.userData.componentIds.indexOf(${JSON.stringify(id)}); if (i < 0) return; const a = o.instanceMatrix.array; res = a[i * 16] === 0 && a[i * 16 + 5] === 0 && a[i * 16 + 10] === 0; }); return res; })()`);
const hiddenNow = await positions(win.members);
check("the hidden members are zero-scale (invisible) yet carry the explosion's translation", (await Promise.all(win.members.map(zeroScale))).every((v) => v === true) && hiddenNow.every((p) => near(sub(p.displayed, p.canonical), p.offset, 1e-3)) && hiddenNow.some((p) => p.offset.some((v) => v !== 0)));
const overlayWorld = () => b.evaluate(`(() => { const out = []; window.__reloop.scene.traverse((o) => { if (o.name === "__removal" && o.isInstancedMesh) { o.updateWorldMatrix(true, false); const v = new (o.position.constructor)(); const a = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) { v.set(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]).applyMatrix4(o.matrixWorld); out.push(v.toArray()); } } }); return out; })()`);
const tintsFollow = async () => {
  const w = await overlayWorld();
  const dm = await positions(door.members);
  return { n: w.length, ok: dm.every((p) => w.some((q) => near(q, p.displayed, 1e-3))), moved: dm.some((p) => p.offset.some((v) => v !== 0)) };
};
const tf1 = await tintsFollow();
check("B3 tints of a displaced instanced assembly sit exactly on its members (they follow the explosion)", tf1.ok && tf1.moved && tf1.n >= door.members.length, tf1);
await b.evaluate(`window.__explode.store.setT(0.8)`);
await frame(500);
const tf2 = await tintsFollow();
check("...and keep following when the explosion changes (no stale tints)", tf2.ok && tf2.n >= door.members.length && (await Promise.all(win.members.map(zeroScale))).every((v) => v === true), tf2);
await b.evaluate(`window.__explode.store.setT(1)`);
await frame(500);
await select(sCol);
await click("[data-testid=explode-fit]");
await frame(700);
await b.shot(`${OUT}/a4_b3_overlay_exploded.png`);
await click("[data-testid=removal-close]");
await frame(700);
const snapB3off = await snap();
check("closing B3 restores the hidden members (linear part only) and leaves the explosion in place", (await Promise.all(win.members.map(zeroScale))).every((v) => v === false) && snapB3off.tints === 0 && (await positions(win.members)).every((p) => near(sub(p.displayed, p.canonical), p.offset, 1e-3)));
await select(win.members[5]);
await frame(500);
const outlinePos = await b.evaluate(`(() => { const id = ${JSON.stringify(win.members[5])}; const res = []; window.__reloop.scene.traverse((o) => { if (o.name === id + "__selection") { o.updateWorldMatrix(true, false); const v = new (o.position.constructor)(); v.setFromMatrixPosition(o.matrixWorld); res.push(v.toArray()); } }); return res; })()`);
const memberDisp = (await positions([win.members[5]]))[0].displayed;
check("the selection outline follows a displaced instanced member (same world position as the member)", outlinePos.length === 2 && outlinePos.every((p) => near(p, memberDisp, 1e-3)), { outlinePos, memberDisp });
await setRange("[data-testid=explode-progress]", 700);
await frame(500);
const outline2 = await b.evaluate(`(() => { const id = ${JSON.stringify(win.members[5])}; const res = []; window.__reloop.scene.traverse((o) => { if (o.name === id + "__selection") { o.updateWorldMatrix(true, false); const v = new (o.position.constructor)(); v.setFromMatrixPosition(o.matrixWorld); res.push(v.toArray()); } }); return res; })()`);
const memberDisp2 = (await positions([win.members[5]]))[0].displayed;
check("...and keeps following while the explosion is changed with the member selected", outline2.length === 2 && outline2.every((p) => near(p, memberDisp2, 1e-3)) && !near(memberDisp2, memberDisp, 1e-3), { outline2, memberDisp, memberDisp2 });
await setRange("[data-testid=explode-progress]", 1000);
await frame(400);
await select(null);
// B2 off again, in the opposite order to how it was switched on
await click("[data-testid=recovery-toggle]");
await frame(600);
await click("[data-testid=recovery-colour]");
await frame(700);
check("B2 colouring off: the original materials are back, nothing left behind (exploded)", (await colourOf(sCol)) !== "009e73" && (await b.evaluate(`(() => { let n = 0; window.__reloop.scene.traverse((o) => { if (o.isInstancedMesh && o.instanceColor && Array.isArray(o.userData.componentIds)) n++; }); return n; })()`)) === 0);
await click("[data-testid=recovery-toggle]");
await frame(400);
check("B2 assessments are exactly as before the B3 work and the explosion", (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY_B2)})`)) === b2Stored);
const b3Stored = await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY_B3)})`);

// ── 9. section clip (world space) on exploded geometry ──────────────────────────────────────────────
await click("[data-testid=explode-reset]");
await frame(300);
await b.goto(`${BASE}/?view=section`);
await frame(900);
await click("[data-testid=explode-toggle]");
await frame(700);
check("with a section view active the panel says the plane stays fixed in world space", /fixed in world space/.test((await text("[data-testid=explode-section-note]")) ?? ""));
await click("[data-testid=explode-mode-floors]");
await setRange("[data-testid=explode-progress]", 1000);
await frame(600);
await click("[data-testid=explode-fit]");
await frame(800);
const clipped = await b.evaluate(`(() => { let n = 0, tot = 0; window.__reloop.scene.traverse((o) => { if (o.isMesh && o.material && !Array.isArray(o.material) && o.userData.componentIds) { tot++; if (o.material.clippingPlanes && o.material.clippingPlanes.length === 1) n++; } }); return { n, tot }; })()`);
check("the section plane (world space) is still applied to every building material while exploded", clipped.n > 100 && clipped.n === clipped.tot, clipped);
await b.shot(`${OUT}/a4_section_exploded.png`);
await click("[data-testid=explode-reset]");
await frame(300);
await click("[data-testid=explode-close]");
await frame(500);

// ── 10. reset, close, reload ─────────────────────────────────────────────────────────────────────────
await b.goto(`${BASE}/?view=full`);
await frame(900);
const snap1 = await snap(); // baseline of THIS page load (material uuids are random per load, so snap0 cannot be compared after a reload)
await click("[data-testid=explode-toggle]");
await frame(600);
await click("[data-testid=explode-mode-cinematic]");
await setRange("[data-testid=explode-progress]", 1000);
await frame(500);
check("exploded before the drift test", Math.abs((await st()).t - 1) < 1e-9 && (await groups()).some((g) => g.position.some((v) => v !== 0)));
// zero-drift: a random sweep of modes, sliders, distances, layouts, plays and pauses, then Reset
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const MODES = ["floors", "systems", "cinematic", "assembly"];
for (let i = 0; i < 60; i++) {
  const k = Math.floor(rnd() * 7);
  if (k === 0) await click(`[data-testid=explode-mode-${MODES[Math.floor(rnd() * 4)]}]`);
  else if (k === 1) await setRangeIfEnabled("[data-testid=explode-progress]", Math.floor(rnd() * 1001));
  else if (k === 2) await setRangeIfEnabled("[data-testid=explode-floor-gap]", Math.floor(rnd() * 25) / 2);
  else if (k === 3) await setRangeIfEnabled("[data-testid=explode-system-gap]", Math.floor(rnd() * 30));
  else if (k === 4 && (await disabled("[data-testid=explode-layout]")) === false) await setSelect("[data-testid=explode-layout]", ["grid", "row-x", "row-z"][Math.floor(rnd() * 3)]);
  else if (k === 5) await setRangeIfEnabled("[data-testid=explode-assembly-gap]", Math.floor(rnd() * 20) / 20);
  else await b.evaluate(`window.__explode.store.preset(["assembled", "partial", "full"][${Math.floor(rnd() * 3)}])`);
  await b.sleep(40);
}
await click("[data-testid=explode-play]");
await b.sleep(400);
await click("[data-testid=explode-play]");
await frame(300);
await click("[data-testid=explode-reset]");
await frame(700);
const dEnd = await positions(sample);
check("zero drift: after a 60-action random sweep, Reset puts every sampled component exactly where it started (bit-identical)", dEnd.every((p, i) => exact(p.displayed, disp0[i].displayed)), dEnd.filter((p, i) => !exact(p.displayed, disp0[i].displayed)).slice(0, 2));
check("zero drift: every group is back at exactly (0, 0, 0)", (await groups()).every((g) => g.position.every((v) => Object.is(v, 0))));
const snapEnd = await snap();
check("zero drift: the whole scene (every instance matrix, visibility flag, material, group position) hashes identically to the start", snapEnd.hash === snap1.hash && snapEnd.tints === 0 && snapEnd.colours === 0, { snapEnd, snap1 });
check("assembled after Reset: the panel shows 0 % and the assembled mode", /^0%/.test((await text("[data-testid=explode-progress-label]")) ?? "") && (await st()).mode === "assembled");
await click("[data-testid=explode-close]");
await frame(700);
const closed = await stats(false);
check("closing the panel returns the scene to the original draw calls and triangles", closed.drawCalls === r.statsBefore.drawCalls && closed.triangles === r.statsBefore.triangles, { closed, before: r.statsBefore });
check("closing the panel leaves nothing bound (no solver) and the scene identical to the start", (await b.evaluate(`window.__explode.solver() === null`)) && (await snap()).hash === snap1.hash);
const idleAfter = await b.evaluate(`(async () => { let n = 0; const g = window.__reloop.gl; const o = g.render.bind(g); g.render = (...a) => { n++; return o(...a); }; await new Promise((r) => setTimeout(r, 800)); g.render = o; return n; })()`);
check("idle again after closing: 0 frames", idleAfter === 0, idleAfter);
r.renderMsAfterClose = await renderMs(false);

// reload: canonical data intact, assembled
await b.goto(`${BASE}/?view=full`);
await frame(900);
const dReload = await positions(sample);
check("after a reload the model is assembled and every position is canonical", dReload.every((p, i) => exact(p.displayed, disp0[i].displayed)) && (await recordsHash()) === rec0);
check("B1 / B2 / B3 data are untouched by A4 (records, assessments, plans)", (await recordsHash()) === rec0 && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY_B2)})`)) === b2Stored && (await b.evaluate(`localStorage.getItem(${JSON.stringify(KEY_B3)})`)) === b3Stored);
check("the explosion state is not persisted (a reload starts assembled, panel closed)", !(await exists("[data-testid=explode-panel]")));

// ── 11. performance (states, playback) ───────────────────────────────────────────────────────────────
await click("[data-testid=explode-toggle]");
await frame(600);
const perf = {};
for (const [name, mode, tt] of [["floors100", "floors", 1], ["systems100", "systems", 1], ["cinematic100", "cinematic", 1]]) {
  await b.evaluate(`window.__explode.store.setMode(${JSON.stringify(mode)}); window.__explode.store.setT(${tt})`);
  await frame(500);
  await click("[data-testid=explode-fit]"); // everything in view: culling then removes nothing, so counts are comparable with the assembled view
  await frame(700);
  perf[name] = { ...(await stats(false)), shadowFrame: (await stats(true)).drawCalls, renderMs: await renderMs(false), renderMsShadow: await renderMs(true) };
}
r.perf = perf;
await b.evaluate(`window.__explode.store.reset(); window.__explode.store.setMode("cinematic")`);
await frame(400);
await b.evaluate(`window.__frames = []; const g = window.__reloop.gl; window.__origRender = g.render.bind(g); g.render = (...a) => { window.__frames.push(performance.now()); return window.__origRender(...a); }; Object.assign(window.__explode.stats, { updates: 0, avgMs: 0, maxMs: 0 })`);
await click("[data-testid=explode-play]");
await b.sleep(9800);
const playback = await b.evaluate(`(() => { const f = window.__frames; const dts = f.slice(1).map((t, i) => t - f[i]).sort((a, c) => a - c); window.__reloop.gl.render = window.__origRender; return { frames: f.length, medianMs: +dts[Math.floor(dts.length / 2)].toFixed(1), p95Ms: +dts[Math.floor(dts.length * 0.95)].toFixed(1), maxMs: +dts[dts.length - 1].toFixed(1), updateAvgMs: +window.__explode.stats.avgMs.toFixed(3), updateMaxMs: +window.__explode.stats.maxMs.toFixed(2), finished: !window.__explode.store.get().playing && window.__explode.store.liveT() === 1 }; })()`);
r.playback = playback;
check("playback (cinematic, 9 s): runs to exactly 100 % and stops by itself, smooth frames, sub-millisecond updates", playback.finished && playback.medianMs < 20 && playback.updateAvgMs < 2 && playback.frames > 300, playback);
check("exploded modes draw exactly the same geometry as the assembled model (the site-ground plane aside): same meshes, geometries, instances; draw calls and triangles equal or lower by the ground", ["floors100", "systems100", "cinematic100"].every((k) => perf[k].meshes === r.statsBefore.meshes && perf[k].geometries === r.statsBefore.geometries && perf[k].instances === r.statsBefore.instances && perf[k].instancedMeshes === r.statsBefore.instancedMeshes && [r.statsBefore.drawCalls, r.statsBefore.drawCalls - 1].includes(perf[k].drawCalls) && [r.statsBefore.triangles, r.statsBefore.triangles - 2].includes(perf[k].triangles)), { perf, before: r.statsBefore });
await click("[data-testid=explode-close]");
await frame(500);

// ── console ──────────────────────────────────────────────────────────────────────────────────────
const bad = b.logs.filter((l) => !/\[vite\]|React DevTools/.test(l));
check("console clean", bad.length === 0, bad.slice(0, 5));
r.logs = bad.slice(0, 5);
await finish(failures.length ? 1 : 0);
