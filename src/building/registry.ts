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
  /** Instanced meshes: UUID → component ID per instance index, and the reverse lookup */
  private readonly instanceIds = new Map<string, readonly string[]>();
  private readonly idToInstance = new Map<string, { meshUuid: string; index: number }>();

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

  /** Link an instanced mesh: instance i represents component ids[i]. */
  linkInstances(meshUuid: string, ids: readonly string[]): void {
    for (const id of ids) {
      if (!this.components.has(id)) throw new Error(`Cannot link instance: unknown component ${id}`);
    }
    this.instanceIds.set(meshUuid, ids);
    ids.forEach((id, index) => this.idToInstance.set(id, { meshUuid, index }));
  }

  unlinkInstances(meshUuid: string): void {
    const ids = this.instanceIds.get(meshUuid);
    if (!ids) return;
    for (const id of ids) {
      if (this.idToInstance.get(id)?.meshUuid === meshUuid) this.idToInstance.delete(id);
    }
    this.instanceIds.delete(meshUuid);
  }

  /** Look up component ID from a mesh UUID (and instance index for instanced meshes) */
  getIdByMesh(meshUuid: string, instanceId?: number): string | undefined {
    if (instanceId !== undefined) {
      const ids = this.instanceIds.get(meshUuid);
      if (ids) return ids[instanceId];
    }
    return this.meshToId.get(meshUuid);
  }

  /** Where an instanced component is drawn (undefined for plain meshes or unlinked ids) */
  getInstance(id: string): { meshUuid: string; index: number } | undefined {
    return this.idToInstance.get(id);
  }

  /** Number of instanced components currently linked to meshes */
  get linkedInstanceCount(): number {
    return this.idToInstance.size;
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
    const out: BuildingComponent[] = [];
    for (const c of this.components.values()) if (c.parentId === parentId) out.push(c);
    return out;
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
    this.instanceIds.clear();
    this.idToInstance.clear();
  }
}

/** Singleton registry instance for the application */
export const registry = new ComponentRegistry();
