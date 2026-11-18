# ReLoop India — Execution Roadmap

## Phase Sequence

### Part A — Digital Twin
| Phase | Goal | Status |
|-------|------|--------|
| A0 | Project foundation, config, types, registry, stub viewer | ✅ Done |
| A1 | Parametric structural building (foundations through roof) | ✅ Done |
| A2 | Architecture & interiors (walls, doors, windows, rooms) | ✅ Done |
| A3 | Plumbing & electrical systems | ✅ Done (conceptual; see MEP_LAYOUT.md) |
| A4 | Interactions & cinematic exploded assembly | ✅ Done (exploded view, display transform only; see A4 Results) |
| A5 | Visual refinement & performance optimization | ✅ Done (materials, light, presentation mode; see A5 Results) |
| A* | Architectural realism & cinematic rendering | ✅ Done (AO, site, glass / facade / MEP look, hero framing; see PRESENTATION_AND_VISUALS.md, A* sections) |

### Part B — Engineering & Circularity
| Phase | Goal |
|-------|------|
| B1 | Quantity engine & material inventory from geometry — ✅ Done (see B1 Results) |
| B2 | Material passports & recovery assessment — ✅ Done (recovery assessment; see B2 Results) |
| B3 | Removal simulation with dependency logic — ✅ Done (conceptual planning aid; see B3 Results) |
| B4 | Demolition vs deconstruction scenarios — ✅ Done (planning comparison; see B4 Results) |
| B5 | Embodied carbon & environmental estimates — ✅ Done (decision support; see B5 Results; economic estimates not built) |

### Part C — Integration & Presentation
| Phase | Goal |
|-------|------|
| C1 | Digital material passports — ✅ Done (see C1 Results). The earlier "Main application interface" goal is not started |
| C2 | Intelligent material reuse & matching — ✅ Done (see C2 Results). The earlier "Dashboard with metrics & charts" goal is not started |
| C3 | Material recovery & circularity tracking — ✅ Done (see C3 Results). The earlier "Optional reporting & bounded AI assistance" goal is not started |
| C4 | End-to-end testing & expo readiness |

---

## C3 Results — Material Recovery & Circularity Tracking
Method, stage rules, balance and limits: `RECOVERY_TRACKING.md`. Screenshots: `docs/screenshots/c3/`.

**Delivered.** `src/engine/tracking/` (pure: an append-only history per component; status, quantities, completion and flags derived from it; validated operations with explicit
stage rules; a documented variance as the only way past the available quantity; planned scope from B2 / B3 / C2; a planned-versus-actual report reconciled per unit; batches that
hold no quantities; persistence that drops histories that do not replay; JSON / CSV export) and `src/scene/tracking/` (one workspace: progress overview, filter rail, register with
bulk actions, tracking panel with stage stepper, planned-versus-actual bars, forms and history, report, 3D marks by stage / flags, Locate in 3D with fold / unfold, inspector line).
C1: a "Recovery tracking (C3)" passport section. C2: allocation changes are logged in the record's history and fulfilment is shown on C2's allocation rows. Nothing is recovered,
reused, recycled or disposed unless the user records it with a source; unknown stays distinct from zero; no environmental saving is claimed.

**Verification actually run.** `npm test` 746 (73 new tracking tests, 5 new passport tests). `npm run verify:browser:c3` 139 / 139 against the real building (planned scope vs an
independent set; planned = B1 quantity x 90 %; the full workflow planned -> in progress -> recovered -> inspected -> allocated -> reused / recycled with partial recovery and the
remainder written off; stage guards; quantity, source, whole-item and future-date validation; documented variance; unknown vs recorded zero; on hold; voiding and its logged revert;
C2 changed / cancelled / fulfilled logged; report and overview equal to an independent replay of the stored histories; units never added; batches and assemblies; passport and
inspector; 3D marks, Locate and fold; exports; persistence incl. broken / corrupt / orphaned data and allocations changed while closed; exclusivity and presentation mode; B1 / B2 / C2
untouched; the closed workspace leaves the building bit-identical). The A1 - A5, B1 - B5, C1 (nine passport sections) and C2 browser checks still pass.
**Known limitations.** See `RECOVERY_TRACKING.md`: user-stated stages and recorded quantities only, B1 units only, a fixed 10 % variance tolerance, one record per component, browser-only storage.

---

## C2 Results — Intelligent Material Reuse & Matching
Method, rules, data model and limits: `MATERIAL_REUSE_MATCHING.md`. Screenshots: `docs/screenshots/c2/`.

**Delivered.** `src/engine/reuse/` (pure: validated requirements; supply from B1 x B2 with whole items and "upper bound" labelled; a
deterministic matching engine with seven criteria, rule-based strong / conditional / incompatible tiers and an exposed, configurable
weighted score; an allocation ledger that cannot double count across requirements and never mixes units; review of stale allocations;
a derived suggested allocation; persistence; JSON / CSV export for C3) and `src/scene/reuse/` (one workspace: catalogue, requirement
form, ranked matches with a compatibility strip and a criterion-by-criterion comparison, allocation summary, 3D marks through B4/B5's
tint highlight, Locate in 3D with fold / unfold, inspector line). No emission factor, grade, certification or condition was invented:
missing data stays unknown and keeps a match conditional.

**Verification actually run.** `npm test`: 80 reuse tests (668 in the repository). `npm run verify:browser:c2` 142 / 142 against the real
building (tiers equal to an independent hand computation from the records; supply = record quantity x 90 %; a real click selects the
real component; tints in the right colours on the existing meshes; competing allocations refused in the UI with the reason; partial,
revised and removed allocations; suggested vs confirmed; observed condition turning conditional into strong live; persistence and
corrupt / orphaned data; Locate in 3D, fold and unfold; exclusivity with the other drawers and presentation mode; weights; export;
the closed workspace leaves the building bit-identical; console clean). The A1–A5, B1–B5 and C1 browser checks still pass.
**Known limitations.** See `MATERIAL_REUSE_MATCHING.md`: recorded data only (no grades or certifications to verify), strict B1 units
(door leaves are m2), per-component allocation with greedy suggestions, condition only from C1 observations, no C3 tracking yet.

---

## C1 Results — Digital Material Passports
Method, fields and limits: `MATERIAL_PASSPORTS.md`. Screenshots: `docs/screenshots/c1/`.

**Delivered.** `src/engine/passport/` (pure: a passport composed from the record, B1, B2, B3, B4 and B5 with a status and source on every
field; validated user metadata; JSON and CSV export; persistence) and `src/scene/passport/` (panel above the inspector that opens for the
selected component and folds without losing the model context; editing of inspection status, observed condition, date, inspector, condition
note and provenance note; downloads). Quantities and the B2-B5 results are read-only in the passport.

**Verification actually run.** `npm test`: 19 new passport tests (linking to the stable id with hand-checked 0.729 m3 / 1,749.6 kg, the model's
condition labelled assumed, missing never fabricated across a sample of 9,700 records, B2 / B3 / B4 / B5 data composed read-only, validated
edits and persistence including orphaned and corrupt data, JSON / CSV content and escaping, B1 / B2 untouched). `npm run verify:browser:c1`
58 / 58 against the real building (a real canvas click opens the passport of the hit component; contents; B2 through the real UI;
editing, validation and persistence; JSON and CSV downloads captured and parsed; fold keeps selection and camera; assembly, parent link,
invalid id; floor isolation; presentation mode; corrupt / orphaned saved data; B1 - B5 data and the rendered model unchanged; console clean).
**Known limitations.** See `MATERIAL_PASSPORTS.md`: one passport at a time, no attachments, entries are per browser, not a certified
digital product passport.

---

## B5 Results — Embodied Carbon & Environmental Impact
Method, factor policy and limits: `CARBON_ASSESSMENT.md`. Screenshots: `docs/screenshots/b5/`.

**Delivered.** `src/engine/carbon/` (pure: user-editable, source-attributed factor library that starts empty, quantity x factor in the
factor's unit with B1 mass only, baseline with boundary / coverage / not-assessed reasons, scenario terms avoided - processing -
transport from B4's allocation, validated assumptions, sensitivity, persistence) and `src/scene/carbon/` (Carbon workspace, inspector
line, 3D highlight through B4's tint mechanism). No emission factor was invented: an optional demo set is labelled ILLUSTRATIVE.
Economic estimates were not built (no reliable inputs).

**Verification actually run.** `npm test` carbon engine: 29 tests (quantity x factor, unit compatibility, missing factor / density =
null not 0, invalid input rejected with the previous state kept, hand-calculated scenario terms 1,020.8 kgCO2e, incomplete reuse
assumptions not assessed, density override, sensitivity, persistence, immutability, no double counting through assemblies, real-model
coverage). `npm run verify:browser:b5` 81 / 81 against the real building (empty library = Not assessed; 200 kgCO2e/m3 x the independent sum of the brick quantities;
scenario net 62.4 x Q by hand; Not assessed until each input is given; reuse net -2Q at 0 % replacement and 118Q at 60 %; sensitivity
78.4Q / 46.4Q; highlight ids = the leaf components; persistence and corrupt data; conflicts; B1-B4 data untouched; console clean).
**Known limitations.** See `CARBON_ASSESSMENT.md`: results exist only after the user supplies factors; module coverage is whatever the
factors state; mass-based terms exclude components without a density; one assumption set for all compared scenarios.

---

## B4 Results — Demolition vs Deconstruction Scenario Planning
Method, rules, data model and limits: `SCENARIO_PLANNING.md`. Screenshots: `docs/screenshots/b4/`.

**Delivered.** `src/engine/scenarios/` (pure: allocation `recovered = allocated x % / 100` with residual to disposal or unknown, rule
resolution component -> category -> template -> unknown, three editable templates, immutable validating edits, per-leaf evaluation and
aggregation by material category and unit, comparison and "what differs", highlight matching, B3 coverage, persistence codec) and
`src/scene/scenarios/` (a wide Scenarios workspace opened from the controls panel: scenario management, two- or three-way comparison
with charts and tables, missing assumptions, editor for category rules and component overrides, selected-component card, inspector
line, 3D highlight). B1 stays the only source of quantities; scenarios are a separate assumptions-only store in `localStorage`.

**Decisions.** No recovery rate is supplied (conventional = a disposal baseline until the user adds rules; selective and reuse-first use
B2's percentages); a missing % is "n/a" and carried as unknown, never 0; whole-building indicators only with mass coverage >= 90 % of
solid volume and always with the coverage; B3 is context only; the highlight reuses B3's tint technique with priority B3 > B4 > B2.
Full list: `DECISIONS_AND_ASSUMPTIONS.md` (B4 Decisions).

**Verification actually run**
- `npm run typecheck` clean; `npm test` 540 tests / 26 files pass (new: 45 in `scenarios.test.ts`: the six required cases, reconciliation
  of every category x unit in both bases for all three templates, no double counting through assemblies, resolution order, duplicate
  independence, persistence and reset, B1 / B2 / B3 untouched, highlight ids = matching components); `npm run build` passes (bundle
  1,688 kB, 494 kB gzipped; chunk-size warning only; dev hooks absent from the bundle).
- Engine on the real model: 84,365 leaves evaluated in both bases in about 55 ms; example check 0.729 m3 column x 60 % = 0.4374 m3.
- Browser (`npm run verify:browser:b4`, headless Chrome, 111 checks, all pass, console clean): real click opens the workspace
  (draw calls unchanged); the three templates compare and the UI figures equal the engine's; hand calculations (column 0.437 m3 recycled,
  0.292 m3 residual to disposal; 80 % of a category, 0 % and 100 %); missing % shown as n/a / unknown; invalid % (120, -3, abc) rejected
  with the stored rule unchanged; residual to unknown; component and assembly overrides (available unchanged, no double counting);
  rename / duplicate (independent) / reset / delete; persistence across reloads and corrupt saved data; highlight ids = the matching
  leaf components, tint colours, exact restore (hash of materials, visibility, instance matrices) after clear and close; B2 colouring
  suspended while highlighting and resumed; B3 simulation takes priority; floor isolation, layers, X-ray and an exploded view (t = 1,
  instanced tints sit on their displaced sources) with the highlight on; B1 records, B2 assessments and B3 plan unchanged.
- Regression: A1, A2, A3, B1 scripts exit clean; B2 (38 checks), B3 106 / 106, A4 78 / 78, A5 99 / 99 pass with B4 in place (their
  screenshots were restored afterwards).

**Known limitations.** Conceptual planning only: no cost, time, carbon, landfill or transport figure; no certified waste classification.
Every recovery % is the user's, so conventional demolition understates real recycling until rules are added. Whole-building indicators
cover only components with an estimated mass (45 % of components, 92.5 % of solid volume). One pathway per component plus its residual;
no per-phase or per-floor rules. Scenarios are per browser (no export / import). Presentation mode's guided steps do not include
scenarios. Highlight tints are flat and dense for large sets.

**First task for B5:** `src/engine/sustainability/` reading `computeScenario` results (quantities per category, unit and pathway) and
adding embodied-carbon, cost and landfill-impact factors, each with a stated source; refuse to produce a figure for a category without
a documented factor (show "not available"), keep factors apart from the scenarios, and compare the same scenarios side by side.

---

## A5 Results — Visual Fidelity, Realism & Presentation
Method, decisions, measurements and limits: `PRESENTATION_AND_VISUALS.md`. Screenshots: `docs/screenshots/a5/baseline` (before) and
`docs/screenshots/a5/final` (after).

**Delivered.** Procedural architectural finishes by assumed substance (shader patch on the existing materials, one shared noise
texture, no new dependency), a procedural sky environment with Neutral tone mapping and a south-west sun, a soft ground with a contact
shadow and an exploded-view stage, a south-east hero view as the default, smooth glides for the A4 presets, camera flights, and a
presentation mode (clean canvas, 7 camera presets, a 5-step / 13-scene guided demonstration, compact component card, drawers, exact
restore on Exit). One interface token set for every panel.

**Decisions.** Finishes follow what the model ASSUMES and never touch records; overlays (B2 clones, B3 tints) stay flat and exact;
no post-processing; the guided demonstration has no sustainability step (B5 does not exist) and never invents data (B2 colouring only
when assessments exist). Full list: `DECISIONS_AND_ASSUMPTIONS.md` (A5 Decisions).

**Verification actually run**
- `npm run typecheck` clean; `npm test` 495 tests / 25 files pass (new: presets 31, camera path 6, surface 19, glide / snapshot 8,
  framing 3); `npm run build` passes (bundle 1,620 kB, 475 kB gzipped; chunk-size warning only). Dev hooks absent from the bundle.
- Browser (`npm run verify:browser:a5`, 99 checks, all pass, console clean): see PRESENTATION_AND_VISUALS.md section 10. A1, A2, A3, B1,
  B2 pass; A4 78 / 78; B3 106 / 106 (their screenshots restored afterwards).
- Renderer (Apple M3 Pro, headless Chrome 1600 x 1000): draw calls 1,191 -> 1,192 (+1 decal), triangles unchanged, programs 13 -> 22,
  textures 3 -> 7, GPU frame 3.9 - 6.4 ms with no measurable cost from the finishes, camera flights and cinematic playback at a median
  16.7 ms with p95 16.8 ms. The A4 hand-over profile of the cinematic playback found no hot spot.

**Known limitations.** Finishes are appearance only (no verified specification); no ambient occlusion beyond the sun shadow and a
contact decal; the frozen shadow map is stepped at the edges of the exploded stack's shadow; glass reflects a procedural sky;
untested on touch devices, mobile layouts, other browsers, weaker GPUs or a projector.

**First task for B4 / C1:** the dashboard (C2) and report (C3) should reuse `presentation/presets.ts` plans for their camera shots
instead of their own, and B4 scenario views can be added as guided steps (a step is data: scenes with a plan and a caption built from
the live model).

---

## A4 Results — Exploded View & Assembly Decomposition
Method, grouping rules, offset math, composition and limits: `EXPLODED_VIEW.md`. Screenshots: `docs/screenshots/a4/`.

**Delivered.** `src/engine/explode/` (pure: grouping model with real bounds, assembly rules, allocation-free offset solver, displayed
bounds) and `src/scene/explode/` (store, 3D controller with playback, group and instance drivers, bottom bar, inspector line,
optional trace lines). Modes: Assembled, Floors, Systems, Assembly focus, Cinematic (floors, then systems, then assemblies, from
one progress value), with distances, presets, play / pause / loop, Reset, Fit, Focus, floor and system isolation. It is a display
transform: records, registry, B1 quantities, B2 assessments and B3 plans are never written.

**Decisions.** Floor and system offsets translate the existing `Floor_*` and `<floor>_<system>` groups (everything below follows,
and picking, culling, clipping and shadows use the world matrices); only assembly decomposition writes instance-matrix
translation (elements 12–14), while B3 owns the linear part, so a B3-hidden instance stays hidden. Membership is explicit
containment only (3,015 assembly records, 83,420 members); `dependencies` and `connectedTo` are never membership. 1,406
assemblies (44,275 members) decompose; walls, MEP network containers and single-layer assemblies do not (reason each), and
structure (no assembly records) groups by floor / system / category. 2 × 2 system grid by default (a row would be 178 m wide).
Full list: `DECISIONS_AND_ASSUMPTIONS.md`.

**Verification actually run**
- `npm run typecheck` clean; `npm test` 430 tests / 22 files pass (new: 29 in `explode.test.ts`, 16 in `drivers.test.ts`,
  12 in `explodeStore.test.ts`); `npm run build` passes (bundle 1,583 kB, 462 kB gzipped; was 1,541 / 449; chunk-size warning
  only). `window.__explode`, `__reloop` and `__removal` are absent from the production bundle.
- Engine and driver tests on the real model: grouping matches the scene tree and every drawn component has one floor / system /
  category; every assembly record is supported or listed with a reason; membership is containment, one assembly each, same
  floor; offsets are additive, deterministic, monotonic, exactly zero at 0 and never accumulate; floor groups are disjoint
  vertically at full explosion and system footprints never overlap (every layout); the instance driver restores bit-identical
  matrices and bounding spheres after 80 random parameter changes, composes with B3 hiding, moves followers, and keeps displaced
  instances pickable (three.js raycast) at the displayed position and not at the canonical one; plain meshes in a displaced
  group are picked where displayed.
- Browser (`npm run verify:browser:a4`, headless Chrome, 78 checks): offsets of 80 sampled components (plain and instanced, all
  four systems) against independently computed formulas in every mode and across a 21-step cinematic sweep; real clicks at the
  displayed position of structure, architecture, plumbing and electrical components select them (and clicking where the column
  was does not); floor isolation, layer toggles, X-ray, a section view (world-space clip applied to every building material),
  Fit / Focus framing clear of the UI, the camera untouched by parameter changes; B2 colouring and the B3 overlay on and off
  in both orders (hidden members stay hidden and follow the explosion, tints and outlines follow, B2 data unchanged); a
  60-action random sweep then Reset puts every sampled component, every group and a hash of the whole scene exactly back;
  reload leaves canonical data intact; playback runs to 100 % and stops; console clean.
- A1, A2, A3, B1, B2 and B3 browser scripts re-run with A4 in place, all pass (B3: 106/106, including its exact-restore hash checks
  after its hide/restore moved to the linear part of the matrix). Their screenshots were restored afterwards, so uncommitted image
  changes are untouched.
- Performance (details in `EXPLODED_VIEW.md`): draw calls and triangles identical when inactive and in every exploded view
  (minus the hidden ground plane); render cost never opened 5.84 ms vs opened-then-closed 5.85 ms (alternating fresh loads);
  update cost 0.2–0.4 ms; cinematic playback at a median 16.7 ms per frame (one 58 ms outlier in the last run).

**Known limitations.** No assembly "isolate" (use floor / system isolation, focus and the members list). Structure, walls and
MEP network containers are not decomposed. One global layer gap (spread capped at 1.5 m per assembly). Section planes are
world-space (they cut the displaced geometry; the panel says so). System spacing includes site items outside the footprint.
Trace lines are positional and only for the inspected assembly. Not verified: narrow or mobile layouts, and real-GPU frame
cadence beyond the headless run.

**First task for A5:** profile the cinematic playback on real hardware (about 270 instanced meshes are rewritten and re-uploaded per
frame in the assembly phase, and a shadow frame doubles the 1,556 draw calls) before changing anything.

---

## B3 Results — Removal Simulation with Dependency Logic
Method, relationship census, direction rules, validation and limits: `REMOVAL_SIMULATION.md`. Screenshots: `docs/screenshots/b3/`.

**Delivered.** `src/engine/removal/` (pure: typed relationship graph with one adapter per source, plan analysis with hard errors /
advisory warnings / unknown relationships, cycle detection, derived states, prerequisite closure, suggested order, highlight sets,
persistence codec) and `src/scene/removal/` (Removal drawer opened from the controls panel or the inspector, plan list, ordered
sequence, simulation controls, per-component detail with relationships and findings, user-defined dependencies, 3D overlay, inspector
line). It extends the one registry, viewer, B1 inventory and B2 store; no new dependencies and no new geometry.

**Decisions.** The model's `dependencies` field has no single direction (A1 "bears on" and A2 "hosted in" are the reverse of removal
order; A3 supply is the same, A3 drainage the reverse), and `parentId` is containment for assemblies but "member beneath" in A1, so
each source has its own tested adapter into "prerequisite → dependent". Blocking only where the model records support or hosting
(2,834 edges); MEP edges are advisory (19,825 + 3,496) and vents / cross-family / `connectedTo` joints are unknown and imply no
order (207 + 61,404). States are derived; the user's order is never changed silently; B2's colour overlay is suspended while the
simulation is shown. Full list: `DECISIONS_AND_ASSUMPTIONS.md`.

**Verification actually run**
- `npm run typecheck` clean; `npm test` 373 tests / 19 files pass (new: 42 in `removal.test.ts`, 2 in `hide.test.ts`); `npm run build`
  passes (bundle 1,541 kB, 449 kB gzipped; chunk-size warning only). No lint tool exists (none added).
- Engine tests on the real model: every referenced id exists; direction (beam before column valid, column before beam a blocking
  violation; window before its wall assembly and lintel); advisory MEP edges warn without blocking, in both directions; the model's
  blocking relationships are satisfiable (0 cycles; a suggested order of all 3,960 top-level records has no violation); inserting a
  ground column's 19 blocking prerequisites gives a plan with 0 errors; planning and analysis leave the records, B1 quantities and
  B2 assessments unchanged; a hidden instance is no longer picked (three.js raycast).
- Browser (`npm run verify:browser:b3`, headless Chrome, 106 checks): real click opens the drawer (draw calls unchanged); a lone
  column is blocked with a named, sourced explanation; "Add blocking prerequisites" yields a plan whose every "bears on" pair is
  supported-first; tinted prerequisites / dependents equal the raw records' relations; stepping hides exactly the intended
  components, reset / closing restores every mesh and instance matrix exactly (hash) and the original draw calls; B2 colouring is
  suspended and resumes with B2 data untouched; floor isolation, layer toggles and X-ray work while simulating; an instanced
  window/wall plan; user dependencies (reason required, unknown id rejected, "pick in model", cycle); persistence across a reload;
  duplicate independence; reorder + suggested order; reset / delete leave no stale state; corrupt, outdated and stale-reference
  saved data; B1 quantities unchanged; console clean.
- A1, A2, A3, B1 and B2 browser scripts re-run, all pass (their screenshots were restored afterwards, so uncommitted image changes are
  untouched).
- Worst case (a plan of all 3,960 top-level records, ~9,800 components hidden at step 1,500): adding all 390 ms, selecting 50–80 ms,
  jumping to a step ~110 ms, reset ~130 ms; a camera move recomputes nothing.

**Known limitations.** Conceptual only: no stability, load-path, propping, isolation or live-service model, and no time, cost, crane or
access model. MEP relationships are advisory. Group-level edges apply only when the group is planned as a whole. No activity nodes
(use user dependencies or notes). Plans are per browser (no export/import) and the cursor is not saved. Removed components are hidden,
not animated or ghosted. Hover/pick-through of hidden plain meshes relies on the existing visibility guard (clicks on hidden
instances are covered by a unit test, not a browser click).

**First task for B4:** a pure `src/engine/scenarios/` that compares a conventional demolition plan with a selective deconstruction
plan over the same components, reading B3 plans (order, states, findings) and B2 recovery assessments, with no cost, time or carbon
figures until reliable inputs exist; tests first on the ground column plan and the window/wall plan.

---

## B2 Results — Material Recovery & Reuse Assessment
Method, formula, data model and limits: `RECOVERY_ASSESSMENT.md`. Screenshots: `docs/screenshots/b2/`.

**Delivered.** `src/engine/recovery/` (pure: assessment model, `Available × Recovery %`, recovery inventory, persistence
codec, generic suggestions) and `src/scene/recovery/` (Recovery drawer opened from the controls panel or the inspector, assessment
editor, bulk planning, recovery inventory, 3D colour overlay, inspector line). B1 quantities are the only source of quantities;
assessments are a separate sparse map saved to `localStorage` (the app had no persistence before).

**Decisions.** Loss is not a second factor: one recovery % defined as net of loss, loss kept as a note (no double counting).
No recovery rates are supplied: every % is the user's, and the generic per-category suggestions (classification, method,
pathway) carry no numbers and apply only on request. Unavailable figures read "Not available" with the reason, never 0.

**Verification actually run**
- `npm run typecheck` clean; `npm test` 329 tests / 17 files pass (new: 24 in `recovery.test.ts`); `npm run build` passes
  (bundle 1,486 kB, 432 kB gzipped; chunk-size warning only). No lint tool exists (none added).
- Hand-calculated cases (tests and in the browser): column 0.729 m³ × 60 % = 0.4374 m³; tile 0.2259645 m² × 50 %; drain stack
  0.375 m × 25 % = 0.09375 m; WC pan 1 nr × 100 %; column mass 1,749.6 kg × 60 % = 1,049.76 kg. Invalid % (-3, 120, NaN, text)
  rejected; missing %, no quantity and no mass give "Not available". Grouping identities: Σ groups = total per unit for all five
  groupings; units never mixed; an assembly edit assesses each of its parts once.
- Browser (`npm run verify:browser:b2`, headless Chrome): real click opens the drawer (draw calls unchanged); hand calculation in
  the UI; inventory row updates (concrete m³ recoverable 0.437); persistence across a reload; colouring on/off restores the
  original materials; status, floor and material filters (others pale in 3D); row click → inspector id; floor isolation with the
  overlay on; assembly (26 of 26 parts) and filtered bulk edits (4,799 floor tiles); mass basis (kg only); reset; console clean.
- B1 and A1–A3 browser scripts re-run: see the final report.

**Known limitations.** Assessments are per browser (no export/import). Colour mode and basis are not saved. Suggestions are
generic and unvalidated. "To assess" excludes components classified for recovery that still lack a %. Mass basis covers only
components with a density. No cost, carbon or landfill figures (no reliable inputs).

**First task for B3:** create `src/engine/removal/sequence.ts`, a pure function that, given the A1–A3 `dependencies` /
`connectedTo` / `parentId` relations and a set of component ids chosen for removal, returns the components that must be removed
first (dependants) and those left unsupported, with tests written first on a column, a wall with a window and a plumbing stack. No
UI and no time or cost model yet.

---

## B1 Results — Quantity Takeoff & Material Inventory
Method, rules, identities and the density table: `QUANTITY_ENGINE.md`. Audit (counts, code-vs-brief differences,
componentType table): `B1_AUDIT.md`. Screenshots: `docs/screenshots/b1/`.

**Delivered.** `src/engine/quantities/` (pure engine) + the inspector's takeoff block + the Inventory drawer
(`src/scene/inventory/`, opened from the controls panel). One engine: the UI only filters, sorts and renders the
memoised `getModelInventory()`.

**Scope note.** The brief described A1 + A2 (51,494 records); the code also contains A3 MEP, so the app registers
**87,380 records** (84,365 leaves). The engine covers all of them; the identities are tested on STR + ARC and on the full
model.

**Building totals (default config, full model, leaves only)**
| Category | Quantity | Status |
|---|---|---|
| Concrete (A1 1,490.873 + A2 119.805 + 0.225 MEP plinth) | 1,610.902 m3 (lintels 14.386 inside) | calculated; reinforcement not modelled |
| Masonry (net, as built) | 1,332.235 m3 (wall gross 1,451.058 = net 1,282.049 in walls + lintel 14.355 + 439 voids 154.655) | calculated |
| Floor tile / screed | 5,093.01 / 4,939.47 m2 (rooms only: 4,886.29 tile ≤ 4,939.47 screed ≤ 5,041.24 clear) | calculated |
| Ceilings / wall tiles / skirting / glazing | 5,041.78 m2 / 1,447.74 m2 / 2,929.77 m / 235.44 m2 | calculated |
| Pipes / cables (route length) | 3,861.24 m / 12,013.01 m | calculated |
| Estimated mass | 6,934.82 t, covers 92.5 % of the modelled solid volume (concrete 3,866 t, masonry 2,398 t, finishes the rest) | estimated; 46,057 components have no mass |
| Products | 264 doors (+5 cased openings), 171 windows, 29 kitchens, 79 WC, 79 basins, 63 shower trays, 29 washers, 24 balconies, 15 stair balustrades, 1,186 light fittings; 1,713 balusters and 168 posts as segments | calculated |

**Unavailable / not modelled:** reinforcement, structural steel, MEP pipe wall and conductor size, plaster/paint, mortar,
formwork (listed in the drawer, never 0). Mass is `unavailable` (documented, `info` issue) for hollow/assembled items drawn
as solid boxes: sanitaryware, cabinets, appliances, light fittings, aluminium frames, flush doors, railings, pipes, cables,
MEP parts. **Issues:** 0 record mismatches over 84,365 leaves, 0 unclassified types, 1 warning (the roof-access door is
hosted by the roof enclosure, not a wall: `UNLINKED_OPENING`, no total affected).

**Verification actually run**
- `npm run typecheck` clean; `npm test` 305 tests / 16 files pass (new: 61 tests in 2 files: 35 unit + 26 on the real model incl. the 6
  reconciliation identities); `npm run build` passes (bundle 1,446 kB, 422 kB gzipped; chunk-size warning only). No lint
  tool exists (none added).
- Engine build 0.37 s for the 87,380 records in Vitest (< 1.5 s required); a full A1 + A2 build 0.21 s.
- Browser (`npm run verify:browser:b1`, headless Chrome, Apple M3 Pro): the drawer opens by a real click; **draw calls 1,556
  and 9,007,734 triangles before and after opening it** (unchanged); filters (floor F02 + concrete = 362 rows, all
  match), sort, search ("STR-COL" = 210), card drill-down (lintels = 440 rows), row click → same id in the inspector's ID
  line, parent select, CSV export (362 data rows = filtered count, RFC 4180 parse OK) and a clean console. UI cross-checks:
  945 STR members, 210 columns 153.090 m3, 42 footings 100.800, 42 pedestals 13.608, 426 beams 353.047, 210 slab panels
  863.291. A1, A2 and A3 browser scripts still pass.
- Test change: `vitest.config.ts` now has `testTimeout: 30000`: A3's regeneration-determinism test takes ~6.5 s on this
  machine and failed the 5 s default at HEAD, before any B1 code.

**Known limitations.** Densities are typical values not verified against the standards; the table's "assumed" rows say
so. Wall face area is volume / thickness. Table sort on Quantity ignores units (filter by category first). The drawer
overlays the right 560 px of the 3D view. The first selection after load may wait for the idle-time inventory build
(~0.4 s). The Products and Estimated-mass cards do not drill down (assemblies are not table rows; there is no "has mass"
filter).

**First task for B2:** create `src/engine/passports/passport.ts`, a pure function
`buildPassports(inventory: Inventory): Map<string, MaterialPassport>` that, for every leaf row, joins the engine's
`ComponentQuantities` (primary quantity, mass and status, `sourceIds`) with its `materialId` and `MATERIAL_PROPS` entry
into one passport record (`componentId`, `materialId`, `quantity`, `massKg | null`, `confidence` mapped from status and
basis, `assumptions`, `issues`), with tests written first: one passport per leaf, passports for the 46,057 mass-less
leaves keep `massKg: null` (never 0), and Σ passport mass = the inventory's mass total. No UI and no recovery rules yet.

---

## A2 Results — Architectural Digital Twin
Layout: `ARCHITECTURE_LAYOUT.md` (plans in `docs/plans/`, generated from the model). IDs/data model:
`COMPONENT_DATA_MODEL.md` (A2 section). Decisions, assumptions, limitations: `DECISIONS_AND_ASSUMPTIONS.md`.
Screenshots: `docs/screenshots/a2/`.

**Layout.** 6 apartments per typical floor (3 south 2BHK 12 × 10.2 m; 3 north: 2BHK + study and a 3BHK corner unit
with band annexes) on an E–W corridor just south of gridline 3, which is where the A1 stair arrives. Ground floor:
entrance lobby (axial with the stair), security, meter room, staff toilet, society office instead of A2; living-room
sliders become windows; steps and canopy. Top floor: the stair continues to a roof-access enclosure; roof canopies cap
the balcony stacks.

**Structural change:** `stair.roofAccess` default → `true` (one flag; 939 → 945 members; documented and tested).

**Components (default config):** 51,494 records = 945 A1 members + 2,737 A2 assemblies + 47,812 A2 components.
| Prefix | Assemblies | Components | | Prefix | Assemblies | Components |
|---|---|---|---|---|---|---|
| ARC-WALL | 359 | 1,535 | | ARC-TILE | 79 | 24,457 |
| ARC-PART | 543 | 1,209 | | ARC-SKT | – | 2,198 |
| ARC-WIN | 171 | 3,032 | | ARC-CEIL | 365 | 3,891 |
| ARC-DOOR | 269 | 3,204 | | ARC-FIX | 394 | 1,293 |
| ARC-BAL | 30 | 1,908 | | ARC-KIT | 29 | 1,640 |
| ARC-FAC | 25 | 637 | | ARC-BATH | 79 | 1,247 |
| ARC-ROOF | 8 | 123 | | ARC-STAIRFIN | 15 | 485 |
| ARC-ENT | 1 | 6 | | ARC-FLR | 370 | 947 |
All 47,812 architecture components are instanced (244 InstancedMeshes); the 945 structural members keep one mesh each.
`npx vite-node scripts/plans/inventory.ts` prints this table.

**Verification actually run**
- `npm run typecheck` clean; `npm test` 213 tests / 11 files pass (≈3.3 s); `npm run build` passes (bundle warning
  only). No lint tool is configured (none added).
- Automated validations: IDs valid/unique/deterministic with the record's floor; parent/child integrity, children
  inside parent envelopes, child IDs extending the parent's; rooms tile the floor and each apartment envelope; door
  connectivity (rooms → entrance → corridor → stair; outside → lobby → stair at G); minimum clear dimensions incl.
  corridors at columns; door swings inside rooms, clear of columns and each other; openings fit walls, clear of
  columns/junctions, heads below ceilings; no wall gaps (5 cm sampling); zero positive-volume overlaps architecture vs
  structure and architecture vs architecture (allow-list empty; sloping members checked exactly); zero coplanar
  same-facing faces; quantities consistent with units/dimensions/geometry; stair finish arithmetic (all 24 finished
  risers = 0.15, bottom FFL, top next FFL); fixtures inside rooms and clear of door swings; WC/basin/shower 0.6 m zones
  free. Mutation tests confirm the plan validators, the overlap/coplanar checkers and the exact sloped check catch planted
  faults.
- Browser (headless Chrome, ANGLE Metal, Apple M3 Pro; `npm run verify:browser:a2`): 20 captures (exterior from two
  angles, four facades, entrance and canopy, balcony, roof, ground and typical plan views with ceilings hidden, two
  kitchens, two bathrooms, stair core, ceilings on, section through a window, assembly selection, layer off). Real mouse
  clicks resolved instanced components (wall pier, glazing pane, fin) to their IDs; the inspector's parent link selected
  the assembly; the layer checkbox hid its group and a click passed through; isolate + ceilings toggle + reset worked;
  every drawn component resolves to exactly one record (48,757 = 945 meshes + 47,812 instances; 0 unresolved, 0
  undrawn, 0 duplicates); console clean. The A1 structural browser check (`npm run verify:browser`, architecture hidden)
  still passes.
- `renderer.info`, 1600 × 1000, dpr 1: full exterior **1,191 draw calls, 657,134 triangles** per steady frame
  (2,370 / 1.31 M on the single shadow-refresh frame); isolated floor F01 197 calls / 111 k triangles. 34 geometries,
  3 textures (environment), 10–12 programs. Budgets (≤ ~1,500 calls, ≤ ~3 M triangles) met.

**Known limitations** (details in DECISIONS_AND_ASSUMPTIONS.md): interior column faces show the structural material;
doors modelled closed; fixtures are simple geometry with rule-based layouts; plain roof; no plumbing/electrical network
(connection points only); no lint configuration; no code splitting.

**First task for A3:** create `src/building/mep/plumbing.ts`, a pure generator that takes the A2 connection-point
records (`componentType === "connection_point"`, with `roomId`, position and water/drain role from the ID suffix) and
the A1 shaft opening, and emits conceptual `PLB-PIPE-{floor}-{apt}-{n}` supply and drain runs from every connection
point to the services shaft (axis-aligned segments in the floor/ceiling void and the shaft), with tests written first:
every connection point connected exactly once, runs reach the shaft on every storey, and `findOverlaps` reports no
clash with A1 or A2 records except a documented allow-list for wall penetrations.

---

## A1 Results — Parametric Structural Building (G+4)
Spec: `BUILDING_SPECIFICATION.md`. IDs/data model: `COMPONENT_DATA_MODEL.md`. Screenshots: `docs/screenshots/a1/`.

**Counts (default config):** 42 footings, 42 pedestals, 210 column segments, 426 beams (71 × 6 levels), 207 slab panels,
8 stair flights, 4 landings = **939 components**.

**Verification actually run**
- `npm run typecheck`, `npm test` (84 tests, 6 files), `npm run build` — all pass. No lint tool is configured in the repo
  and none was added (no new dependencies).
- Generator tests cover the counts, datum, column/beam/slab junctions, beam ends on joint faces, slab-area identity per
  bay, opening clearance, stair arithmetic/fit, ID uniqueness/determinism, and a generic overlap test across all 939
  members (empty allow-list; stacked/abutting members touch on faces only). Tests were mutation-checked: shrinking slab
  notches, lengthening beams 1 cm, and shifting the stair 0.1 m each made the intended tests fail.
- Browser (headless Chrome, real GPU WebGL2 on Apple M3 Pro, via `npm run verify:browser`): full, top, stair-core and
  section views plus junction close-ups; real mouse clicks on a column, footing, roof slab and roof beam resolved to the
  right IDs in the dev inspector; clicking empty space clears; all 939 meshes carry `userData.componentId` matching their
  record; console clean.
- `renderer.info` (full view, 1600×1000, dpr 1): **940 draw calls, 17,700 triangles** per steady frame; 1,879 calls /
  35,400 triangles on the single frame where the shadow map is refreshed. 19 geometries, 3 programs.

**Known limitations**
- Section/stair views are uncapped cuts (cut members show their hollow interior); back-face shadow noise is visible on
  cut beams.
- Stair landing has no explicit support member (conceptual; walls/supports come with A2). Stair headroom is not checked.
- `roofAccess` and `includePlinthBeams: false` / column-override variants are covered by unit and overlap tests but were
  not inspected visually.
- No roof-edge upstand beam (parapet belongs with A2). No lint configuration.
- The production bundle is ~1.1 MB (317 kB gzipped); no code splitting yet.

**First task for A2:** create `src/building/architecture/walls.ts`, a pure generator `config -> ComponentRecord[]` for
`ARC` perimeter wall panels (one per bay per floor, L0→ROOF, `assembly: "walls"` added to `ASSEMBLY_NAMES`, IDs
`ARC-WALL-{floor tag}-{X|Z}-{nodeA}-{nodeB}`), sized from the structural junction rule — clear width = span − joint size,
height = storey height − beam depth, thickness ≤ beam width — with no rendering yet. Write its tests first, reusing
`recordSolids()` for a generic overlap test of all walls against the 939 structural members, and leave the stair/shaft
core enclosure and door/window openings as the following step.

---

## A1 Plan (original, for reference — the column/beam junction rule was later revised, see BUILDING_SPECIFICATION.md)

### Generation sequence
1. **Grid**: Derive X and Z positions from config. Use as basis for all placement.
2. **Foundations**: One footing + pedestal at each grid intersection (7 × 6 = 42).
   Footing bottom at y = -1.5, top at y = -0.9. Pedestal top at y = 0.
3. **Columns**: Segments between each level. Column runs from top-of-slab-below
   (or pedestal top) to underside-of-beam-above (level elevation − beam depth).
   42 columns × 5 storeys = 210 segments.
4. **Beams**: X-direction beams along each grid row (6 spans × 6 rows = 36 per floor);
   Z-direction beams along each grid column (5 spans × 7 cols = 35 per floor).
   71 beams × 6 levels (L0 through ROOF) = 426 beams. Span between column faces.
5. **Slabs**: Per-bay rectangular panels between beam inner faces. 30 bays per level
   minus stair/shaft openings. Panels are simple boxes (no CSG).
6. **Stair flights & landings**: Dog-legged stair with mid-landing per storey.
   Two flights of 12 risers each. Landing at mid-height.

### ID assignment
Each generator yields `BuildingComponent` records with deterministic IDs from
`buildComponentId()`. Generators output both the component data and the geometry
parameters needed to render the mesh.

### Performance plan
- Shared `BoxGeometry` for standard member sizes (one geometry instance per unique
  dimension set).
- Shared `MeshStandardMaterial` per material type.
- Individual meshes (not InstancedMesh initially) to preserve per-component raycasting.
  If >2000 objects cause frame drops, wrap with instancing behind an adapter that
  preserves `userData.componentId` lookups.
- Frustum culling enabled by default.

### Validation plan
- Count assertions: 42 footings, 42 pedestals, 210 column segments, ~426 beams,
  ~140 slab panels, ~10 stair elements.
- Alignment: column centres match grid intersections; beam ends meet column faces.
- No z-fighting: verify member clearances at junctions.
- Registry size equals rendered mesh count.
