/** Small stroke icons for the shell (16 px, currentColor). Generic shapes only; every button that uses one also carries its text or a title. */

import type { ReactElement } from "react";

export type IconName =
  | "model"
  | "inventory"
  | "recovery"
  | "removal"
  | "scenarios"
  | "carbon"
  | "reuse"
  | "recycle"
  | "tracking"
  | "layers"
  | "floors"
  | "explode"
  | "selection"
  | "present"
  | "reset"
  | "chevronLeft"
  | "chevronRight"
  | "mark";

const P: Record<IconName, ReactElement> = {
  model: <path d="M8 1.8 13.7 5v6L8 14.2 2.3 11V5L8 1.8Zm0 0v6.4m0 0 5.7-3.2M8 8.2 2.3 5" />,
  inventory: <path d="M3 4h10M3 8h10M3 12h10M1.8 4h.01M1.8 8h.01M1.8 12h.01" />,
  recovery: <path d="M12.8 7A5 5 0 0 0 4 4.6M3.2 9A5 5 0 0 0 12 11.4M4.2 2v2.8h2.8m5.8 6.4V8.4H9.1" />,
  removal: <path d="M2.5 5.5h11M5 5.5V3.2h6v2.3M3.8 5.5l.7 7.3h7l.7-7.3M6.6 8v3M9.4 8v3" />,
  scenarios: <path d="M2.5 13V6.5m4 6.5V3m4 10V8.5m3 4.5H1.8" />,
  carbon: <path d="M13.5 2.5C7 2.5 3 5.4 3 9.3c0 1.4.6 2.5 1.6 3.2 3.9.9 8.6-1.6 8.9-10Zm-10 11c1.4-3.4 3.4-5.4 6-6.8" />,
  reuse: <path d="M2.5 7.5V6.2A2.2 2.2 0 0 1 4.7 4h6.6m0 0L9.4 2.1M11.3 4 9.4 5.9M13.5 8.5v1.3A2.2 2.2 0 0 1 11.3 12H4.7m0 0 1.9 1.9M4.7 12l1.9-1.9" />,
  recycle: <path d="M8 2.3 13.4 11.6H2.6L8 2.3Zm-1.5 5.2L8 10l1.5-2.5M5.4 14h5.2" />,
  tracking: <path d="M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4Zm-2.6-6.4 1.9 1.9 3.4-3.7" />,
  layers: <path d="M8 2 14 5.2 8 8.4 2 5.2 8 2Zm-6 6.1L8 11.3l6-3.2m-12 3 6 3.2 6-3.2" />,
  floors: <path d="M2.5 3h11M2.5 6.3h11M2.5 9.6h11M2.5 12.9h11" />,
  explode: <path d="M3 3.2h10M4.2 6.2h7.6M3 9.8h10m-8.8 3h7.6M8 1.6v.8m0 11.2v.8" />,
  selection: <path d="M3 2.5 12.8 7l-4.1 1.4L7.2 12.6 3 2.5Z" />,
  present: <path d="M2 3h12v7.4H2V3Zm4 10.4h4M8 10.4v3M6.4 5.6 10 6.7 6.4 8.1V5.6Z" />,
  reset: <path d="M2.8 8a5.2 5.2 0 1 0 1.6-3.7M2.6 2.6v2.6h2.6" />,
  chevronLeft: <path d="m9.8 3.5-4.5 4.5 4.5 4.5" />,
  chevronRight: <path d="m6.2 3.5 4.5 4.5-4.5 4.5" />,
  mark: <path d="M3.4 8.1a4.6 4.6 0 0 1 8-3.1l1.1 1.2M12.6 7.9a4.6 4.6 0 0 1-8 3.1l-1.1-1.2M12.7 3.6v2.9h-2.9M3.3 12.4V9.5h2.9" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none" }}>
      {P[name]}
    </svg>
  );
}
