/**
 * Batches (C3): named groups of components for working on them together (starting tracking, changing a stage, filtering). A batch holds
 * NO quantities and no records: it is a list of component ids, so batches may overlap freely and reports still count every component
 * once. Pure and immutable; an invalid request returns the same list and the reason.
 */

import type { Inventory } from "@/engine/quantities";
import type { Batch } from "./types";

export interface BatchEdit {
  readonly batches: readonly Batch[];
  readonly batch: Batch | null;
  readonly error: string | null;
  /** Ids that are not leaf components of the model: ignored. */
  readonly ignored: number;
}

const MAX_NAME = 60;
const nameError = (batches: readonly Batch[], name: string, exceptId?: string): string | null => {
  const t = name.trim();
  if (t === "") return "Give the batch a name";
  if (t.length > MAX_NAME) return `Name is too long (at most ${MAX_NAME} characters)`;
  if (batches.some((b) => b.id !== exceptId && b.name.toLowerCase() === t.toLowerCase())) return "A batch with that name exists";
  return null;
};

/** Keep leaf components of the model only, each once, in the order given. */
export function leafIdsOf(inv: Inventory, ids: Iterable<string>): { ids: string[]; ignored: number } {
  const out: string[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  for (const id of ids) {
    const rec = inv.recordById.get(id);
    if (!rec || rec.geometry.kind === "group" || seen.has(id)) {
      if (!seen.has(id)) ignored++;
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return { ids: out, ignored };
}

export function createBatch(batches: readonly Batch[], inv: Inventory, id: string, name: string, ids: Iterable<string>, now: string): BatchEdit {
  const e = nameError(batches, name);
  if (e) return { batches, batch: null, error: e, ignored: 0 };
  const leaf = leafIdsOf(inv, ids);
  if (leaf.ids.length === 0) return { batches, batch: null, error: "A batch needs at least one component of the model", ignored: leaf.ignored };
  const batch: Batch = { id, name: name.trim(), componentIds: leaf.ids, createdAt: now };
  return { batches: [...batches, batch], batch, error: null, ignored: leaf.ignored };
}

export function renameBatch(batches: readonly Batch[], id: string, name: string): BatchEdit {
  const cur = batches.find((b) => b.id === id);
  if (!cur) return { batches, batch: null, error: "That batch does not exist", ignored: 0 };
  const e = nameError(batches, name, id);
  if (e) return { batches, batch: null, error: e, ignored: 0 };
  if (cur.name === name.trim()) return { batches, batch: cur, error: null, ignored: 0 };
  const batch = { ...cur, name: name.trim() };
  return { batches: batches.map((b) => (b.id === id ? batch : b)), batch, error: null, ignored: 0 };
}

export const deleteBatch = (batches: readonly Batch[], id: string): readonly Batch[] => (batches.some((b) => b.id === id) ? batches.filter((b) => b.id !== id) : batches);
