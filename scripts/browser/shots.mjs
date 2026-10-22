// Batch capture in one browser session (dev server must be running):
//   node scripts/browser/shots.mjs <shots.json> <outDir>
// shots.json: [{ "name": "south", "query": "?view=full", "pos": [x,y,z], "target": [x,y,z],
//                "state": { "isolate": "L1", "hide": ["ceilings"], "ceilings": false }, "select": "ID" }]
import { readFileSync, mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";
const [file, out] = process.argv.slice(2);
const shots = JSON.parse(readFileSync(file, "utf8"));
mkdirSync(out, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
let lastQuery = null;
for (const s of shots) {
  const q = s.query ?? "?view=full";
  if (q !== lastQuery || s.reload) {
    await b.goto(`http://localhost:5173/${q}`);
    lastQuery = q;
  }
  const st = s.state ?? {};
  await b.evaluate(`(() => { const L = ${JSON.stringify(["structure","exteriorWalls","interiorWalls","openings","flooring","ceilings","fixtures","balconiesFacade","roof"])};
    const hide = ${JSON.stringify(st.hide ?? [])};
    const floors = Object.fromEntries(["FDN","L0","L1","L2","L3","L4","ROOF"].map(f => [f, !(${JSON.stringify(st.hideFloors ?? [])}).includes(f)]));
    window.__reloop.setViewState({ layers: Object.fromEntries(L.map(l => [l, !hide.includes(l)])), isolate: ${JSON.stringify(st.isolate ?? null)}, ceilingsInIsolation: ${JSON.stringify(st.ceilings ?? false)}, floors });
    window.__reloop.select(${JSON.stringify(s.select ?? null)}); })()`);
  await b.sleep(300);
  if (s.focus) {
    // Frame an assembly from its record envelope: camera along `dir` at `dist` x its size.
    await b.evaluate(`(() => { const r = window.__reloop.records.find((x) => x.id === ${JSON.stringify(s.focus)});
      const c = r.originalPosition; const sz = r.geometry.size; const m = Math.max(sz[0], sz[2], 1.5);
      const d = ${JSON.stringify(s.dir ?? [1, 1.2, 1])}; const l = Math.hypot(...d); const k = (${s.dist ?? 1.6}) * m / l;
      window.__reloop.setView([c[0] + d[0] * k, c[1] + d[1] * k, c[2] + d[2] * k], [c[0], c[1] - sz[1] * 0.15, c[2]]); })()`);
  } else if (s.pos) await b.evaluate(`window.__reloop.setView(${JSON.stringify(s.pos)}, ${JSON.stringify(s.target)})`);
  await b.sleep(s.wait ?? 900);
  await b.shot(`${out}/${s.name}.png`);
  console.log(`shot ${s.name}`);
}
console.log(JSON.stringify({ stats: await b.evaluate(`window.__reloop.stats(false)`), console: b.logs.filter((l) => !/\[vite\]|DevTools/.test(l)) }));
await b.close();
