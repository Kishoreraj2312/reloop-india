# ReLoop India — Exploded View & Assembly Decomposition (A4)

A4 takes the assembled building apart on screen: floors separate vertically, the four systems separate horizontally, and
supported assemblies come apart into their layers, all driven by one progress value and fully reversible. It is a
**visualization layer**. It reads the registry and the generated records and never writes to them, to B1 quantities, B2
assessments or B3 removal plans, and it never performs a removal. It extends the one viewer; it adds no dependency, no
geometry and no second renderer.

```
src/engine/explode/    pure: types, config, ease, assemblies (rules), model (groups, bounds), offsets (solver), bounds
src/scene/explode/     explodeStore, ExplodeController (the 3D side), groups (floor/system drivers), instances (assembly driver),
                       ExplodePanel, ExplodeInfo (inspector line), ExplodeTraces, bridge (camera requests), model
scripts/explode/       census scripts behind the grouping rules (npx vite-node scripts/explode/census*.ts)
scripts/browser/verifyA4.mjs   real-browser check (npm run verify:browser:a4)
```

## Principles (and how each is met)

1. **The explosion is a derived display transform, never stored.** State is a few numbers (mode, progress, gaps, layout, focus).
   Closing the panel resets them; nothing is persisted.
2. **Displayed = f(canonical, parameters), recomputed from scratch.** `ExplodeSolver.solve()` rebuilds every offset from the
   canonical model and the current parameters; nothing is added to an already-displaced position. Instance matrices are
   rewritten from the generated (canonical) matrices, group positions from the solver.
3. **Parameter 0 restores bit-exact canonical transforms.** Offsets are exactly `+0` (`-0` is normalised away), group positions
   are set to exactly `(0, 0, 0)`, and instance translations are copied from the canonical array, not recomputed. Tests compare
   bit patterns after random 80-step and 100-step sweeps; the browser check does the same on the running scene (80 sampled
   components, every group, and a hash of every instance matrix and visibility flag).
4. **IDs, dimensions, materials, quantities and instance→component maps are untouched.** Only group positions and translation
   elements 12–14 of instance matrices are written; `mesh.userData.componentIds`, `registry` links and `mesh.count` never change.
5. **No duplicate geometry, no random directions, no invented ownership.** Draw calls and triangles in every exploded view equal
   the assembled view's (A5: the site plane stays drawn as the stage under the displaced model, one draw call, as in the assembled view).
6. **`parentId`, `dependencies`, containment, support and connectivity are not interchangeable** (see Grouping).

## Modes and controls

The panel is a compact bar at the bottom of the canvas (opened with "Exploded view" in the controls panel). Every control
changes the real display; one that cannot apply is disabled and says why in one line.

| Control | Behaviour |
|---|---|
| **Assembled / Floors / Systems / Assembly focus / Cinematic** | the mode; "Assembled" is the exact canonical view |
| **Progress** (0–100 %), **Play ▶ / Pause**, **loop**, **Assembled / Partial / Full** | one master parameter; Play animates it (9 s cinematic, 4 s otherwise) and reverses when started from the end; scrubbing pauses |
| **Floor gap / System gap / Layer gap** | distances (6 m / 6 m / 0.3 m by default); disabled when the mode does not use them |
| **Systems**: layout (2 × 2 grid, row along X, row along Z) and per-system checkboxes | which systems take part and how they are arranged |
| **Assembly**: shows what the selection belongs to and whether it can be decomposed; **Focus this assembly**, **Frame assembly**, member list | the assembly decomposed in "Assembly focus"; members are listed and clickable |
| **Fit to exploded view**, **Focus selection** | camera requests (the only things that move the camera) |
| **Isolate its floor / its system**, **Show all** | the existing floor isolation and layer toggles, set from the selection |
| **trace lines** (default off) | a line per member of the inspected assembly from where it would sit assembled to where it is |
| **Reset** | assembled, default distances |

Disabled with a reason, for example: progress while assembled ("Choose Floors, Systems, …"), progress in Assembly focus before
an assembly is chosen, distance controls the current mode does not use, "Focus this assembly" for a structural member ("no
assembly records") or a pipe ("network container …").

## Grouping rules (census of the generated model, 87,380 records)

| Level | Rule | Facts |
|---|---|---|
| **Floor** | the record's explicit `floor` field (−1 foundation, 0..4, 5 roof): exactly the scene's `Floor_<key>` groups | all 87,380 have one; 0 records are more than one storey from their floor's band. A storey group holds its floor slab and beams (at the bottom), the columns above them, its walls, fixtures and services, so nothing separates from what it rests on *inside* a floor. The interface between storeys (a beam sitting on the column below) is where floors separate. |
| **System** | the record's `system`: exactly the scene's `<floor>_<system>` groups | structure 945 (all plain meshes), architecture 47,812, plumbing 8,560, electrical 27,048 (all instanced) |
| **Category** | the record's `assembly` name (the scene's category groups) | used for bounds and visibility only |
| **Assembly** | an assembly *record* (a `group`) and its contained members | 3,015 assembly records, 83,420 members; every member's `parentId` is its assembly and lies inside its envelope (0 exceptions), assemblies are not nested, and a member always shares its assembly's floor |

What is **not** used: `dependencies` (support, hosting, flow) and `connectedTo` (joints) never define membership. The only
dependency read is the explicit hosting link of an opening to its host wall assembly, and only to find the wall normal. A1
`parentId` ("member beneath") is not containment (its parent is not a group) and is ignored here.

**Structure has no assembly records** (945 members, floor / system / category grouping only), so it is never decomposed.

### Assembly decomposition rules

Members of a supported assembly are layered along an axis derived from real geometry; layers are single-linkage clusters of
member centres (1 cm tolerance), centred, and spaced by the layer gap (capped so one assembly spreads at most 1.5 m).
A wall-tiling room moves each wall's panels radially away from the room centre in plan.

| Assembly type | Count (supported) | Axis |
|---|---:|---|
| window, door | 171, 264 | the host wall's normal: the thin horizontal axis of the host wall assembly's envelope (own envelope if there is no host) |
| floor finish | 370 | Y (screed, tile, skirting) |
| kitchen, bathroom, utility appliances | 29, 79, 29 | Y (build-up by height) |
| balcony, balcony canopy | 24, 6 | Y |
| ceiling, ceiling fixtures | 137, 137 | Y (the rest have a single layer) |
| facade, entrance, stair finish, parapet, plinth, shaft upstand, roof enclosure | 24, 1, 15, 4, 1, 1, 1 | Y |
| distribution board | 34 | the board's depth (thin horizontal axis of its envelope) |
| wall tiling | 79 | radial in plan |

**1,406 of 3,015 assemblies (44,275 of 83,420 members) can be decomposed.** The other 1,609 each carry a reason:

| Not decomposed | Count | Reason |
|---|---:|---|
| wall assemblies | 902 | the pieces of one wall tile a single plane: no layered build-up |
| ceilings / ceiling fixtures with one layer or one member | 228 + 228 | nothing to separate |
| cased openings, roof finish, roof drain | 5 + 1 + 1 | all members share one layer |
| network containers (cold / hot water, drainage, vent, rainwater, sewer, conduits, cables, distribution, earthing, cable trays) | 36 + 29 + 31 + 18 + 8 + 2 + 34 + 34 + 7 + 6 + 5 | members run in every direction, so no single decomposition axis exists; stack and run segments already separate with their floors |
| wiring devices | 34 | spread across the whole floor with no common axis |

The panel lists these, with their reasons, under "what can be decomposed".

## Offset math

For a component `c` on floor index `k` (relative to the anchor floor L0, so foundation = −1, roof = +5) in system `s` and
assembly `a`:

```
offset(c) = floorOffset(k) + systemOffset(s) + assemblyOffset(a, c)           (world vectors; additive, order-independent)
floorOffset(k)     = (0, k · floorGap · e_floors, 0)
systemOffset(s)    = arrangementDelta(s) · e_systems                           (horizontal)
assemblyOffset     = unit(c) · gapFor(a) · e_assemblies                        (unit(c): axis × layer index from the middle,
                                                                                or a radial unit direction)
gapFor(a)          = min(layerGap, maxSpan / (layers − 1))                     (layers) | layerGap · radialFactor (radial)
e = ease(window(t)),  ease(x) = x²(3 − 2x)  (exactly 0 at 0 and exactly 1 at 1; monotonic)
```

* **Modes:** Floors, Systems and Assembly focus use the whole `[0, 1]`; Cinematic uses the staged windows floors `[0, 0.40]`,
  systems `[0.35, 0.75]`, assemblies `[0.70, 1]` (configurable in `config.ts`), all driven by the one progress value. In
  Assembly focus only the chosen assembly moves.
* **System arrangement:** computed from the actual plan bounds of each system over all floors plus the gap: columns and rows
  are sized by their widest/deepest member, spaced by the gap, and the arrangement is re-centred on the assembled union, so the
  exploded model stays where it was. 2 × 2 grid (structure, architecture / plumbing, electrical) by default; a single row of
  four would be about 178 m wide (row along Z: 152 m), the grid is about 91 × 75 m.
* **Defaults (tuned on the running application):** floor gap 6 m (adjacent floor groups overlap by up to 3.6 m assembled
  because services reach into the next storey; 6 m leaves 2.4 m clear), system gap 6 m, layer gap 0.3 m (at most ±0.75 m for
  any assembly), full cinematic bounds about 92 × 60 × 76 m.
* **Degenerate directions:** a radial member within 5 cm of the assembly centre uses the assembly's default axis (the longer
  horizontal axis of its envelope); an assembly with fewer than two distinct layers/directions is not decomposed (listed with the
  reason). Nothing is random.

## How it is applied (and why it composes)

| What | How | Consequence |
|---|---|---|
| **Floor / system offsets** | translate the existing `Floor_*` and `<floor>_<system>` groups (`GroupDriver`; only groups whose offset changed are written) | plain meshes, instanced batches, B3 tint meshes, selection outlines, picking, frustum culling, clip planes and shadows all follow through world matrices; canonical local transforms are never edited |
| **Assembly offsets** | write translation elements 12–14 of the instance matrices from the canonical array (`InstanceExplosion`; only meshes with moving members, only dirty ones, one `needsUpdate` each) | the linear part of the matrix is not touched |
| **Instance matrix ownership** | explosion owns elements 12–14; B3's removal overlay owns elements 0–11 and 15 (zero scale = removed) | a B3-hidden instance stays hidden while exploded; B3 restores its linear part without touching the explosion |
| **Copies of instances** | B3 tint meshes and selection outlines register as *followers* with their own canonical copies | every copy moves with its source and returns exactly |
| **Culling / picking of displaced instances** | the mesh's bounding sphere is grown by the largest displacement and restored to exactly its original radius at parameter 0 | a click resolves to the displaced component and not to the empty canonical position |
| **Shadows** | the key light and its shadow frustum are refitted to the displaced bounds and the frozen shadow map refreshed with each change; exact original values restored at parameter 0 | shadows stay correct while exploded |
| **Ground** | the presentation-only site plane is not hidden (A4 hid it): while anything is displaced it becomes the stage and drops below the lowest displaced point, so the stack stands on it and casts its shadow on it instead of being cut by it (A5) | not a component |
| **Camera** | never moved by a parameter change; *Fit* and *Focus* frame the displayed bounds of the **visible** groups in the free part of the canvas (not under the bar, drawers, layer panel or a tall inspector); the orbit limit is raised while displaced | |

Appearance layering, bottom to top: base material → B2 recovery colour → B3 removal status → selection. The explosion is a
transform-only layer, orthogonal to colour. B2's colour overlay is still suspended while B3's overlay is shown (as before A4).

Layer toggles, floor isolation and X-ray keep working while exploded (isolated floors stay at their exploded position; hidden
groups do not count for Fit). **Section views** (`?view=section` / `stair` / `clip=…`) use world-space planes, so they cut the
*displayed* geometry; that is no longer a building-relative section, and the panel says so. Return to Assembled for that.

## Verification

* `npm run typecheck`; `npm test` (57 new tests): `explode.test.ts` (29: grouping against the real scene tree, assembly
  membership and rules, monotonic and additive offsets, floor groups disjoint at full explosion, systems never overlapping in
  every layout, bit-exact zero), `drivers.test.ts` (16: instance driver and group driver on the real batches: bit-exact reset
  after random cycles, B3 composition, followers, bounding sphere and raycast of displaced instances and of plain meshes in a
  displaced group), `explodeStore.test.ts` (12: playback, loop, throttled commits, clamping, reset).
* `npm run verify:browser:a4` (78 checks on the running app, headless Chrome, with screenshots in `docs/screenshots/a4/`):
  offsets of 80 sampled components in every mode against independently computed formulas, a 21-step cinematic sweep, real clicks
  at the displayed position of structure, architecture, plumbing and electrical components (and not at the canonical one),
  floor isolation, layer toggles, X-ray, section clip, B2 colouring and the B3 overlay on and off in both orders, a
  60-action random sweep then Reset (bit-identical), reload, playback frame cadence, console clean.
* A dev-only hook `window.__explode` (canonical vs displayed positions, group positions, bounds, update cost) is excluded from
  production builds.

## Performance (measured on the running application, headless Chrome)

| | Before A4 | A4 inactive / opened at 0 % | Exploded (after Fit) |
|---|---|---|---|
| draw calls / triangles (steady) | 1,556 / 9,007,734 | identical | 1,555 / 9,007,732 (ground plane hidden) in floors, systems and cinematic (A4); with A5 the ground stays drawn, so the exploded count equals the assembled count |
| draw calls on a shadow frame | 3,100 | identical | 3,099 |
| idle frames per second | 0 | 0 (also after closing) | 0 once playback ends |
| render + GPU finish, mean per frame (alternating fresh page loads, 8 loads, 120-frame batches) | n/a | never opened **5.84 ms** (sd 1.34) vs opened then closed **5.85 ms** (sd 1.33) | same geometry, so the same order (page-to-page GPU variation of about 1.3 ms dominates) |
| update cost (solve + groups + instances) | n/a | n/a | floors / systems: about 0.2 ms (11 group writes); cinematic phase 3: about 270 meshes written, 0.4 ms average, 0.7 ms max over a 9 s playback |
| playback, cinematic 9 s | n/a | n/a | 539–540 frames at a median 16.7 ms, p95 17–18 ms; one 58 ms outlier in the last run (18.9 ms max in the run before) |

A4 inactive costs the same as before: the controller's per-frame callbacks return immediately, batches only register their
canonical matrices when they mount, and the viewer renders no frames while idle.

## A5 additions (presentation quality)

* **Glide.** The `Assembled / Partial / Full` buttons and the presentation scenes move the progress with `explodeStore.glidePreset`
  (linear in time; the solver's smoothstep makes every offset an S-curve; no overshoot; exactly the target at the end). Any direct change
  cancels it where it stands; `preset()` stays instant for tests and scripts.
* **Stage.** The site plane follows the lowest displaced point each frame (set by the controller through `placeGroundStage`), receives the
  stack's shadow, and is restored to grade when nothing is displaced.
* **Framing.** `explodeBridge.fitPose` returns the framing of the final displaced model without applying it, so a camera flight and the
  explosion can run together; Fit / Focus are unchanged. Framing is `framing.ts: frameBoxInto`.
* **Looks.** Finishes, sky environment and light are A5 (see PRESENTATION_AND_VISUALS.md); the cinematic playback was profiled for A5
  (566 frames over 9.4 s on an Apple M3 Pro, median 16.7 ms, p95 16.8 ms, max 16.8 ms; update cost 0.5 ms average, 1.7 ms max, 271
  meshes written per frame in the assembly phase), so no change to the playback or shadow refresh was needed.

## Limitations

* Decomposition covers 1,406 of 3,015 assemblies; structure, walls and the MEP network containers are not decomposed (reasons
  above). There is no "isolate this assembly" that hides everything else: use the floor and system isolation, which are the
  existing mechanisms, plus the focus and members list.
* The assembly gap is one global value; the maximum spread per assembly is capped, so very layered assemblies (kitchens: 17
  layers) separate by small steps.
* Section planes are world-space and are not adjusted to the displaced geometry.
* The system arrangement spaces the *whole-model* bounds of each system, including site items outside the footprint (the
  plumbing system includes the external sewer), so its column is wider than the building.
* Trace lines show positions only, for the inspected assembly only.
* Displaced bounds used for Fit pad assembly spread by the largest displacement rather than per assembly.
