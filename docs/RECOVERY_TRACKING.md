# ReLoop India — Material Recovery & Circularity Tracking (C3)

C3 follows each component from **planned** recovery to its **actual** final outcome: deconstruction, recovery, inspection, allocation for
reuse, and what finally happened to the material (reused, recycled, disposed). It compares planned and recorded quantities, keeps every
step in a history that is never edited, and links each record to the component's material passport (C1), its reuse allocation (C2), its
removal order (B3), its recovery plan (B2) and its place in the 3D building.

C3 records **what the user records**. Nothing is recovered, reused, recycled or disposed because a plan, an assessment or an allocation says
so: being recovered or allocated in C2 never makes material "reused". A quantity that was never recorded is *unknown*, which is not zero.

```
src/engine/tracking/   pure: types, summary (fold a history into status, balance, flags), ops (validated operations, stage rules, C2 sync),
                       plan (what B1 / B2 / B3 / C2 say now; the planned scope), report (rollups, differences, unresolved), batches,
                       persist, export, tracking.test.ts (73 tests)
src/scene/tracking/    trackingStore (localStorage, drawer exclusivity, C2 follow), hooks, registerModel, TrackingDrawer (shell, fold), Overview,
                       Rail (facets), Register, RecordPanel (+ Stepper), Forms, History, Viz (bars), Report, HighlightSync, TrackingInfo, tracking.css
scripts/browser/verifyC3.mjs   139 checks against the running app and the real building
```

## Records: an append-only history per component
A **record** exists for one leaf component (keyed by the id B1, B2, B3, C1 and C2 use) once the user starts tracking it. It holds its unit
(the component's B1 primary unit; every quantity of the record is in it, nothing is converted) and a list of **events**: `track` (the plan as it
stood), `plan` (a quantity the user states), `status`, `recovered`, `outcome` (reused / recycled / disposed), `unrecovered` (confirmed not
recovered), `variance` (a documented reconciliation), `note`, `allocation` (C2 changed, recorded by the system) and `void`. Events are only ever
appended. A mistake is corrected by **voiding** an event with a reason: it stays visible, struck through, and leaves the totals. Events typed by
the user and events recorded by the system (automatic stage changes, C2 allocation changes) are distinguished and system events cannot be voided.
Every quantity event carries its **source**: measured, estimated or assumed, chosen explicitly in the form (there is no default); a record's quality is
its weakest source.

**Assemblies never hold records**: starting tracking on an assembly tracks each of its parts once. Records are keyed by component id, so a
component cannot be tracked twice. **Batches** are named groups of component ids for working on them together (starting tracking, changing a stage,
filtering); a batch holds no quantities, so overlapping batches cannot double-count.

## Stages and the rules between them
Planned for recovery · Deconstruction in progress · Recovered · Inspected · Allocated for reuse · Reused · Recycled · Disposed · On hold / outcome
unknown. The user states the stage; the engine checks it against the recorded quantities and refuses the rest, with the reason shown on the disabled
control:
- **Recovered / Inspected** need a recovered quantity above 0; **Allocated for reuse** also needs an active C2 allocation for the component.
- **Reused / Recycled / Disposed** need a recorded outcome of that kind. Recovery and allocation never imply it.
- **Planned** only while no recovery is recorded; **In progress** from planned / on hold or while material is left to recover; **On hold** needs a reason.
- An outcome stage with nothing in hand cannot go back to an earlier one. Any recovery record (even a recorded zero) starts or resumes the work; recording
  an outcome that leaves nothing in hand closes the record with the outcome that holds most of the recovered quantity.
- Voiding the evidence under a stage reverts the stage by a logged system event; a void that later records depend on is refused, naming what to void first.

## The balance (no double counting between stages)
For a record, in its unit: **available** Q (B1 + documented variances) · **recovered** R · **not recovered** L · **reused / recycled / disposed** U, C, X.
Rules: R + L ≤ Q, and U + C + X ≤ R. Derived: **in hand** = R − U − C − X (recovered, no outcome yet) · **not yet recovered** = Q − R − L ·
**unaccounted** = Q − U − C − X − L. Material is in exactly one place, so moving it between stages never counts it twice.
**Recovered above the available quantity is refused** unless the user records a **documented variance** (a signed difference with a mandatory reason and
source: "the real tile area is larger than the modelled one"); the variance is shown next to B1's figure and B1 itself is never changed.
**Unknown is not zero**: recovered is `null` until a recovered event exists, an explicit 0 is a recorded zero, and every report, export and the passport say
"not recorded". A whole item (nr) is recorded in whole items; dates cannot be in the future.

## Planned versus actual
The **plan** is a snapshot of B2 taken when tracking starts: B1 quantity × recovery % for a reuse, refurbish or recycling classification (whole items to the
nearest item); otherwise there is no planned quantity (null, flagged), and the user can state one (with a source). B2 is read again to show **drift**.
**Completion** = Σ recovered ÷ Σ planned over the records where both are known and the plan is above 0. Flags (each with a level): component not in the model,
unit changed, more booked than available (errors); no plan, recovered below / above plan by more than 10 %, closed with material unaccounted, recovered material
with no outcome, outcome differs from the plan (reuse planned, recycled or disposed), C2 allocation not fully fulfilled, on hold, recovery not recorded (warnings);
plan drift, reuse against a cancelled allocation, reuse outside C2, estimated / assumed values (information). The **report** breaks the tracked population down
by material category, floor and stage (one unit at a time), lists the differences and the unresolved / incomplete records with their reasons, and reconciles:
every component once, every breakdown equal to the total. The **planned scope** (B2 reuse / recycling classifications, the active B3 plan, C2 allocations) shows
how much of what is planned is tracked and the planned quantity still untracked.

## Links to C1, C2, B3 and the 3D building
- **C1 passport**: a ninth section, "Recovery tracking (C3)", composed from the record and the C2 allocations (stage, planned from B2, recovered / reused /
  recycled / disposed / not recovered with their source as the field status, unaccounted, what needs attention); an untracked component says so. The Passport button
  in the tracking panel opens the component's passport; the passport links back.
- **C2 allocations**: the panel shows the requirement, the allocated quantity and how much was recorded as reused against it (an allocation is fulfilled only by a recorded
  reused outcome). When a component's allocation is created, changed or cancelled, the record logs a system event (also for changes made while the app was closed), steps an
  "Allocated" stage back if the last allocation is cancelled, and keeps every earlier entry. C2's allocation rows show "C3: reused x of y". C3 never changes C2.
- **B3**: the removal step is shown (a planned order, not evidence of removal). **B5**: the component's baseline carbon is shown as context; no saving is claimed.
- **3D**: selecting a row selects the real component; **Locate in 3D** folds the workspace into a card and frames the camera on it, and **Show workspace** returns to the same
  scope, search and selection. Marks use the existing tint highlight on the existing meshes: by stage (sky blue planned, orange in progress, yellow recovered / inspected /
  allocated, green reused, blue recycled, vermillion disposed, grey on hold; pale for planned but not started) or only the records needing attention. Opening any other
  drawer closes the workspace; presentation mode closes it and restores it.

## Workspace
A 900 px drawer: a **progress overview** (stage bar that filters, coverage of the planned scope, quantities for one unit with a planned-versus-actual bar), a **filter rail**
(stage, material category, floor, batches), and two tabs. **Register**: tracked / planned / not started / all components, searchable and sortable ("needs attention first"),
multi-select for bulk start, bulk stage and saving a batch, a small outcome bar per row, ↑ / ↓ stepping, and below the list the **tracking panel** of the selected component
(stage stepper with quick updates, planned versus actual bars with an exact legend, attention list, linked records, the recording forms, the history). **Report**: breakdowns,
differences, unresolved records, JSON / CSV export. The inspector gains a "tracking" line.

## Persistence and export
`rematter.tracking.v1` (versioned JSON): records with their full histories and batches only; status, balances, completion and reports are never stored. A history that does not
replay to a possible state (outcomes above the recovered quantity, a stage its quantities do not support, a duplicate event id, a bad void) is **dropped and counted**, never
repaired; records of components that are not in the model are kept and flagged. Export: `rematter.recovery-tracking/1` JSON (every record with its history; a quantity never
recorded is `null`) and CSV (one row per record; unknown stays empty, zero stays 0). Neither asserts an environmental saving.

## Verification
`npm test`: 73 tracking tests (plan from B2; starting; partial, cumulative, zero and unknown recovery; validation of quantities, sources, dates and whole items; documented variance;
outcomes and the balance; every stage rule; voiding and the reverts it logs; C2 created / changed / cancelled / fulfilled and fulfilment limits; drift and model changes; reports
reconciled per unit with hand-computed numbers; persistence incl. broken accounting, orphans and corrupt data; batches; export; the real model) and 5 passport tests.
`npm run verify:browser:c3`: 139 checks (see the script header), including the planned scope equal to an independent set, planned = B1 × 90 %, the whole workflow in the real UI,
the report and overview equal to an independent replay of the stored histories, and the A1–A5, B1–B5, C1 and C2 browser checks unchanged.

## Limitations
- The stage is the user's statement checked against the quantities; the app cannot know what happened on site. Actual figures are only as good as the entries and their sources.
- Quantities are in the component's B1 unit (no mass-based or cross-unit tracking); a component recorded as a whole piece cannot be partly "reused" in a different unit.
- Planned quantities exist only where B2 gives a recovery estimate (or the user states one); the tolerance for "below / above plan" is a fixed 10 %.
- One record per component; assemblies are tracked through their parts. Batches are groups for convenience, not quantities.
- Records live in this browser only (no multi-user work, no photos or documents). No environmental saving is calculated or claimed.
