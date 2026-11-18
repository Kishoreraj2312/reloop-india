# ReLoop India — Decisions & Assumptions

## Key Decisions
1. **1BHK Retired**: The old prototype is not extended, copied, or rendered.
   New G+4 implementation built from scratch.
2. **No external BIM/IFC**: Geometry is procedurally generated from config parameters.
3. **Deterministic calculations only**: All quantities derive from geometry parameters
   via TypeScript arithmetic. No AI-generated numbers.
4. **Planning tool disclaimer**: The model is conceptual. No claims of structural
   adequacy, safe reuse, or regulatory compliance.

## Assumptions (all labelled "assumed" in component records)
- M30 concrete density: 2400 kg/m³
- Brick masonry density: 1800 kg/m³
- Steel density: 7850 kg/m³
- Member sizes are conceptual defaults for visualization, not engineered sections.
- Recovery routes are initial assumptions pending site inspection.
- Cost estimates (future) will use placeholder Indian market rates, clearly labelled.

## A1 Decisions (structural frame)
1. **Junction rule deviates from the brief** (documented in BUILDING_SPECIFICATION.md): columns run level-to-level and
   end flush with the beam/slab top instead of at the beam underside, because the literal rule leaves a 0.45×0.45×0.5 m void
   at every joint. Beams still end on column faces (pedestal faces at L0).
2. **Slab panels are notched rectilinear polygons**, not plain boxes: columns/pedestals are wider than beams, so a plain
   box inset to the beam faces would interpenetrate them. Built without CSG.
3. **Floor tags**: storey members use the tag of the level at their base (`G`, `F01`..`F04`), level members the level's
   own tag (`G`..`F04`, `RF`). The brief's "F01 = storey 1" examples differ; see COMPONENT_DATA_MODEL.md.
4. Column ID has no extra `C-` segment (`STR-COL-F01-B2`, as A0 defined), and the material is carried by A0's `materialId`.
5. A0's stub viewer was removed; `registry` gained `unlinkMesh`; config gained `columnOverrides`, `includePlinthBeams`,
   `stairOpening`, `shaftOpening` and stair layout fields (all with validation).

## Known Limitations
- Browser visual verification not performed in A0 (Playwright unavailable in env).
  Build + typecheck confirm code correctness; manual browser check recommended.
- Three.js bundle ~1.1 MB gzipped 311 KB — acceptable for desktop expo demo.
  Code-splitting can be added if needed.
- No lint tool is configured (none added in A1 to avoid new dependencies). A1 browser verification was done — see
  EXECUTION_ROADMAP.md (A1 Results); the A0 note above no longer applies.

## A2 Decisions (architecture)
1. **Structural change (the only one): `stair.roofAccess` default `false` → `true`.** A2 requires a roof-access
   enclosure and door; without a stair to the roof it would enclose nothing. A1 already parameterised and tested this
   variant (overlap test included), so the change is one config flag. Effect: +1 flight pair and landing
   (`STR-STAIR-F04-FL1/FL2/LND`) and the roof stair bay is split around the opening (`STR-SLAB-RF-P16` →
   `STR-SLAB-RF-P16-W/E/S/N`); 939 → 945 members. No other structural geometry or ID changed. Tests now assert both
   variants explicitly.
2. **Corridor position follows the A1 stair.** The stair arrives at the south edge of its well, so the common corridor
   runs E–W just south of gridline 3 (z −4.8…−3); see ARCHITECTURE_LAYOUT.md.
3. **Stairwell lining walls.** The A1 stair stands in a 2.8 × 5.4 m opening with 1.4 m floor strips beside it, so the
   flights' outer edges faced a drop. Instead of guarding dead strips, A2 encloses the well with 0.115 walls standing on
   the slab just outside the opening (W/E/N); the opening itself stays clear. Guards remain only where needed (inner
   flight balustrades, landing north edge).
4. **En-suite deepened (stage 4).** The fixture validators showed shower + WC + basin with 0.6 m clear zones do not fit
   a 1.93 × 1.69 m en-suite. It became 2.1 × 2.25 (boundary); the master bedroom keeps 3.43 × 3.69 m clear plus a small
   door lobby (an L-shaped room of two rectangles).
5. **Walls stop at the beam soffit everywhere (clear height 3.1 m)**, including partitions not under a beam; the 0.35 m
   above off-grid partitions is inside the ceiling void (head detail not modelled). This keeps every wall clear of every
   beam without per-crossing cut-outs.
6. **Junction ownership instead of CSG.** Walls are extended to the far face of the walls they meet; for each overlapping
   pair exactly one keeps the overlap (a wall passing through beats one ending there unless the ending wall has a higher
   rank: exterior > core/party > partition), and columns are subtracted from all. Openings split the host piece into
   piers, reveals, sill panel, lintel and above-lintel infill.
7. **Frame grid on the facade.** Floor bands (beam zone) and thin column cladding project 50 mm and form a frame; fins
   flank the balcony stacks; casement windows get sunshades (chajjas) on the lintel band; sliders and ventilators do not.
8. **Ceiling light fittings ride with the ceilings layer** (they are ceiling-mounted), so cutaway plans show no floating
   lights. The fixtures layer covers kitchens, bathrooms and appliances.
9. **Instanced rendering for all architecture.** One InstancedMesh per floor × category × material × unit shape, with
   an instanceId → componentId map, keeps the full model within the draw-call budget (1,191 calls in the full exterior
   view, of which 945 are A1 member meshes). Nothing is merged: each instance is a component.
10. **Overlap allow-list: empty.** Sloping stair members (A1 flight prisms, rotated handrails and strings) are checked
   exactly (x-extrusions of polygons, clipped area × x-overlap) instead of being allow-listed; everything else is boxes.
11. **Site ground plane** at finished grade (−0.45) is presentation only (not a component); it hides when the foundation
   floor is isolated.

## A2 Assumptions (planning values; all records `confidence: "assumed"`)
- FFL = slab top + 0.05 (0.04 screed + 0.01 tile); ceiling FFL + 2.8; site grade −0.45; 3 entrance risers of 0.167.
- Walls: exterior 0.23 (outer face flush with column outer face), party/corridor/core/shaft 0.23, partitions 0.115.
- Openings: door heads FFL + 2.1 (entrance 2.4), window sill 0.9 / head 2.1, ventilators sill 1.65, lintel 0.15,
  reveal depth 0.115, fit tolerance 5 mm, minimum pier 50 mm.
- Clear room minimums: bedroom 2.8 m, kitchen 2.0 m, bathroom 1.2 × 1.8 m, corridor/passage 1.2 m; fixture clearances
  0.6 m in front of WC, basin, shower entry; door approach 0.75 m (kitchens) / 0.6 m (wet rooms).
- Balconies: 1.5 m projection beyond the wall face, cantilever conceptual (no back-span or reinforcement modelled),
  finish 15 mm below room FFL, railing 1.05 m.
- Internal kitchens and baths are assumed mechanically ventilated to the shaft; no ducts or plumbing are modelled
  (connection points are visual stubs only). No code compliance, fire/egress, structural adequacy or MEP coordination
  is claimed.

## A2 Known Limitations
- Interior column faces show the A1 structural material (not plastered); skirting and wall tiles return around
  protruding columns but column faces are not otherwise finished.
- Doors are modelled closed; swings are data (validated, drawn in the plan SVGs) rather than animated.
- Fixtures are simple box/cylinder geometry; kitchen/bath layouts are rule-based per room, not individually designed.
- The roof is plain (finish, parapet, enclosure, shaft upstand, drains); no water tank or solar equipment.
- No lint tool is configured (none added; no new dependencies). `npm run typecheck` (strict TS with unused checks) is
  the static gate.
- `npm run build` warns that the bundle exceeds 500 kB (three.js); no code splitting yet.

## B3 Decisions (removal simulation)
1. **One direction, one adapter per source.** The model's relationship fields point in different directions (A1 "bears on" and A2
   "hosted in" are the reverse of removal order; A3 supply is the same, A3 drainage the reverse), so each has its own tested adapter
   into "prerequisite → dependent". Raw fields are never read as prerequisites directly. The relationship census that justifies
   this is in `REMOVAL_SIMULATION.md` and reproducible with `npm run census:removal`.
2. **Blocking only where the model records support or hosting** (A1 `bears_on`, A2 `hosted_in`). MEP relationships are advisory
   because the model has no isolation or discharge state; vents, cross-family and unrecognised dependencies and all `connectedTo`
   joints are "unknown" and imply no order. Nothing is inferred from proximity.
3. **`parentId` is containment for assemblies.** An assembly entry stands for all its parts; an assembly plus one of its parts is an
   overlap error. A1 "member beneath" is the same relation as its `dependencies` and adds nothing.
4. **States are derived** from membership, validation and the simulation cursor; "blocked" is a calculated flag, not a state.
   Only the ordered entries, notes and user dependencies are stored. The cursor is not persisted.
5. **The user's order is never changed silently.** "Add blocking prerequisites", "Apply suggested order" (previewed) and "move it to
   step n" are explicit actions. A blocked step is never skipped.
6. **No activities as nodes.** Non-component prerequisites (e.g. "isolate circuit X") are expressed as user-defined dependencies
   between components or as step notes; isolation status is never asserted by the tool.
7. **Plan tints are drawn without depth testing**, at low opacity, because the structure is enclosed by the facade and would
   otherwise be invisible in the default view. Removed components are hidden (matrix scale zero / `visible = false`), reversibly.
8. **B2 colour overlay is suspended, not blended,** while the removal overlay is shown, so the two never write the same materials.
9. **Group-level edges apply when the group is planned as a whole.** A prerequisite group is addressed when all of its parts are
   covered by earlier entries.
10. **No new dependencies; no `removalPhase` record field.** Plans live in `localStorage` (`rematter.removal.plans.v1`).

## A4 Decisions (exploded view)
1. **The explosion is display state, derived every time.** `displayed = canonical + offset(parameters)`, recomputed from scratch;
   parameter 0 restores exact canonical transforms (offsets are exactly `+0`, group positions exactly zero, instance translations
   copied from the canonical array). Nothing about it is stored or persisted, and closing the panel resets it.
2. **Floor and system offsets are translations of the existing scene groups; only assembly offsets write instance matrices.**
   Groups already exist for every floor and every floor × system, so moving them carries plain meshes, instanced batches, B3
   tints, selection outlines, picking, culling, clipping and shadows through world matrices, at a cost of about ten group writes
   per update. Per-instance writes are needed only for members of decomposed assemblies.
3. **Instance matrix ownership is split by element.** The explosion owns the translation (elements 12–14); B3's removal overlay owns
   the linear part (0–11, 15). B3's save/restore was changed from "whole matrix" to "linear part" so a hidden instance stays hidden
   while exploded and B3 never restores a stale position. Overlays that copy instances (B3 tints, selection outlines) mirror the
   canonical matrices and register as followers.
4. **Floor grouping is the explicit `floor` field** (the scene's own groups), not geometry. A storey group holds its slab and beams
   at the bottom and its columns, walls, fixtures and services above, so a floor stays rigid; storeys separate at the beam-on-column
   interface. 6 m between floor groups because assembled floor groups overlap by up to 3.6 m (services reach into the next storey).
5. **Systems separate horizontally in a 2 × 2 grid by default** (about 91 × 75 m) instead of a row (about 178 m wide), spaced from
   the actual per-system plan bounds plus a gap and re-centred on the assembled union. A row along X or Z is selectable.
6. **Decomposition uses assembly records only** (explicit containment). `dependencies` and `connectedTo` never define membership;
   the one dependency read is an opening's explicit hosting link, used only to find the wall normal. Per-type rules are
   documented; 1,609 of 3,015 assemblies (walls, MEP network containers, single-layer assemblies) are not decomposed, each with a
   reason, and structure (no assembly records) falls back to floor / system / category.
7. **Layers, not scatter.** Members are clustered into layers along the rule's axis (1 cm tolerance) and offset by their layer
   index from the middle, so related members stay together and the result is deterministic; one assembly spreads at most 1.5 m.
   Wall-tiling panels move radially away from the room centre; a member too close to the centre uses the assembly's default axis.
8. **Displaced instances keep correct culling and picking** by growing the mesh's bounding sphere by the largest displacement
   (restored to the exact original radius at parameter 0); plain meshes need nothing because they move with their group.
9. **Shadows follow the explosion**: the key light and its shadow frustum are refitted to the displaced bounds and the frozen
   shadow map is refreshed with each change; the presentation-only ground plane is hidden while anything is displaced.
10. **The camera never moves on its own.** Fit and Focus frame the displayed bounds of the visible groups in the free part of the
    canvas (clear of the bar, drawers, layer panel and a tall inspector); the orbit distance limit is raised while displaced.
11. **Section planes stay world-space** and cut the displayed geometry; the panel says that this is no longer a building-relative
    section. They are not re-aimed at the displaced model.
12. **No assembly "isolate".** Floors and systems are isolated with the existing floor isolation and layer toggles (set from the
    selection); an assembly is chosen, decomposed, framed and its members listed, but the rest of the model stays visible.
13. **Trace lines are optional and positional**: a line per member of the inspected assembly from its assembled position to its
    displayed one; no line between components, so no relationship is implied. Default off.
14. **A dev-only hook** (`window.__explode`) exposes canonical vs displayed positions for verification and is dead-code eliminated
    from production builds. No new dependencies.

## A5 Decisions (visual fidelity and presentation)
1. **Surface detail is a shader patch on the existing materials, not textures or new geometry.** One shared 256 x 256 procedural
   noise texture and a pattern per class of assumed substance (plaster, concrete, ashlar, granite, tile, timber, brushed metal,
   glass, ground). MEP materials stay untextured: they are distinguished by colour, roughness and metalness. No dependency, no asset,
   no extra draw call (1,556 / 1,191 unchanged); shader programs 13 -> 19 (one per finish).
2. **Appearance never edits the model.** The finish follows the record's `substance` / material id (what A1-A3 ASSUME), never changes
   a dimension, a quantity or a material id, and the inspector and card keep `confidence: assumed`. Library `render` values are not
   edited; reflectivity limits for glossy floor tiles live in the scene layer (`reflectionFor`).
3. **Pattern coordinates are canonical** (instance matrix only), so A4 group translations cannot make a texture swim; joint and grain
   patterns use the piece's own frame; per-piece tone uses `gl_InstanceID`. B2 / B3 overlays use clones and flat tints, which do not
   inherit the patch, so status colours stay exact and flat.
4. **Overlay precedence in presentation mode:** B3 removal (when its drawer shows a plan) > B2 recovery colouring > finishes. The
   presentation never turns B3 on, and turns B2 on only when assessments exist; leaving presentation mode restores the exact earlier
   colouring state.
5. **Tone mapping Neutral, procedural sky environment, one south-west sun.** The default view is now the south-east hero axonometric
   (`?view=hero`, used when no `?view=` is given) so the entrance, the south balconies and the shadowed east facade are in view;
   `?view=full` keeps the original north-east oblique for the A1 verification.
6. **The site plane is a stage while A4 displaces anything**, positioned each frame below the lowest displaced point, instead of being
   hidden. The bare grid shows only when the foundation floor is isolated. A ghosted (X-ray) building casts no shadow.
7. **Exploded transitions glide**: progress moves linearly in time and the solver's smoothstep makes each offset an S-curve; there is
   no spring or overshoot. Mode changes close the explosion in the old mode first. `preset()` stays instant for tests and scripts.
8. **Presentation mode is an overlay on the one viewer.** It applies declarative plans (`presets.ts`, pure and tested on the real
   model) through the existing stores and view state, snapshots the application on entry and restores it on exit. It owns no data and
   writes no record, quantity, assessment or plan.
9. **Guided demonstration: 5 steps / 13 scenes, all optional and user-triggered**; captions are computed from the live records.
   Sustainability (B5) is not offered because B5 does not exist. Auto-advance (9 s dwell) is off by default and pauses on any press,
   key or canvas touch.
10. **No post-processing.** SSAO, bloom, GI and shadow-map filtering upgrades were not added: the frozen shadow map and the
    environment deliver the depth this model needs inside the existing budget.
11. **Interface tokens in one stylesheet** (`src/ui/theme.css`); the B1 - B3 drawers keep their layouts and pick up the shared radius
    and control look. No new dependency.


## B4 Decisions (demolition vs deconstruction scenarios)
1. **A scenario stores assumptions, never data.** Rules, overrides, the residual destination, the baseline and the selected material
   categories; B1 quantities, B2 assessments and B3 plans are read, never copied or changed, and results are recomputed (memoised per
   scenario object) so a stale result cannot be shown. Duplicates are deep copies.
2. **"Material category" is B2's** (the material's substance), so B2's recovery inventory and B4 agree on what a category is; results are
   per category **and unit** and units are never added.
3. **Resolution order is fixed: component -> category -> template -> unknown.** An assembly rule reaches its parts (nearest rule wins);
   only real assemblies count, because A1's `parentId` means "member beneath", not containment. Assemblies are never rows.
4. **No recovery rate is supplied.** The material library holds no documented recovery data, so "conventional demolition" is a
   disposal baseline (editable, with category rules the user can justify) rather than an invented recycling rate; selective and
   reuse-first take every percentage from B2. The templates therefore give 0 % diverted until the user assesses something.
5. **Reuse-first has no demolition fallback and its residual defaults to unknown**; selective's baseline and residual default to
   disposal. They recover the same quantities where both apply and differ in what they assume for the rest, which the "What differs"
   section states. Reuse-first applies all three B2 pathways (reuse and refurbishment are the assessor's classification, recycling as
   assessed); a stricter "reuse pathways only" variant was not built because it would drop information the user entered.
6. **Selective's default scope is the categories assessed in B2 at creation (or reset)**, stored as an explicit, editable list; it is a
   starting selection, not a hidden rule.
7. **A missing % is never a number.** A recovery pathway without a usable % shows its recovered quantity as unavailable ("n/a"),
   carries the whole allocation as unknown, and is listed under missing assumptions; an invalid stored % is read as "not set".
8. **The % is net of loss** (as in B2): no second loss factor, and B2's loss note is not applied.
9. **Whole-building indicators need coverage:** shown only when B1's mass covers >= 90 % of the modelled solid volume, always with the
   coverage (components and volume); otherwise only category results. The indicator is a share of the estimated mass of the
   components that have one.
10. **B3 is context, not evidence:** the workspace counts how many components with a recovered quantity are covered by the active
    plan and says a plan does not show that anything has been removed.
11. **3D highlight uses B3's tint technique** (children of the existing meshes, following the A4 explosion), writes no material,
    colour or visibility, and has a fixed priority B3 simulation > B4 highlight > B2 colouring. It exists only while the workspace is
    open; B2 colouring is suspended while it is drawn. Opening the recovery or removal drawer closes the workspace; presentation mode
    closes it and exit restores it.
12. **One drawer, wider than the others (900 px, clamped to the viewport)** because up to three scenarios are compared side by side;
    "View model" folds it into a card. Outcome colours reuse B2's three Okabe–Ito hues, plus vermillion (disposal) and a grey hatch
    (unknown); no chart library, no new dependency.
13. **No carbon, cost, landfill or transport figure** (B5). **A dev-only hook** (`window.__scenarios`, `window.__scenarioOverlay`)
    supports the browser check and is absent from production builds.

## C2 Decisions (material reuse matching)
1. **A match is preliminary and rule-based.** The tier (strong / conditional / incompatible) is decided by the criteria, never by a
   threshold on the score; the score only orders candidates, its criteria and weights are shown and configurable, and the comparison
   states the formula with the actual numbers. No AI or hidden judgement; no claim of structural suitability, code compliance or fitness.
2. **Missing data is "unknown", and unknown keeps a match conditional.** It earns no points by default (editable credit), is listed under
   "information the project data does not hold", and is never read as a match. A requirement's own specifications that the model has no
   data for (grade, fire rating, certification) are listed and can never be verified, so they keep every candidate conditional.
3. **Eligibility follows B2.** Reuse and refurbish classifications are eligible; recycling is a blocker ("assessed for recycling, not for
   reuse"); not assessed / insufficient information / further assessment are conditional (the requirement can exclude them). The
   quantity of an unassessed component is the modelled upper bound, labelled as such; a reuse classification without a recovery % is
   unknown. A whole item (nr) needs a recovery estimate of 100 %: a fraction of one item supplies nothing.
4. **Condition is C1's observed condition only.** The record's `condition: "good"` is a generated default and is never used; a required
   condition with no observation is unknown; a component recorded as damaged is never matched.
5. **Units are never converted.** A requirement is in one B1 primary unit and only components measured in it match; totals are one line
   per unit. Door leaves are m2 in B1, so a count of doors does not match them (stated, not worked around).
6. **Sizes are compared by magnitude** (sorted extents: length, width, thickness), so orientation never matters; a size the component
   does not record is unknown. Only an oversize length or width can be cut down (if cutting is accepted); a thickness cannot.
7. **Allocation never double counts.** A component's allocations over all requirements are bounded by its supply, a requirement's by its
   demand, in the right unit; one allocation per (requirement, component); revising excludes the allocation's own quantity; an
   incompatible component cannot be allocated, a conditional one can with its conditions open. Allocations are reviewed against current
   data and flagged, never altered; allocations for components not in the model are kept and flagged.
8. **Suggestions are derived, not stored**, greedy in ranking order (larger supply first so fewer pieces are needed), respect other
   requirements' allocations, and become allocations only through the same validated path when the user confirms.
9. **Persistence stores inputs only** (requirements, allocations with the match at confirmation, weights); results are recomputed.
   Editing a requirement cannot change its unit while it has allocations or drop its quantity below what is allocated.
10. **3D uses the existing highlight** (B4/B5 tints on the existing meshes; two additive, backward-compatible fields: a per-match colour
    and an owner). Priority and lifetime are unchanged; the workspace closes when another drawer opens (watched by the store, so no
    existing opener changed). **Locate in 3D** folds the workspace and frames the camera, only on a user request; the folded workspace
    stays mounted so filters, selection and the active requirement survive.
11. **B5 is context only:** the source components' baseline carbon as B5 assesses it, never a saving. **Allocation records are shaped
    for C3** (stable ids, the planned quantity and unit, the match at confirmation) and exported with null recovered / reused outcomes.
12. **One wide drawer (900 px, clamped), no new dependency**, tokens from `src/ui/theme.css`; every status has a shape as well as a
    colour. **A dev-only hook** (`window.__reuse`) supports the browser check and is absent from production builds.

## C3 Decisions (recovery tracking)
1. **The record is an append-only history; everything else is derived.** Status, quantities, completion, flags and reports are recomputed from the events, so a stale or silently
   overwritten figure cannot be shown. A mistake is voided with a reason and stays visible; events recorded by the system (automatic stage changes, C2 changes) cannot be voided.
2. **Planned and actual are kept apart.** The plan is a snapshot of B2's estimate (B1 quantity x recovery %) taken when tracking starts, plus a plan the user states; B2 is read
   again only to show drift. Actual quantities exist only as events with a source (measured / estimated / assumed, chosen explicitly: no default). Nothing becomes "reused"
   because it was recovered or allocated: reused / recycled / disposed are outcome events with a quantity, and the stage rules refuse a stage the quantities do not support.
3. **Unknown is not zero.** Recovered is null until a recovered event exists; an explicit 0 is a recorded zero. Reports count records without a recovered quantity separately,
   exports write null / empty, the passport says "not recorded". Unaccounted material includes the whole quantity of a record whose recovery was never recorded.
4. **A conservation balance, in one unit.** R + L <= Q and U + C + X <= R; in hand, not yet recovered and unaccounted are derived, so moving material between stages cannot count it
   twice. The unit is the component's B1 primary unit (a changed unit is flagged, never converted); whole items are whole.
5. **Recovered above the available quantity needs a documented reconciliation.** A signed variance with a mandatory reason and source raises (or lowers) the effective available
   quantity of that record; B1 is never changed, and the variance is shown next to B1's figure.
6. **Assemblies and batches cannot double count.** One record per component id; an assembly is tracked through its parts; batches are id lists that hold no quantities, so
   overlapping batches change no figure. Reports are built from the tracked components, each once, and reconcile.
7. **C2 is followed, never overwritten.** Created / changed / cancelled allocations (including those changed while the app was closed) are appended as system events; an "Allocated"
   stage steps back by a logged event when the last allocation is cancelled; reuse recorded against an allocation is kept when it is cancelled. An allocation is fulfilled only by a
   recorded reused outcome. C3 reads C2 and never changes it.
8. **Integrity on load.** A history that does not replay to a possible state is dropped and counted (never repaired); records of components not in the model are kept and flagged.
9. **A fixed 10 % tolerance** marks a recovered quantity below / above plan; the difference is always shown as a number. Whole items are planned to the nearest item.
10. **No environmental saving is claimed**: B5's baseline per component is shown as context; the exports and report say so.
11. **3D and drawers as in C2**: the existing tint highlight (per-match colour, owner "tracking"), marks that follow the register, Locate + fold, exclusivity watched by the store,
    presentation mode closes and restores it. **The C1 passport gained a ninth section** (the only existing module extended: additive, with its tests and browser check updated).
    **A dev-only hook** (`window.__tracking`) supports the browser check and is absent from production builds.

