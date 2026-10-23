/**
 * Masonry takeoff per wall assembly (B1).
 *
 * A2 builds walls without CSG: the openings are absent from the wall pieces. So
 *   net masonry   = Σ volume of pieces with roles pier / sill / reveal / above   (what is built)
 *   lintel        = Σ volume of wall_lintel pieces (RCC, reported under concrete)
 *   void          = the opening itself, per hosted opening (deducted once, keyed by opening id)
 *   gross         = net + lintel + Σ voids                                        (solid wall band)
 * Reveals are real pieces, so they are not deducted again. Void volumes use the hosted opening
 * extents from the architecture model:
 *   door   (o1 − o0) × (head − bottom) × t            bottom = slab top
 *   window (o1 − o0) × (head − bottom + stoneSill) × t  the stone sill (part of the window
 *                                                       assembly) sits in the gap below `bottom`
 * Face areas: gross face = gross / t, net face = net / t (t = wall thickness; a division, not a
 * measured area: it is exact when every piece has the full thickness, which is checked).
 */

import type { ComponentRecord } from "@/building/structure";
import { ARCH_CONFIG } from "@/building/architecture/config";
import type { ArchitectureModel } from "@/building/architecture/generate";
import type { WallBuild } from "@/building/architecture/walls";
import { issue, NO_TEXT, result, unavailable, rawVolume } from "./geometry";
import type { QuantityIssue, QuantityResult } from "./types";

export interface OpeningVoid {
  readonly openingId: string; // the door / window / cased-opening assembly
  readonly kind: "door" | "window";
  readonly hostWallId: string;
  readonly volumeM3: number;
}

export interface WallTakeoff {
  readonly wallId: string;
  readonly floor: number;
  readonly thicknessM: number | null;
  readonly net: QuantityResult; // m3
  readonly lintel: QuantityResult; // m3
  readonly voids: QuantityResult; // m3, Σ of `openings`
  readonly gross: QuantityResult; // m3
  readonly netFaceArea: QuantityResult; // m2
  readonly grossFaceArea: QuantityResult; // m2
  readonly openings: readonly OpeningVoid[];
  readonly pieceIds: readonly string[];
  readonly issues: readonly QuantityIssue[];
}

export interface WallTakeoffs {
  readonly walls: readonly WallTakeoff[];
  readonly issues: readonly QuantityIssue[];
}

const MASONRY_TYPES = new Set(["wall_pier", "wall_sill", "wall_reveal", "wall_above"]);
const OPENING_ASSEMBLY = new Set(["door", "window", "cased_opening"]);

function pieceVolume(rec: ComponentRecord): number | null {
  return rawVolume(rec.geometry);
}

export function wallTakeoffs(records: readonly ComponentRecord[], model?: ArchitectureModel): WallTakeoffs {
  const byWall = new Map<string, ComponentRecord[]>();
  const walls: ComponentRecord[] = [];
  const openingAssemblies: ComponentRecord[] = [];
  for (const r of records) {
    if (r.componentType === "wall_assembly") {
      walls.push(r);
      byWall.set(r.id, []);
    } else if (r.geometry.kind === "group" && r.assemblyType && OPENING_ASSEMBLY.has(r.assemblyType)) openingAssemblies.push(r);
  }
  for (const r of records) if (r.parentId && (r.componentType.startsWith("wall_") && r.componentType !== "wall_assembly") && byWall.has(r.parentId)) byWall.get(r.parentId)!.push(r);

  const built = new Map<string, WallBuild>();
  for (const s of model?.storeys ?? []) for (const w of s.walls) built.set(w.id, w);

  // Opening assembly -> hosted opening, keyed by (host wall id | lintel piece id). Each key is used once.
  const assemblyByKey = new Map<string, ComponentRecord>();
  const global: QuantityIssue[] = [];
  for (const o of openingAssemblies) {
    const host = o.dependencies[0];
    const lintel = o.dependencies[1];
    if (!host || !lintel) {
      global.push(issue("UNLINKED_OPENING", `${o.id}: dependencies do not name a host wall and a lintel`, o.id));
      continue;
    }
    const key = `${host}|${lintel}`;
    if (assemblyByKey.has(key)) global.push(issue("UNLINKED_OPENING", `${o.id}: opening ${key} is already claimed by ${assemblyByKey.get(key)!.id}`, o.id));
    else assemblyByKey.set(key, o);
  }
  const used = new Set<string>();

  const out: WallTakeoff[] = walls.map((w) => {
    const pieces = byWall.get(w.id)!;
    const issues: QuantityIssue[] = [];
    let net = 0;
    let lintel = 0;
    let bad = 0;
    const netIds: string[] = [];
    const lintelIds: string[] = [];
    let thin = 0;
    // Thickness: the assembly's own, or (stairwell lining, a U of three piers) the one all its pieces share.
    let t0w = w.dimensions.thickness;
    if (t0w === undefined) {
      const ts = pieces.map((p) => p.dimensions.thickness);
      const t0 = ts[0];
      if (t0 !== undefined && ts.every((x) => x !== undefined && Math.abs(x - t0) <= 1e-9)) t0w = t0;
    }
    const t: number | null = typeof t0w === "number" && Number.isFinite(t0w) && t0w > 0 ? t0w : null;
    const tOk = t !== null;
    for (const p of pieces) {
      const v = pieceVolume(p);
      if (v === null) {
        bad++;
        issues.push(issue("INVALID_VALUE", `${p.id}: piece has no valid volume`, p.id));
      } else if (MASONRY_TYPES.has(p.componentType)) {
        net += v;
        netIds.push(p.id);
      } else if (p.componentType === "wall_lintel") {
        lintel += v;
        lintelIds.push(p.id);
      }
      const th = p.dimensions.thickness;
      if (t !== null && th !== undefined && Math.abs(th - t) > 1e-9) thin++;
    }
    if (!tOk) issues.push(issue("MISSING_DIMENSION", `${w.id}: wall thickness is missing`, w.id));

    // Voids from the hosted openings of this wall.
    const openings: OpeningVoid[] = [];
    let linked = true;
    const hb = built.get(w.id);
    const stone = ARCH_CONFIG.openings.stoneSill.thickness;
    if (!model) {
      linked = false;
      issues.push(issue("MISSING_DIMENSION", `${w.id}: architecture model not provided, hosted openings are unknown`, w.id));
    } else if (!hb) {
      if (lintelIds.length > 0) {
        linked = false;
        issues.push(issue("UNLINKED_OPENING", `${w.id}: has ${lintelIds.length} lintel(s) but is not in the architecture model's hosted walls`, w.id));
      }
    } else {
      for (const op of hb.openings) {
        const a = assemblyByKey.get(`${w.id}|${op.lintelId}`);
        if (!a || used.has(a.id)) {
          linked = false;
          issues.push(issue("UNLINKED_OPENING", `${w.id}: hosted opening ${op.key} (lintel ${op.lintelId}) has no unique door/window assembly`, w.id));
          continue;
        }
        used.add(a.id);
        const tt = t ?? hb.across[1] - hb.across[0];
        const heightM = op.kind === "window" ? op.head - op.bottom + stone : op.head - op.bottom;
        openings.push({ openingId: a.id, kind: op.kind, hostWallId: w.id, volumeM3: (op.o1 - op.o0) * heightM * tt });
      }
    }
    const voidSum = openings.reduce((s, o) => s + o.volumeM3, 0);
    const ids = [w.id, ...netIds, ...lintelIds];
    const netR = bad > 0 || !tOk ? unavailable("volume", "Σ masonry pieces", ids, issues) : result("volume", net, "calculated", "Σ volume of pier + sill + reveal + above pieces", netIds, NO_TEXT);
    const lintelR = result("volume", lintel, "calculated", "Σ volume of wall_lintel pieces (RCC; concrete category)", lintelIds);
    const voidR = linked ? result("volume", voidSum, "calculated", "Σ hosted opening voids (door: (o1−o0)(head−bottom)t; window adds the stone sill thickness)", openings.map((o) => o.openingId)) : result("volume", voidSum, "estimated", "Σ voids of the openings that could be linked", openings.map((o) => o.openingId), ["some openings could not be linked to this wall"]);
    const gross: QuantityResult = bad > 0 || !tOk || !model
      ? unavailable("volume", "net + lintel + voids", ids, issues)
      : result("volume", net + lintel + voidSum, linked ? "calculated" : "estimated", "net + lintel + Σ voids (each opening deducted once)", ids, linked ? NO_TEXT : ["gross is incomplete: an opening could not be linked to this wall"], issues);
    const faceMethod = (what: string) => `${what} volume ÷ wall thickness${thin > 0 ? " (some pieces are thinner than the run)" : ""}`;
    const faceStatus = thin > 0 ? "estimated" : "calculated";
    const netFace = netR.value !== null && t !== null ? result("area", netR.value / t, faceStatus, faceMethod("net masonry"), netIds) : unavailable("area", faceMethod("net masonry"), netIds, issues);
    const grossFace = gross.value !== null && t !== null ? result("area", gross.value / t, gross.status === "calculated" ? faceStatus : "estimated", faceMethod("gross wall"), ids) : unavailable("area", faceMethod("gross wall"), ids, issues);
    return {
      wallId: w.id,
      floor: w.floor,
      thicknessM: t,
      net: netR,
      lintel: lintelR,
      voids: voidR,
      gross,
      netFaceArea: netFace,
      grossFaceArea: grossFace,
      openings,
      pieceIds: pieces.map((p) => p.id),
      issues,
    };
  });

  // Openings that were never deducted from any wall.
  for (const o of openingAssemblies) {
    if (o.dependencies[0] && o.dependencies[1] && !used.has(o.id) && assemblyByKey.get(`${o.dependencies[0]}|${o.dependencies[1]}`) === o) {
      global.push(issue("UNLINKED_OPENING", `${o.id}: hosted by ${o.dependencies[0]}, which is not a wall assembly with hosted openings; no wall void is deducted for it`, o.id));
    }
  }
  return { walls: out, issues: global };
}
