/**
 * MEP record drafts (A3). Generators build mutable drafts (connections are only known once
 * a whole network is laid out), then `finalize` freezes them into ComponentRecords that
 * extend the shared model exactly like A1/A2 records:
 *   id        PLB|ELC-{TYPE}-{floor tag}-{group location}-{code}{nn}
 *   parentId  the group assembly (a real `group` record whose envelope holds its children)
 *   quantity  from unit + dimensions (m = route length, nr = 1), as in A2 (`quantityFor`)
 *   networkId network / circuit membership; connectedTo = physical joints (symmetric
 *             between MEP records; A2 endpoints are referenced, never modified)
 */

import { buildComponentId } from "../ids";
import type { ComponentDimensions } from "../types";
import { recordBounds, type ComponentRecord, type MepCategory, type SolidDescriptor, type Vec3 } from "../structure";
import { quantityFor, type ArcUnit } from "../architecture/record";
import { hasMaterial } from "../materialLibrary";

export type MepSystem = "plumbing" | "electrical";

/** ID TYPE segments. Plumbing: cold/hot water, drainage, vent, rainwater, external sewer. */
export type PlbType = "CW" | "HW" | "DR" | "VT" | "RW" | "SEW";
/** Electrical: incoming, panels/DBs, submains, trays, conduits, final-circuit cables, devices, light fittings, earthing. */
export type ElcType = "INC" | "PNL" | "SUB" | "TRY" | "CND" | "CBL" | "DEV" | "LGT" | "EAR";
export type MepType = PlbType | ElcType;

export interface GroupSpec {
  readonly system: MepSystem;
  readonly type: MepType;
  readonly floor: number;
  readonly loc: string;
  readonly name: string;
  readonly assemblyType: string;
  readonly category: MepCategory;
  readonly materialId: string;
  readonly apartmentId?: string;
  readonly roomId?: string;
}

export interface Group extends GroupSpec {
  readonly id: string;
}

export interface DraftInput {
  readonly code: string; // P, F, V, ... (numbered per group) or a fixed suffix when `fixed`
  readonly fixed?: boolean;
  readonly name: string;
  readonly componentType: string;
  readonly materialId: string;
  readonly geometry: SolidDescriptor;
  readonly position: Vec3;
  readonly rotation?: Vec3;
  readonly dimensions: ComponentDimensions;
  readonly unit: ArcUnit;
  readonly networkId: string;
  readonly category?: MepCategory;
  readonly roomId?: string;
  readonly nominalSize?: string;
  readonly gradient?: number;
  readonly flowFrom?: Vec3;
  readonly flowTo?: Vec3;
  readonly carries?: readonly string[];
  readonly assumptions?: string;
}

export interface Draft extends DraftInput {
  readonly id: string;
  readonly group: Group;
  readonly connections: Set<string>;
  readonly dependencies: string[];
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

export class MepDrafts {
  private readonly groups = new Map<string, Group>();
  private readonly counters = new Map<string, number>();
  readonly drafts: Draft[] = [];
  readonly byId = new Map<string, Draft>();

  group(spec: GroupSpec): Group {
    const id = buildComponentId({ system: spec.system, type: spec.type, floor: spec.floor, location: spec.loc });
    let g = this.groups.get(id);
    if (!g) this.groups.set(id, (g = Object.freeze({ ...spec, id })));
    return g;
  }

  add(group: Group, d: DraftInput): Draft {
    let id: string;
    if (d.fixed) id = `${group.id}-${d.code}`;
    else {
      const key = `${group.id}|${d.code}`;
      const n = (this.counters.get(key) ?? 0) + 1;
      this.counters.set(key, n);
      id = `${group.id}-${d.code}${pad(n, d.code.length === 1 ? 3 : 2)}`;
    }
    if (this.byId.has(id)) throw new Error(`MEP: duplicate id ${id}`);
    const draft: Draft = { ...d, id, group, connections: new Set(), dependencies: [] };
    this.drafts.push(draft);
    this.byId.set(id, draft);
    return draft;
  }

  /** Physical joint. Both directions between MEP drafts; one direction toward external (A2) records. */
  link(a: string, b: string): void {
    if (a === b) return;
    const da = this.byId.get(a);
    const db = this.byId.get(b);
    if (!da && !db) throw new Error(`MEP: link between two external records ${a} / ${b}`);
    da?.connections.add(b);
    db?.connections.add(a);
  }

  /** `id` is fed from / drains into `upstream` (dependency direction for Part B). */
  dependsOn(id: string, upstream: string): void {
    const d = this.byId.get(id);
    if (d && !d.dependencies.includes(upstream)) d.dependencies.push(upstream);
  }

  get(id: string): Draft {
    const d = this.byId.get(id);
    if (!d) throw new Error(`MEP: unknown draft ${id}`);
    return d;
  }

  /** Freeze drafts into records: each group's assembly record precedes its children. */
  finalize(): ComponentRecord[] {
    const children = new Map<string, Draft[]>();
    for (const d of this.drafts) {
      let l = children.get(d.group.id);
      if (!l) children.set(d.group.id, (l = []));
      l.push(d);
    }
    const out: ComponentRecord[] = [];
    for (const g of this.groups.values()) {
      const kids = children.get(g.id);
      if (!kids?.length) continue;
      const recs = kids.map((d) => toRecord(d));
      const min: [number, number, number] = [Infinity, Infinity, Infinity];
      const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const r of recs) {
        const b = recordBounds(r);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, b.min[k]!);
          max[k] = Math.max(max[k]!, b.max[k]!);
        }
      }
      if (!hasMaterial(g.materialId)) throw new Error(`MEP: unknown material ${g.materialId}`);
      const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      const geometry = Object.freeze({ kind: "group" as const, size: Object.freeze(size) as Vec3 });
      const dims: ComponentDimensions = { length: size[0], width: size[2], height: size[1] };
      out.push(
        Object.freeze({
          id: g.id,
          name: g.name,
          system: g.system,
          componentType: `${g.assemblyType}_assembly`,
          assemblyType: g.assemblyType,
          floor: g.floor,
          materialId: g.materialId,
          dimensions: Object.freeze(dims),
          quantity: 1,
          unit: "nr" as const,
          condition: "good" as const,
          recoveryRoute: "inspect" as const,
          confidence: "assumed" as const,
          ...(g.apartmentId !== undefined ? { apartmentId: g.apartmentId } : {}),
          ...(g.roomId !== undefined ? { roomId: g.roomId } : {}),
          dependencies: Object.freeze([]),
          originalPosition: Object.freeze([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]) as Vec3,
          originalRotation: Object.freeze([0, 0, 0]) as Vec3,
          assembly: g.category,
          geometry,
          assumptions: "Conceptual MEP planning model (A3); grouping assembly, not a physical item.",
        }),
      );
      out.push(...recs);
    }
    return out;
  }
}

function toRecord(d: Draft): ComponentRecord {
  if (!hasMaterial(d.materialId)) throw new Error(`MEP: unknown material ${d.materialId} on ${d.id}`);
  const g = d.group;
  return Object.freeze({
    id: d.id,
    name: d.name,
    system: g.system,
    componentType: d.componentType,
    assemblyType: g.assemblyType,
    floor: g.floor,
    materialId: d.materialId,
    dimensions: Object.freeze({ ...d.dimensions }),
    quantity: quantityFor(d.unit, d.dimensions, d.geometry),
    unit: d.unit,
    condition: "good" as const,
    recoveryRoute: "inspect" as const,
    confidence: "assumed" as const,
    parentId: g.id,
    ...(g.apartmentId !== undefined ? { apartmentId: g.apartmentId } : {}),
    ...((d.roomId ?? g.roomId) !== undefined ? { roomId: d.roomId ?? g.roomId } : {}),
    dependencies: Object.freeze([...d.dependencies]),
    originalPosition: Object.freeze([...d.position]) as Vec3,
    originalRotation: Object.freeze([...(d.rotation ?? [0, 0, 0])]) as Vec3,
    assembly: d.category ?? g.category,
    geometry: Object.freeze(d.geometry),
    networkId: d.networkId,
    connectedTo: Object.freeze([...d.connections].sort()),
    ...(d.carries ? { carries: Object.freeze([...d.carries]) } : {}),
    ...(d.nominalSize ? { nominalSize: d.nominalSize } : {}),
    ...(d.gradient !== undefined ? { gradient: d.gradient } : {}),
    ...(d.flowFrom ? { flowFrom: Object.freeze([...d.flowFrom]) as Vec3 } : {}),
    ...(d.flowTo ? { flowTo: Object.freeze([...d.flowTo]) as Vec3 } : {}),
    assumptions: d.assumptions ?? "Conceptual MEP planning model (A3): routing, sizes and quantities are planning assumptions, not a construction-ready or code-certified design.",
    source: "A3 generator",
  });
}
