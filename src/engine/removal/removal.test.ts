import { describe, expect, it } from "vitest";
import { getModelInventory, modelRecords } from "@/engine/quantities";
import { EMPTY_ASSESSMENT, type Assessments } from "@/engine/recovery";
import {
  RelationshipGraph,
  addEntries,
  addUserEdge,
  analysePlan,
  clearPlan,
  createPlan,
  duplicatePlan,
  getModelGraph,
  goToStep,
  highlightSets,
  insertPrerequisites,
  moveEntry,
  parsePlans,
  removeEntry,
  removeUserEdge,
  removedIds,
  reorder,
  requiredBefore,
  resetSimulation,
  serializePlans,
  setNote,
  stepBack,
  stepForward,
  suggestOrder,
  updateUserEdge,
  withCursor,
  type GraphNode,
  type RemovalPlan,
} from "./index";

const node = (id: string, o: Partial<GraphNode> = {}): GraphNode => ({ id, name: id, system: "structure", componentType: "beam", floor: 0, dependencies: [], group: false, ...o });
const planOf = (g: RelationshipGraph, ids: string[], cursor = 0): RemovalPlan => ({ ...addEntries(createPlan("p", "test"), g, ids).plan, cursor });
const codes = (a: ReturnType<typeof analysePlan>, i: number) => a.entries[i]!.findings.map((f) => f.code).sort();

// A1-style chain: slab S bears on beam B bears on column C bears on pedestal P bears on footing F.
// The stored direction is "X lists what it bears on"; the REMOVAL order is S, B, C, P, F.
const chain = new RelationshipGraph([
  node("F", { componentType: "footing" }),
  node("P", { componentType: "pedestal", dependencies: ["F"] }),
  node("C", { componentType: "column", dependencies: ["P"] }),
  node("B", { componentType: "beam", dependencies: ["C"] }),
  node("S", { componentType: "slab", dependencies: ["B"] }),
  node("C2", { componentType: "column" }),
]);

describe("edge direction (prerequisite → dependent)", () => {
  it("A1: a member that bears on another is its prerequisite, the reverse of the stored field", () => {
    const [e] = chain.prerequisitesOf("C").filter((x) => x.prerequisiteId === "B");
    expect(e).toMatchObject({ prerequisiteId: "B", dependentId: "C", relationship: "bears_on", severity: "blocking", source: "model", directed: true });
    expect(e!.reason).toContain("supported element is removed before its support");
    expect(chain.dependentsOf("C").map((x) => x.dependentId)).toEqual(["P"]);
    expect(chain.prerequisitesOf("F").map((x) => x.prerequisiteId)).toEqual(["P"]);
  });

  it("A2: an opening is the prerequisite of its host wall assembly and lintel", () => {
    const g = new RelationshipGraph([
      node("W", { system: "architecture", componentType: "wall_assembly", group: true }),
      node("W-LN", { system: "architecture", componentType: "wall_lintel", parentId: "W" }),
      node("W-P1", { system: "architecture", componentType: "wall_pier", parentId: "W" }),
      node("WIN", { system: "architecture", componentType: "window_assembly", group: true, dependencies: ["W", "W-LN"] }),
    ]);
    expect(g.prerequisitesOf("W").map((e) => [e.prerequisiteId, e.relationship, e.severity])).toEqual([["WIN", "hosted_in", "blocking"]]);
    expect(g.prerequisitesOf("W-LN").map((e) => e.prerequisiteId)).toEqual(["WIN"]);
    expect(g.prerequisitesOf("W-P1")).toEqual([]);
    expect([...g.coverage("W")].sort()).toEqual(["W", "W-LN", "W-P1"]);
    expect([...g.leaves("W")].sort()).toEqual(["W-LN", "W-P1"]);
  });

  it("A3: supply points upstream (the listed record is the prerequisite); drainage points downstream (the listing record is)", () => {
    const g = new RelationshipGraph([
      node("cw1", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-F01" }),
      node("cw2", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-F01", dependencies: ["cw1"] }),
      node("dr1", { system: "plumbing", componentType: "drain_pipe", networkId: "PLB-NET-DR-A1", dependencies: ["dr2"] }),
      node("dr2", { system: "plumbing", componentType: "drain_stack", networkId: "PLB-NET-DR-A1" }),
    ]);
    expect(g.prerequisitesOf("cw2")).toMatchObject([{ prerequisiteId: "cw1", dependentId: "cw2", relationship: "fed_from", severity: "advisory" }]);
    expect(g.prerequisitesOf("dr2")).toMatchObject([{ prerequisiteId: "dr1", dependentId: "dr2", relationship: "drains_into", severity: "advisory" }]);
  });

  it("never reads a vent, a cross-family or an unrecognised dependency as an order; it becomes an unknown link", () => {
    const g = new RelationshipGraph([
      node("v", { system: "plumbing", componentType: "vent_pipe", networkId: "PLB-NET-DR-A1", dependencies: ["t"] }),
      node("t", { system: "plumbing", componentType: "pipe_tee", networkId: "PLB-NET-DR-A1" }),
      node("pipe", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-X", dependencies: ["fix"] }),
      node("fix", { system: "architecture", componentType: "shower_mixer" }),
      node("lit", { system: "architecture", componentType: "wall_pier", dependencies: ["t"] }),
    ]);
    for (const id of ["v", "t", "pipe", "fix", "lit"]) expect(g.prerequisitesOf(id)).toEqual([]);
    expect(g.linksOf("v")).toMatchObject([{ relationship: "unordered_flow", severity: "unknown", directed: false }]);
    expect(g.linksOf("fix")).toHaveLength(1);
    expect(g.linksOf("lit")).toHaveLength(1);
  });

  it("parentId is containment for assemblies (no edge), and only a fallback 'member beneath' relation for structure", () => {
    const g = new RelationshipGraph([
      node("A", { system: "architecture", componentType: "kitchen_assembly", group: true }),
      node("A-1", { system: "architecture", componentType: "kitchen_sink", parentId: "A" }),
      node("c1", { componentType: "column" }),
      node("c2", { componentType: "column", parentId: "c1" }), // beneath c1, no dependencies listed
    ]);
    expect(g.prerequisitesOf("A")).toEqual([]);
    expect(g.prerequisitesOf("A-1")).toEqual([]);
    expect(g.linksOf("A-1")).toEqual([]);
    expect(g.prerequisitesOf("c1")).toMatchObject([{ prerequisiteId: "c2", dependentId: "c1", relationship: "bears_on", via: "c2.parentId" }]);
  });

  it("connectedTo is symmetric and carries no order, even when only one side lists it", () => {
    const g = new RelationshipGraph([node("a", { system: "electrical", componentType: "conduit", connectedTo: ["b"] }), node("b", { system: "electrical", componentType: "junction_box" })]);
    expect(g.linksOf("a")).toHaveLength(1);
    expect(g.linksOf("b")[0]!.id).toBe(g.linksOf("a")[0]!.id);
    expect(g.prerequisitesOf("a")).toEqual([]);
    expect(g.dependentsOf("b")).toEqual([]);
  });
});

describe("sequence validation", () => {
  it("a valid prerequisite chain has no errors in the right order and blocking errors in the wrong one", () => {
    const ok = analysePlan(chain, planOf(chain, ["S", "B", "C", "P", "F"]));
    expect(ok.errorCount).toBe(0);
    expect(ok.entries.every((e) => !e.blocked)).toBe(true);
    const bad = analysePlan(chain, planOf(chain, ["F", "P", "C", "B", "S"]));
    expect(bad.entries.map((e) => e.blocked)).toEqual([true, true, true, true, false]);
    expect(codes(bad, 0)).toEqual(["ORDER_VIOLATION"]);
    expect(bad.entries[2]!.findings[0]!.edges[0]).toMatchObject({ prerequisiteId: "B", dependentId: "C" });
    expect(bad.entries[2]!.findings[0]!.message).toContain("scheduled before its blocking prerequisite B");
  });

  it("a blocking prerequisite that is not in the plan blocks the dependent", () => {
    const a = analysePlan(chain, planOf(chain, ["C"]));
    expect(a.entries[0]!.blocked).toBe(true);
    expect(a.entries[0]!.findings[0]).toMatchObject({ code: "PREREQ_NOT_IN_PLAN", level: "error", source: "model" });
    expect(a.entries[0]!.findings[0]!.message).toContain("Blocking prerequisite B is not in the plan");
    // C's own dependents (P) do not need to be in the plan
    expect(analysePlan(chain, planOf(chain, ["S", "B", "C"])).errorCount).toBe(0);
  });

  it("independent components can be scheduled in either order", () => {
    expect(analysePlan(chain, planOf(chain, ["C2", "S"])).errorCount).toBe(0);
    expect(analysePlan(chain, planOf(chain, ["S", "C2"])).errorCount).toBe(0);
  });

  it("reordering re-validates", () => {
    let p = planOf(chain, ["B", "S"]);
    expect(analysePlan(chain, p).entries[0]!.blocked).toBe(true);
    p = moveEntry(p, 1, 0);
    expect(p.entries).toEqual(["S", "B"]);
    expect(analysePlan(chain, p).errorCount).toBe(0);
  });

  it("advisory relationships warn without blocking, whether absent or later in the sequence", () => {
    const g = new RelationshipGraph([
      node("p1", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-F01" }),
      node("p2", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-F01", dependencies: ["p1"] }),
    ]);
    const absent = analysePlan(g, planOf(g, ["p2"]));
    expect(absent.entries[0]).toMatchObject({ blocked: false });
    expect(codes(absent, 0)).toEqual(["ADVISORY_NOT_IN_PLAN", "ISOLATION_UNCONFIRMED"]);
    expect(absent.warningCount).toBe(1);
    expect(absent.errorCount).toBe(0);
    const later = analysePlan(g, planOf(g, ["p2", "p1"]));
    expect(codes(later, 0)).toContain("ADVISORY_ORDER");
    expect(later.entries[0]!.blocked).toBe(false);
    expect(codes(analysePlan(g, planOf(g, ["p1", "p2"])), 1)).not.toContain("ADVISORY_ORDER");
  });

  it("lists unknown relationships for review without blocking or ordering", () => {
    const g = new RelationshipGraph([node("a", { system: "electrical", componentType: "conduit", connectedTo: ["b"] }), node("b", { system: "electrical", componentType: "junction_box" })]);
    const alone = analysePlan(g, planOf(g, ["a"]));
    expect(codes(alone, 0)).toEqual(["UNKNOWN_LINK"]);
    expect(alone.reviewCount).toBe(1);
    expect(alone.entries[0]!.blocked).toBe(false);
    expect(codes(analysePlan(g, planOf(g, ["a", "b"])), 0)).toEqual([]);
    expect(codes(analysePlan(g, planOf(g, ["b", "a"])), 0)).toEqual([]); // either order is fine
  });

  it("reports missing references, duplicates and assembly/part overlap without dropping them", () => {
    const g = new RelationshipGraph([
      node("W", { system: "architecture", componentType: "wall_assembly", group: true }),
      node("W-1", { system: "architecture", componentType: "wall_pier", parentId: "W" }),
    ]);
    const p: RemovalPlan = { ...createPlan("p", "x"), entries: ["W", "ghost", "W", "W-1"] };
    const a = analysePlan(g, p);
    expect(a.entries.map((e) => e.exists)).toEqual([true, false, true, true]);
    expect(codes(a, 1)).toEqual(["MISSING_REF"]);
    expect(codes(a, 2)).toEqual(["DUPLICATE_ENTRY"]);
    expect(codes(a, 3)).toEqual(["OVERLAP_ENTRY"]);
    expect(codes(a, 0)).toEqual(["OVERLAP_ENTRY"]);
    expect(a.entries.every((e) => e.blocked)).toBe(true);
    expect(a.entries[2]!.coverage).toEqual([]); // a duplicate stands for nothing
    expect(addEntries(createPlan("p", "x"), g, ["W", "W", "nope"])).toMatchObject({ added: ["W"], duplicates: ["W"], unknown: ["nope"] });
  });

  it("an assembly entry covers its parts; a prerequisite assembly satisfied by its parts counts as addressed", () => {
    const g = new RelationshipGraph([
      node("W", { system: "architecture", componentType: "wall_assembly", group: true }),
      node("W-1", { system: "architecture", componentType: "wall_pier", parentId: "W" }),
      node("WIN", { system: "architecture", componentType: "window_assembly", group: true, dependencies: ["W"] }),
      node("WIN-F", { system: "architecture", componentType: "window_frame", parentId: "WIN" }),
    ]);
    // WIN planned as its single part, W as a whole: the group prerequisite is fully covered by WIN-F
    expect(analysePlan(g, planOf(g, ["WIN-F", "W"])).errorCount).toBe(0);
    expect(analysePlan(g, planOf(g, ["W", "WIN-F"])).entries[0]!.findings[0]).toMatchObject({ code: "ORDER_VIOLATION" });
    // a group-level edge applies to an entry only when that group is planned as a whole
    expect(analysePlan(g, planOf(g, ["W-1"])).errorCount).toBe(0);
    expect(removedIds(analysePlan(g, planOf(g, ["W", "WIN-F"])), 1)).toEqual(new Set(["W", "W-1"]));
  });

  it("detects circular dependencies among user-defined and model relationships and names the path", () => {
    let p = planOf(chain, ["C2", "S"]);
    p = addUserEdge(p, chain, { prerequisiteId: "C2", dependentId: "S", severity: "blocking", reason: "C2 carries the temporary prop" }, "u1").plan;
    expect(analysePlan(chain, p).errorCount).toBe(0);
    p = addUserEdge(p, chain, { prerequisiteId: "S", dependentId: "C2", severity: "blocking", reason: "S must be unloaded first" }, "u2").plan;
    const a = analysePlan(chain, p);
    expect(a.cycles).toEqual([["C2", "S", "C2"]]);
    expect(a.entries.map((e) => e.blocked)).toEqual([true, true]);
    expect(a.entries[0]!.findings.map((f) => f.code)).toContain("CYCLE");
    expect(a.entries[0]!.findings.find((f) => f.code === "CYCLE")!.message).toContain("C2 → S → C2");
  });

  it("applies user-defined dependencies with their source and reason", () => {
    let p = planOf(chain, ["C2", "S"]);
    p = addUserEdge(p, chain, { prerequisiteId: "S", dependentId: "C2", severity: "blocking", reason: "scaffold on C2 is removed with S" }, "u1").plan;
    const a = analysePlan(chain, p);
    expect(a.entries[0]!.findings[0]).toMatchObject({ code: "ORDER_VIOLATION", source: "user" });
    expect(a.entries[0]!.findings[0]!.message).toContain("scaffold on C2 is removed with S");
    const adv = updateUserEdge(p, chain, "u1", { prerequisiteId: "S", dependentId: "C2", severity: "advisory", reason: "prefer S first" });
    expect(adv.error).toBeNull();
    expect(analysePlan(chain, adv.plan).entries[0]!.blocked).toBe(false);
    expect(analysePlan(chain, removeUserEdge(p, "u1")).errorCount).toBe(0);
  });

  it("validates user-defined dependencies", () => {
    const p = planOf(chain, ["S"]);
    const e = (o: object) => addUserEdge(p, chain, { prerequisiteId: "S", dependentId: "C2", severity: "blocking", reason: "x", ...o }, "u").error;
    expect(e({})).toBeNull();
    expect(e({ reason: "   " })).toMatch(/reason is required/);
    expect(e({ dependentId: "S" })).toMatch(/own prerequisite/);
    expect(e({ dependentId: "nope" })).toMatch(/Unknown component/);
    const once = addUserEdge(p, chain, { prerequisiteId: "S", dependentId: "C2", severity: "blocking", reason: "x" }, "u1").plan;
    expect(addUserEdge(once, chain, { prerequisiteId: "S", dependentId: "C2", severity: "advisory", reason: "y" }, "u2").error).toMatch(/already exists/);
    expect(analysePlan(chain, { ...p, userEdges: [{ id: "z", prerequisiteId: "S", dependentId: "gone", severity: "blocking", reason: "r" }] }).findings.some((f) => f.code === "USER_EDGE_INACTIVE" && f.level === "review")).toBe(true);
  });

  it("is deterministic", () => {
    const p = planOf(chain, ["F", "C", "S", "B", "P", "C2"]);
    expect(JSON.stringify(analysePlan(chain, p))).toBe(JSON.stringify(analysePlan(chain, p)));
  });
});

describe("states and the simulation cursor", () => {
  const p0 = planOf(chain, ["S", "B", "C", "C2"]);
  it("derives planned / ready for review / simulated removed; blocked is a separate calculated flag", () => {
    const states = (cursor: number) => analysePlan(chain, { ...p0, cursor }).entries.map((e) => e.state);
    expect(states(0)).toEqual(["ready_for_review", "planned", "planned", "ready_for_review"]); // B waits for S, C for B; C2 is free
    expect(states(1)).toEqual(["simulated_removed", "ready_for_review", "planned", "ready_for_review"]);
    expect(states(3)).toEqual(["simulated_removed", "simulated_removed", "simulated_removed", "ready_for_review"]);
    expect(analysePlan(chain, p0).entries.every((e) => !e.blocked)).toBe(true);
    expect(analysePlan(chain, planOf(chain, ["B"])).entries[0]).toMatchObject({ blocked: true, state: "planned" });
  });

  it("steps forward only through unblocked entries and never skips a blocked one", () => {
    const bad = planOf(chain, ["B", "S", "C2"]); // B is scheduled before its prerequisite S
    const a = analysePlan(chain, bad);
    expect(a.nextAvailable).toBe(1); // S is the next available entry
    expect(stepForward(bad, a)).toBe(bad); // blocked at the cursor: unchanged
    expect(goToStep(bad, a, 3).cursor).toBe(0);
    const fixed = moveEntry(bad, 1, 0);
    const b = analysePlan(chain, fixed);
    expect(stepForward(fixed, b).cursor).toBe(1);
    expect(goToStep(fixed, b, 3).cursor).toBe(3);
    expect(goToStep({ ...fixed, cursor: 3 }, b, 1).cursor).toBe(1);
    expect(stepBack(stepForward(fixed, b)).cursor).toBe(0);
    expect(stepBack(fixed)).toBe(fixed);
  });

  it("withCursor equals a full analysis at that cursor (so stepping never re-validates)", () => {
    const g = getModelGraph();
    const base = planOf(g, ["STR-COL-G-A1", "STR-BM-F01-X-A1-B1", "STR-SLAB-F01-P01", "STR-COL-F01-A1", "ghost-id"]);
    const bad = { ...base, entries: [...base.entries, "STR-COL-G-A1"] }; // plus a duplicate
    for (const p of [p0, base, bad]) {
      const at0 = analysePlan(p === p0 ? chain : g, { ...p, cursor: 0 });
      for (let c = 0; c <= p.entries.length + 1; c++) expect(JSON.stringify(withCursor(at0, c))).toBe(JSON.stringify(analysePlan(p === p0 ? chain : g, { ...p, cursor: c })));
    }
  });

  it("reset restores the initial state and the removed set follows the cursor", () => {
    const a = analysePlan(chain, { ...p0, cursor: 2 });
    expect(removedIds(a, 2)).toEqual(new Set(["S", "B"]));
    expect(removedIds(a, 0).size).toBe(0);
    expect(resetSimulation({ ...p0, cursor: 2 })).toEqual(p0);
  });

  it("an edit before the cursor pulls the cursor back; an edit after it leaves it", () => {
    expect(removeEntry({ ...p0, cursor: 3 }, 1).cursor).toBe(1);
    expect(moveEntry({ ...p0, cursor: 3 }, 3, 2).cursor).toBe(2);
    expect(moveEntry({ ...p0, cursor: 1 }, 3, 2).cursor).toBe(1);
    expect(addEntries({ ...p0, cursor: 2 }, chain, ["P"]).plan.cursor).toBe(2); // appended
    expect(addEntries({ ...p0, cursor: 2 }, chain, ["P"], 1).plan.cursor).toBe(1); // inserted before the cursor
    expect(reorder({ ...p0, cursor: 4 }, ["B", "S", "C", "C2"]).cursor).toBe(0);
    expect(reorder(p0, ["S", "B"])).toBe(p0); // not a permutation: ignored
  });
});

describe("suggestions and prerequisites (explicit actions)", () => {
  it("suggestOrder returns a valid, stable order and leaves the plan untouched", () => {
    const p = planOf(chain, ["C", "C2", "B", "S"]);
    const s = suggestOrder(analysePlan(chain, p));
    expect(s.order).toEqual(["C2", "S", "B", "C"]);
    expect(s.changed).toBe(true);
    expect(s.stuck).toEqual([]);
    expect(p.entries).toEqual(["C", "C2", "B", "S"]);
    expect(analysePlan(chain, reorder(p, s.order)).errorCount).toBe(0);
    expect(suggestOrder(analysePlan(chain, planOf(chain, ["S", "B", "C"]))).changed).toBe(false);
  });

  it("suggestOrder reports entries stuck on a cycle", () => {
    let p = planOf(chain, ["C2", "S"]);
    p = addUserEdge(p, chain, { prerequisiteId: "C2", dependentId: "S", severity: "blocking", reason: "a" }, "1").plan;
    p = addUserEdge(p, chain, { prerequisiteId: "S", dependentId: "C2", severity: "blocking", reason: "b" }, "2").plan;
    expect(suggestOrder(analysePlan(chain, p))).toMatchObject({ stuck: ["C2", "S"], changed: false });
  });

  it("requiredBefore follows blocking prerequisites transitively and nothing else", () => {
    expect(requiredBefore(chain, ["C"]).required).toEqual(["B", "S"]);
    expect(requiredBefore(chain, ["F"]).required).toEqual(["P", "C", "B", "S"]);
    expect(requiredBefore(chain, ["S"]).required).toEqual([]);
    expect(requiredBefore(chain, ["C", "B"]).required).toEqual(["S"]);
  });

  it("insertPrerequisites puts them, correctly ordered, just before the entry, and the result validates", () => {
    const base = planOf(chain, ["C2", "F"]);
    const r = insertPrerequisites(base, chain, "F");
    expect(r.added).toEqual(["S", "B", "C", "P"]);
    expect(r.plan.entries).toEqual(["C2", "S", "B", "C", "P", "F"]);
    expect(analysePlan(chain, r.plan).errorCount).toBe(0);
    expect(insertPrerequisites(r.plan, chain, "F").added).toEqual([]); // idempotent
    expect(insertPrerequisites(base, chain, "nope").plan).toBe(base);
  });
});

describe("plan data integrity", () => {
  it("duplicating a plan yields independent data with the same sequence, restarted", () => {
    let a = planOf(chain, ["S", "B"], 2);
    a = setNote(a, "S", "check with engineer");
    a = addUserEdge(a, chain, { prerequisiteId: "S", dependentId: "C2", severity: "advisory", reason: "r" }, "u1").plan;
    const b = duplicatePlan(a, "p2");
    expect(b).toMatchObject({ id: "p2", name: "test (copy)", entries: ["S", "B"], cursor: 0, notes: { S: "check with engineer" } });
    expect(JSON.stringify(analysePlan(chain, b).entries.map((e) => e.findings))).toBe(JSON.stringify(analysePlan(chain, { ...a, cursor: 0 }).entries.map((e) => e.findings)));
    const b2 = removeEntry(setNote(b, "S", ""), 0);
    expect(a.entries).toEqual(["S", "B"]);
    expect(a.notes).toEqual({ S: "check with engineer" });
    expect(a.userEdges).toHaveLength(1);
    expect(b2.entries).toEqual(["B"]);
    expect(clearPlan(a)).toMatchObject({ entries: [], notes: {}, userEdges: [], cursor: 0 });
  });

  it("operations never mutate their input", () => {
    const deep = (o: unknown): unknown => (typeof o === "object" && o !== null ? (Object.values(o).forEach(deep), Object.freeze(o)) : o);
    const p = deep(planOf(chain, ["S", "B", "C"], 1)) as RemovalPlan;
    expect(() => {
      moveEntry(p, 0, 2);
      removeEntry(p, 1);
      setNote(p, "S", "n");
      addEntries(p, chain, ["P"], 0);
      stepForward(p, analysePlan(chain, p));
      insertPrerequisites(p, chain, "C");
      duplicatePlan(p, "x");
      analysePlan(chain, p);
    }).not.toThrow();
  });
});

describe("persistence", () => {
  it("round-trips plans (without the cursor) and keeps references to unknown components for the user to resolve", () => {
    let p: RemovalPlan = { ...planOf(chain, ["S", "B"], 2), entries: ["S", "ghost", "B"] }; // a reference to a component that no longer exists
    p = setNote(p, "S", "n1");
    p = addUserEdge(p, chain, { prerequisiteId: "S", dependentId: "C2", severity: "blocking", reason: "because" }, "u1").plan;
    const q = { ...duplicatePlan(p, "p2", "second") };
    const parsed = parsePlans(serializePlans({ plans: [p, q], activeId: "p2" }));
    expect(parsed.dropped).toBe(0);
    expect(parsed.activeId).toBe("p2");
    expect(parsed.plans[0]).toEqual({ ...p, cursor: 0 });
    expect(parsed.plans[0]!.entries).toContain("ghost");
  });

  it("ignores corrupt, outdated or malformed data without throwing", () => {
    expect(parsePlans(null).plans).toEqual([]);
    expect(parsePlans("{not json").plans).toEqual([]);
    expect(parsePlans(JSON.stringify({ version: 99, plans: [] })).plans).toEqual([]);
    expect(parsePlans(JSON.stringify({ version: 1, plans: "x" })).plans).toEqual([]);
    const mixed = parsePlans(
      JSON.stringify({
        version: 1,
        activeId: "nope",
        plans: [
          { id: "a", name: "ok", entries: ["S", 7, null, "B"], notes: { S: "n", B: 3 }, userEdges: [{ id: "e", prerequisiteId: "S", dependentId: "B", severity: "blocking", reason: "r" }, { id: "bad", severity: "x" }, { id: "e2", prerequisiteId: "a", dependentId: "b", severity: "advisory", reason: "  " }] },
          { id: "a", name: "duplicate id", entries: [] },
          { name: "no id", entries: [] },
          null,
        ],
      }),
    );
    expect(mixed.dropped).toBe(3);
    expect(mixed.activeId).toBe("a");
    expect(mixed.plans).toEqual([{ id: "a", name: "ok", entries: ["S", "B"], notes: { S: "n" }, userEdges: [{ id: "e", prerequisiteId: "S", dependentId: "B", severity: "blocking", reason: "r" }], cursor: 0 }]);
  });
});

// ── the real generated model ────────────────────────────────────────────────

describe("real model: relationship census and direction", () => {
  const g = getModelGraph();
  const recs = modelRecords();
  const byId = new Map(recs.map((r) => [r.id, r]));

  it("every referenced component exists", () => {
    expect(g.size).toBe(recs.length);
    for (const r of recs) {
      if (r.parentId) expect(byId.has(r.parentId)).toBe(true);
      for (const d of [...r.dependencies, ...(r.connectedTo ?? [])]) expect(byId.has(d)).toBe(true);
    }
  });

  it("A1: the stored direction of 'bears on' is the reverse of the removal direction", () => {
    expect(byId.get("STR-BM-F01-X-A1-B1")!.dependencies).toContain("STR-COL-G-A1");
    const beam = g.prerequisitesOf("STR-COL-G-A1").find((e) => e.prerequisiteId === "STR-BM-F01-X-A1-B1")!;
    expect(beam).toMatchObject({ dependentId: "STR-COL-G-A1", relationship: "bears_on", severity: "blocking", source: "model" });
    expect(g.prerequisitesOf("STR-COL-G-A1").map((e) => e.prerequisiteId)).toContain("STR-COL-F01-A1"); // the column above
    expect(g.dependentsOf("STR-COL-G-A1").map((e) => e.dependentId)).toEqual(["STR-PED-G-A1"]); // its pedestal comes later
    expect(g.prerequisitesOf("STR-FTG-G-A1").map((e) => e.prerequisiteId)).toEqual(["STR-PED-G-A1"]);
    const plan = (ids: string[]) => analysePlan(g, planOf(g, ids));
    const withBeam = plan(["STR-BM-F01-X-A1-B1", "STR-COL-G-A1"]);
    expect(withBeam.entries[1]!.findings.flatMap((f) => f.edges.map((e) => e.prerequisiteId))).not.toContain("STR-BM-F01-X-A1-B1"); // satisfied
    const wrong = plan(["STR-COL-G-A1", "STR-BM-F01-X-A1-B1"]);
    expect(wrong.entries[0]!.findings.find((f) => f.code === "ORDER_VIOLATION")!.edges.map((e) => e.prerequisiteId)).toContain("STR-BM-F01-X-A1-B1");
  });

  it("A2: a window assembly is removed before its wall assembly and lintel", () => {
    const win = "ARC-WIN-G-A1-LIV-S-01";
    const wall = "ARC-WALL-G-EXT-S-A1-B1";
    expect(byId.get(win)!.dependencies).toEqual(expect.arrayContaining([wall, `${wall}-LN01`]));
    expect(g.prerequisitesOf(wall).map((e) => [e.prerequisiteId, e.relationship])).toContainEqual([win, "hosted_in"]);
    expect(g.prerequisitesOf(`${wall}-LN01`).map((e) => e.prerequisiteId)).toContain(win);
    const touches = (a: ReturnType<typeof analysePlan>, i: number) => a.entries[i]!.findings.some((f) => f.edges.some((e) => e.prerequisiteId === win));
    expect(touches(analysePlan(g, planOf(g, [win, wall])), 1)).toBe(false);
    const rev = analysePlan(g, planOf(g, [wall, win]));
    expect(rev.entries[0]!.findings.find((f) => f.code === "ORDER_VIOLATION")!.edges.every((e) => e.relationship === "hosted_in")).toBe(true);
    expect(analysePlan(g, planOf(g, [win])).errorCount).toBe(0); // the opening has no prerequisites
    expect(analysePlan(g, planOf(g, [win, "ARC-WIN-G-A1-LIV-W-01"].filter((x) => g.has(x)))).errorCount).toBe(0); // independent openings
  });

  it("A3: advisory flow relationships, in both directions, never block", () => {
    const find = (rel: string) => {
      for (const r of recs) if (r.system === "plumbing") for (const e of g.prerequisitesOf(r.id)) if (e.relationship === rel) return e;
    };
    const drain = find("drains_into")!;
    const supply = find("fed_from")!;
    for (const e of [drain, supply]) {
      expect(e.severity).toBe("advisory");
      const a = analysePlan(g, planOf(g, [e.dependentId]));
      expect(a.entries[0]!.blocked).toBe(false);
      expect(a.entries[0]!.findings.map((f) => f.code)).toContain("ADVISORY_NOT_IN_PLAN");
      expect(a.entries[0]!.findings.map((f) => f.code)).toContain("ISOLATION_UNCONFIRMED");
    }
    // stored direction check: drainage lists the downstream record; supply lists the upstream one
    expect(byId.get(drain.prerequisiteId)!.dependencies).toContain(drain.dependentId);
    expect(byId.get(supply.dependentId)!.dependencies).toContain(supply.prerequisiteId);
  });

  it("the model's blocking relationships can all be satisfied: no cycles, and a suggested order has no violations", () => {
    const top = recs.filter((r) => !g.containerOf(r.id)).map((r) => r.id);
    const base = analysePlan(g, planOf(g, top));
    expect(base.cycles).toEqual([]);
    expect(base.findings.filter((f) => f.code === "PREREQ_NOT_IN_PLAN")).toEqual([]); // every record is covered
    const sorted = suggestOrder(base);
    expect(sorted.stuck).toEqual([]);
    const after = analysePlan(g, reorder(planOf(g, top), sorted.order));
    expect(after.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(after.blockedCount).toBe(0);
  });

  it("inserting a column's prerequisites yields a valid plan", () => {
    const col = "STR-COL-G-A1";
    const r = insertPrerequisites(planOf(g, [col]), g, col);
    expect(r.added).toHaveLength(requiredBefore(g, [col]).required.length);
    expect(r.added).toContain("STR-BM-F01-X-A1-B1");
    expect(r.added).not.toContain("STR-PED-G-A1");
    expect(r.added.indexOf("STR-SLAB-F01-P01")).toBeLessThan(r.added.indexOf("STR-BM-F01-X-A1-B1"));
    expect(analysePlan(g, r.plan).errorCount).toBe(0);
  });

  it("planning and analysis leave B1 quantities, B2 assessments and the records unchanged", () => {
    const snap = () => JSON.stringify(recs.slice(0, 4000).map((r) => [r.id, r.quantity, r.unit, r.dependencies, r.parentId ?? null]));
    const inv = getModelInventory();
    const q = () => JSON.stringify([...inv.byId].slice(0, 2000).map(([id, v]) => [id, v.primary, v.mass]));
    const b2: Assessments = new Map([["STR-COL-G-A1", { ...EMPTY_ASSESSMENT, classification: "direct_reuse", recoveryPct: 60 }]]);
    const before = [snap(), q(), JSON.stringify([...b2])];
    let p = planOf(g, ["STR-COL-G-A1"]);
    p = insertPrerequisites(p, g, "STR-COL-G-A1").plan;
    p = setNote(moveEntry(p, 0, 1), "STR-COL-G-A1", "note");
    analysePlan(g, { ...p, cursor: 3 });
    expect([snap(), q(), JSON.stringify([...b2])]).toEqual(before);
  });
});

describe("dependency highlighting", () => {
  it("marks the planned, blocked, prerequisite, dependent and advisory components, and never the removed ones", () => {
    const p = planOf(chain, ["S", "B", "C", "P"], 1);
    const a = analysePlan(chain, p);
    const removed = removedIds(a, 1);
    const h = highlightSets(chain, a, p, "C", removed);
    expect([...h.prerequisites]).toEqual(["B"]); // S is removed (hidden), so only B remains to be marked
    expect([...h.dependents]).toEqual(["P"]);
    expect(h.focusEntry).toBe(2);
    expect([...h.planned].sort()).toEqual(["B", "C", "P"]);
    expect(h.blocked.size).toBe(0);
    const bad = planOf(chain, ["C"]);
    const hb = highlightSets(chain, analysePlan(chain, bad), bad, null, new Set());
    expect([...hb.blocked]).toEqual(["C"]);
    expect(hb.planned.size).toBe(0);
    expect(hb.focusEntry).toBeNull();
  });

  it("works for a component that is not in the plan, and for assemblies (their parts)", () => {
    const empty = createPlan("e", "e");
    const h = highlightSets(chain, analysePlan(chain, empty), empty, "B", new Set());
    expect([...h.prerequisites]).toEqual(["S"]);
    expect([...h.dependents]).toEqual(["C"]);
    expect(h.focusEntry).toBeNull();
  });

  it("includes user-defined relatives and separates advisory ones", () => {
    const g = new RelationshipGraph([
      node("p1", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-F01" }),
      node("p2", { system: "plumbing", componentType: "pipe", networkId: "PLB-NET-CW-F01", dependencies: ["p1"] }),
      node("x"),
    ]);
    let p = planOf(g, ["p2"]);
    p = addUserEdge(p, g, { prerequisiteId: "x", dependentId: "p2", severity: "blocking", reason: "r" }, "u").plan;
    const h = highlightSets(g, analysePlan(g, p), p, "p2", new Set());
    expect([...h.advisory]).toEqual(["p1"]);
    expect([...h.prerequisites]).toEqual(["x"]);
  });

  it("real model: a column's relatives are the members above it and the pedestal below", () => {
    const g = getModelGraph();
    const p = planOf(g, ["STR-COL-G-A1"]);
    const h = highlightSets(g, analysePlan(g, p), p, "STR-COL-G-A1", new Set());
    expect(h.prerequisites.has("STR-BM-F01-X-A1-B1")).toBe(true);
    expect(h.prerequisites.has("STR-COL-F01-A1")).toBe(true);
    expect(h.prerequisites.has("STR-PED-G-A1")).toBe(false);
    expect([...h.dependents]).toEqual(["STR-PED-G-A1"]);
    expect(h.blocked.has("STR-COL-G-A1")).toBe(true); // its prerequisites are not in the plan
  });
});
