// Ad-hoc capture: node scripts/browser/shot.mjs <out.png> [query] [posX,posY,posZ targetX,targetY,targetZ]
import { launch } from "./cdp.mjs";
const [out, query = "", pos, tgt] = process.argv.slice(2);
const b = await launch({ width: 1600, height: 1000 });
await b.goto(`http://localhost:5173/${query}`);
if (pos && tgt) {
  await b.evaluate(`window.__reloop.setView(${JSON.stringify(pos.split(",").map(Number))}, ${JSON.stringify(tgt.split(",").map(Number))})`);
  await b.sleep(900);
}
await b.shot(out);
const stats = await b.evaluate(`JSON.stringify(window.__reloop.stats(false))`);
console.log(stats);
console.log(b.logs.filter((l) => !/\[vite\]|DevTools/.test(l)).slice(0, 10).join("\n"));
await b.close();
