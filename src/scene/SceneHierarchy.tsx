/**
 * ReLoop India — Scene Hierarchy Builder
 *
 * Building > Floor > System > Component
 * Each group carries stable names for traversal.
 * Visibility toggles are plumbed as props (state managed by parent).
 */

import { useRef, useEffect, type ReactNode } from "react";
import { Group } from "three";
import type { BuildingSystem } from "@/building/types";
import type { LevelName } from "@/building/config";

interface FloorGroupProps {
  level: LevelName;
  visible?: boolean;
  children?: ReactNode;
}

export function FloorGroup({ level, visible = true, children }: FloorGroupProps) {
  const ref = useRef<Group>(null);
  useEffect(() => {
    if (ref.current) ref.current.name = `Floor_${level}`;
  }, [level]);
  return (
    <group ref={ref} visible={visible}>
      {children}
    </group>
  );
}

interface SystemGroupProps {
  system: BuildingSystem;
  level: LevelName;
  visible?: boolean;
  children?: ReactNode;
}

export function SystemGroup({ system, level, visible = true, children }: SystemGroupProps) {
  const ref = useRef<Group>(null);
  useEffect(() => {
    if (ref.current) ref.current.name = `${level}_${system}`;
  }, [system, level]);
  return (
    <group ref={ref} visible={visible}>
      {children}
    </group>
  );
}

interface BuildingGroupProps {
  children?: ReactNode;
}

export function BuildingGroup({ children }: BuildingGroupProps) {
  const ref = useRef<Group>(null);
  useEffect(() => {
    if (ref.current) ref.current.name = "Building_G4";
  }, []);
  return <group ref={ref}>{children}</group>;
}
