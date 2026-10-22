/**
 * Rainwater (A3): connects the A2 roof drains and gable downpipes into four networks,
 * one per downpipe, without duplicating the A2 pipes:
 *   roof drain grating -> outlet through the parapet base (1:100) -> branch into the A2
 *   downpipe below its rainwater head (the head sits above the roof finish, so the outlet
 *   enters the downpipe, the head acts as an overflow) ... A2 downpipe ... -> shoe at the
 *   downpipe foot, offset clear of the plinth -> underground storm pipe -> recharge pit.
 */

import { MEP_CONFIG } from "./config";
import { declareNetwork, endpoint, indexDrafts, type MepContext } from "./context";
import { FIXED_PARTS, PART_FILL } from "./parts";
import { Net, type RunSpec } from "./net";
import { add, placeLocal, scale, sub, type V3 } from "./geom";
import type { Group } from "./record";

const C = MEP_CONFIG;
const RF = 5;

export function generateRainwater(ctx: MepContext): void {
  const drains = ctx.archRecords.filter((r) => r.componentType === "roof_drain");
  const dps = ctx.archRecords.filter((r) => r.componentType === "facade_downpipe");
  const pipe = C.pipe.rain110;
  for (const drn of drains) {
    const [dx, , dz] = drn.originalPosition;
    // Downpipe stack on the same gable and the same z (one record per storey).
    const stack = dps.filter((p) => Math.abs(p.originalPosition[2] - dz) < 0.05 && Math.sign(p.originalPosition[0]) === Math.sign(dx)).sort((a, b) => a.floor - b.floor);
    const top = stack.find((p) => p.floor === RF);

    const foot = stack.find((p) => p.floor === 0);
    const k = drn.id.match(/DRN(\d+)$/)?.[1] ?? "1";
    const side = dx < 0 ? "W" : "E";
    const tag = `${side}${dz < 0 ? 1 : 2}`;
    endpoint(ctx, drn.id, "roof drain");
    if (!top || !foot) {
      ctx.unresolved.push({ subject: drn.id, reason: "no A2 downpipe on this gable line" });
      continue;
    }
    endpoint(ctx, top.id, "rainwater downpipe (top)");
    endpoint(ctx, foot.id, "rainwater downpipe (foot)");
    const from = ctx.drafts.drafts.length;
    const netId = declareNetwork(ctx, { id: `PLB-NET-RW-${tag}`, system: "plumbing", kind: "rainwater", name: `Rainwater: roof drain ${k} -> downpipe ${tag} -> recharge pit` });
    const gRoof = ctx.drafts.group({ system: "plumbing", type: "RW", floor: RF, loc: tag, name: `Rainwater outlet ${tag}`, assemblyType: "rainwater", category: "rainwater", materialId: "pvc_pipe" });
    const gG = ctx.drafts.group({ system: "plumbing", type: "RW", floor: 0, loc: tag, name: `Rainwater shoe + recharge ${tag}`, assemblyType: "rainwater", category: "rainwater", materialId: "pvc_pipe" });
    const spec = (g: Group, extra: Partial<RunSpec> = {}): RunSpec => ({ kind: "pipe", group: g, networkId: netId, od: pipe.od, materialId: "pvc_pipe", componentType: "rainwater_pipe", label: `${pipe.nominal} pipe`, nominal: pipe.nominal, flow: "downstream", ...extra });
    const net = new Net();
    const xp = top.originalPosition[0];
    // Roof outlet: horizontal from under the grating into the side of the A2 downpipe (saddle
    // branch: the gable band leaves no room for a junction fitting), falling 1:100, its invert
    // kept above the roof slab and the floor band.
    const slabTop = ctx.d.slabTop(RF);
    const drop = Math.abs(xp - dx) * C.slope.underground;
    const y1 = slabTop + pipe.od / 2 + 0.006;
    const y0 = y1 + drop;
    const a = net.node([dx, y0, dz], { record: drn.id });
    const j = net.node([xp, y1, dz], { record: top.id });
    net.edge(a, j, spec(gRoof, { gradient: C.slope.underground, label: "110 mm roof outlet through the parapet (saddle branch into the downpipe)" }));
    // Foot: shoe offset out past the plinth, down below grade, then to a recharge pit.
    const fg = foot.geometry as { height: number };
    const yb = foot.originalPosition[1] - fg.height / 2;
    const out = Math.sign(xp);
    const x1 = xp + out * 0.22;
    const pitX = xp + out * 2.6;
    const yU = ctx.arch.datums.siteGrade - 0.35;
    const f0 = net.node([xp, yb + 0.12, dz], { record: foot.id });
    const f1 = net.node([xp, yb, dz]);
    const f2 = net.node([x1, yb, dz]);
    const f3 = net.node([x1, yU, dz]);
    const f4 = net.node([pitX, yU - Math.abs(pitX - x1) * C.slope.underground, dz]);
    net.edge(f0, f1, spec(gG, { label: "downpipe shoe stub" }));
    net.edge(f1, f2, spec(gG, { label: "offset past the plinth" }));
    net.edge(f2, f3, spec(gG, { label: "110 mm rainwater drop to below grade" }));
    net.edge(f3, f4, spec(gG, { gradient: C.slope.underground, componentType: "storm_drain", label: "110 mm underground storm pipe", materialId: "upvc_drain" }));
    const pit = pitRecord(ctx, gG, netId, [pitX, ctx.arch.datums.siteGrade, dz]);
    net.setRecord(f4, pit);
    net.emit(ctx.drafts);
    // The roof outlet and the shoe are one network through the A2 downpipe stack; the shoe's
    // offset leaves from inside the downpipe foot.
    const outlet = net.runsAt(a)[0]!;
    const shoe = net.runsAt(f0)[0]!;
    ctx.drafts.link(outlet, shoe);
    for (const run of net.runsAt(f1)) ctx.drafts.link(run, foot.id);
    indexDrafts(ctx, from);
    for (const id of [drn.id, top.id, foot.id]) ctx.endpoints.get(id)?.connectedBy.push(netId);
  }
}

function pitRecord(ctx: MepContext, g: Group, netId: string, top: V3): string {
  const S = FIXED_PARTS["recharge-pit"];
  const pl = placeLocal(top, [1, 0, 0], [0, 1, 0], sub(S.centre, scale(S.size, 0.5)), add(S.centre, scale(S.size, 0.5)));
  return ctx.drafts.add(g, {
    code: "PIT",
    name: `${g.name}: rainwater recharge pit (1.2 m dia., filter media)`,
    componentType: "recharge_pit",
    materialId: "concrete_precast",
    geometry: { kind: "part", part: "recharge-pit", size: pl.size, fill: PART_FILL["recharge-pit"]! },
    position: pl.position,
    rotation: pl.rotation,
    dimensions: { length: pl.size[0], width: pl.size[2], height: pl.size[1] },
    unit: "nr",
    networkId: netId,
    nominalSize: "1.2 m dia. x 2.0 m",
    assumptions: "Conceptual rainwater recharge pit (filter media, perforated cover); capacity not designed.",
  }).id;
}

