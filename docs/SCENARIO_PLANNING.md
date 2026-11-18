# ReLoop India — Demolition vs Deconstruction Scenario Planning (B4)

B4 lets a user build two or three end-of-life scenarios for the same building, see where the B1 material quantities end up under each
(direct reuse, reuse after refurbishment, recycling, disposal, unknown), read what differs, edit the assumptions behind every result
and mark the real components of any outcome in the existing 3D model. It extends the application: one registry, one viewer, the B1
inventory, the B2 assessments, the B3 plans. It adds no carbon, cost or landfill-impact figure (those are B5), supplies no recovery
rate, and is a planning comparison, not a certified waste or recovery plan.

```
src/engine/scenarios/   pure engine: types, allocate (the quantity calculation), rules (resolution), templates, edit (immutable
                        operations), compute (per-leaf evaluation + aggregation), compare (differences), match (highlight ids),
                        context (B3 coverage), persist, scenarios.test.ts (45 tests)
src/scene/scenarios/    scenarioStore (external store + localStorage), ScenarioDrawer (workspace), ScenarioList, CompareSection,
                        Charts, ScenarioEditor, RuleControls, SelectedComponent, ScenarioHighlight (3D), ScenarioInfo (inspector),
                        colors, layout, summaryData
```

## Inputs and what each one means

| Source | Used as | Never |
|---|---|---|
| **B1** quantities (`getModelInventory`) | The only source of quantities: a leaf's primary quantity in its own unit (m³, m², m, nr), or its estimated mass (kg). | Recomputed, edited or copied into a scenario. |
| **B2** assessments | Starting assumptions: a component's classification and net recovery % when a rule says "use the B2 assessment". Destination, preparation and notes are not used; the loss note is never applied (the % is already net of loss). | Changed. |
| **B3** removal plans | Planning context only: how many components a scenario expects to recover material from are covered by the active plan's entries. A plan lists an intended order; it does not show that anything has been removed or can be. | Read as proof of removal; changed. |

**Material category** is B2's: the material's substance (`concrete`, `brick_masonry`, `porcelain_tile` …). Results are aggregated by
material category **and unit**; m³, m², m, nr and kg are never added together.

## Data model

A `Scenario` stores assumptions only (never quantities, assessments or results):

| Field | Meaning |
|---|---|
| `template` | `conventional`, `selective` or `reuse_first` |
| `residual` | Where the unrecovered share of a recovery pathway goes: `disposal` or `unknown` |
| `baseline` | Treatment of components the template does not otherwise cover (a pathway, never "assessment") |
| `scope` | Selective only: the material categories whose B2 assessments are applied |
| `categoryRules` | material category → `Rule` |
| `componentRules` | component or assembly id → `Rule` |

A `Rule` is `{ kind, recoveryPct, residual }`. `kind` is a pathway (`direct_reuse`, `refurbish_reuse`, `recycling`, `disposal`,
`unknown`) or `assessment` (take classification and % from the component's B2 assessment). `recoveryPct` (0–100, net of loss) exists
only for the three recovery pathways and may be **null = not configured**; `residual` null = the scenario default.

## Rule resolution (per leaf component)

```
component override  ->  material-category override  ->  template rule  ->  unknown
```

- A component override is looked up on the leaf's own id, then on its nearest **assembly** ancestor (an assembly rule applies to its
  parts unless a part has its own). Only real assemblies count: an A1 `parentId` ("member beneath") is not containment.
- Template rule: conventional → the baseline; selective → B2 assessment if the category is in `scope`, else the baseline;
  reuse-first → B2 assessment.
- A rule of kind `assessment` is read against the component: not assessed → unknown ("not assessed"); further assessment →
  unknown; insufficient information → unknown; direct reuse / refurbish / recycling → that pathway with the assessment's %
  (no % → unconfigured).

## The calculation (`allocate`)

```
Estimated recovered quantity = Allocated quantity × Recovery percentage / 100
Unrecovered residual         = Allocated quantity − Estimated recovered quantity      → disposal or unknown
```

- Disposal and unknown allocate the whole quantity. A recovery pathway **without a usable %** recovers nothing it can state: its
  recovered quantity is *unavailable* (shown "n/a", never 0) and the whole allocation is carried as **unknown**, visible and counted.
- 0 % recovers nothing (everything is residual); 100 % recovers everything (no float residue). A % outside 0–100, NaN or text is
  rejected at every entry point (editing returns the *same* scenario plus an error; the stored rule is untouched), and a stored
  invalid % is read as "not set", never repaired to a guess.
- No second loss factor is applied. A quantity is allocated once, so for each material category and unit
  `direct reuse + refurbished reuse + recycling + disposal + unknown = available`; the engine reports `reconciled` per row (relative
  tolerance 1e-9: float noise is tolerated, a real discrepancy is shown, not hidden).
- Components with no B1 value on the chosen basis (for example no density) are counted as *unquantified* and are not part of
  "available"; they are never given a value.

## Templates (editable starting points)

The repository holds no documented material-category recovery rates, so **no template supplies one**.

| Template | Defaults | Result with no B2 assessments |
|---|---|---|
| **Conventional demolition** | baseline disposal for every component; residual → disposal | everything disposed (0 % diverted) |
| **Selective deconstruction** | B2 assessments for the *selected categories* (default: the categories with at least one B2 assessment when the scenario is created or reset; editable); outside the selection the baseline (disposal) applies; residual → disposal | same as conventional (empty selection) |
| **Reuse-first** | B2 assessments for the whole building, **no demolition fallback**: unassessed or unclear components stay unknown; residual → unknown | everything unknown (0 % diverted) |

Reuse-first and selective use the same B2 percentages, so they recover the same quantities where both apply; they differ in what they
*assume* for the rest (disposal vs unknown). Every default is visible in the editor and can be changed; a category rule
(for example concrete → recycling at your own %) turns the conventional baseline into whatever the user can justify.

## Metrics

`Diversion % = (direct reuse + refurbished reuse + recycling) ÷ available × 100`, with the **unknown share** (and disposal share)
beside it, per material category and unit and as a total per unit. **Whole-building indicators** use the estimated-mass basis (kg) and
are shown only when B1's mass covers at least 90 % of the modelled solid volume (92.5 % on the current model); the card always states
the coverage (38,308 of 84,365 components, 45 %, because pipes, cables, fixtures and similar have no density), otherwise the card says
why it is not shown and the category tables remain.

## Management and persistence

Create from a template (or all three at once), rename (non-empty), duplicate (deep copy: nothing shared), reset to the template's
defaults (assumptions and overrides; id, name and template kept), delete, choose which two or three to compare and which one to edit.
Scenarios are saved in `localStorage` (`rematter.scenarios.v1`, versioned JSON, assumptions only; invalid items are dropped and
counted, an invalid % becomes "not set", overrides that match nothing are kept and reported as missing assumptions, blocked storage
degrades to a session). The comparison selection, basis, unit tab, workspace and highlight are view state and are not saved.

## The workspace

A wide drawer (900 px, one drawer at a time) with: the scenario list; a highlight bar; whole-building cards; material flow per unit
(one stacked bar per scenario, hatch for unknown, labelled legend); a totals table (allocated and outcome for every pathway,
residual, "no recovery % set", a reconcile check, components with a value); a material-category table with per-scenario bars,
diverted % (with the difference from the first scenario) and unknown %, and a detail table for a chosen category; **What differs**;
**Missing assumptions** per scenario; the B3 plan context; the selected component's outcomes and its override; and the editor
(residual, baseline, selection, category rules, component overrides). **What differs** compares each scenario with the first and
contains only statements read from the stored assumptions (template, residual, baseline, selected categories, category rules,
override counts) and from the calculated results (changes in diverted / disposal / unknown per unit and the categories that moved
most, each with both scenarios' treatment of that category); it states no cause. "View model" folds the workspace into a small card
so the whole building is visible while the highlight stays on.

## 3D integration

- Clicking an outcome (bar segment or table cell), a category row or a missing assumption marks the **real leaf component ids**
  (`matchLeaves`) in the existing viewer. A category row highlights that material category in the shown unit, coloured by each
  component's dominant outcome; an outcome selects every component with a non-zero quantity in it (a component split 60 % / 40 % is
  in both). Assemblies are never marked (their parts are).
- Technique: B3's, on the existing meshes: a translucent tint child of the source mesh (instanced: one InstancedMesh per source batch
  and outcome, following the A4 explosion), drawn without depth testing, sharing the geometry; no material, colour or visibility of any
  component is changed, so floor isolation, layers, X-ray, sections and exploded views keep working and removing the tints restores
  the model exactly (hash-checked).
- Priority: **B3 simulation > B4 highlight > B2 colouring**. The highlight exists only while the workspace is open and the B3
  simulation is not shown; B2 colouring is suspended while a highlight is drawn and resumes afterwards; opening the Recovery or
  Removal drawer (also from the inspector) closes the workspace; presentation mode closes it and exit restores it.
- Selecting a component (3D or list) uses the app's selection: the existing inspector (with its B1 quantity and B2 line) opens, a
  "scenarios" line shows its outcome in each compared scenario, and the workspace card offers its override.
- Colours: the Okabe–Ito hues B2 uses for direct reuse (green), refurbishment (orange) and recycling (blue), vermillion for disposal
  and a grey hatch for unknown. The four hues pass the data-viz palette check (colour-blind separation, lightness band); the orange is
  below 3:1 on the panel, so every chart carries visible labels and a numeric table.

## Verification

- `src/engine/scenarios/scenarios.test.ts` — 45 tests: the six required cases (10 m³ at 80 % → 8 + 2; 4 m² direct reuse without % →
  unavailable + 4 m² unknown; 5 items disposal; 3 m undecided → unknown; 0 % and 100 %; invalid % rejected without changing the
  previous state), identities (every outcome sums to the quantity; every category × unit reconciles in both bases for all three
  templates; Σ rows = totals; totals equal an independent B1 sum per unit, so assemblies are not double counted), resolution order,
  assembly and A1-parent semantics, templates on the real model (no invented results; hand check column 0.729 m³ × 60 % = 0.4374 m³),
  duplicate independence, persistence and reset, B1 / B2 / B3 untouched (deep-frozen scenario and plan, checksums), highlight ids
  equal the matching components, "what differs" derived from the data.
- `npm run verify:browser:b4` — 111 checks against the real building in headless Chrome (see the roadmap).

## Limitations

- Conceptual planning: no cost, time, carbon, landfill or transport figure; no market, quality or standards check; no certified
  waste classification. Reuse feasibility is the user's B2 judgement.
- Every recovery % is the user's; the templates supply none. Conventional demolition is a disposal baseline until the user adds
  category rules, so on its own it understates what real demolition recycles.
- Whole-building indicators cover only components with an estimated mass (45 % of components, 92.5 % of the solid volume):
  reinforcement, pipes, cables, fixtures and finishes without a density are outside them.
- A scenario applies one pathway per component (plus its residual); there is no split between pathways inside one component, no
  per-floor or per-phase rules and no time dimension.
- Scenarios are per browser (no export/import). Presentation mode's guided steps do not include scenarios (they close the workspace).
- The highlight is drawn as flat translucent tints (large sets look dense); it does not dim the rest of the model.
