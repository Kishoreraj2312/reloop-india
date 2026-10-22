/**
 * Draws the A2 floor plans as SVG straight from the plan model (no hand-drawn copies):
 *   npm run plans   ->  docs/plans/ground.svg, docs/plans/typical.svg
 * North is up (world +Z), 1 m = 20 px. Walls are the boundary wall footprints (before
 * junction trimming), columns are solid, door swings are drawn from the same arcs the
 * validators use.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../../src/building/config";
import { buildGrid, nodeLabel } from "../../src/building/structure";
import { floorBoundaries, wallFootprint } from "../../src/building/architecture/boundaries";
import { buildFloorPlan, type FloorPlan } from "../../src/building/architecture/plan";
import { ARCH_CONFIG } from "../../src/building/architecture/config";
import { columnRects, planArcs } from "../../src/building/architecture/validatePlan";
import type { PlanRect } from "../../src/building/architecture/rect";

const S = 20;
const M = 60;
const cfg = DEFAULT_CONFIG;
const grid = buildGrid(cfg);
const X = (x: number) => M + (x - grid.xs[0]!) * S;
const Y = (z: number) => M + (grid.zs[grid.zs.length - 1]! - z) * S;
const W = (grid.xs[grid.xs.length - 1]! - grid.xs[0]!) * S + 2 * M;
const H = (grid.zs[grid.zs.length - 1]! - grid.zs[0]!) * S + 2 * M + 40;

const FILL: Record<string, string> = {
  living: "#f3e9d8", dining: "#f3e9d8", bedroom: "#e5ecf3", bathroom: "#dbeee9", toilet: "#dbeee9",
  kitchen: "#f5e1d6", utility: "#eee6dc", foyer: "#efefe8", passage: "#efefe8", store: "#e8e4dc",
  study: "#e9efe1", corridor: "#e2e2de", stair: "#d7d5d0", services: "#dcdcd6", shaft: "#bdbdb8",
  lobby: "#ece4d2", security: "#e6e6e0", meter: "#e6e6e0", office: "#e9efe1",
};

const r2 = (r: PlanRect, fill: string, extra = "") =>
  `<rect x="${X(r.x0).toFixed(1)}" y="${Y(r.z1).toFixed(1)}" width="${((r.x1 - r.x0) * S).toFixed(1)}" height="${((r.z1 - r.z0) * S).toFixed(1)}" fill="${fill}" ${extra}/>`;

function draw(plan: FloorPlan, title: string): string {
  const out: string[] = [];
  const bounds = floorBoundaries(plan);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#ffffff"/>`);
  for (const room of plan.rooms) for (const rc of room.rects) out.push(r2(rc, FILL[room.type] ?? "#eee"));
  // Grid
  grid.xs.forEach((x, i) => {
    out.push(`<line x1="${X(x)}" y1="${M - 25}" x2="${X(x)}" y2="${H - M - 15}" stroke="#c44" stroke-width="0.6" stroke-dasharray="6 4"/>`);
    out.push(`<text x="${X(x)}" y="${M - 30}" font-size="12" text-anchor="middle" fill="#c44">${nodeLabel(i, 0)[0]}</text>`);
  });
  grid.zs.forEach((z, i) => {
    out.push(`<line x1="${M - 25}" y1="${Y(z)}" x2="${W - M + 25}" y2="${Y(z)}" stroke="#c44" stroke-width="0.6" stroke-dasharray="6 4"/>`);
    out.push(`<text x="${M - 32}" y="${Y(z) + 4}" font-size="12" text-anchor="middle" fill="#c44">${i + 1}</text>`);
  });
  // Balconies and stair opening
  for (const b of plan.balconies) {
    const zf = b.side === "S" ? grid.zs[0]! - cfg.column.depth / 2 : grid.zs[grid.zs.length - 1]! + cfg.column.depth / 2;
    const d = ARCH_CONFIG.balcony.depth;
    out.push(r2({ x0: b.bay[0], x1: b.bay[1], z0: b.side === "S" ? zf - d : zf, z1: b.side === "S" ? zf : zf + d }, "#f6efe2", `stroke="#8a7a62" stroke-width="1"`));
  }
  const so = grid.xs[cfg.stairBay.xStart]! + 3;
  out.push(r2({ x0: so - cfg.stairOpening.width / 2, x1: so + cfg.stairOpening.width / 2, z0: -cfg.stairOpening.length / 2, z1: cfg.stairOpening.length / 2 }, "none", `stroke="#555" stroke-dasharray="3 3"`));
  // Walls and columns
  for (const b of bounds) {
    if (b.kind === "open") continue;
    out.push(r2(wallFootprint(b, cfg), b.kind === "partition" ? "#7d7d7d" : "#3d3d3d"));
  }
  for (const c of columnRects(cfg, plan.storey)) out.push(r2(c, "#111"));
  // Openings: windows (light strip), doors (gap + swing)
  for (const w of plan.windows) {
    const t = ARCH_CONFIG.windowTypes[w.typeKey];
    const wb = bounds.find((b) => b.line.axis === w.line.axis && Math.abs(b.line.c - w.line.c) < 1e-6 && b.s0 <= w.centre && b.s1 >= w.centre)!;
    out.push(r2(wallFootprint(wb, cfg, w.centre - t.width / 2, w.centre + t.width / 2), "#9fd0e8"));
  }
  const arcs = planArcs(plan, cfg);
  for (const d of plan.doors) {
    const db = bounds.find((b) => b.line.axis === d.line.axis && Math.abs(b.line.c - d.line.c) < 1e-6 && b.s0 <= d.centre && b.s1 >= d.centre);
    if (db) out.push(r2(wallFootprint(db, cfg, d.centre - d.width / 2, d.centre + d.width / 2), "#ffffff"));
    for (const a of arcs.get(d.key)!) {
      const ex = a.px + a.sx * a.r;
      const ez = a.pz + a.sz * a.r;
      // closed leaf along the wall -> open leaf perpendicular
      const closedX = d.line.axis === "x" ? ex : a.px;
      const closedZ = d.line.axis === "x" ? a.pz : ez;
      const openX = d.line.axis === "x" ? a.px : ex;
      const openZ = d.line.axis === "x" ? ez : a.pz;
      const sweep = (a.sx * a.sz > 0) === (d.line.axis === "x") ? 0 : 1;
      out.push(`<path d="M ${X(a.px)} ${Y(a.pz)} L ${X(openX)} ${Y(openZ)} A ${a.r * S} ${a.r * S} 0 0 ${sweep} ${X(closedX)} ${Y(closedZ)}" fill="none" stroke="#b5651d" stroke-width="0.8"/>`);
    }
  }
  // Labels
  for (const room of plan.rooms) {
    const rc = room.rects.reduce((a, b) => ((b.x1 - b.x0) * (b.z1 - b.z0) > (a.x1 - a.x0) * (a.z1 - a.z0) ? b : a));
    const cx = X((rc.x0 + rc.x1) / 2);
    const cy = Y((rc.z0 + rc.z1) / 2);
    const small = Math.min(rc.x1 - rc.x0, rc.z1 - rc.z0) < 2;
    out.push(`<text x="${cx}" y="${cy}" font-size="${small ? 7 : 9}" text-anchor="middle" fill="#333">${room.code}</text>`);
    if (room.code === "LIV" || room.code === "LOB" || room.code === "COR")
      out.push(`<text x="${cx}" y="${cy + 12}" font-size="11" font-weight="bold" text-anchor="middle" fill="#222">${room.aptId}</text>`);
  }
  out.push(`<text x="${M}" y="${H - 18}" font-size="13" fill="#222">${title} — storey ${plan.storey} (${plan.kind}); N up; grid 6 m; walls before junction trimming; door swings as validated</text>`);
  out.push(`</svg>`);
  return out.join("\n");
}

mkdirSync("docs/plans", { recursive: true });
writeFileSync("docs/plans/ground.svg", draw(buildFloorPlan(cfg, 0), "Ground floor (G)"));
writeFileSync("docs/plans/typical.svg", draw(buildFloorPlan(cfg, 1), "Typical floor (F01-F04)"));
console.log("wrote docs/plans/ground.svg, docs/plans/typical.svg");
