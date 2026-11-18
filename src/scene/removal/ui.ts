import type { CSSProperties } from "react";
import { PALETTE } from "../inventory/ui";

export const field: CSSProperties = { font: "inherit", fontSize: 12, padding: "2px 4px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", color: PALETTE.text, minWidth: 0 };
// Every button style has the same keys in the same order: React warns when a longhand (borderColor, fontWeight) is
// added or removed while its shorthand (border, font) is present, so variants override the existing keys only.
export const btn: CSSProperties = { font: "inherit", fontSize: 12, fontWeight: 400, padding: "2px 9px", border: `1px solid ${PALETTE.line}`, borderRadius: 6, background: "#fff", cursor: "pointer", color: PALETTE.text };
export const btnAccent: CSSProperties = { ...btn, fontWeight: 600, border: `1px solid ${PALETTE.accent}` };
export const btnOff: CSSProperties = { ...btn, opacity: 0.45, cursor: "not-allowed" };
export const linkBtn: CSSProperties = { font: "inherit", fontSize: "inherit", color: PALETTE.accent, background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textAlign: "left" };
export const heading: CSSProperties = { fontSize: 10, letterSpacing: 0.5, color: PALETTE.muted, margin: "14px 0 6px", fontWeight: 600 };
export const LEVEL_COLOUR = { error: "#b3340a", warning: "#8a5a00", review: "#2f5d86", info: PALETTE.muted } as const;
export const SOURCE_LABEL = { model: "model", rule: "rule", user: "user" } as const;
