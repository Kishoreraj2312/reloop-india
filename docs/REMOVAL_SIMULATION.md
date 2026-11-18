# ReLoop India — Removal Simulation with Dependency Logic (B3)

B3 lets a user pick real components, order them into a removal plan, see which relationships the model itself records between
them, find blocked or invalid steps, and step through the plan on the existing 3D model. It extends the one registry, one viewer,
one B1 inventory and the B2 store; it adds no dependencies, no second viewer and no new geometry.

**It is a conceptual planning aid.** It reads relationships the generators wrote into the records. It does not calculate
structural stability, prove a load path, know whether a service is isolated, or produce a certified demolition or deconstruction
order. "Simulated as removed" and "ready for review" describe the plan, not the real building.

```
src/engine/removal/   pure: types, graph (adapters), validate (plan analysis), sequence, plan ops, highlight, persist, model
src/scene/removal/    removalStore (external store + localStorage), RemovalDrawer, EntryDetail, RemovalInfo (inspector line),
                      RemovalOverlay (3D), hide (instance hiding), colors, ui
scripts/removal/census.ts        relationship census (npm run census:removal)
scripts/browser/verifyB3.mjs     real-browser check (npm run verify:browser:b3)
```

## Direction: prerequisite → dependent

Every relationship is normalised to one reading: **the prerequisite must be addressed before the dependent can be removed.**
The model's own fields do not share that direction, so each source has its own adapter (`graph.ts`, `dependencyEdge()`), each
unit-tested. Raw `dependencies`, `parentId` or `connectedTo` are never read as "prerequisites" directly.

### Relationship census of the generated model (87,380 records; `npm run census:removal`)

| Raw field | Edges | What the model says | B3 reading |
|---|---:|---|---|
| `dependencies`, A1 structure (slab → beam, beam → column / pedestal, column → column / pedestal, pedestal → footing, flight → landing) | 1,954 | "this member bears on / frames into that one" | **`bears_on`, blocking.** The supported member is the prerequisite of its support: the stored direction is the *reverse* of removal order. |
| `dependencies`, A2 openings (window / door / cased-opening assembly → host wall assembly and lintel; enclosure door → roof enclosure) | 880 | "this opening is hosted in that wall" | **`hosted_in`, blocking.** The opening is the prerequisite of its host. |
| `dependencies`, A3 supply networks (cold, hot water, water supply, all electrical) | 19,825 | "this record is fed from the listed upstream record" | **`fed_from`, advisory.** The listed (upstream) record is the prerequisite: the stored direction is the removal direction. |
| `dependencies`, A3 drainage, sewer and rainwater | 3,496 | "this record drains into the listed downstream record" | **`drains_into`, advisory.** The listing record (the discharger) is the prerequisite: the stored direction is the *reverse*. |
| `dependencies`, A3 vents, cross-family (e.g. plumbing → electrical, pipe → fixture) or unrecognised | 207 | a dependency whose removal direction cannot be read | **`unordered_flow`, unknown, no order.** Listed for review. |
| `connectedTo` (A3 physical joints) | 61,404 unique joints (119,206 listed; 3,602 listed from one side only) | symmetric physical connection | **`connected_to`, unknown, no order.** Listed for review when the other end is not in the plan. |
| `parentId`, A1 | 252 | "the member directly beneath" (all 252 are also in `dependencies`) | same relation as `bears_on`; added only if a record omits it |
| `parentId`, A2 / A3 | 83,420 | the containing assembly (a group record) | **containment, never an order.** An assembly entry stands for all of its parts. |

Checks: 0 dangling references in any field; 0 cycles in `dependencies` and in `parentId`. Both are asserted in the tests, and the
real model's blocking relationships are checked to be satisfiable (a suggested order of all 3,960 top-level records has no
violation).

### Source labels and severity

- **model**: stated by a model field; the direction comes from the documented adapter above.
- **rule**: derived by a documented rule from model data. Currently one: the isolation note ("covers N MEP networks; isolation is
  not modelled, confirm on site"), an `info` finding.
- **user**: entered by the user with a mandatory reason.
- **blocking** relationships block the dependent; **advisory** ones warn only; **unknown** ones are listed for review and imply no
  order. Nothing is inferred from proximity, and no connection point, load path or isolation status is invented.
- Why advisory for MEP: the model has no isolation or discharge state, so it cannot say that an upstream element is a *hard*
  prerequisite. Why blocking for A1 and A2: "bears on" and "hosted in" are recorded support/hosting relations; the planner
  treats removing a support (or host) before what it carries as a sequencing error. That is a planning rule, not a stability check.

## Plans, states and the simulation

A plan stores only `id, name, ordered entry ids, notes, user dependencies`. It references components by id and never writes to
records, B1 quantities or B2 assessments. An entry is one record id; an assembly id stands for all its parts, and an assembly
together with one of its own parts is an overlap error.

States are **derived**, never hand-set:

| State | Meaning |
|---|---|
| Not planned | not in the sequence |
| Planned | in the sequence, not yet simulated; some in-plan blocking prerequisite has not been simulated yet |
| Ready for review | no hard error, and every blocking prerequisite is already simulated as removed (or there is none). Always "requires human review" |
| Simulated as removed | position before the simulation cursor |
| *blocked* (a flag, not a state) | at least one hard error is attached to the step; the reasons are listed |

The simulation cursor is an ordered prefix: entries before it are "removed". **Next** is enabled only when the entry at the cursor
is not blocked; a blocked step is never skipped. The panel then names the next available step and offers an explicit
"move it to step n". An edit that changes an entry before the cursor pulls the cursor back to that entry. The cursor is not saved.

### Validation (`analysePlan`, pure and deterministic)

Hard errors: `MISSING_REF` (component does not exist; kept visible, never silently dropped), `DUPLICATE_ENTRY`, `OVERLAP_ENTRY`,
`PREREQ_NOT_IN_PLAN` (blocking prerequisite not in the plan), `ORDER_VIOLATION` (dependent scheduled before a blocking
prerequisite), `CYCLE` (reported with its path). Warnings: `ADVISORY_NOT_IN_PLAN`, `ADVISORY_ORDER`. Review: `UNKNOWN_LINK`,
`USER_EDGE_INACTIVE`. Info: `ISOLATION_UNCONFIRMED`. Findings are folded per step and relationship kind with a count and a bounded
sample, each showing the relationship, severity, source and reason. The order is never changed silently.

Group-level edges (wall assembly, window assembly) apply to a step only when that group is planned as a whole; a prerequisite
group counts as addressed when all its parts are covered by earlier entries.

Explicit user actions: **Add blocking prerequisites** (transitive closure, inserted just before the step, ordered among
themselves), **Apply suggested order** (previewed first; stable topological order; steps on a cycle stay where they are).

User-defined dependencies: any pair of existing components, blocking or advisory, with a mandatory reason; severity and reason are
editable; "pick in model" takes the other end from the next click. They appear in findings with the source `user`.

## 3D integration (existing rendering only)

`RemovalOverlay` runs only while the drawer is open with "Show in 3D" on and a plan active:

- **Simulated as removed:** instanced components get the LINEAR part of their instance matrix zeroed (elements 0–11; the
  original is saved and restored byte for byte) while the translation (elements 12–14) belongs to the A4 exploded view and is
  never read, written or restored by B3, so a hidden instance stays hidden while exploded and stays where the explosion puts it
  (a unit test shows such an instance is no longer picked); plain meshes are set invisible and their previous flag restored.
- **Tints:** translucent children of the source mesh that share its geometry (instanced: one InstancedMesh per source batch and
  colour, mirroring the source instances' canonical matrices and following them when the view is exploded), drawn without depth testing so members enclosed by the facade stay visible; they copy the section clip plane. Colours
  (Okabe–Ito): planned blue, blocked vermillion, prerequisite green, dependent purple, advisory yellow; the selected component keeps
  the existing orange selection outline (suppressed while it is hidden).
- **Context:** structure is enclosed by the facade, so the drawer offers "Show plan layers only" / "All layers", which only sets the
  existing layer toggles. Layers, floor isolation, X-ray, section views and the camera behave as before (tints are children of the
  meshes and follow their visibility).
- **B2 precedence:** B2's colour overlay is suspended (originals restored) while the removal overlay is applied and resumes when the
  drawer closes or "Show in 3D" is switched off. Both are verified in the browser, including that B2 assessments are untouched.
- Closing the drawer, resetting, deleting the plan or switching "Show in 3D" off restores the exact original view.

The relationship graph is built once (idle prewarm) and plan analyses are memoised by plan identity; camera movement and hover do not
recompute anything. Analysis of a plan covering every top-level record takes about 0.1 s.

## Persistence

`localStorage` key `rematter.removal.plans.v1` (versioned JSON; plans only, no cursor). Invalid, outdated or malformed data yields no
plans and never throws; invalid plans are dropped; references to components that no longer exist are kept and flagged in the
plan; blocked storage degrades to a session-only state. Duplicating a plan deep-copies entries, notes and user dependencies and
restarts at step 0. Per browser; no export/import.

## Limitations

- The dependency model is only as good as the relationships the generators recorded. A1 `bears on` is conceptual (see
  `COMPONENT_DATA_MODEL.md`); load paths, temporary works, propping and stability are not modelled.
- MEP relationships are advisory: isolation, draining down, live-service status and routing clearance are not modelled, and
  the isolation note cannot be "confirmed" in the tool by design (it would claim a real-world state).
- Group-level edges apply only when the group is planned as a whole; partial planning of an assembly is not analysed against the
  assembly's own relationships.
- Activities (non-component prerequisites such as "isolate circuit X") are not nodes; use a user-defined dependency between
  components or a step note.
- No time, cost, crane, access-path or collision model; the plan sequence is an ordering only.
- Plans are per browser. Removed components are hidden, not animated or ghosted. Plans with thousands of steps list the first 200
  (more on request).
- A selected component's relatives are highlighted while a plan is active, even if the component is not in the plan (useful while
  planning); they disappear when the drawer is closed.
