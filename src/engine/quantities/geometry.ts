/**
 * Per-record measures from the geometry descriptor (B1).
 *
 *   box       volume sx·sy·sz of the LOCAL size (rotation about X for sloping rails/strings is
 *             ignored: the world bounding box of a rotated box is larger than the member)
 *   prism     volume = polygon area × extent (shoelace, exact — never the bounding box)
 *   cylinder  π r² h
 *   part      catalogue part: envelope volume × fill fraction (estimated; not a product volume)
 *   group     no physical quantity
 *
 * Every input is validated (finite and > 0). A bad input gives value null and a structured
 * issue, never 0.
 */

import { polygonArea, type ComponentRecord, type GeometryDescriptor, type Point2 } from "@/building/structure";
import type { QuantityIssue, QuantityResult, Kind, Status, Unit } from "./types";
import { KIND_UNIT } from "./types";

export const NO_ISSUES: readonly QuantityIssue[] = Object.freeze([]);
export const NO_TEXT: readonly string[] = Object.freeze([]);

export function issue(code: QuantityIssue["code"], message: string, componentId?: string, severity: QuantityIssue["severity"] = "warning"): QuantityIssue {
  return componentId === undefined ? { code, message, severity } : { code, message, componentId, severity };
}

export function result(
  kind: Kind,
  value: number | null,
  status: Status,
  method: string,
  sourceIds: readonly string[],
  assumptions: readonly string[] = NO_TEXT,
  issues: readonly QuantityIssue[] = NO_ISSUES,
  unit: Unit = KIND_UNIT[kind],
): QuantityResult {
  return { kind, value, unit, status: value === null ? "unavailable" : status, method, assumptions, issues, sourceIds };
}

export const unavailable = (kind: Kind, method: string, sourceIds: readonly string[], issues: readonly QuantityIssue[], assumptions: readonly string[] = NO_TEXT): QuantityResult =>
  result(kind, null, "unavailable", method, sourceIds, assumptions, issues);

/** Largest relative difference tolerated between a recomputed measure and record.quantity. */
export const RECORD_TOLERANCE = 1e-9;

const ok = (n: number): boolean => Number.isFinite(n) && n > 0;

/** First invalid dimension in a descriptor, or null. */
export function invalidDimension(g: GeometryDescriptor): string | null {
  switch (g.kind) {
    case "box":
    case "group":
      return g.size.every(ok) ? null : `size [${g.size.join(", ")}] must be finite and > 0`;
    case "prism":
      if (!ok(g.extent)) return `extent ${g.extent} must be finite and > 0`;
      if (g.profile.length < 3 || g.profile.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return "profile needs ≥ 3 finite points";
      return ok(polygonArea(g.profile)) ? null : "profile area must be > 0";
    case "cylinder":
      return ok(g.radius) && ok(g.height) ? null : `radius ${g.radius} / height ${g.height} must be finite and > 0`;
    case "part":
      if (!g.size.every(ok)) return `size [${g.size.join(", ")}] must be finite and > 0`;
      return ok(g.fill) && g.fill <= 1 ? null : `fill ${g.fill} must be in (0, 1]`;
  }
}

const M_VOLUME: Record<GeometryDescriptor["kind"], string> = {
  box: "box: sx·sy·sz of the local size (rotation ignored)",
  prism: "prism: polygon area (shoelace) × extent",
  cylinder: "cylinder: π·r²·h",
  part: "catalogue part: envelope sx·sy·sz × fill fraction",
  group: "assembly: no physical volume",
};

/** Raw volume in m3, or null when the geometry cannot give one. */
export function rawVolume(g: GeometryDescriptor): number | null {
  if (g.kind === "group" || invalidDimension(g) !== null) return null;
  switch (g.kind) {
    case "box":
      return g.size[0] * g.size[1] * g.size[2];
    case "prism":
      return polygonArea(g.profile) * g.extent;
    case "cylinder":
      return Math.PI * g.radius * g.radius * g.height;
    case "part":
      return g.size[0] * g.size[1] * g.size[2] * g.fill;
  }
}

export function volumeResult(rec: ComponentRecord): QuantityResult {
  const g = rec.geometry;
  const ids = [rec.id];
  if (g.kind === "group") return unavailable("volume", M_VOLUME.group, ids, [issue("UNSUPPORTED_GEOMETRY", "assemblies carry no physical volume; sum their parts", rec.id, "info")]);
  const bad = invalidDimension(g);
  if (bad) return unavailable("volume", M_VOLUME[g.kind], ids, [issue("INVALID_VALUE", `${rec.id}: ${bad}`, rec.id)]);
  const v = rawVolume(g)!;
  return g.kind === "part"
    ? result("volume", v, "estimated", M_VOLUME.part, ids, ["fill is the catalogue's solid fraction of the envelope"])
    : result("volume", v, "calculated", M_VOLUME[g.kind], ids);
}

/** Plan area of a prism in the xz plane (a horizontal slab panel): the exact polygon area. */
export function prismPlanArea(g: GeometryDescriptor): number | null {
  return g.kind === "prism" && g.plane === "xz" && invalidDimension(g) === null ? polygonArea(g.profile) : null;
}

const sortedDesc = (s: readonly [number, number, number]): [number, number, number] => [...s].sort((a, b) => b - a) as [number, number, number];

/**
 * Area of a panel: the exposed face = the two largest sides of the box (horizontal panels:
 * length × width in plan; vertical panels: length × height). A prism in xz gives its polygon area.
 */
export function areaResult(rec: ComponentRecord): QuantityResult {
  const g = rec.geometry;
  const ids = [rec.id];
  const bad = g.kind === "group" ? null : invalidDimension(g);
  if (bad) return unavailable("area", "panel face", ids, [issue("INVALID_VALUE", `${rec.id}: ${bad}`, rec.id)]);
  if (g.kind === "box") {
    const [a, b] = sortedDesc(g.size);
    return result("area", a * b, "calculated", "box panel: two largest sides (length × width, or length × height)", ids);
  }
  const pa = prismPlanArea(g);
  if (pa !== null) return result("area", pa, "calculated", "prism plan area (polygon, shoelace)", ids);
  return unavailable("area", "panel face", ids, [issue("UNSUPPORTED_GEOMETRY", `${rec.id}: area from ${g.kind} geometry is not defined`, rec.id)]);
}

/**
 * Length of a linear item: the longest box side (cylinder: its height). A short piece of a
 * vertical strip (a skirting return 0.07 m long × 0.10 m high) has its length on a shorter axis,
 * so when record.dimensions.length equals one of the box sides, that side is the length. The
 * value always comes from the geometry; the dimension only picks which axis.
 */
export function lengthResult(rec: ComponentRecord): QuantityResult {
  const g = rec.geometry;
  const ids = [rec.id];
  const bad = g.kind === "group" ? null : invalidDimension(g);
  if (bad) return unavailable("length", "linear item", ids, [issue("INVALID_VALUE", `${rec.id}: ${bad}`, rec.id)]);
  if (g.kind === "box" || g.kind === "part") {
    const dl = rec.dimensions.length;
    const side = dl === undefined ? undefined : g.size.find((x) => Math.abs(x - dl) <= RECORD_TOLERANCE * Math.max(1, dl));
    if (side !== undefined) return result("length", side, "calculated", "box side that equals record.dimensions.length (the longest side for ordinary members)", ids);
    return result("length", Math.max(...g.size), "calculated", "longest side of the local box", ids);
  }
  if (g.kind === "cylinder") return result("length", g.height, "calculated", "cylinder height (axis length)", ids);
  return unavailable("length", "linear item", ids, [issue("UNSUPPORTED_GEOMETRY", `${rec.id}: length from ${g.kind} geometry is not defined`, rec.id)]);
}

export function countResult(rec: ComponentRecord): QuantityResult {
  return result("count", 1, "calculated", "one item", [rec.id]);
}

export function matchesRecord(value: number, recorded: number): boolean {
  return Math.abs(value - recorded) <= RECORD_TOLERANCE * Math.max(1, Math.abs(recorded));
}

export type { Point2 };
