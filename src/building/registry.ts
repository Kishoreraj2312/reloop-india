/**
 * ReLoop India — Component Registry
 *
 * Central store linking component IDs to data records and 3D object references.
 * Baseline records are immutable after registration.
 */

import type { BuildingComponent, BuildingSystem } from "./types";

export interface ComponentQuery {
  floor?: number;
  system?: BuildingSystem;
  componentType?: string;
  materialId?: string;
}

export class ComponentRegistry {
  private readonly components = new Map<string, BuildingComponent>();
  /** Maps Three.js object UUID → component ID */
  private readonly meshToId = new Map<string, string>();

  /** Register a component. Throws on duplicate ID. */
  register(component: BuildingComponent): void {
    if (this.components.has(component.id)) {
      throw new Error(`Duplicate component ID: ${component.id}`);
    }
    this.components.set(component.id, component);
  }

  /** Bulk register. Stops on first duplicate. */
  registerAll(components: readonly BuildingComponent[]): void {
    for (const c of components) {
      this.register(c);
    }
  }

  /** Link a Three.js mesh UUID to a component ID */
  linkMesh(meshUuid: string, componentId: string): void {
    if (!this.components.has(componentId)) {
      throw new Error(`Cannot link mesh: unknown component ${componentId}`);
    }
    this.meshToId.set(meshUuid, componentId);
  }

  /** Remove a mesh link (called when a mesh unmounts) */
  unlinkMesh(meshUuid: string): void {
    this.meshToId.delete(meshUuid);
  }

  /** Look up component ID from a mesh UUID */
  getIdByMesh(meshUuid: string): string | undefined {
    return this.meshToId.get(meshUuid);
  }

  getById(id: string): BuildingComponent | undefined {
    return this.components.get(id);
  }

  getAll(): BuildingComponent[] {
    return [...this.components.values()];
  }

  get size(): number {
    return this.components.size;
  }

  /** Query by floor, system, componentType, materialId (all optional, AND logic) */
  query(q: ComponentQuery): BuildingComponent[] {
    return this.getAll().filter((c) => {
      if (q.floor !== undefined && c.floor !== q.floor) return false;
      if (q.system && c.system !== q.system) return false;
      if (q.componentType && c.componentType !== q.componentType) return false;
      if (q.materialId && c.materialId !== q.materialId) return false;
      return true;
    });
  }

  /** Get direct children of a parent component */
  getChildren(parentId: string): BuildingComponent[] {
    return this.getAll().filter((c) => c.parentId === parentId);
  }

  /** Get the parent component */
  getParent(childId: string): BuildingComponent | undefined {
    const child = this.getById(childId);
    if (!child?.parentId) return undefined;
    return this.getById(child.parentId);
  }

  /** Clear the registry (for testing or full rebuild) */
  clear(): void {
    this.components.clear();
    this.meshToId.clear();
  }
}

/** Singleton registry instance for the application */
export const registry = new ComponentRegistry();
