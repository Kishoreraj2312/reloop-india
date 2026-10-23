/** Test helpers: build minimal ComponentRecords with a hand-written geometry. */
import type { ComponentRecord, GeometryDescriptor } from "@/building/structure";

export interface RecInput {
  readonly id: string;
  readonly componentType: string;
  readonly geometry: GeometryDescriptor;
  readonly unit?: "m3" | "m2" | "m" | "nr";
  readonly quantity?: number;
  readonly materialId?: string;
  readonly floor?: number;
  readonly system?: ComponentRecord["system"];
  readonly parentId?: string;
  readonly assemblyType?: string;
  readonly dependencies?: readonly string[];
  readonly rotation?: readonly [number, number, number];
  readonly dimensions?: ComponentRecord["dimensions"];
}

export function rec(i: RecInput): ComponentRecord {
  return {
    id: i.id,
    name: i.id,
    system: i.system ?? "architecture",
    componentType: i.componentType,
    ...(i.assemblyType !== undefined ? { assemblyType: i.assemblyType } : {}),
    floor: i.floor ?? 0,
    materialId: i.materialId ?? "rcc_conceptual",
    dimensions: i.dimensions ?? {},
    quantity: i.quantity ?? 0,
    unit: i.unit ?? "m3",
    condition: "good",
    recoveryRoute: "inspect",
    confidence: "assumed",
    ...(i.parentId !== undefined ? { parentId: i.parentId } : {}),
    dependencies: i.dependencies ?? [],
    originalPosition: [0, 0, 0],
    originalRotation: i.rotation ?? [0, 0, 0],
    assembly: "exteriorWalls",
    geometry: i.geometry,
  };
}

export const box = (sx: number, sy: number, sz: number): GeometryDescriptor => ({ kind: "box", size: [sx, sy, sz] });
