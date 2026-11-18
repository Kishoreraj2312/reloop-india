/**
 * The workspace showing in the dock. Each is the same component the drawer was, handed the same props; only its frame changed
 * (it now fills the dock instead of floating over the model).
 */

import type { ViewState } from "@/scene/viewState";
import { InventoryDrawer } from "@/scene/inventory/InventoryDrawer";
import { inventoryUi } from "@/scene/inventory/inventoryStore";
import { RecoveryDrawer } from "@/scene/recovery/RecoveryDrawer";
import { recoveryStore } from "@/scene/recovery/recoveryStore";
import { RemovalDrawer } from "@/scene/removal/RemovalDrawer";
import { removalStore } from "@/scene/removal/removalStore";
import { ScenarioDrawer } from "@/scene/scenarios/ScenarioDrawer";
import { scenarioStore } from "@/scene/scenarios/scenarioStore";
import { CarbonDrawer } from "@/scene/carbon/CarbonDrawer";
import { carbonStore } from "@/scene/carbon/carbonStore";
import { ReuseDrawer } from "@/scene/reuse/ReuseDrawer";
import { reuseStore } from "@/scene/reuse/reuseStore";
import { RecycleDrawer } from "@/scene/recycle/RecycleDrawer";
import { recycleUi } from "@/scene/recycle/recycleStore";
import { TrackingDrawer } from "@/scene/tracking/TrackingDrawer";
import { trackingStore } from "@/scene/tracking/trackingStore";
import type { WorkspaceId } from "./workspaces";

interface Props {
  id: WorkspaceId;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  view: ViewState;
  onViewChange: (v: ViewState) => void;
}

export function WorkspaceView({ id, selectedId, onSelect, view, onViewChange }: Props) {
  switch (id) {
    case "inventory":
      return <InventoryDrawer onClose={() => inventoryUi.set(false)} onSelect={onSelect} selectedId={selectedId} />;
    case "recovery":
      return <RecoveryDrawer onClose={() => recoveryStore.setOpen(false)} onSelect={onSelect} selectedId={selectedId} />;
    case "removal":
      return <RemovalDrawer onClose={() => removalStore.setOpen(false)} onSelect={onSelect} selectedId={selectedId} view={view} onViewChange={onViewChange} />;
    case "scenarios":
      return <ScenarioDrawer onClose={() => scenarioStore.setOpen(false)} onSelect={onSelect} selectedId={selectedId} />;
    case "carbon":
      return <CarbonDrawer onClose={() => carbonStore.setOpen(false)} />;
    case "reuse":
      return <ReuseDrawer onClose={() => reuseStore.setOpen(false)} onSelect={onSelect} selectedId={selectedId} />;
    case "recycle":
      return <RecycleDrawer onClose={() => recycleUi.set(false)} />;
    case "tracking":
      return <TrackingDrawer onClose={() => trackingStore.setOpen(false)} onSelect={onSelect} selectedId={selectedId} />;
  }
}
