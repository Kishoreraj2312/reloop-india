/** Prints the room schedule (clear dimensions from the wall model) as markdown: npm run plans:schedule */
import { DEFAULT_CONFIG } from "../../src/building/config";
import { floorBoundaries } from "../../src/building/architecture/boundaries";
import { buildFloorPlan } from "../../src/building/architecture/plan";
import { roomClearRects } from "../../src/building/architecture/validatePlan";
import { rectArea, rectD, rectW } from "../../src/building/architecture/rect";

for (const storey of [0, 1]) {
  const plan = buildFloorPlan(DEFAULT_CONFIG, storey);
  const b = floorBoundaries(plan);
  console.log(`\n#### Storey ${storey} (${plan.kind})\n\n| Apt | Room | Type | Clear (m) | Clear area (m²) |\n|---|---|---|---|---|`);
  for (const apt of plan.apartments) {
    if (storey === 1 && !["A1", "A4", "A5", "CM"].includes(apt.id)) continue;
    for (const r of plan.rooms.filter((x) => x.aptId === apt.id)) {
      const cr = roomClearRects(r, b, DEFAULT_CONFIG);
      const main = cr.reduce((a, c) => (rectArea(c) > rectArea(a) ? c : a));
      const area = cr.reduce((s, c) => s + rectArea(c), 0);
      console.log(`| ${apt.id} | ${r.code} | ${r.type} | ${rectW(main).toFixed(2)} × ${rectD(main).toFixed(2)} | ${area.toFixed(1)} |`);
    }
  }
}
