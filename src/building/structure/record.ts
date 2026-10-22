/**
 * ReLoop India — shared record factory for A1 structural generators.
 */

import { buildComponentId } from "../ids";
import type { ComponentDimensions } from "../types";
import {
  descriptorVolume,
  type AssemblyName,
  type ComponentRecord,
  type GeometryDescriptor,
  type Vec3,
} from "./geometry";
import { STRUCTURAL_MATERIAL } from "./grid";

export interface RecordInput {
  /** ID segments: TYPE (FTG, COL, ...) and LOCATION. Floor comes from `floor`. */
  readonly type: string;
  readonly location: string;
  readonly name: string;
  readonly componentType: string;
  /** A0 floor index: -1 foundation, 0 ground .. 4, 5 roof. */
  readonly floor: number;
  readonly assembly: AssemblyName;
  readonly position: Vec3;
  readonly geometry: GeometryDescriptor;
  readonly dimensions: ComponentDimensions;
  readonly parentId?: string;
  /** IDs of members this one is supported by / bears on (conceptual, refined in B3). */
  readonly dependencies?: readonly string[];
}

/** Build a frozen ComponentRecord with the A1 defaults (conceptual RCC, assumed). */
export function makeRecord(input: RecordInput): ComponentRecord {
  const id = buildComponentId({
    system: "structure",
    type: input.type,
    floor: input.floor,
    location: input.location,
  });
  const record: ComponentRecord = {
    id,
    name: input.name,
    system: "structure",
    componentType: input.componentType,
    floor: input.floor,
    materialId: STRUCTURAL_MATERIAL.id,
    dimensions: Object.freeze({ ...input.dimensions }),
    quantity: descriptorVolume(input.geometry),
    unit: "m3",
    condition: "good",
    recoveryRoute: "inspect",
    confidence: "assumed",
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    dependencies: Object.freeze([...(input.dependencies ?? [])]),
    originalPosition: Object.freeze([...input.position]) as Vec3,
    originalRotation: Object.freeze([0, 0, 0]) as Vec3,
    assembly: input.assembly,
    geometry: input.geometry,
  };
  return Object.freeze(record);
}

/** Convenience: record for an axis-aligned box centred at `position`. */
export function boxGeometry(sx: number, sy: number, sz: number): GeometryDescriptor {
  return Object.freeze({ kind: "box" as const, size: Object.freeze([sx, sy, sz]) as Vec3 });
}
