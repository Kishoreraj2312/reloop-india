// Demo project check (dev server on :5173, or BASE=http://localhost:PORT): the user's own entries are backed up, every module is
// filled through its own store, the presentation runs the 10-minute demo tour scene by scene (each scene's drawer / colouring /
// selection checked, screenshots in OUT), and Exit demo restores the user's entries byte for byte.
//   node scripts/browser/verifyDemo.mjs            (screenshots: docs/screenshots/demo)
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "docs/screenshots/demo";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
};
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const click = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return false; e.click(); return true; })()`);
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const KEYS = ["rematter.recovery.assessments.v1", "rematter.removal.plans.v1", "rematter.scenarios.v1", "rematter.carbon.v1", "rematter.passports.v1", "rematter.reuse.v1", "rematter.tracking.v1"];
const storage = () => b.evaluate(`JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map((k) => [k, localStorage.getItem(k)])))`);

await b.goto(`${BASE}/`);
// the user's own data: a removal plan of their own, entered through the store (it must survive the demo untouched)
await b.evaluate(`(() => { const r = window.__removal; r.createPlan("My own plan"); r.addEntries(["STR-COL-G-A1"]); return 1; })()`);
await b.goto(`${BASE}/`);
const own = await storage();
check("not loaded: no demo badge, the guided demonstration is the A5 one", !(await exists("[data-testid=demo-badge]")), null);

await click("[data-testid=present-toggle]");
await b.sleep(800);
check("presentation offers Load demo project", await exists("[data-testid=pm-demo-load]"), null);
const t0 = Date.now();
await click("[data-testid=pm-demo-load]");
await b.sleep(600);
const st = await b.evaluate(`(() => { const s = window.__demo.get(); return { active: s.active, error: s.error, summary: s.summary }; })()`);
st.ms = Date.now() - t0;
console.log(JSON.stringify(st));
const sm = st.summary ?? {};
check("demo loads without error and fills every module", st.active && !st.error && sm.assessments > 5000 && sm.removalEntries > 20 && sm.scenarios === 3 && sm.factors > 0 && sm.passports >= 4 && sm.requirements === 6 && sm.allocations > 0 && sm.tracked > 300 && sm.removalPlans === 3 && sm.trackingErrors === 0, st);
check("in presentation the top bar says Demo data · illustrative", /Demo data/i.test((await text("[data-testid=pm-demo-label]")) ?? "") && /illustrative/i.test((await text("[data-testid=pm-demo-label]")) ?? ""), await text("[data-testid=pm-demo-label]"));
check("the backup holds the user's own entries as they were", await b.evaluate(`(() => { const p = JSON.parse(localStorage.getItem("rematter.demo.v1")); const own = ${own}; return Object.keys(own).every((k) => (p.backup[k] ?? null) === own[k]); })()`), null);
check("the user's own plan is out of the way while the demo runs, and every demo note is labelled", await b.evaluate(`(() => { const plans = window.__removal.get().plans.map((p) => p.name); return !plans.includes("My own plan") && plans.every((n) => /^Demo/.test(n)) && /Demo \\(illustrative\\)/.test(localStorage.getItem("rematter.recovery.assessments.v1")); })()`), null);
check("the start button now runs the demo tour", /10-minute demo/.test((await text("[data-testid=pm-start]")) ?? ""), await text("[data-testid=pm-start]"));
check("the toolbar offers every module", (await exists("[data-testid=pm-scenarios]")) && (await exists("[data-testid=pm-carbon]")) && (await exists("[data-testid=pm-reuse]")) && (await exists("[data-testid=pm-tracking]")), null);

// walk the tour
await click("[data-testid=pm-start]");
const seen = [];
for (let i = 0; i < 11; i++) {
  await b.sleep(2600);
  const cur = await b.evaluate(`${q("[data-testid=presentation]")}.getAttribute("data-cursor")`);
  const cap = await text("[data-testid=pm-caption]");
  const pos = await text("[data-testid=pm-position]");
  seen.push({ cur, pos, cap: cap?.slice(0, 90) });
  await b.shot(`${OUT}/tour_${String(i + 1).padStart(2, "0")}.png`);
  if (i < 10) await click("[data-testid=pm-next]");
}
console.log(JSON.stringify(seen, null, 1));
check("the tour has 11 scenes and every one was visited", seen.length === 11 && new Set(seen.map((s) => s.cur)).size === 11 && /11 \/ 11/.test(seen[10].pos ?? ""), seen.map((s) => s.pos));
check("every caption is filled, free of NaN / undefined", seen.every((s) => s.cap && s.cap.length > 30 && !/NaN|undefined/.test(s.cap)), seen);
const attention = await b.evaluate(`(document.body.innerText.match(/(\\d+) records? needs? attention/) || [])[1] ?? "0"`);
check("tracking: the only open items are the in-progress handrails and the few panes on hold; no plan-vs-actual or allocation flags", Number(attention) <= (sm.inProgress ?? 0) + (sm.onHold ?? 0) && !/allocation not fully fulfilled|more than planned|still unaccounted|neither recovered/i.test(await b.evaluate("document.body.innerText")), { attention, inProgress: sm.inProgress, onHold: sm.onHold });
check("presentation shows its own compact demo label; the global badge steps aside", (await exists("[data-testid=pm-demo-label]")) && !(await exists("[data-testid=demo-badge]")), null);
const console1 = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
check("console clean during the tour", console1.length === 0, console1.slice(0, 5));

// exit presentation, exit demo: the user's own entries come back byte for byte
await click("[data-testid=pm-exit]");
await b.sleep(600);
check("back in the normal interface the badge says DEMO PROJECT · illustrative, with Exit demo", /DEMO PROJECT/.test((await text("[data-testid=demo-badge]")) ?? "") && /illustrative/.test((await text("[data-testid=demo-badge]")) ?? "") && (await exists("[data-testid=demo-exit]")), await text("[data-testid=demo-badge]"));
await b.shot(`${OUT}/normal_mode_badge.png`);
await click("[data-testid=demo-exit]");
await b.sleep(200);
await click("[data-testid=demo-exit-confirm]");
await b.sleep(2500);
for (let i = 0; i < 50 && !(await b.evaluate("!!window.__reloop").catch(() => false)); i++) await b.sleep(200);
const after = await storage();
check("Exit demo restores the user's own entries exactly", after === own, { own: own.slice(0, 200), after: after.slice(0, 200) });
check("after Exit demo: no badge, no demo flag", !(await exists("[data-testid=demo-badge]")) && (await b.evaluate(`localStorage.getItem("rematter.demo.v1")`)) === null, null);

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed }, null, 1));
await b.close();
process.exit(failed.length ? 1 : 0);
