// A3 browser check (dev server on :5173): MEP groups exist, plumbing/electrical toggles hide
// them, X-ray ghosts the building, a pipe selection traces its network. Prints JSON.
import { launch } from "./cdp.mjs";
const b = await launch({ width: 1400, height: 900 });
await b.goto("http://localhost:5173/?view=full");
const r = {};
r.groups = await b.evaluate(`["L1_plumbing","L1_electrical"].map((n) => !!window.__reloop.scene.getObjectByName(n))`);
const click = async (sel) => { const p = await b.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`); await b.click(p.x, p.y); };
await click("input[data-layer=plumbing]");
r.plumbingHidden = await b.evaluate(`!window.__reloop.scene.getObjectByName("L1_plumbing").visible`);
await click("input[data-layer=plumbing]");
await click("[data-testid=xray]");
r.xray = await b.evaluate(`(() => { let t = 0, n = 0; window.__reloop.scene.getObjectByName("L1_architecture").traverse((o) => { if (o.material) { n++; if (o.material.opacity < 0.2) t++; } }); return t > 0 && t >= n * 0.5; })()`);
const pipe = await b.evaluate(`window.__reloop.records.find((x) => x.componentType === "drain_stack").id`);
await b.evaluate(`window.__reloop.select(${JSON.stringify(pipe)})`);
await b.sleep(400);
await click("[data-testid=trace]");
r.trace = await b.evaluate(`document.querySelector('[data-testid=id-inspector]').innerText.match(/(\\d+) traced/)?.[1] ?? null`);
await b.shot("docs/screenshots/a3_trace_xray.png");
await click("[data-testid=reset]");
r.reset = await b.evaluate(`!document.querySelector('[data-testid=xray]').checked`);
r.console = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
r.ok = r.groups.every(Boolean) && r.plumbingHidden && r.xray && Number(r.trace) > 5 && r.reset && r.console.length === 0;
console.log(JSON.stringify(r, null, 1));
await b.close();
process.exit(r.ok ? 0 : 1);
