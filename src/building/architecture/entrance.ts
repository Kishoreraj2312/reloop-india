/**
 * Building entrance (A2): landing at FFL in front of the entrance door, steps down to site
 * grade (equal risers derived from config), a cantilevered canopy spanning between the two
 * fins that frame the entrance bay, and two canopy downlights. Assembly ARC-ENT-G-MAIN.
 */

import type { BuildingConfig } from "../config";
import type { ComponentRecord, Vec3 } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig } from "./config";
import { facadeBox, facadeFrame } from "./balconies";
import { finLines } from "./facade";
import type { FloorPlan, PlanBalcony } from "./plan";
import { arcAssembly, arcRecord, boxGeom, dimsHorizontal, dimsSolid, pad2, unionBox, type Box } from "./record";

export function generateEntrance(ground: FloorPlan, balconies: readonly PlanBalcony[], cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  const ed = ground.doors.find((d) => d.typeKey === "ED");
  if (!ed) return [];
  const d = archDatums(cfg, arch);
  const en = arch.entrance;
  const f = facadeFrame(cfg, ed.side === "S" ? "S" : "N");
  const ffl = d.ffl(0);
  const grade = arch.datums.siteGrade;
  const riser = (ffl - grade) / en.risers;
  // Landing starts at the plinth cladding face.
  const start = cfg.pedestal.depth / 2 - cfg.column.depth / 2 + arch.facade.plinth.thickness;
  const a0 = ed.centre - en.width / 2;
  const a1 = ed.centre + en.width / 2;
  const parts: { suffix: string; name: string; type: string; mat: string; b: Box; unit: "m3" | "m2" | "nr"; cyl?: boolean }[] = [];
  parts.push({ suffix: "LND", name: "entrance landing", type: "entrance_landing", mat: "stone_tread", b: facadeBox(f, a0, a1, grade, ffl, f.wallFace, start, start + en.landingDepth), unit: "m3" });
  for (let k = 1; k < en.risers; k++) {
    // Step k counted down from the landing: top at ffl - k * riser
    const dd0 = start + en.landingDepth + (k - 1) * en.tread;
    parts.push({ suffix: `STP${pad2(k)}`, name: `entrance step ${k}`, type: "entrance_step", mat: "stone_tread", b: facadeBox(f, a0, a1, grade, ffl - k * riser, f.wallFace, dd0, dd0 + en.tread), unit: "m3" });
  }
  // Canopy between the fins that flank the door
  const fins = finLines(balconies).get(f.side) ?? [];
  const gL = Math.max(...fins.filter((g) => g < ed.centre));
  const gR = Math.min(...fins.filter((g) => g > ed.centre));
  const ch = cfg.column.width / 2; // canopy spans between the column faces (abutting the column cladding)
  const cy0 = ffl + en.canopy.underside;
  const canopy = facadeBox(f, gL + ch, gR - ch, cy0, cy0 + en.canopy.thickness, f.wallFace, 0, en.canopy.depth);
  parts.push({ suffix: "CNP", name: "entrance canopy slab", type: "entrance_canopy", mat: "concrete_balcony", b: canopy, unit: "m3" });
  const r = arch.fixtures.downlightRadius;
  [ed.centre - en.width / 3, ed.centre + en.width / 3].forEach((x, i) =>
    parts.push({ suffix: `CLT${i + 1}`, name: "canopy downlight", type: "light_fixture", mat: "fixture_light", b: facadeBox(f, x - r, x + r, cy0 - 0.02, cy0, f.wallFace, en.canopy.depth / 2 - r, en.canopy.depth / 2 + r), unit: "nr", cyl: true }),
  );

  const env = unionBox(parts.map((p) => p.b));
  const out: ComponentRecord[] = [
    arcAssembly({ type: "ENT", floor: 0, location: "MAIN", name: "Building entrance: steps, landing, canopy", assemblyType: "entrance", category: "facade", materialId: "stone_tread", min: env.min as Vec3, max: env.max as Vec3, dimensions: dimsSolid(env), unit: "nr", apartmentId: "CM", roomId: "CM-LOB" }),
  ];
  const parentId = out[0]!.id;
  for (const p of parts) {
    const { geometry, position } = boxGeom(p.b);
    out.push(
      arcRecord({
        type: "ENT",
        floor: 0,
        location: `MAIN-${p.suffix}`,
        name: `Entrance: ${p.name}`,
        componentType: p.type,
        assemblyType: "entrance",
        category: "facade",
        materialId: p.mat,
        geometry: p.cyl ? { kind: "cylinder", radius: r, height: 0.02, axis: "y" } : geometry,
        position,
        dimensions: p.type === "entrance_canopy" ? dimsHorizontal(p.b) : dimsSolid(p.b),
        unit: p.unit,
        parentId,
        apartmentId: "CM",
      }),
    );
  }
  return out;
}
