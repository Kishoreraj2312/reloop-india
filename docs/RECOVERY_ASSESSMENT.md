# ReLoop India — Recovery & Reuse Assessment (B2)

B2 lets a user pick a real component in the 3D model, read its B1 quantity, record a planning assessment, adjust
transparent assumptions and see the estimated recoverable quantity roll up into a recovery inventory. It extends the
existing app: one registry, one viewer, one B1 inventory. It adds no ML, no safety certification, no carbon or cost
figures, and invents no recovery rates.

```
src/engine/recovery/     pure engine: types, suggestions, assess (patch + calculation), summary, persist, starter (default sample)
src/scene/recovery/      recoveryStore (external store + localStorage), RecoveryDrawer, AssessmentEditor,
                         RecoveryTable, RecoveryInfo (inspector), RecoveryColoring (3D overlay), colors, StarterNotice
```

## Data model

A `RecoveryAssessment` belongs to one **leaf** component id and is stored apart from the records and the B1 quantities
(the store is sparse: only edited components have an entry).

| Field | Meaning |
|---|---|
| `classification` | `null` (not assessed), `direct_reuse`, `refurbish_reuse`, `recycling`, `further_assessment`, `insufficient_information` |
| `recoveryPct` | 0–100, the estimated share of the available quantity expected to be recovered, **net of expected loss or damage** |
| `preparation` | none / cleaning / refurbishment / reprocessing |
| `destination` | reuse in the same building · reuse in another project · refurbish and reuse · material recycling · further inspection |
| `lossNote`, `note` | free text. The loss note is informational and is never applied to a quantity |

Classifications are planning categories, not judgements of condition, safety, compliance or suitability; the UI says so
next to the editor, and structural members always get the suggestion "requires further assessment".

## Calculation

```
Estimated recoverable quantity = Available quantity × Recovery percentage
```

- **Available quantity** is the B1 primary quantity in its own unit (m³, m², m, nr), or, with "Quantify by: estimated mass",
  the B1 mass in kg. B1 stays the source of truth: nothing is recomputed.
- **Loss is not a second factor.** The data model has one percentage, defined as net of loss; a separate loss factor would
  double-count, so the loss field is a note only.
- A recoverable number exists only when the component is classified direct reuse / refurbish / recycling **and** has a valid
  percentage and a B1 value. Otherwise it is "Not available" with the reason ("not assessed", "recovery % not set", "no B1
  quantity", "no estimated mass"), never 0. Choosing "further assessment" or "insufficient information" clears the %.
- Validation: the percentage must be a finite number with 0 ≤ p ≤ 100; invalid input is rejected with a message and changes
  nothing. A destination that contradicts the classification (e.g. recycling → reuse in another project) is flagged, not blocked.
- Hand-checked cases (tests and browser): column 0.729 m³ × 60 % = 0.4374 m³; floor tile 0.2259645 m² × 50 % = 0.11298225 m²;
  drain stack 0.375 m × 25 % = 0.09375 m; WC pan 1 nr × 100 % = 1 nr; column mass 1,749.6 kg × 60 % = 1,049.76 kg.

## Recovery inventory

`summarize()` groups the B1 leaf rows by **material category** (the material library's substance), **component category**
(the B1 category), **floor**, **recovery pathway** (destination) or **assessment status**. Each output row is one group in
**one unit**: m³, m², m, nr and kg are never added. Columns:

| Column | Definition |
|---|---|
| Parts | leaf components of the group with this unit |
| Available | Σ B1 quantity (components without a value are excluded and counted in the row's tooltip) |
| Est. recoverable | Σ available × % over components that have a recoverable estimate; "–" when none has |
| % | est. recoverable ÷ available of the **whole** group |
| To assess | Σ available of components classified further assessment / insufficient information / not yet assessed |

Available − recoverable − to assess is the part of classified components that is not expected to be recovered, plus
components classified for recovery that have no % yet. Only leaves are rows (assemblies never are), so Σ over groups equals
the total for every grouping; the tests assert it. Clicking a group row lists its components.

## 3D integration (existing selection and rendering architecture)

- Selecting in the model or the list uses the app's `handleSelect`; the inspector gets a "recovery" line with the status, the
  calculation and a link into the drawer. Selecting an assembly shows "n of N parts assessed" and edits apply to its parts.
- "Colour the 3D model by assessment" recolours the **existing** meshes imperatively: structure meshes swap to a cached
  per-status clone of their material; instanced batches swap to a white clone and write `instanceColor`. Clones keep the
  original clipping planes, side and transparency; switching off restores the originals and disposes the clones. No geometry
  is duplicated and there is no second viewer.
- Palette (Okabe–Ito, colour-blind safe): direct reuse green, refurbish orange, recycling blue, further assessment purple,
  insufficient information dark grey, not assessed light grey; components outside the active list filter are pale grey.
- While list filters are active, only the filtered components are coloured. Layers, floor isolation, X-ray and section views are
  untouched and still work (checked with isolate L2 while the overlay is on). Opening the drawer does not change the renderer's
  draw calls.

## Planning controls and persistence

Per component: classification, %, preparation, destination, loss note, note. In bulk: the same fields for an assembly's parts or
for the filtered list ("only the fields you choose are changed"; each component once; re-applying changes nothing), plus
"remove assessments of the filtered components" and a confirmed "reset all". Before B2 the app had no persistence, so the
sparse assessment map is saved in `localStorage` (`rematter.recovery.assessments.v1`, versioned JSON; invalid entries are
dropped on load, and blocked storage degrades to a session-only state). It is per browser. The colour mode and the quantity /
mass basis are view settings and are not saved.

## Starter sample (the default)

A browser that has never saved assessments starts with an **illustrative starter sample**, so "Colour the 3D model by assessment"
shows several colours straight away instead of one pale grey. It is not an assessment of this building: it is one rule per B1
material category (plus a few finer material rules), with planning figures chosen to show the workflow. `starter.ts` holds the rules
and applies them through the same `applyPatch` validation as typed-in data.

| What | Sample classification (recovery %) |
|---|---|
| Structure (RC frame) · cement screed · plaster · glazing · glass fixtures · roof finish | recycling (90 · 80 · 60 · 85 · 80 · 40) |
| Masonry: exterior and core walls | recycling (75) |
| Masonry: interior partitions | refurbish, reuse (50): bricks cleaned and reclaimed |
| Concrete: bands, fins, lintels | recycling (85) |
| Concrete: balcony and canopy slabs | further assessment: inspect corrosion and cracking first |
| Stone sills and treads · boards · metal window frames and railings · kitchen units | refurbish, reuse (70 · 100 · 90 · 80) |
| Timber doors and frames | direct reuse (100) |
| Sanitary ware · appliances | further assessment |
| Floor and wall tiles, ceilings, conduit, cables, pipes, hardware, single balusters | not assessed (high count, low mass; left out as in the demo, so a full save of the assessments stays inside the browser's storage) |

12,050 components, about 97 % of the modelled mass. Rules that are visible in the model: the facade is the "recycling" blue with
pink balcony slabs, amber window frames, sills and railings; with the exterior walls hidden the interior shows amber partitions.

**Honesty rules**

- Every sample entry carries the note "Starter sample (illustrative)". The Recovery drawer says so in a banner, and the scenario
  and carbon drawers (which are built on these assessments) say it in one line, with a link back to Recovery.
- An entry the user changes loses that note, so the note always means "untouched".
- The sample lives in memory. It is put in when the browser is idle (the model is already on screen), and a pristine sample
  **writes nothing**. The first edit saves only the changes over the sample (`{"base":"starter", entries, removed}`: a few hundred
  bytes, not 2.4 MB), so it cannot crowd out the demo's backup or the other modules' data.
- "Reset all assessments" (or clearing every entry) records the choice (`rematter.recovery.starter.v1` = `declined`): the sample
  never comes back by itself. "Fill unassessed components with the starter sample" adds it back to components that have no entry and
  never touches one that has.
- Saves from before the sample (plain `version: 1` entries) are read exactly as before, with no sample added.
- The demo project's B2 rules are the sample's (`starterGroups(inv, DEMO_TAG)`), so the auto-loaded demo and the starter colour the
  model alike; the demo backs up and restores the starter flag with the rest, and Exit demo gives the sample back.
- Browser checks that need an empty start launch with the flag already set (`launch()` in `cdp.mjs`); only `verifyStarter.mjs`
  launches with `{ starter: true }`.

## Generic suggestions

`suggestions.ts` maps each B1 category to a starting classification, method and pathway (for example concrete: recycling as
aggregate; stone: refurbish and reuse; doors and frames: direct reuse; tiles: recycling). They are rules of thumb about the kind
of material, carry no rate, are labelled "not an assessment of this component", and apply only when the user presses "Use
suggested classification".

## Verification

`recovery.test.ts` (24 tests): percentage validation, the hand-calculated cases above, missing data, immutable edits, assembly
expansion (parts once), persistence round trip and corrupt input, grouping identities (Σ groups = total per unit for every
grouping), mass basis, and a no-double-counting run over all wall-assembly parts of the real model.
`scripts/browser/verifyB2.mjs` (`npm run verify:browser:b2`) drives the real app: it opens the drawer with a real click, checks the
hand calculation in the UI, invalid and missing input, the recovery inventory updating, colouring and restore, status / floor /
material filters, row → inspector selection, floor isolation with the overlay on, assembly and bulk edits, persistence across a
reload, the mass basis, reset, unchanged draw calls and a clean console.
`starter.test.ts` (10 tests): every rule valid and labelled, more than 90 % of the mass, several classifications, the finer material
rules splitting what a category would colour alike, the delta save round trip (a pristine sample saves nothing; edits, removals and additions come back;
damaged saves are rejected) and `fillWithStarter` never touching an entered entry. `scripts/browser/verifyStarter.mjs`
(`npm run verify:browser:starter`, 28 checks) starts from a fresh profile: the sample appears by itself, colours the model with
four classifications, writes nothing until the first edit, saves only the change, survives a reload, is not brought back by a
reset, is filled back on request, is replaced by the demo and returned by Exit demo, and the scenario and carbon drawers say it
is in use.

## Limitations and assumptions to validate

- The tool supplies no recovery rates: every percentage is the user's. The generic suggestions are not validated against
  industry guidance and are not condition-based.
- Recovery % is a single net figure; loss is documented in a note only.
- B1's own limits carry over: mass exists only where a density does (46,057 components have none), MEP wall and conductor sizes
  are not modelled, reinforcement is not included.
- Assessments are per browser (localStorage); there is no export/import yet.
- The starter sample is generic: it does not know this building's condition, mortar, damp or damage. Replace it with real
  assessments before relying on any figure that is built on it.
- The overlay recolours at assessment or filter changes (about 85k instances); it is not animated.
- No cost, carbon or landfill figures: there are no reliable inputs in the model.
