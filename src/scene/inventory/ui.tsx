/** Small presentational pieces shared by the inspector and the inventory drawer. No quantities are computed here. */

import type { CSSProperties } from "react";
import type { Status } from "@/engine/quantities";

export const PALETTE = {
  text: "#1f2933",
  muted: "#6b7680",
  line: "#d5d9dd",
  panel: "#f6f7f8",
  accent: "#b4461b",
  warn: "#9a3412",
} as const;

const CHIP: Record<Status, { bg: string; fg: string }> = {
  calculated: { bg: "#e3f1e8", fg: "#1f6b43" },
  estimated: { bg: "#fbefd2", fg: "#7a4d00" },
  unavailable: { bg: "#e6e9ec", fg: "#4b5560" },
};

export function StatusChip({ status, title }: { status: Status; title?: string }) {
  const c = CHIP[status];
  const style: CSSProperties = { display: "inline-block", padding: "0 6px", borderRadius: 8, background: c.bg, color: c.fg, fontSize: 10, lineHeight: "15px", letterSpacing: 0.2, whiteSpace: "nowrap" };
  return (
    <span style={style} title={title} data-status={status}>
      {status}
    </span>
  );
}
