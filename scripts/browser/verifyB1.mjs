// B1 browser check (dev server on :5173, or BASE=http://localhost:PORT): opens the Inventory drawer with a
// real click, checks renderer stats before/after, summary cards, filters, sort, search, card drill-down,
// row -> 3D selection (inspector ID line), parent select, CSV export (row count = filtered count) and a clean
// console. Screenshots go to docs/screenshots/b1. Prints JSON; exit code 1 on any failed check.
import { mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";

const BASE = process.env.BASE ?? "http://localhost:5173";
const OUT = "docs/screenshots/b1";
mkdirSync(OUT, { recursive: true });
const b = await launch({ width: 1600, height: 1000 });
const r = {};
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const center = (sel) => b.evaluate(`(() => { const e = ${q(sel)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
// scroll the target into its scroll container first: a click must not depend on where the drawer body happened to be left
const click = async (sel) => { await b.evaluate(`${q(sel)}?.scrollIntoView({ block: "nearest" })`); const p = await center(sel); if (!p) throw new Error(`no element ${sel}`); await b.click(p.x, p.y); };
const setSelect = (sel, value) => b.evaluate(`(() => { const e = ${q(sel)}; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event("change", { bubbles: true })); return e.value; })()`);
const count = () => b.evaluate(`Number(${q("[data-testid=inv-count]")}.dataset.count)`);
const inspectorId = () => b.evaluate(`${q("[data-testid=id-inspector]")}.innerText.split("\\n")[1]`);
const scrollBody = (sel) => b.evaluate(`(() => { const body = ${q("[data-testid=inventory-body]")}; const t = ${q(sel)}; body.scrollTop = t.offsetTop - 8; return body.scrollTop; })()`);
const cardValue = (key) => b.evaluate(`${q(`[data-testid=inv-card-${key}] [data-testid=inv-card-value]`)}.innerText`);

await b.goto(`${BASE}/?view=full`);
r.statsBefore = await b.evaluate(`window.__reloop.stats(false)`);

// 1. open with a real click
await click("[data-testid=inventory-toggle]");
await b.sleep(1500);
r.drawerOpen = await b.evaluate(`!!${q("[data-testid=inventory-drawer]")}`);
r.drawerWidth = await b.evaluate(`${q("[data-testid=inventory-drawer]")}.getBoundingClientRect().width`);
r.statsAfter = await b.evaluate(`window.__reloop.stats(false)`);
r.drawCallsUnchanged = r.statsBefore.drawCalls === r.statsAfter.drawCalls && r.statsBefore.triangles === r.statsAfter.triangles;
await b.shot(`${OUT}/b1_summary.png`);

// 2. summary cards
r.cards = Object.fromEntries(await Promise.all(["concrete", "masonry", "lintels", "tile_floor", "screed", "ceiling_board", "tile_wall", "skirting", "glazing", "mass", "issues"].map(async (k) => [k, await cardValue(k)])));
r.cardProducts = await b.evaluate(`${q("[data-testid=inv-card-products]")}.innerText.replace(/\\n+/g, " | ")`);
r.notModelled = await b.evaluate(`${q("[data-testid=inv-not-modelled]")}.children.length`);

// 3. breakdowns
await scrollBody("[data-testid=inv-bd-concrete]");
await b.sleep(300);
await b.shot(`${OUT}/b1_breakdowns.png`);
r.concreteTotalRow = await b.evaluate(`${q("[data-testid=inv-bd-concrete-total]")}.innerText.replace(/\\t/g, " | ")`);
r.concreteTableTotalEqualsCard = await b.evaluate(`(() => { const cells = ${q("[data-testid=inv-bd-concrete-total]")}.querySelectorAll("td"); return cells[cells.length - 1].innerText; })()`) === r.cards.concrete;

// 4. table: scroll into view, windowing
await scrollBody("[data-testid=inv-filter-floor]");
await b.sleep(500);
r.totalRows = await count();
r.domRows = await b.evaluate(`document.querySelectorAll("[data-testid=inv-row]").length`);
r.windowed = r.domRows < 200 && r.totalRows > 80000;
await b.shot(`${OUT}/b1_table.png`);

// 5. filter: floor F02 + category concrete
await setSelect("[data-testid=inv-filter-floor]", "2");
await setSelect("[data-testid=inv-filter-category]", "concrete");
await b.sleep(900);
r.filteredCount = await count();
r.footer = await b.evaluate(`${q("[data-testid=inv-footer]")}.innerText.replace(/\\n+/g, " | ")`);
r.allRowsMatch = await b.evaluate(`[...document.querySelectorAll("[data-testid=inv-row]")].every((row) => row.innerText.includes("F02") && row.innerText.includes("Concrete"))`);
await b.shot(`${OUT}/b1_filtered.png`);

// 6. row -> 3D selection (real click on the first row)
const firstId = await b.evaluate(`${q("[data-testid=inv-row]")}.dataset.id`);
const rowPos = await b.evaluate(`(() => { const r = ${q("[data-testid=inv-row]")}.getBoundingClientRect(); return { x: r.x + 120, y: r.y + r.height / 2 }; })()`);
await b.click(rowPos.x, rowPos.y);
await b.sleep(700);
r.rowClick = { rowId: firstId, inspectorId: await inspectorId() };
r.rowClickSelectsSame = r.rowClick.rowId === r.rowClick.inspectorId;
r.selectedRowHighlighted = await b.evaluate(`${q("[data-testid=inv-row]")}.style.background !== "transparent"`);

// 7. CSV export: capture the Blob the page downloads
await b.evaluate(`(() => { window.__csv = null; const orig = URL.createObjectURL; URL.createObjectURL = (blob) => { window.__csv = blob; return orig.call(URL, blob); }; })()`);
await click("[data-testid=inv-export]");
await b.sleep(600);
const csv = await b.evaluate(`window.__csv ? window.__csv.text() : null`);
const parse = (text) => { const rows = []; let row = [], f = "", qd = false; for (let i = 0; i < text.length; i++) { const c = text[i]; if (qd) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else qd = false; } else f += c; } else if (c === '"') qd = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\r" || c === "\n") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; } else f += c; } if (f !== "" || row.length) { row.push(f); rows.push(row); } return rows; };
const table = csv ? parse(csv) : [];
r.csv = { header: table[0]?.join("|") ?? null, dataRows: Math.max(0, table.length - 1), widthsConsistent: table.every((x) => x.length === table[0]?.length) };
r.csvRowsEqualFiltered = r.csv.dataRows === r.filteredCount && r.csv.widthsConsistent;
r.csvAllF02Concrete = table.slice(1).every((x) => x[2] === "F02" && x[4] === "Concrete");

// 8. sort by quantity (desc) on the filtered set
await click("[data-testid=inv-sort-quantity]");
await click("[data-testid=inv-sort-quantity]");
await b.sleep(500);
const qs = await b.evaluate(`[...document.querySelectorAll("[data-testid=inv-row]")].sort((a, c) => parseInt(a.style.top) - parseInt(c.style.top)).slice(0, 6).map((row) => Number(row.lastElementChild.children[0].innerText.replace(/,/g, "")))`);
r.sortDesc = qs;
r.sortedDesc = qs.every((v, i) => i === 0 || qs[i - 1] >= v);

// 9. search (debounced) across all rows, then clear
await click("[data-testid=inv-clear]");
await b.sleep(500);
await click("[data-testid=inv-search]");
await b.send("Input.insertText", { text: "STR-COL" });
await b.sleep(700);
r.searchCount = await count();
r.searchIs210Columns = r.searchCount === 210;
await click("[data-testid=inv-clear]");
await b.sleep(400);

// 9b. cross-checks against docs/BUILDING_SPECIFICATION.md and the hand-checkable anchors (footer = filtered totals)
const footerTotal = (u) => b.evaluate(`${q(`[data-testid=inv-total-${u}]`)}?.querySelector("b")?.innerText ?? null`);
const searchFor = async (text) => { await click("[data-testid=inv-search]"); await b.evaluate(`${q("[data-testid=inv-search]")}.select()`); await b.send("Input.insertText", { text }); await b.sleep(700); };
r.cross = {};
for (const [label, text, expectCount, expectM3] of [["columns", "STR-COL", 210, "153.090"], ["footings", "STR-FTG", 42, "100.800"], ["pedestals", "STR-PED", 42, "13.608"], ["beams", "STR-BM", 426, "353.047"], ["slab panels", "STR-SLAB", 210, "863.291"]]) {
  await searchFor(text);
  r.cross[label] = { count: await count(), m3: await footerTotal("m3"), expectCount, expectM3 };
}
await click("[data-testid=inv-clear]");
await setSelect("[data-testid=inv-filter-system]", "structure");
await b.sleep(800);
r.cross["structure members"] = { count: await count(), m3: await footerTotal("m3"), expectCount: 945, expectM3: "1,490.873" };
await click("[data-testid=inv-clear]");
await b.sleep(500);
r.crossOk = Object.values(r.cross).every((c) => c.count === c.expectCount && c.m3 === c.expectM3);

// 10. card drill-down
await scrollBody("[data-testid=inv-cards]");
await click("[data-testid=inv-card-lintels]");
await b.sleep(700);
r.lintelCardCount = await count();
r.lintelChip = await b.evaluate(`!!${q("[data-testid=inv-card-chip]")}`);
await b.shot(`${OUT}/b1_card_drilldown.png`);

// 11. select parent from a child row
const parentBtn = await b.evaluate(`(() => { const row = ${q("[data-testid=inv-row]")}; const btn = row.querySelector("[data-testid=select-parent-row]"); return { rowId: row.dataset.id, title: btn?.title ?? null }; })()`);
await click("[data-testid=inv-row] [data-testid=select-parent-row]");
await b.sleep(700);
r.parentSelect = { child: parentBtn.rowId, inspectorId: await inspectorId(), expected: parentBtn.title?.replace("Select parent ", "") };
r.parentSelectOk = r.parentSelect.inspectorId === r.parentSelect.expected;

// 12. drawer closes; scene stats unchanged
r.statsOpenSelected = await b.evaluate(`window.__reloop.stats(false)`);
await click("[data-testid=inventory-close]");
await b.sleep(600);
r.closed = await b.evaluate(`!${q("[data-testid=inventory-drawer]")}`);
r.statsClosed = await b.evaluate(`window.__reloop.stats(false)`);
// same selection before and after closing: the drawer itself adds no draw calls
r.statsStable = r.statsClosed.drawCalls === r.statsOpenSelected.drawCalls && r.statsClosed.triangles === r.statsOpenSelected.triangles;

r.console = b.logs.filter((l) => !/\[vite\]|DevTools/.test(l));
r.ok = [r.drawerOpen, r.drawerWidth >= 540 && r.drawerWidth <= 580, r.drawCallsUnchanged, r.concreteTableTotalEqualsCard, r.windowed, r.filteredCount > 0, r.allRowsMatch, r.rowClickSelectsSame, r.csvRowsEqualFiltered, r.csvAllF02Concrete, r.sortedDesc, r.searchIs210Columns, r.crossOk, r.lintelCardCount === 440, r.lintelChip, r.parentSelectOk, r.closed, r.statsStable, r.console.length === 0].every(Boolean);
console.log(JSON.stringify(r, null, 1));
await b.close();
process.exit(r.ok ? 0 : 1);
