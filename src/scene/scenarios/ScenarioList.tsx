/**
 * Scenario management (B4): create from a template, rename, duplicate, reset to template defaults, delete, choose which two
 * or three scenarios are compared and which one is edited. Everything stored is an assumption; nothing here computes a quantity.
 */

import { useMemo, useState } from "react";
import { getModelInventory } from "@/engine/quantities";
import { assessedCategories, isModified, TEMPLATE_INFO, TEMPLATES, type Scenario, type TemplateId } from "@/engine/scenarios";
import { PALETTE } from "../inventory/ui";
import { useRecovery } from "../recovery/recoveryStore";
import { btn, btnAccent, btnOff, field, heading } from "../removal/ui";
import { MAX_COMPARE, scenarioStore, useScenarios } from "./scenarioStore";

export function ScenarioList() {
  const sc = useScenarios();
  const { assessments } = useRecovery();
  const [template, setTemplate] = useState<TemplateId>("selective");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "reset" | "delete"; id: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const assessed = useMemo(() => assessedCategories(getModelInventory(), assessments), [assessments]);

  const commitRename = (id: string) => {
    const e = scenarioStore.rename(name, id);
    setMessage(e);
    if (!e) setRenaming(null);
  };

  return (
    <div data-testid="scenario-list">
      <div style={heading}>SCENARIOS</div>
      {sc.scenarios.length === 0 ? (
        <div data-testid="scenario-empty" style={{ padding: "8px 10px", background: "#fff", border: `1px solid ${PALETTE.line}`, borderRadius: 6 }}>
          <div style={{ marginBottom: 6 }}>
            Create scenarios from a template and compare them. Templates only choose starting assumptions: no recovery rate is supplied, and every quantity comes from the B1 inventory and your B2 assessments.
          </div>
          <button type="button" data-testid="scenario-starter" style={btnAccent} onClick={() => scenarioStore.createStarterSet()}>
            Start with the three templates
          </button>
        </div>
      ) : (
        <table data-testid="scenario-table" style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: `1px solid ${PALETTE.line}` }}>
          <thead>
            <tr style={{ background: "#eceff1", fontSize: 10.5 }}>
              <th style={{ padding: "2px 6px", textAlign: "left", width: 54 }} title={`Compare up to ${MAX_COMPARE} scenarios side by side`}>
                Compare
              </th>
              <th style={{ padding: "2px 6px", textAlign: "left" }}>Scenario</th>
              <th style={{ padding: "2px 6px", textAlign: "left" }}>Template</th>
              <th style={{ padding: "2px 6px", textAlign: "right" }} title="Category rules + component overrides">
                Overrides
              </th>
              <th style={{ padding: "2px 6px" }} />
            </tr>
          </thead>
          <tbody>
            {sc.scenarios.map((s) => (
              <ScenarioRow key={s.id} s={s} compared={sc.compareIds.includes(s.id)} active={sc.activeId === s.id} full={sc.compareIds.length >= MAX_COMPARE} modified={isModified(s, assessed)} renaming={renaming === s.id} name={name} setName={setName} onRename={() => (setRenaming(s.id), setName(s.name), setMessage(null))} onCommit={() => commitRename(s.id)} onCancel={() => setRenaming(null)} confirm={confirm?.id === s.id ? confirm.kind : null} setConfirm={(k) => setConfirm(k ? { kind: k, id: s.id } : null)} onMessage={setMessage} />
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <select data-testid="scenario-template" style={field} value={template} onChange={(e) => setTemplate(e.target.value as TemplateId)}>
          {TEMPLATES.map((t) => (
            <option key={t} value={t}>
              {TEMPLATE_INFO[t].label}
            </option>
          ))}
        </select>
        <button type="button" data-testid="scenario-new" style={btn} onClick={() => scenarioStore.createFromTemplate(template)}>
          New from template
        </button>
        {message && (
          <span data-testid="scenario-message" style={{ color: PALETTE.warn, fontSize: 11 }}>
            {message}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10.5, color: PALETTE.muted, marginTop: 4 }}>{TEMPLATE_INFO[template].summary}</div>
    </div>
  );
}

function ScenarioRow(p: {
  s: Scenario;
  compared: boolean;
  active: boolean;
  full: boolean;
  modified: boolean;
  renaming: boolean;
  name: string;
  setName: (n: string) => void;
  onRename: () => void;
  onCommit: () => void;
  onCancel: () => void;
  confirm: "reset" | "delete" | null;
  setConfirm: (k: "reset" | "delete" | null) => void;
  onMessage: (m: string | null) => void;
}) {
  const { s } = p;
  const overrides = Object.keys(s.categoryRules).length + Object.keys(s.componentRules).length;
  return (
    <tr data-testid="scenario-row" data-id={s.id} data-active={p.active} style={{ borderTop: `1px solid ${PALETTE.line}`, background: p.active ? "#fdf3ed" : "transparent" }}>
      <td style={{ padding: "2px 6px" }}>
        <input
          type="checkbox"
          data-testid="scenario-compare"
          checked={p.compared}
          disabled={!p.compared && p.full}
          title={!p.compared && p.full ? "Three scenarios are already compared" : "Include in the side-by-side comparison"}
          onChange={() => p.onMessage(scenarioStore.toggleCompare(s.id) ? null : "Three scenarios are already compared.")}
        />
      </td>
      <td style={{ padding: "2px 6px" }}>
        {p.renaming ? (
          <span style={{ display: "inline-flex", gap: 4 }}>
            <input data-testid="scenario-name-input" autoFocus style={{ ...field, width: 190 }} value={p.name} onChange={(e) => p.setName(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? p.onCommit() : e.key === "Escape" && p.onCancel())} />
            <button type="button" data-testid="scenario-rename-ok" style={btn} onClick={p.onCommit}>
              OK
            </button>
          </span>
        ) : (
          <button type="button" data-testid="scenario-name" onClick={() => scenarioStore.select(s.id)} title="Edit this scenario's assumptions" style={{ font: "inherit", background: "none", border: "none", padding: 0, cursor: "pointer", fontWeight: p.active ? 600 : 400, color: PALETTE.text, textAlign: "left" }}>
            {s.name}
          </button>
        )}
      </td>
      <td style={{ padding: "2px 6px", color: PALETTE.muted, fontSize: 11 }}>{TEMPLATE_INFO[s.template].label}</td>
      <td style={{ padding: "2px 6px", textAlign: "right" }}>{overrides}</td>
      <td style={{ padding: "2px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
        {p.confirm ? (
          <span>
            {p.confirm === "delete" ? "Delete?" : "Reset to template?"}{" "}
            <button type="button" data-testid="scenario-confirm" style={{ ...btn, color: PALETTE.warn }} onClick={() => (p.confirm === "delete" ? scenarioStore.delete(s.id) : scenarioStore.reset(s.id), p.setConfirm(null))}>
              Yes
            </button>{" "}
            <button type="button" style={btn} onClick={() => p.setConfirm(null)}>
              No
            </button>
          </span>
        ) : (
          <>
            <button type="button" data-testid="scenario-edit" style={p.active ? btnAccent : btn} onClick={() => (scenarioStore.select(s.id), setTimeout(() => document.querySelector("[data-testid=scenario-editor]")?.scrollIntoView({ block: "start", behavior: "smooth" }), 60))} title="Edit this scenario's assumptions (scrolls to the editor)">
              Edit
            </button>{" "}
            <button type="button" data-testid="scenario-rename" style={btn} onClick={p.onRename}>
              Rename
            </button>{" "}
            <button type="button" data-testid="scenario-duplicate" style={btn} onClick={() => scenarioStore.duplicate(s.id)}>
              Duplicate
            </button>{" "}
            <button type="button" data-testid="scenario-reset" style={p.modified ? btn : btnOff} disabled={!p.modified} onClick={() => p.setConfirm("reset")} title="Back to the template's defaults: clears every override">
              Reset
            </button>{" "}
            <button type="button" data-testid="scenario-delete" style={btn} onClick={() => p.setConfirm("delete")}>
              Delete
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
