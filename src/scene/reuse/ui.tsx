/** Small presentational pieces of the reuse workspace (C2). Nothing here computes a match, a quantity or an allocation. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CRITERIA, CRITERION_HELP, CRITERION_LABELS, CRITERION_SHORT, STATE_LABELS, TIER_HELP, TIER_LABELS, type CriterionKey, type State, type Tier } from "@/engine/reuse";

/** 3D colours: the Okabe–Ito hues B2 / B4 already use for "reusable" (green) and "needs work" (orange), and blue for confirmed. */
export const TINT = { strong: 0x009e73, conditional: 0xe69f00, allocated: 0x0072b2 } as const;
export const cssHex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

// ── state and tier marks (shape carries the meaning as well as colour) ───────

const STATE_CLASS: Readonly<Record<State, string>> = { met: "met", partial: "partial", unknown: "unknown", unmet: "unmet", na: "na" };

export function StateIcon({ state, size = 13, title }: { state: State; size?: number; title?: string }) {
  const s = size;
  const c = s / 2;
  const r = c - 1.2;
  const label = title ?? STATE_LABELS[state];
  let body: ReactNode;
  switch (state) {
    case "met":
      body = (
        <>
          <circle cx={c} cy={c} r={r} fill="currentColor" />
          <path d={`M${s * 0.3} ${s * 0.52} L${s * 0.45} ${s * 0.66} L${s * 0.72} ${s * 0.36}`} fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
      break;
    case "partial":
      body = (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth={1.4} />
          <path d={`M${c} ${c - r} A${r} ${r} 0 0 1 ${c} ${c + r} Z`} fill="currentColor" />
        </>
      );
      break;
    case "unknown":
      body = (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2.2 2" />
          <text x={c} y={c + 3.2} textAnchor="middle" fontSize={s * 0.62} fontWeight={700} fill="currentColor">?</text>
        </>
      );
      break;
    case "unmet":
      body = (
        <>
          <circle cx={c} cy={c} r={r} fill="currentColor" />
          <path d={`M${s * 0.34} ${s * 0.34} L${s * 0.66} ${s * 0.66} M${s * 0.66} ${s * 0.34} L${s * 0.34} ${s * 0.66}`} stroke="#fff" strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
      break;
    case "na":
      body = <path d={`M${s * 0.28} ${c} H${s * 0.72}`} stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" />;
      break;
  }
  return (
    <svg className={`rx-state rx-state-${STATE_CLASS[state]}`} width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={label} data-state={state}>
      <title>{label}</title>
      {body}
    </svg>
  );
}

export function TierChip({ tier, compact = false }: { tier: Tier; compact?: boolean }) {
  return (
    <span className={`rx-tier rx-tier-${tier}${compact ? " compact" : ""}`} title={TIER_HELP[tier]} data-tier={tier}>
      <i className="rx-tier-dot" />
      {TIER_LABELS[tier]}
    </span>
  );
}

/** The compatibility strip: one mark per criterion in a fixed order, so columns line up down a list. */
export function Pips({ states }: { states: Readonly<Record<CriterionKey, State>> }) {
  return (
    <span className="rx-pips" data-testid="pips">
      {CRITERIA.map((k) => (
        <span key={k} className="rx-pip" data-criterion={k} data-state={states[k]} title={`${CRITERION_LABELS[k]}: ${STATE_LABELS[states[k]]}`}>
          <StateIcon state={states[k]} size={12} />
        </span>
      ))}
    </span>
  );
}

export function PipHeads() {
  return (
    <span className="rx-pips rx-pips-head" aria-hidden="true">
      {CRITERIA.map((k) => (
        <span key={k} className="rx-pip" title={`${CRITERION_LABELS[k]} — ${CRITERION_HELP[k]}`}>
          {CRITERION_SHORT[k]}
        </span>
      ))}
    </span>
  );
}

/** A small status chip with a neutral, strong, conditional, bad or allocated tone. */
export function Chip({ tone = "neutral", children, title }: { tone?: "neutral" | "strong" | "cond" | "bad" | "alloc"; children: ReactNode; title?: string }) {
  return (
    <span className={`rx-chip rx-chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** A stacked horizontal bar: segments are shares of `total`. */
export function Bar({ total, parts, height = 6, testid }: { total: number; parts: readonly { value: number; kind: "alloc" | "proposed" | "over" | "strong" | "cond"; title?: string }[]; height?: number; testid?: string }) {
  const t = total > 0 ? total : 1;
  return (
    <div className="rx-bar" style={{ height }} data-testid={testid}>
      {parts.map((p, i) => (p.value > 0 ? <i key={i} className={`rx-bar-${p.kind}`} style={{ width: `${Math.min(100, (p.value / t) * 100)}%` }} title={p.title} /> : null))}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, testid, label }: { value: T; options: readonly { value: T; label: ReactNode; title?: string; testid?: string }[]; onChange: (v: T) => void; testid?: string; label?: string }) {
  return (
    <div className="rx-seg" role="group" aria-label={label} data-testid={testid}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} title={o.title} data-testid={o.testid} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, aside, children, testid }: { title: ReactNode; aside?: ReactNode; children: ReactNode; testid?: string }) {
  return (
    <section className="rx-section" data-testid={testid}>
      <header>
        <h4>{title}</h4>
        {aside && <span className="rx-aside">{aside}</span>}
      </header>
      {children}
    </section>
  );
}

// ── a windowed list: only the rows near the viewport are in the DOM ─────────

export function VList<T>({ items, rowHeight, renderRow, keyOf, scrollToKey, testid, empty, overscan = 8, style, onStep }: { items: readonly T[]; rowHeight: number; renderRow: (item: T, index: number) => ReactNode; keyOf: (item: T) => string; scrollToKey?: string | null; testid?: string; empty?: ReactNode; overscan?: number; style?: CSSProperties; /** ↑ / ↓ / Home / End on the focused list: move the selection (the parent knows which row is selected). */ onStep?: (to: "prev" | "next" | "first" | "last") => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [h, setH] = useState(300);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback(() => setTop(ref.current?.scrollTop ?? 0), []);
  // keep a requested row in view (selection from the 3D model or from another panel)
  useEffect(() => {
    if (!scrollToKey || !ref.current) return;
    const i = items.findIndex((it) => keyOf(it) === scrollToKey);
    if (i < 0) return;
    const el = ref.current;
    const y = i * rowHeight;
    if (y < el.scrollTop || y + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y - el.clientHeight / 2 + rowHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new target scrolls; filtering or sorting must not
  }, [scrollToKey]);
  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((top + h) / rowHeight) + overscan);
  return (
    <div
      ref={ref}
      className="rx-vlist"
      onScroll={onScroll}
      data-testid={testid}
      style={style}
      tabIndex={onStep ? 0 : undefined}
      onKeyDown={
        onStep
          ? (e) => {
              const to = e.key === "ArrowDown" ? "next" : e.key === "ArrowUp" ? "prev" : e.key === "Home" ? "first" : e.key === "End" ? "last" : null;
              if (!to) return;
              e.preventDefault();
              onStep(to);
            }
          : undefined
      }
    >
      {items.length === 0 ? (
        empty
      ) : (
        <div style={{ height: items.length * rowHeight, position: "relative" }}>
          {items.slice(first, last).map((it, k) => (
            <div key={keyOf(it)} className="rx-vrow" style={{ position: "absolute", top: (first + k) * rowHeight, height: rowHeight, left: 0, right: 0 }}>
              {renderRow(it, first + k)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function useDebounced<T>(value: T, ms = 150): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Whole-number thousands separators. */
export const n0 = (n: number): string => n.toLocaleString("en-US");

/** The id of a component as a monospace span with the tail visible. */
export const Mono = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span className="rx-mono" title={title}>
    {children}
  </span>
);

/** A quantity as editable text: 12 significant digits remove float noise (0.22076800000000002) without losing real precision. */
export const qtyInput = (n: number): string => String(Number(n.toPrecision(12)));
