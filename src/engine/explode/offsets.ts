/**
 * Offset solver (A4). displayed = canonical + offset(params), recomputed from scratch on every call:
 * nothing accumulates, parameter 0 gives exact zeros, and an offset is a pure translation, so the effective offset of a
 * component is floorOffset + systemOffset + assemblyOffset (additive and order-independent).
 *
 *   floor     [0, relIndex x floorGap x ease, 0]; relIndex = floor index - anchor (foundation below, roof above)
 *   system    arrangement delta (x, z) x ease; the arrangement is computed from the actual system bounds plus a gap
 *   assembly  unit x gap-per-layer x ease; layers: gap = min(gap, maxSpan / (layers - 1)); radial: gap x radialFactor
 *
 * The solver owns preallocated output arrays: solve() allocates nothing, so it is safe in the animation hot path.
 */

import type { BuildingSystem } from "@/building/types";
import { clamp01, ease, norm0, windowed } from "./ease";
import { floorKeyOf, type ExplodeModel } from "./model";
import type { ExplodeParams, FloorKey, SystemLayout, Vec3 } from "./types";

export class ExplodeSolver {
  /** x, y, z per floor slot (model.floors order). */
  readonly floorOffset: Float64Array;
  /** x, y, z per system slot (model.systems order). */
  readonly systemOffset: Float64Array;
  /** Metres per unit offset, per assembly index (0 outside the focus / outside the assembly phase). */
  readonly assemblyFactor: Float64Array;
  /** True when any assembly factor is non-zero. */
  assemblyActive = false;
  /** Largest displacement any member can have right now (metres), for bounding volumes. */
  maxAssemblyDisplacement = 0;
  /** Eased progress per level, as solved (0..1). */
  eFloor = 0;
  eSystem = 0;
  eAssembly = 0;

  private arrKey = { layout: "" as SystemLayout | "", gap: NaN, mask: -1 };
  private readonly arrDelta: Float64Array; // x, z per system slot at full explosion
  private focusIndex = -1;
  private focusId: string | null | undefined = undefined;

  constructor(readonly model: ExplodeModel) {
    this.floorOffset = new Float64Array(model.floors.length * 3);
    this.systemOffset = new Float64Array(model.systems.length * 3);
    this.assemblyFactor = new Float64Array(model.assemblies.length);
    this.arrDelta = new Float64Array(model.systems.length * 2);
  }

  solve(p: ExplodeParams): this {
    const m = this.model;
    const cfg = m.cfg;
    const t = p.mode === "assembled" ? 0 : clamp01(p.t);
    let eF = 0;
    let eS = 0;
    let eA = 0;
    switch (p.mode) {
      case "floors":
        eF = ease(t);
        break;
      case "systems":
        eS = ease(t);
        break;
      case "assembly":
        eA = ease(t);
        break;
      case "cinematic":
        eF = ease(windowed(t, cfg.phases.floors));
        eS = ease(windowed(t, cfg.phases.systems));
        eA = ease(windowed(t, cfg.phases.assemblies));
        break;
      default:
        break;
    }
    this.eFloor = eF;
    this.eSystem = eS;
    this.eAssembly = eA;

    for (let i = 0; i < m.floors.length; i++) {
      this.floorOffset[i * 3] = 0;
      this.floorOffset[i * 3 + 1] = norm0(m.floorRel[i]! * p.floorGap * eF);
      this.floorOffset[i * 3 + 2] = 0;
    }

    this.arrange(p);
    for (let i = 0; i < m.systems.length; i++) {
      this.systemOffset[i * 3] = norm0(this.arrDelta[i * 2]! * eS);
      this.systemOffset[i * 3 + 1] = 0;
      this.systemOffset[i * 3 + 2] = norm0(this.arrDelta[i * 2 + 1]! * eS);
    }

    if (p.focus !== this.focusId) {
      this.focusId = p.focus;
      this.focusIndex = p.focus === null ? -1 : (m.assemblyIndex.get(p.focus) ?? -1);
    }
    let any = false;
    let maxD = 0;
    const span = cfg.assembly.maxSpan;
    for (let a = 0; a < m.assemblies.length; a++) {
      const plan = m.assemblies[a]!;
      let f = 0;
      if (eA > 0 && (p.mode === "cinematic" || (p.mode === "assembly" && a === this.focusIndex))) {
        f = (plan.strategy === "layers" ? Math.min(p.assemblyGap, span / Math.max(1, plan.layerCount - 1)) : p.assemblyGap * cfg.assembly.radialFactor) * eA;
      }
      this.assemblyFactor[a] = f;
      if (f > 0) {
        any = true;
        const d = f * plan.maxUnit;
        if (d > maxD) maxD = d;
      }
    }
    this.assemblyActive = any;
    this.maxAssemblyDisplacement = maxD;
    return this;
  }

  /** Arrangement of the enabled systems (cached; recomputed only when layout, gap or the enabled set change). */
  private arrange(p: ExplodeParams): void {
    const m = this.model;
    let mask = 0;
    for (const s of p.systems) {
      const slot = m.systemSlot.get(s);
      if (slot !== undefined) mask |= 1 << slot;
    }
    const k = this.arrKey;
    if (k.layout === p.layout && k.gap === p.systemGap && k.mask === mask) return;
    k.layout = p.layout;
    k.gap = p.systemGap;
    k.mask = mask;
    this.arrDelta.fill(0);
    const items: { slot: number; w: number; d: number; cx: number; cz: number; col: number; row: number }[] = [];
    for (let slot = 0; slot < m.systems.length; slot++) {
      if (!(mask & (1 << slot))) continue;
      const b = m.systemBounds.get(m.systems[slot]!)!;
      items.push({ slot, w: b.max[0] - b.min[0], d: b.max[2] - b.min[2], cx: (b.min[0] + b.max[0]) / 2, cz: (b.min[2] + b.max[2]) / 2, col: 0, row: 0 });
    }
    if (items.length < 2) return;
    items.forEach((it, i) => {
      if (p.layout === "row-x") (it.col = i), (it.row = 0);
      else if (p.layout === "row-z") (it.col = 0), (it.row = i);
      else (it.col = i % 2), (it.row = Math.floor(i / 2));
    });
    const nc = Math.max(...items.map((i) => i.col)) + 1;
    const nr = Math.max(...items.map((i) => i.row)) + 1;
    const colW = new Array<number>(nc).fill(0);
    const rowD = new Array<number>(nr).fill(0);
    for (const it of items) {
      colW[it.col] = Math.max(colW[it.col]!, it.w);
      rowD[it.row] = Math.max(rowD[it.row]!, it.d);
    }
    const colX = [0];
    for (let c = 0; c < nc - 1; c++) colX.push(colX[c]! + colW[c]! + p.systemGap);
    const rowZ = [0];
    for (let r = 0; r < nr - 1; r++) rowZ.push(rowZ[r]! + rowD[r]! + p.systemGap);
    const W = colX[nc - 1]! + colW[nc - 1]!;
    const D = rowZ[nr - 1]! + rowD[nr - 1]!;
    // keep the arrangement centred where the assembled systems are centred (union of their plan extents)
    const x0 = Math.min(...items.map((i) => i.cx - i.w / 2));
    const x1 = Math.max(...items.map((i) => i.cx + i.w / 2));
    const z0 = Math.min(...items.map((i) => i.cz - i.d / 2));
    const z1 = Math.max(...items.map((i) => i.cz + i.d / 2));
    const left = (x0 + x1) / 2 - W / 2;
    const back = (z0 + z1) / 2 - D / 2;
    for (const it of items) {
      const wantX = left + colX[it.col]! + colW[it.col]! / 2;
      const wantZ = back + rowZ[it.row]! + rowD[it.row]! / 2;
      this.arrDelta[it.slot * 2] = p.layout === "row-z" ? 0 : wantX - it.cx;
      this.arrDelta[it.slot * 2 + 1] = p.layout === "row-x" ? 0 : wantZ - it.cz;
    }
  }

  /** Effective offset of a component (floor + system + assembly), written to `out`. */
  offsetOf(id: string, out: Float64Array | number[]): void {
    const rec = this.model.byId.get(id);
    out[0] = out[1] = out[2] = 0;
    if (!rec) return;
    const fs = this.model.floorSlot.get(floorKeyOf(rec.floor));
    if (fs !== undefined) for (let i = 0; i < 3; i++) out[i]! += this.floorOffset[fs * 3 + i]!;
    const ss = this.model.systemSlot.get(rec.system);
    if (ss !== undefined) for (let i = 0; i < 3; i++) out[i]! += this.systemOffset[ss * 3 + i]!;
    const a = this.model.memberAssembly.get(id);
    if (a !== undefined) {
      const f = this.assemblyFactor[a]!;
      if (f !== 0) {
        const u = this.model.memberUnit.get(id)!;
        out[0]! += u[0] * f;
        out[1]! += u[1] * f;
        out[2]! += u[2] * f;
      }
    }
  }

  floorOffsetOf(key: FloorKey): Vec3 {
    const s = this.model.floorSlot.get(key);
    return s === undefined ? [0, 0, 0] : [this.floorOffset[s * 3]!, this.floorOffset[s * 3 + 1]!, this.floorOffset[s * 3 + 2]!];
  }
  systemOffsetOf(sys: BuildingSystem): Vec3 {
    const s = this.model.systemSlot.get(sys);
    return s === undefined ? [0, 0, 0] : [this.systemOffset[s * 3]!, this.systemOffset[s * 3 + 1]!, this.systemOffset[s * 3 + 2]!];
  }
}


/** One-shot (allocating) convenience for tests and tools. */
export function solveOffsets(model: ExplodeModel, p: ExplodeParams): ExplodeSolver {
  return new ExplodeSolver(model).solve(p);
}

