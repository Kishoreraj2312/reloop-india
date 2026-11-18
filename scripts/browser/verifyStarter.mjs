// Starter sample check (dev server on :5173, or BASE=http://localhost:PORT). A browser that has never saved recovery assessments starts
// from an illustrative starter sample, so "Colour the 3D model by assessment" shows several colours straight away. Checks, on a fresh
// profile (the only check that launches with the starter on): the sample appears without opening anything and writes nothing; the colouring
// uses several classifications; the first edit saves only the change (a few hundred bytes, not the sample) and drops that component's
// starter note; the edit survives a reload; "Reset all assessments" is remembered (the sample does not come back by itself) and "Fill
// unassessed components with the starter sample" brings it back without touching entered entries; the demo project replaces it and Exit
// demo gives it back; the scenario and carbon drawers say the sample is in use. Screenshots: docs/screenshots/starter.
//   node scripts/browser/verifyStarter.mjs
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = process.env.OUT ?? "docs/screenshots/starter";
const KEY = "rematter.recovery.assessments.v1";
const FLAG = "rematter.recovery.starter.v1";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000, starter: true });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " " + JSON.stringify(detail)}`);
};
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const text = (sel) => b.evaluate(`${q(sel)}?.innerText ?? null`);
const exists = (sel) => b.evaluate(`!!${q(sel)}`);
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "center" })`); await b.sleep(120); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const stored = (k) => b.evaluate(`localStorage.getItem(${JSON.stringify(k)})`);
const counts = async () => { const m = /^([\d,]+) of ([\d,]+) components assessed/.exec((await text("[data-testid=recovery-counts]")) ?? ""); return m ? Number(m[1].replace(/,/g, "")) : null; };
const bannerCount = async () => Number(await b.evaluate(`${q("[data-testid=recovery-starter]")}?.dataset.count ?? 0`));
const meshColour = (id) => b.evaluate(`window.__reloop.scene.getObjectByName(${JSON.stringify(id)})?.material?.color?.getHexString() ?? null`);
const colours = () => b.evaluate(`(() => {
  const seen = new Set();
  window.__reloop.scene.traverse((o) => {
    if (o.isInstancedMesh && o.instanceColor && Array.isArray(o.userData.componentIds)) {
      const a = o.instanceColor.array, c = new o.material.color.constructor();
      for (let i = 0; i < a.length; i += 3) seen.add(c.fromArray(a, i).getHexString());
    } else if (o.isMesh && typeof o.userData.componentId === "string") seen.add(o.material.color.getHexString());
  });
  return [...seen];
})()`);
const waitFor = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await b.sleep(300); } return false; };
const ready = async () => { for (let i = 0; i < 100; i++) { if (await b.evaluate("!!window.__reloop && !!document.querySelector('canvas')")) break; await b.sleep(200); } await b.sleep(800); };
const COL = "STR-COL-F01-A1"; // a structural column: recycling in the sample (blue)

try {
  await b.goto(`${BASE}/?view=full`);
  check("fresh profile: nothing saved yet", (await stored(KEY)) === null && (await stored(FLAG)) === null, { key: await stored(KEY), flag: await stored(FLAG) });

  // 1. the sample appears by itself, in idle time, with the drawer closed: the top-bar badge counts it
  const badge = await waitFor(async () => /\d/.test((await text("[data-testid=recovery-toggle]")) ?? ""), 20000);
  check("the sample appears without opening anything (top-bar badge)", badge, await text("[data-testid=recovery-toggle]"));
  check("a pristine sample writes nothing", (await stored(KEY)) === null && (await stored(FLAG)) === null, null);

  await click("[data-testid=recovery-toggle]");
  await b.sleep(1500);
  const n0 = await counts();
  check("the drawer counts the sample's components as assessed", n0 !== null && n0 > 10000, n0);
  check("the starter banner says so, with the same count", (await bannerCount()) === n0 && /Starter sample/.test((await text("[data-testid=recovery-starter]")) ?? "") && (await exists("[data-testid=recovery-starter-unsaved]")), { banner: await bannerCount(), n0 });
  await b.shot(`${OUT}/starter_drawer.png`);

  // 2. the colouring shows several classifications
  await click("[data-testid=recovery-colour]");
  await b.sleep(1500);
  const cols = await colours();
  check("colouring: the column is the 'recycling' blue", (await meshColour(COL)) === "0072b2", await meshColour(COL));
  check("colouring: recycling, refurbish-reuse, direct-reuse and further-assessment colours are all on the model", ["0072b2", "e69f00", "009e73", "cc79a7"].every((c) => cols.includes(c)), cols);
  check("colouring: a pale 'not assessed' remains for what the sample leaves out", cols.includes("bfc4c9"), cols);
  await click("[data-testid=recovery-close]");
  await b.sleep(700);
  await b.shot(`${OUT}/starter_colour_exterior.png`);

  // 3. the first edit saves the change only
  await b.evaluate(`window.__reloop.select(${JSON.stringify(COL)})`);
  await b.sleep(600);
  await click("[data-testid=recovery-toggle]");
  await b.sleep(900);
  const beforeBanner = await bannerCount();
  await setSelect("[data-testid=rec-classification]", "further_assessment");
  await b.sleep(900);
  const raw = await stored(KEY);
  check("first edit: the save is the change over the sample, not the sample", raw !== null && raw.length < 4000 && /"base":"starter"/.test(raw), raw?.length);
  check("first edit: that component is now further assessment (purple) and the count of assessed components is unchanged", (await meshColour(COL)) === "cc79a7" && (await counts()) === n0, { colour: await meshColour(COL), n: await counts() });
  check("first edit: the component no longer carries the starter note, so the banner count drops by one", (await bannerCount()) === beforeBanner - 1, { before: beforeBanner, after: await bannerCount() });
  check("first edit: the banner no longer says nothing is saved", !(await exists("[data-testid=recovery-starter-unsaved]")), null);

  // 4. the edit survives a reload, on top of the sample
  await b.goto(`${BASE}/?view=full`);
  await click("[data-testid=recovery-toggle]");
  await b.sleep(1500);
  check("reload: the edited component and the rest of the sample are back", (await counts()) === n0 && (await bannerCount()) === beforeBanner - 1, { n: await counts(), banner: await bannerCount() });
  await b.evaluate(`window.__reloop.select(${JSON.stringify(COL)})`);
  await b.sleep(600);
  check("reload: the edit is still further assessment", (await b.evaluate(`${q("[data-testid=rec-classification]")}?.value`)) === "further_assessment", null);

  // 5. the other drawers say the sample is in use
  await click("[data-testid=scenario-toggle]");
  await b.sleep(1500);
  check("the scenario drawer says the starter sample is in use", /Starter sample in use/.test((await text("[data-testid=starter-notice]")) ?? ""), await text("[data-testid=starter-notice]"));
  await click("[data-testid=starter-notice-open]");
  await b.sleep(1000);
  check("its 'Review or reset' link opens the recovery drawer", await exists("[data-testid=recovery-drawer]"), null);
  await click("[data-testid=carbon-toggle]");
  await b.sleep(1500);
  check("the carbon drawer says it too", await exists("[data-testid=starter-notice]"), null);
  await click("[data-testid=recovery-toggle]");
  await b.sleep(1200);

  // 6. reset is remembered
  await click("[data-testid=recovery-reset]");
  await click("[data-testid=recovery-reset-confirm]");
  await b.sleep(800);
  check("reset: nothing assessed, no banner, the choice is saved", (await counts()) === 0 && !(await exists("[data-testid=recovery-starter]")) && (await stored(FLAG)) === "declined" && (await stored(KEY)) === null, { n: await counts(), flag: await stored(FLAG), key: await stored(KEY) });
  await b.goto(`${BASE}/?view=full`);
  await click("[data-testid=recovery-toggle]");
  await b.sleep(1500);
  check("reload after reset: the sample does not come back by itself", (await counts()) === 0, await counts());

  // 7. fill brings it back, without touching an entered entry
  await b.evaluate(`window.__reloop.select(${JSON.stringify(COL)})`);
  await b.sleep(600);
  await setSelect("[data-testid=rec-classification]", "direct_reuse");
  await b.sleep(500);
  await click("[data-testid=recovery-fill-starter]");
  await b.sleep(1200);
  const n1 = await counts();
  check("fill: the sample is added to everything unassessed (the entered component is not counted twice)", n1 === n0, { n1, n0 });
  check("fill: the entered column keeps the user's own classification", (await b.evaluate(`${q("[data-testid=rec-classification]")}?.value`)) === "direct_reuse", await b.evaluate(`${q("[data-testid=rec-classification]")}?.value`));
  check("fill: reports how many it added", /Starter sample added to [\d,]+ unassessed/.test((await text("[data-testid=recovery-fill-msg]")) ?? ""), await text("[data-testid=recovery-fill-msg]"));
  await click("[data-testid=recovery-fill-starter]");
  await b.sleep(600);
  check("fill again: nothing left to add", /Nothing to add/.test((await text("[data-testid=recovery-fill-msg]")) ?? ""), await text("[data-testid=recovery-fill-msg]"));
  const raw2 = await stored(KEY);
  check("fill: saved as the change over the sample", raw2 !== null && raw2.length < 4000 && /"base":"starter"/.test(raw2), raw2?.length);

  // 8. the demo project replaces the sample, and Exit demo gives the browser back as it was
  await b.goto(`${BASE}/?view=full`);
  await b.sleep(1500);
  const before = { key: await stored(KEY), flag: await stored(FLAG) };
  await b.evaluate(`window.__demo.load()`);
  await b.sleep(2500);
  await click("[data-testid=recovery-toggle]");
  await b.sleep(1500);
  const nd = await counts();
  check("demo: the recovery assessments are the demo's (noted Demo), not the sample's", nd !== null && nd > 10000 && !(await exists("[data-testid=recovery-starter]")), { nd, n0 });
  await b.evaluate(`window.__reloop.select(${JSON.stringify(COL)})`);
  await b.sleep(600);
  check("demo: a component's note says Demo", (await b.evaluate(`${q("[data-testid=rec-note]")}?.value`)) === "Demo (illustrative)", await b.evaluate(`${q("[data-testid=rec-note]")}?.value`));
  await b.evaluate(`window.__demo.exit()`);
  await b.sleep(1500);
  await ready();
  const after = { key: await stored(KEY), flag: await stored(FLAG) };
  check("exit demo: storage is back exactly as it was before the demo", after.key === before.key && after.flag === before.flag, { before: before.key?.length, after: after.key?.length });
  await click("[data-testid=recovery-toggle]");
  await b.sleep(1500);
  check("exit demo: the sample (and the entered column) is back", (await counts()) === n0, await counts());

  // 9. screenshots of the finished look, with the interior shown
  await b.goto(`${BASE}/?view=full&hide=roof,ceilings,exteriorWalls,balconiesFacade`);
  await click("[data-testid=recovery-toggle]");
  await b.sleep(1200);
  await click("[data-testid=recovery-colour]");
  await b.sleep(1200);
  await click("[data-testid=recovery-close]");
  await b.sleep(800);
  await b.shot(`${OUT}/starter_colour_interior.png`);

  const errors = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
  check("console clean", errors.length === 0, errors.slice(0, 5));
} catch (e) {
  check("script ran to the end", false, String(e?.stack ?? e));
}
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
process.exit(failed.length ? 1 : 0);
