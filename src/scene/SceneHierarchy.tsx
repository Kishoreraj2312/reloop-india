/**
 * ReLoop India — Scene Hierarchy
 *
 * Building > Floor > System > Assembly > Component
 * Groups carry stable names for traversal. Visibility toggles are plumbed as props
 * (state is managed by the parent).
 */

import type { ReactNode } from "react";
import type { BuildingSystem } from "@/building/types";
import type { LevelName } from "@/building/config";
import type { AssemblyName } from "@/building/structure";

/** Floor groups: the foundation zone below L0, then L0..L4 and ROOF. */
export type FloorKey = "FDN" | LevelName;

interface FloorGroupProps {
  level: FloorKey;
  visible?: boolean;
  children?: ReactNode;
}

export function FloorGroup({ level, visible = true, children }: FloorGroupProps) {
  return (
    <group name={`Floor_${level}`} visible={visible}>
      {children}
    </group>
  );
}

interface SystemGroupProps {
  system: BuildingSystem;
  level: FloorKey;
  visible?: boolean;
  children?: ReactNode;
}

export function SystemGroup({ system, level, visible = true, children }: SystemGroupProps) {
  return (
    <group name={`${level}_${system}`} visible={visible}>
      {children}
    </group>
  );
}

interface AssemblyGroupProps {
  assembly: AssemblyName;
  system: BuildingSystem;
  level: FloorKey;
  visible?: boolean;
  children?: ReactNode;
}

export function AssemblyGroup({ assembly, system, level, visible = true, children }: AssemblyGroupProps) {
  return (
    <group name={`${level}_${system}_${assembly}`} visible={visible}>
      {children}
    </group>
  );
}

interface BuildingGroupProps {
  children?: ReactNode;
}

export function BuildingGroup({ children }: BuildingGroupProps) {
  return <group name="Building_G4">{children}</group>;
}
