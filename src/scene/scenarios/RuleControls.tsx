/**
 * One rule's controls (B4): pathway, recovery %, residual destination. Edits apply immediately; an invalid percentage is
 * rejected with a message and the stored rule is left as it was (the engine returns the error, nothing is applied).
 */

import { useEffect, useState } from "react";
import { isRecoveryPathway, makeRule, parseRecoveryPct, RESIDUAL_LABELS, RESIDUALS, RULE_KINDS, RULE_LABELS, type Residual, type Rule, type RuleKind } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { field } from "../removal/ui";

const recovers = (k: RuleKind | ""): boolean => k !== "" && k !== "assessment" && isRecoveryPathway(k);

export function RuleControls({
  rule,
  onChange,
  followLabel,
  allowAssessment = true,
  testid,
}: {
  rule: Rule | null;
  /** Apply a rule (null = remove the override). Returns an error message, or null when applied. */
  onChange: (rule: Rule | null) => string | null;
  /** When set, the rule may be absent: the option reads this text (for example "template"). */
  followLabel?: string;
  allowAssessment?: boolean;
  testid: string;
}) {
  const kind: RuleKind | "" = rule?.kind ?? "";
  const [text, setText] = useState(rule?.recoveryPct == null ? "" : String(rule.recoveryPct));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(rule?.recoveryPct == null ? "" : String(rule.recoveryPct));
    setError(null);
  }, [rule?.kind, rule?.recoveryPct]);

  const apply = (next: Rule | null) => setError(onChange(next));
  const onKind = (k: RuleKind | "") => {
    if (k === "") return apply(null);
    const pct = recovers(k) ? (rule?.recoveryPct ?? null) : null;
    apply(makeRule(k, pct, k === "disposal" || k === "unknown" ? null : (rule?.residual ?? null)));
  };
  const commitPct = () => {
    if (!recovers(kind)) return;
    const p = parseRecoveryPct(text);
    if (p.error) return setError(p.error);
    if (p.value !== (rule?.recoveryPct ?? null)) apply(makeRule(kind as RuleKind, p.value, rule?.residual ?? null));
    else setError(null);
  };
  const missingPct = recovers(kind) && rule?.recoveryPct == null;
  return (
    <div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <select data-testid={`${testid}-kind`} style={{ ...field, minWidth: 150 }} value={kind} onChange={(e) => onKind(e.target.value as RuleKind | "")}>
          {followLabel !== undefined && <option value="">{followLabel}</option>}
          {RULE_KINDS.filter((k) => allowAssessment || k !== "assessment").map((k) => (
            <option key={k} value={k}>
              {RULE_LABELS[k]}
            </option>
          ))}
        </select>
        <input
          data-testid={`${testid}-pct`}
          type="text"
          inputMode="decimal"
          disabled={!recovers(kind)}
          value={text}
          placeholder={recovers(kind) ? "set %" : "–"}
          title={recovers(kind) ? "Estimated recovery, 0–100 %, net of expected loss. Empty = not set: the quantity stays unknown." : "A recovery % applies to reuse and recycling pathways only"}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitPct}
          onKeyDown={(e) => e.key === "Enter" && commitPct()}
          style={{ ...field, width: 56, textAlign: "right", borderColor: error || missingPct ? PALETTE.warn : PALETTE.line }}
        />
        <span style={{ color: PALETTE.muted, fontSize: 11 }}>%</span>
        <select
          data-testid={`${testid}-residual`}
          disabled={!recovers(kind) && kind !== "assessment"}
          style={{ ...field, width: 108 }}
          value={rule?.residual ?? ""}
          title="Where the unrecovered share goes (default: the scenario's setting)"
          onChange={(e) => rule && apply(makeRule(rule.kind, rule.recoveryPct, (e.target.value || null) as Residual | null))}
        >
          <option value="">rest: default</option>
          {RESIDUALS.map((r) => (
            <option key={r} value={r}>
              rest: {RESIDUAL_LABELS[r].toLowerCase()}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div data-testid={`${testid}-error`} style={{ color: PALETTE.warn, fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}
