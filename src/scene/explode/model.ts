import { buildExplodeModel, type ExplodeModel } from "@/engine/explode";
import { modelRecords } from "@/engine/quantities";

let cached: ExplodeModel | null = null;

/** The explode model of the default building, built once on first use (about 0.1 s once the records exist). */
export function getExplodeModel(): ExplodeModel {
  return (cached ??= buildExplodeModel(modelRecords()));
}
