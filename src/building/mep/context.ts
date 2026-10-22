/**
 * Shared state for the MEP generators (A3): the A1/A2 model they connect to, spatial indexes
 * over the building and over MEP items placed so far, the network registry and the record
 * of every A2 service endpoint (connected, or unresolved with a reason).
 */

import type { BuildingConfig } from "../config";
import { buildGrid, recordBounds, type Box3, type ComponentRecord, type GridModel } from "../structure";
import { getStructure } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchDatums, type ArchitectureConfig } from "../architecture/config";
import { getArchitecture, type ArchitectureModel } from "../architecture/generate";
import { interiorContext, type InteriorContext } from "../architecture/interior";
import type { PlanRect } from "../architecture/rect";
import { MepDrafts, type Draft } from "./record";
import { SpaceIndex, box3 } from "./space";
import { MEP_CONFIG } from "./config";

export interface NetworkInfo {
  readonly id: string;
  readonly system: "plumbing" | "electrical";
  readonly kind: string; // "cold-water", "hot-water", "drainage", "rainwater", "sewer", "submain", "circuit", ...
  readonly name: string;
  readonly floor?: number;
  readonly apartmentId?: string;
  /** Upstream network (supply) / receiving network (drainage), where there is one. */
  readonly parent?: string;
}

export interface Endpoint {
  readonly id: string; // A2 record id
  readonly role: string; // "cold supply", "waste", "soil", "floor drain", "light", ...
  connectedBy: string[];
  unresolved?: string;
}

export interface Unresolved {
  readonly subject: string;
  readonly reason: string;
}

/** Equipment the electrical model must feed (placed by the plumbing generators). */
export interface Appliance {
  readonly kind: "geyser" | "pump" | "pump-panel";
  readonly id: string;
  readonly storey: number;
  readonly aptId?: string;
  readonly roomId?: string;
  /** Wall-mounted items: mount side info for a socket beside them. */
  readonly anchor: readonly [number, number, number];
  readonly along?: readonly [number, number, number];
  readonly normal?: readonly [number, number, number];
}

/** A2 component types services may pass through (sleeved penetrations, chases, finishes). */
export const MASONRY = new Set([
  "wall_pier",
  "wall_sill",
  "wall_reveal",
  "wall_lintel",
  "wall_above",
  "wall_tile_panel",
  "kitchen_backsplash",
  "parapet",
  "enclosure_wall_masonry",
  "enclosure_wall_lintel",
  "enclosure_wall_above_lintel",
  "shaft_upstand",
]);
export const FINISHES = new Set(["floor_screed", "floor_tile", "skirting", "roof_finish", "enclosure_floor"]);
export const CEILINGS = new Set(["ceiling_board", "ceiling_cove", "ceiling_fascia"]);

export interface MepContext {
  readonly cfg: BuildingConfig;
  readonly arch: ArchitectureConfig;
  readonly grid: GridModel;
  readonly d: ArchDatums;
  readonly model: ArchitectureModel;
  readonly structure: readonly ComponentRecord[];
  readonly archRecords: readonly ComponentRecord[];
  readonly byId: ReadonlyMap<string, ComponentRecord>;
  /** A1 + A2 geometry. */
  readonly space: SpaceIndex;
  /** MEP items placed so far (drafts as solids). */
  readonly mep: SpaceIndex;
  readonly interiors: readonly InteriorContext[];
  readonly drafts: MepDrafts;
  readonly networks: Map<string, NetworkInfo>;
  readonly endpoints: Map<string, Endpoint>;
  readonly unresolved: Unresolved[];
  readonly appliances: Appliance[];
}

export function createContext(cfg: BuildingConfig): MepContext {
  const model = getArchitecture(cfg);
  const structure = getStructure(cfg);
  const archRecords = model.records;
  const byId = new Map<string, ComponentRecord>();
  for (const r of structure) byId.set(r.id, r);
  for (const r of archRecords) byId.set(r.id, r);
  return {
    cfg,
    arch: ARCH_CONFIG,
    grid: buildGrid(cfg),
    d: archDatums(cfg, ARCH_CONFIG),
    model,
    structure,
    archRecords,
    byId,
    space: new SpaceIndex([...structure, ...archRecords]),
    mep: new SpaceIndex(),
    interiors: model.storeys.map((s) => interiorContext(s.plan, cfg, ARCH_CONFIG)),
    drafts: new MepDrafts(),
    networks: new Map(),
    endpoints: new Map(),
    unresolved: [],
    appliances: [],
  };
}

export function declareNetwork(ctx: MepContext, n: NetworkInfo): string {
  if (!ctx.networks.has(n.id)) ctx.networks.set(n.id, n);
  return n.id;
}

/** Register an A2 endpoint the MEP model must serve. */
export function endpoint(ctx: MepContext, id: string, role: string): Endpoint {
  let e = ctx.endpoints.get(id);
  if (!e) ctx.endpoints.set(id, (e = { id, role, connectedBy: [] }));
  return e;
}

export function unresolved(ctx: MepContext, subject: string, reason: string): void {
  ctx.unresolved.push({ subject, reason });
  const e = ctx.endpoints.get(subject);
  if (e && !e.connectedBy.length) e.unresolved = reason;
}

/** Draft -> solid (for the MEP spatial index). */
export function draftSolid(d: Draft): ComponentRecord {
  return { id: d.id, geometry: d.geometry, originalPosition: d.position, originalRotation: d.rotation ?? [0, 0, 0] } as unknown as ComponentRecord;
}

/** Index drafts created since `from` (call after emitting a network). */
export function indexDrafts(ctx: MepContext, from: number): void {
  for (let i = from; i < ctx.drafts.drafts.length; i++) ctx.mep.add(draftSolid(ctx.drafts.drafts[i]!));
}

// ── obstacles ──────────────────────────────────────────────────────────────────

const toRect = (b: Box3, grow: number): PlanRect => ({ x0: b.min[0] - grow, x1: b.max[0] + grow, z0: b.min[2] - grow, z1: b.max[2] + grow });

/**
 * Plan obstacles for a horizontal run at height y (radius r) inside `area`: every A1/A2
 * solid in that height band except what services may pass (masonry, finishes, ceilings),
 * plus every MEP item placed so far. Inflated by the service clearance.
 */
export function planObstacles(ctx: MepContext, area: PlanRect, y: number, r: number, opts: { allow?: (r: ComponentRecord) => boolean; extraMep?: boolean; ignore?: ReadonlySet<string> } = {}): PlanRect[] {
  const vc = 0.004; // vertical clearance (layers are stacked tightly under the beams)
  const q = box3(area.x0, area.x1, y - r - vc, y + r + vc, area.z0, area.z1);
  const out: PlanRect[] = [];
  const clr = MEP_CONFIG.clearance;
  for (const rec of ctx.space.query(q, (x) => !MASONRY.has(x.componentType) && !CEILINGS.has(x.componentType) && !FINISHES.has(x.componentType) && !(opts.allow?.(x) ?? false)))
    out.push(toRect(recordBounds(rec), clr));
  if (opts.extraMep !== false) for (const rec of ctx.mep.query(q, opts.ignore ? (x) => !opts.ignore!.has(x.id) : undefined)) out.push(toRect(recordBounds(rec), clr));
  return out;
}

export const rectOfBounds = toRect;
