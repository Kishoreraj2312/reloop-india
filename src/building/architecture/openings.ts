/**
 * Opening assemblies for a storey: every window and door hosted by a wall (walls.ts) becomes
 * a window or door assembly fitted into that wall's structural opening.
 */

import type { BuildingConfig } from "../config";
import type { ComponentRecord } from "../structure";
import { ARCH_CONFIG, archDatums, type ArchitectureConfig } from "./config";
import type { FloorPlan } from "./plan";
import { buildDoor } from "./doors";
import { buildWindow } from "./windows";
import type { WallBuild } from "./walls";

export function generateOpenings(plan: FloorPlan, walls: readonly WallBuild[], cfg: BuildingConfig, arch: ArchitectureConfig = ARCH_CONFIG): ComponentRecord[] {
  const d = archDatums(cfg, arch);
  const s = plan.storey;
  const rooms = new Map(plan.rooms.map((r) => [r.id, r]));
  const out: ComponentRecord[] = [];
  for (const w of walls) {
    for (const op of w.openings) {
      if (op.kind === "window") {
        const pw = plan.windows.find((x) => x.key === op.key)!;
        const room = rooms.get(pw.roomId)!;
        const inner = w.outerFace === w.across[0] ? w.across[1] : w.across[0];
        out.push(
          ...buildWindow(
            {
              key: pw.key,
              floor: s,
              typeKey: pw.typeKey,
              axis: w.axis,
              o0: op.o0,
              o1: op.o1,
              bottom: op.bottom,
              head: op.head,
              outerFace: w.outerFace!,
              innerFace: inner,
              hostId: w.id,
              lintelId: op.lintelId,
              apartmentId: room.aptId,
              roomId: room.id,
              name: `Window ${pw.typeKey}, ${room.name} ${room.aptId} (${pw.side})`,
            },
            arch,
          ),
        );
      } else {
        const pd = plan.doors.find((x) => x.key === op.key)!;
        const room = rooms.get(pd.swingInto)!;
        // Leaf swings toward the room on side S (room at +z) / W (room at +x).
        const swingDir: 1 | -1 = pd.side === "S" || pd.side === "W" ? 1 : -1;
        const label = pd.typeKey === "OP" ? "Cased opening" : pd.typeKey === "ED" ? "Building entrance door" : `Door ${pd.typeKey}`;
        out.push(
          ...buildDoor(
            {
              key: pd.key,
              floor: s,
              typeKey: pd.typeKey,
              axis: w.axis,
              o0: op.o0,
              o1: op.o1,
              slabTop: d.slabTop(s),
              ffl: d.ffl(s),
              head: op.head,
              across: w.across,
              swingDir,
              hingeEnd: pd.hingeAt <= pd.centre ? "o0" : "o1",
              hostId: w.id,
              lintelId: op.lintelId,
              apartmentId: room.aptId,
              roomId: room.id,
              name: `${label}, ${room.name} ${room.aptId}`,
            },
            arch,
          ),
        );
      }
    }
  }
  return out;
}
