# ReLoop India — Intelligent Material Reuse & Matching (C2)

C2 connects the recoverable components of the G+4 digital twin to the needs of a new project. The user states a **reuse requirement**
(a material, a quantity and its unit, sizes, condition, what processing is acceptable); the engine compares every component of that
material with it, **criterion by criterion**, and ranks the candidates as *strong*, *conditional* or *incompatible*; the user compares
candidates, **allocates quantities** without double counting, and finds the source components in the 3D building.

A match is **preliminary**. It compares what the model records with what a requirement states. It makes **no claim** about structural
suitability, code compliance, certification or fitness for purpose, and nothing in it is produced by a model or an unexplained formula.

```
src/engine/reuse/   pure: types, source (supply, sizes), requirement (validated drafts), match (criteria, tiers, score, ranking, explain),
                    ledger (allocate, review, demand), suggest (greedy proposal), persist, export, reuse.test.ts (80 tests)
src/scene/reuse/    reuseStore (localStorage, drawer exclusivity), hooks, ReuseDrawer (shell, fold), Rail, Catalogue, Source (source facts,
                    opportunities), RequirementForm, Matches, Comparison, AllocationView, HighlightSync, ReuseInfo (inspector), reuse.css
scripts/browser/verifyC2.mjs   142 checks against the running app and the real building
```

## What is read, what is stored
| Reads (never written by C2) | From |
|---|---|
| component id, material, recorded dimensions, floor / apartment / room, system | the model records (A1–A3) |
| primary quantity and unit, category, estimated mass | B1 inventory (the one shared, memoised inventory; no second inventory) |
| classification, recovery %, preparation | B2 assessments |
| observed condition, inspection | C1 passport entries |
| removal step / state, scenario outcomes, baseline carbon (context only) | the C1 passport composed from B3 / B4 / B5 |

Stored (localStorage `rematter.reuse.v1`, versioned, sparse): **requirements, confirmed allocations, the ranking configuration** and the
active requirement. Matches, scores, free quantities, suggestions and reviews are never stored: they are recomputed from B1 + B2 + C1 +
these inputs (the ranking is memoised per input object, so editing an assessment re-ranks 18,000 components in about 50 ms).
Two things C2 writes elsewhere, both explicit user actions through those modules' own APIs: the B2 assessment editor embedded in the
detail view, and the observed-condition select (C1). B1 quantities, B2 assessments and C1 passports are otherwise untouched; the browser
check hashes them before and after a full run.

## The requirement
Name, intended application (free text), **material category** (B2's: the material's substance), optional **component form** (B1
category), optional **component type** (as recorded: basin, floor_tile, door_leaf …), optional **specific material variant**,
**quantity and unit** (m², m³, m, nr — the B1 primary measures), **size ranges** in millimetres, tolerance, **minimum observed
condition** (not specified / fair / good), what is **acceptable before use** (cleaning, refurbishment, cutting to size, testing),
whether to consider **structural elements** and **components not yet assessed for reuse**, and **other specifications** (grade, fire
rating, certification …) which the model has no data for, so they are listed but can never be verified here. The form offers only
categories, forms, types, variants and units that exist in the model.

Sizes are compared **by magnitude**: a component's recorded extents are sorted; the largest is the *length*, the middle the *width*,
the smallest the *thickness* (a door leaf 2,034 × 634 × 35 mm; a tile 597 × 379 × 10 mm), so orientation does not matter. A component
that records fewer than three extents has only a length; a requested width or thickness is then **unknown**, not a match. `diameter` is
its own recorded field.

## What a component can supply
`supply` is in the component's own B1 primary unit:
- **recoverable**: a reuse-classified component (direct reuse or refurbish) with a recovery %: B1 quantity × % (the B2 estimate, net of loss).
- **upper bound**: anything else. The modelled quantity is the *most* that could exist; no recovery estimate backs it. It is labelled
  "upper bound" everywhere, and such a component can never be a strong match.
- **none**: no B1 quantity.
A whole item (nr) is allocated whole, so a single item recovered at 90 % supplies **nothing** (the candidate says so).

## Matching
Only components of the requested material category are evaluated (the rest are counted, not judged). Each is compared on seven
criteria; every row of the comparison shows *required* against *actual* and the points earned.

| Criterion | Met when | Partial (a condition) | Unknown | Unmet (blocks the match) |
|---|---|---|---|---|
| Material | category, form, type (and variant) agree | a different variant of the same category | | category / form / type differ |
| Dimensions | every requested range holds (± tolerance) | an oversize length / width, if cutting is accepted | a requested size is not recorded | too small; too large and not cuttable (thickness never is) |
| Quantity | unit equals the component's unit and it can supply > 0 (points = share of the requirement it covers) | | | different unit (never converted); nothing to allocate |
| Condition | observed condition (C1) meets the minimum | | required but not recorded | below the minimum; **damaged is never matched** |
| Recovery | B2 reuse classification with a recovery % | needs further assessment (testing) | not assessed, insufficient information, or no % | assessed for recycling; structural element not asked for |
| Processing | nothing needed | cleaning / refurbishment accepted | | needed but not accepted; reprocessing |
| Other specs | (none stated) | | any stated spec | |

**Tier** (rules, never a threshold on the score): any unmet criterion → **incompatible** (the reasons are listed); every criterion
the requirement uses is met → **strong**; otherwise **conditional** (it says what must happen or what is missing). Structural elements
are conditional at best: structural reuse needs a qualified assessment this tool cannot make.
**Score** (ranking only): 100 × Σ weight × points ÷ Σ weight over the criteria the requirement uses (met 1, partial 0.5, unknown 0,
unmet 0; quantity = the covered share). The weights (default 25 / 25 / 10 / 10 / 15 / 5 / 10) and the partial / unknown credits are
shown and editable in the workspace and saved. **Missing data earns nothing** by default and always keeps a match conditional. Ties
break on the larger supply, then on the id, so the order is deterministic. The comparison states the formula with the actual numbers.

## Allocation
An allocation plans a quantity of **one** component for **one** requirement (a suggested match is a candidate; only a confirmed
allocation is stored). Every write is validated:
- a component's allocations over **all** requirements never exceed what it can supply (competing requirements cannot double count;
  the error names what is free and what other requirements hold);
- a requirement is never allocated more than it asks for; revising an allocation excludes its own quantity;
- the allocation unit is the requirement's **and** the component's own unit; units are never converted or added (totals are one line
  per unit); a count is allocated in whole items;
- an incompatible component cannot be allocated; a conditional one can, and the conditions stay open (shown per allocation and as
  "N m² conditional" on the requirement).
Statuses: **unmet** (nothing allocated), **partially matched**, **matched**. The record keeps the match as it was when confirmed (tier,
score, supply and its basis, B2 classification, conditions, missing information).

**Review.** Allocations are checked against the current data on every render and flagged, never changed: component no longer in the
model, unit mismatch, more allocated than the component can now supply (with "trim to"), now incompatible, strong now conditional.
Saved allocations for components that are not in the model are kept and flagged.

**Suggested allocation.** A derived, never-stored proposal: the ranking filled until the requirement is covered (strong first, larger
supply first so fewer pieces are needed, what other requirements hold respected; conditional only if asked), shown as a hatched
segment with "not confirmed"; Confirm applies it through the same validated path.

## 3D integration
The marks reuse B4/B5's tint highlight (translucent tints on the **existing** meshes and instanced batches; no second viewer, no
geometry, nothing written to a record, material or visibility): strong candidates green, conditional amber, confirmed allocations blue
(Okabe–Ito hues B2/B4 already use), "Candidates / Allocated / Off". The selected component is marked by the normal selection outline;
clicking a component in the building updates the comparison, and selecting a candidate selects the real component. **Locate in 3D**
selects it, folds the workspace into a small card and frames the camera on it (a user request; the camera never moves by itself);
**Show workspace** returns to the same requirement, tab, filters and selected candidate (the folded workspace stays mounted).
The highlight exists only while the workspace is open; priority B3 simulation > highlight > B2 colouring. Opening any other drawer
closes the workspace (the store watches the others, so no existing opener changed) and presentation mode closes it and restores it.

## Workspace
One 900 px drawer (clamped to the viewport): a **requirement rail** (progress, demand by unit, ranking weights) and three tabs —
**Catalogue** (every leaf component, searchable and filterable, reuse-ready first; source facts with where each comes from; reuse
opportunities of the selected component against every requirement; "New requirement like this"), **Matches** (requirement summary,
tier counts, ranked list with the compatibility strip M D Q C R P S, suggested allocation, comparison, allocate / revise / remove) and
**Allocation** (matched / partially matched / unmet, per-requirement allocations, totals by unit, review, B5 context, export). The
inspector gains a "reuse" line. ↑ / ↓ / Home / End move the selection in the lists.

## Export and the hand-off to C3
`rematter.reuse-plan/1` JSON (requirements with required / allocated / remaining / status, every allocation with the match at
confirmation, review flags and `outcome: { status: "planned", recoveredQuantity: null, reusedQuantity: null }`) and CSV. C3 Recovery
Tracking (now built, see RECOVERY_TRACKING.md) records what was actually recovered and reused against the stable allocation id and shows "C3: reused x of y" on the allocation
rows; the exported `outcome` stays "planned" with null quantities, because the export is of the plan. Nothing here asserts that any material was recovered or reused.

## Verification
`npm test`: 80 reuse tests (supply and whole items; requirement validation; every blocker, condition and unknown; tolerance; units never
converted; condition and specs; hand-computed scores and configuration; ranking order; competing allocations, partial matches, revise,
remove, batch, reconciliation; review flags; suggestions; persistence incl. corrupt / orphaned data; export; the real model:
evaluated + excluded = all components, ranking 18,000 in ~50 ms). `npm run verify:browser:c2`: 142 checks (see the script header),
including the tiers equal to an independent hand computation from the records, supply = record quantity × 90 %, a real click on a row
selecting the real component, tints on the existing meshes in the right colours, double-allocation refusal in the UI, the closed
workspace leaving the building bit-identical, and A1–A5, B1–B5 and C1 browser checks unchanged.

## Limitations
- Only recorded data is compared; the generated model has no grades, certifications or inspected condition. A requirement's other
  specifications can be listed but never verified, so they keep every candidate conditional.
- Units are strict (B1's primary measures; no mass requirements). Door leaves are measured in m², so a count of doors cannot match them.
- Sizes use the model's design dimensions; components with fewer than three recorded extents have no width / thickness.
- Allocation is per component (piece); using part of a piece implies cutting or splitting, which is flagged but not modelled.
  The suggested allocation is greedy and per requirement, not a global optimisation.
- Condition comes only from C1 observations; the model's own "good" is a generated default and is never used.
- Structural reuse is never "strong". B5 shows the baseline carbon of the source components only; no carbon saving is calculated.
- Requirements, allocations and weights live in this browser only; no multi-user work, no C3 tracking yet.
