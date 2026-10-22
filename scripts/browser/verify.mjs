// Browser verification for the structural model (dev server must be running).
//   node scripts/browser/verify.mjs [baseUrl] [outDir]
// Captures full / top / stair / section views and junction close-ups, checks mesh identity
// and real mouse clicks against the ID inspector, and prints renderer.info.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.argv[2] ?? "http://localhost:5173/";
const OUT = process.argv[3] ?? "docs/screenshots/a1";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const report = {};

for (const view of ["full", "top", "stair", "section"]) {
  await b.goto(`${BASE}?view=${view}`);
  await b.shot(`${OUT}/${view}.png`);
}

await b.goto(`${BASE}?view=full`);
report.renderer = await b.evaluate(`(() => { const gl = window.__reloop.gl.getContext(); const d = gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.VERSION); })()`);
report.stats = await b.evaluate(`({ steadyFrame: window.__reloop.stats(false), shadowRefreshFrame: window.__reloop.stats(true) })`);
report.identity = await b.evaluate(`(() => {
  const r = window.__reloop; const ids = new Set(r.records.map(x => x.id)); let meshes = 0, tagged = 0, matching = 0;
  r.scene.traverse(o => { if (!o.isMesh || o.name.endsWith('__selection')) return; meshes++;
    if (o.userData.componentId) tagged++; if (ids.has(o.userData.componentId) && o.userData.componentId === o.name) matching++; });
  return { records: r.records.length, meshes, withComponentId: tagged, idMatchesNameAndRecord: matching };
})()`);

async function clickTest(view, id) {
  await b.goto(`${BASE}?view=${view}`);
  const pt = await b.evaluate(`(() => { const r = window.__reloop; const m = r.scene.getObjectByName(${JSON.stringify(id)}); const v = m.position.clone(); m.parent.localToWorld(v); v.project(r.camera); return { x: (v.x*0.5+0.5)*innerWidth, y: (-v.y*0.5+0.5)*innerHeight }; })()`);
  await b.click(pt.x, pt.y);
  const text = await b.evaluate(`document.querySelector('[data-testid=id-inspector]').innerText`);
  const got = text.split("\n")[1];
  return { view, expected: id, got, ok: got === id };
}
report.clicks = [
  await clickTest("full", "STR-COL-G-G6"),
  await clickTest("full", "STR-FTG-G-G6"),
  await clickTest("top", "STR-SLAB-RF-P01"),
  await clickTest("top", "STR-BM-RF-X-A1-B1"),
];

await b.goto(`${BASE}?view=stair&select=STR-STAIR-G-FL1`);
await b.shot(`${OUT}/stair_selected.png`);
// Clearing: select via URL in the full view, then click a pixel that is ground grid only.
await b.goto(`${BASE}?view=full&select=STR-COL-G-G6`);
report.selectedBeforeClear = (await b.evaluate(`document.querySelector('[data-testid=id-inspector]').innerText`)).split("\n")[1];
await b.click(60, 960);
report.clearedByClickingEmptySpace = (await b.evaluate(`document.querySelector('[data-testid=id-inspector]').innerText`)).includes("click a member");

const closeups = {
  roof_corner_node: [[21.5, 19.8, 19.5], [18, 17.6, 15]],
  stair_L1_arrival: [[0.8, 5.6, -5.4], [3, 3.9, -1.5]],
};
await b.goto(`${BASE}?view=full`);
for (const [name, [pos, tgt]] of Object.entries(closeups)) {
  await b.evaluate(`window.__reloop.setView(${JSON.stringify(pos)}, ${JSON.stringify(tgt)})`);
  await b.sleep(900);
  await b.shot(`${OUT}/close_${name}.png`);
}

report.consoleProblems = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
console.log(JSON.stringify(report, null, 1));
await b.close();
process.exit(report.clicks.every((c) => c.ok) && report.clearedByClickingEmptySpace && report.consoleProblems.length === 0 ? 0 : 1);
