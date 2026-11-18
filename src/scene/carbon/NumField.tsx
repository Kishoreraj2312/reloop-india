/** A numeric input that commits on blur / Enter (B5). Invalid text is rejected with a message and the stored value is left as it was. */

import { useEffect, useState } from "react";
import { parseNonNegative } from "@/engine/carbon";
import { PALETTE } from "../inventory/ui";
import { field } from "../removal/ui";

export function NumField({ value, onCommit, width = 74, placeholder = "not set", title, testid, max, positive, disabled }: { value: number | null; onCommit: (v: number | null) => string | null; width?: number; placeholder?: string; title?: string; testid?: string; max?: number; positive?: boolean; disabled?: boolean }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setText(value === null ? "" : String(value));
    setErr(null);
  }, [value]);
  const commit = () => {
    const p = parseNonNegative(text, { ...(max !== undefined ? { max } : {}), ...(positive ? { positive } : {}) });
    if (p.error) return setErr(p.error);
    if (p.value !== value) setErr(onCommit(p.value));
    else setErr(null);
  };
  return (
    <span style={{ display: "inline-block", verticalAlign: "top" }}>
      <input data-testid={testid} type="text" inputMode="decimal" disabled={disabled} value={text} placeholder={placeholder} title={title} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} style={{ ...field, width, textAlign: "right", borderColor: err ? PALETTE.warn : PALETTE.line }} />
      {err && (
        <div data-testid={testid ? `${testid}-error` : undefined} style={{ color: PALETTE.warn, fontSize: 10.5, maxWidth: width + 40 }}>
          {err}
        </div>
      )}
    </span>
  );
}
