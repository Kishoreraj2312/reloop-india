# A5 — Visual Fidelity, Realism & Presentation Mode

Scope, method, decisions, measurements and limits of phase A5. Screenshots: `docs/screenshots/a5/baseline` (before) and
`docs/screenshots/a5/final` (after), taken from the running application by `scripts/browser/shotsA5.mjs` and
`scripts/browser/verifyA5.mjs`.

## Scope decision

The roadmap defined A5 as "Visual refinement & performance optimization". This phase keeps that scope and makes it concrete: realistic
materials, lighting and shadows, presentation-quality exploded views, a presentation mode with camera presets and a guided
demonstration, and measured performance. The A4 hand-over task ("profile the cinematic playback on real hardware") was done and is
reported in the measurements below. B4 (scenarios), B5 (carbon) and new geometry are not part of A5, and the guided demonstration has
**no sustainability step** because B5 does not exist (adding one is a data entry in `presentation/presets.ts`).

## 1. Baseline audit (what the audience saw before)

Baseline screenshots are in `docs/screenshots/a5/baseline`. The highest-impact weaknesses, in order:

1. **No figure / ground.** Building, ground plane and backdrop were all pale warm grey (about the same luminance); a 140 m square ground
   plane ended in a hard horizon edge against a flat backdrop.
2. **Flat light.** The key light sat almost behind the camera, so every visible facade had the same tone; the single shadow fell behind the
   building. Interiors in the isolated-floor view were blown out to white, with no gradation between floor, wall and ceiling.
3. **One colour per material, no surface.** Plaster, concrete, stone, tile and timber were uniform fills; glass was a flat translucent grey
   with no reflection. Structural members read as blue-grey steel rather than concrete.
4. **Exploded view.** The site plane vanished and a bare grid showed instead; the bar at the bottom covered the lowest floors until
   "Fit" was pressed; preset buttons jumped instantly; the shadow frustum was refitted but nothing grounded the stack.
5. **Interface.** Browser-default checkboxes and buttons, three different panel styles (translucent white, mono-spaced inspector,
   bordered bar), 3 / 4 / 5 px radii, no mode label and no way to present without the editing panels on screen.
6. **Default camera.** The default oblique looked at the north and east faces; the entrance, the balconies and the south facade (the
   building's best side) were not visible.

Baseline renderer numbers (hero view, headless Chrome on an Apple M3 Pro): 1,191 draw calls, 657,134 triangles with the MEP layers off;
1,556 calls / about 9.0 M triangles with every layer on; 13 shader programs; 3 textures.

## 2. Materials

Surface detail is a small shader patch on the **existing** `MeshStandardMaterial`s (`scene/surface/`): no new material class, no extra
pass, no extra geometry, no texture library. One shared 256 x 256 tileable noise texture is generated at start-up
(`noiseTexture.ts`, deterministic, four channels: blotches, mottling, fine grain, speckle).

| Class (by the material's assumed **substance**) | Treatment |
|---|---|
| Plaster and paint (masonry, lintels, balcony slabs, soffits) | faint tone wash, fine grain, very small bump, faint vertical weathering |
| Concrete (structure, GRC fins, precast) | mottling and sparse pores with a hint of roughness variation |
| Stone cladding | running-bond ashlar 0.6 x 0.3 m with 4 mm half-joints, per-block tone |
| Granite and polished stone | mineral flecks |
| Floor and wall tiles | per-tile tone (each tile is its own instance, so it follows the real tile), hairline darker rim for the joint |
| Roof finish | 0.6 m tile grid, per-piece tone |
| Timber (doors, frames, cabinets) | grain along the piece's longest axis, pores, per-door tone |
| Stainless steel, aluminium, railings | very faint brushed streaks, roughness variation only |
| Glass | Fresnel: near-clear looking straight through (the interior stays readable), more mirror-like at grazing angles |
| Ground | very low-contrast mottling |
| MEP (PVC, CPVC, GI, brass, conduit, cable, enclosures, devices) | **no texture**: they stay distinct by colour, roughness and metalness |

Rules that keep it honest and safe:

- **Assumed, not verified.** The class comes from the recorded `substance` / material id (what A2 and A3 ASSUME the surface is). It never
  changes a record, a dimension, a quantity or a material id, and the card and inspector still show `confidence: assumed`.
- **No swimming.** Pattern coordinates use the instance matrix only (never the group / model matrix), so A4 floor and system
  translations do not drag a texture over a surface; joint and grain patterns use the piece's own frame, so they travel with a piece
  that A4 decomposes. Per-piece tone uses `gl_InstanceID`, which neither A4 nor B3 rewrites.
- **Overlays stay exact.** B2 swaps materials for `clone()`s and B3 draws flat tints; a clone does not inherit the patch, so status
  colours are exact and flat, and switching an overlay off restores the textured original.
- **Reflectivity is limited where it misleads.** Glossy floor tiles and sanitaryware keep their gloss class but reflect less of the sky
  (`reflectionFor` in `surfaceSpecs.ts`), otherwise cut-away interiors read as a blue wash. The A2 / A3 library values are not edited.
- **Structure** keeps six warm-neutral concrete tones (footing darkest, slab palest) so members stay distinguishable.

## 3. Lighting, shadows, environment

- **Tone mapping:** Khronos PBR Neutral at exposure 1.0 (was ACES filmic, which desaturated plaster and timber).
- **Environment:** a procedural sky (`look/skyEnvironment.ts`): gradient dome, soft sun glow and two soft-boxes, prefiltered once by
  PMREM at intensity 0.62. It replaces three's indoor `RoomEnvironment`, whose light panels showed up in exterior glass. The dome used
  for light is calmer than the backdrop, so up-facing surfaces in shade do not get a blue cast.
- **Sun:** one directional light from the south-west at about 50 degrees (`look/palette.ts`): the entrance facade is lit, the east
  facade falls into shade and the shadow lands on the ground to the east, in view of the hero camera. 4096 shadow map, normal bias
  0.035; balconies, sunshades and the canopy cast readable shadows on the walls below them. A soft hemisphere light and the
  environment give the fill, so no shadowless second light leaks into interiors.
- **Backdrop and ground:** a vertical gradient (cool at the top, settling into the haze colour by mid-height) and a ground plane whose
  alpha fades radially into that haze colour (no horizon edge). The ground is mid-light grey, darker than the plaster, so the building
  separates without a cut-out look.
- **Exploded stage:** while A4 displaces anything, the ground becomes a stage: it drops below the lowest displaced point (set each frame
  by the explode controller), receives the stack's shadow and is never cut by it. The bare grid is shown only when the foundation
  floor is isolated.
- **X-ray:** ghosted materials no longer cast shadows (the services keep theirs), so the MEP view is not under a dark shadow of a
  building that is meant to be see-through.
- **Contact shadow:** a soft darkening decal around the footprint (nested rounded rectangles accumulated in a canvas, used as an alpha map)
  grounds the building where the sun shadow does not; one extra draw call, hidden while the model is exploded.
- Not added: global illumination, SSAO, bloom, post-processing passes. Each was weighed against the budget; the frozen shadow map plus
  the environment gives the depth that matters for this model at no per-frame cost.

## 4. Camera

- `?view=hero` (the new default when no `?view=` is given) is the south-east axonometric at about 30 degrees; `?view=full` is the
  unchanged north-east oblique (the A1 verification clicks at projected positions in that view).
- `framing.ts` gained `frameBoxInto`: frame a box into the part of the canvas that UI leaves free (toolbar, drawer, inspector), pure
  and unit-tested. The explode controller's own framing was refactored onto it; behaviour is unchanged.
- Camera flights (`presentation/cameraPath.ts`, `CameraDirector.tsx`) orbit around the target (azimuth the short way, distance in log
  space, ease-in-out cubic, no overshoot), 0.9 - 2.2 s. Any pointer, wheel or touch start on the orbit controls ends a flight where it
  is, and nothing ever moves the camera except a request (preset, step, Exit).

## 5. Exploded view (A4) presentation

- Preset buttons (`Assembled / Partial / Full`) and the presentation scenes **glide** (`explodeStore.glidePreset`): progress moves
  linearly in time and the solver's own smoothstep makes every offset an S-curve, so motion is controlled with no spring or overshoot;
  it ends at exactly the target value. Any direct change (slider, mode, Play, Reset, closing) cancels a glide where it stands. The
  progress slider and Play still act immediately; `preset()` is still the instant one used by tests.
- Changing mode inside the exploded view first closes the explosion in the old mode (0.6 s), then opens it in the new one, so no floor
  jumps between layouts.
- `explodeBridge.fitPose` computes the framing of the FINAL displaced model without applying it, so the camera flies there while the
  floors glide; the Fit / Focus buttons are unchanged (instant, as A4).
- Reset, closing the panel and Exit restore the exact canonical transforms (verified bit for bit by scene hash).

## 6. Presentation mode

Opened from **Present** in the controls panel. It is an interface layer over the one running viewer (one canvas, one scene, one set of
stores), not a second viewer.

- **Clean canvas.** The layer panel, the exploded-view bar and the inspector are hidden; drawers stay available. A mode label and an
  **Exit** button (Esc) are always visible. **Exit restores** the view state, section plane, selection, exploded view (exact
  parameters), drawers, recovery colouring and camera as they were (`presentation/presenter.ts`: `takeSnapshot` / `restoreSnapshot`).
- **Camera presets** (keys 1-7), framed from the actual scene bounds into the space the toolbar and any open drawer leave free:
  Hero (south-east axonometric), Front (south elevation), Plan (top storey, roof, ceilings and services removed, straight down), Floor
  (F02 isolated), Exploded (floors, framed), MEP (F01 isolated, services on, building ghosted), Section (cut along a column gridline).
- **Guided demonstration** (optional; nothing runs unless asked): 5 steps, 13 scenes: Complete building (axonometric, south elevation),
  Structure and architecture (structural frame, typical floor, section), Exploded assembly (floors, systems, cinematic), Plumbing and
  electrical (both, plumbing, electrical), Inventory and recovery (B1 drawer, B2 drawer). Captions are built from the live records
  (counts of components, columns, beams, windows, services), never typed in. Next / Previous (arrow keys), step segments and scene
  chips jump anywhere; **Repeat** (R) replays the transition; **Auto** (Space) advances every 9 s and pauses on any press, key or
  canvas touch; Exit at any time.
- **Honest data.** The recovery scene turns on B2 colouring only when assessments exist; with none, nothing is painted ("unassessed
  grey everywhere" would look like data). The drawers show B1 / B2 / B3 exactly as in the normal interface; presentation never creates
  a plan, an assessment or a dependency.
- **Compact component card** (top right, 300 px): name, ID, system, type, floor, material with its `confidence` tag (all A1-A3 records
  are `assumed`), and the B1 primary quantity with its status chip. **Details** shows the full inspector for the same component.
- **Controls:** F toggles full screen; D toggles details; the description card collapses to its title (the - button) on small screens;
  the framing is recomputed when the window changes size until the presenter moves the camera.
- **Small displays:** at 1366 x 768 the layer panel scrolls and **Present** sits at its top (it used to be the last button, below the
  fold); the toolbar, card, mode label and Exit do not overlap with a drawer open (checked at 1366 x 768 and 1920 x 1080).

## 7. Interface polish

One token set and one panel look for every panel and control (`src/ui/theme.css`): system sans for text, mono only for IDs, solid light
panels with a 1 px rule and one soft shadow, 6 px radius everywhere (was 3 / 4 / 5), dark-ink pressed / active state, one accent. The
layer panel, inspector and exploded-view bar use the shared classes; the B1 - B3 drawers keep their layouts and pick up the radius and
control styling. The selection outline is a calmer deep orange (0xd9531e at 28 % tint instead of 0xff5a1f at 35 %). No blur,
gradients, glows or decorative effects were added.

## 8. Files

New: `src/scene/look/{palette,skyEnvironment}.ts`, `src/scene/surface/{noiseTexture,surfaceSpecs,surfaceShader}.ts` (+ test),
`src/scene/presentation/{presets,cameraPath,cameraBridge,CameraDirector,presenter,PresentationMode,ComponentCard}` (+ css, tests),
`src/scene/inventory/inventoryStore.ts`, `src/scene/viewContext.ts`, `src/ui/theme.css`, `scripts/browser/{shotsA5,verifyA5}.mjs`.
Changed: `Viewer`, `Lighting`, `EnvironmentLight`, `SiteGround`, `BuildingModel` (X-ray shadows), `materials`, `arch/archMaterials`,
`framing` (+ `hero`, `frameBoxInto`, `VIEWER_FOV`), `explode/{explodeStore,ExplodeController,bridge,ExplodePanel}`, `ControlsPanel`,
`ComponentInspector`, `SelectionOutline`, `App`, `main`, `index.html`, and the radius of the shared drawer styles. **No new
dependencies.**

## 9. Measurements (Apple M3 Pro, headless Chrome 1600 x 1000, dpr 1; before = commit 75e82aa plus the uncommitted A4 work)

| | Before A5 | After A5 |
|---|---|---|
| draw calls, exterior, MEP layers off / all layers | 1,191 / 1,556 | 1,192 / 1,557 (+1: the contact-shadow decal) |
| triangles, exterior, MEP off / all layers | 657,134 / 9,007,734 (A4) | 657,138 / 9,007,738 |
| meshes / instanced meshes / instances | 1,555 / 609 / 83,420 | 1,556 / 609 / 83,420 |
| shader programs / textures / geometries | 13 / 3 / 86 | 22 / 7 / 90 |
| CPU time per frame (render submission, 30-frame median) | 1.5 ms | 1.5 - 2.4 ms |
| GPU time per frame (timer query, hero) | n/a | 3.9 - 6.4 ms over 4 runs; with the surface shaders swapped for plain materials on the same scene 4.3 - 6.3 ms: no consistent difference, inside the run-to-run noise (about 2 ms) |
| shadow frame (shadow map refreshed) draw calls | 2,370 | 2,371 |
| bundle (JS, minified / gzip) | 1,583 / 462 kB (A4) | 1,620 / 475 kB (+37 / +13 kB: presentation UI, shaders, tokens) |
| camera flight (1.5 s, presentation) | n/a | 133 frames, median 16.7 ms, p95 16.8 ms, max 33.3 ms |
| exploded glide (1.3 s) | n/a | 152 frames, median 16.7 ms, p95 16.8 ms; the first glide of a session has one 50 - 67 ms frame (A4 binds its runtime on first use; its grouping model is prewarmed in idle time when presentation opens, which took this from 117 ms) |
| cinematic playback, 9.4 s (the A4 hand-over task) | A4: 539 frames, median 16.7 ms, p95 17 - 18 ms | 566 frames, median 16.7 ms, p95 16.8 ms, max 16.8 ms; update 0.5 ms avg, 1.7 ms max, 271 meshes written per frame |
| exploded transform update | A4: 0.2 - 0.4 ms | 0.14 ms average, 1.0 ms max |

The budget (about 1,500 calls, about 3 M triangles for the exterior) holds with the same margin as before: the look is a shader patch,
a texture and one decal; it adds no building geometry. The cinematic profile showed no hot spot, so the per-frame instance rewrite and
shadow refresh were left as they are. Not measured: weaker GPUs (integrated, low-end laptops, a projector's PC) and real 4K output.

## 10. Verification actually run

- `npm run typecheck` clean; `npm test` **495 tests / 25 files pass** (new: 31 in `presets.test.ts`, 6 in `cameraPath.test.ts`,
  19 in `surface.test.ts`, 6 glide + 2 snapshot tests in `explodeStore.test.ts`, 3 in `framing.test.ts`); `npm run build` passes
  (bundle 1,620 kB, 475 kB gzipped; chunk-size warning only). `window.__reloop`, `__explode`, `__removal` and the `__pmDwell` test hook
  are absent from the production bundle.
- The tests run on the real model: every preset frames the real bounds of its floor / building into the space the toolbar leaves,
  scales with them, and leaves `DEFAULT_VIEW` untouched; guided captions quote the model's own counts; every library material gets a
  bounded treatment; every shader injection point exists in three's own standard-material source (a three upgrade that renames a chunk
  fails a test instead of silently turning the finish off); a cloned overlay material does not inherit the patch; the noise texture is
  deterministic, full-range and tileable.
- Browser (`npm run verify:browser:a5`, headless Chrome, **99 checks, all pass, console clean**): renderer and finishes by material
  class (and none on MEP); the draw-call and triangle budgets; records, materials, quantities, positions, rotations and sizes hashed
  before and after a full presentation run (identical); every sampled component displayed at its canonical position before and after;
  presentation clean canvas; hero framing from the real bounds; each of the five other camera presets (view state and framing, the
  plan checked against the real top-storey bounds); camera flights that a pointer press takes over; orbiting after a preset; the
  exploded preset (progress was between 0 and 1 mid-glide, exactly 100 % at the end, model fully framed above the toolbar); picking at the
  displayed position of an exploded floor; all 13 guided scenes through real Next clicks (each scene's effect on layers, isolation,
  exploded mode, drawers, colouring), Previous, step segments, scene chips, keyboard, Repeat, auto-advance and its pause on a canvas
  touch and on Space; compact card, Details, Clear; Inventory / Recovery / Removal drawers from the toolbar and the framing they
  leave; **Exit restores the view state, selection, exploded view (floors, 50 %), camera and a bit-for-bit scene hash**; normal-mode
  picking of a plain structural mesh and an instanced roof tile; B2 colouring's clone is plain and exact, and the textured original is
  restored; frame cadence during flights, glide and cinematic playback; layout at 1366 x 768 and 1920 x 1080.
- A1, A2, A3 (`verify`, `verifyA2`, `verifyA3`), B1, B2 re-run: all pass. A4: 78 / 78. B3: 106 / 106. Their screenshots were
  restored afterwards, so the earlier phases' images are untouched (the uncommitted A4-era changes to them are as before).
- Two intermittent failures during the run were my own: leftover backgrounded verification loops sharing Chrome's debugging port
  (never run two of these scripts at the same time); both disappeared when the scripts ran one at a time.

## 11. Defects found and fixed during the phase

- Exploded framing ignored the toolbar and drawer insets (`bottom` / `right` passed where the framing API wants `bottomInset` /
  `rightInset`); found by the browser check, fixed, with 28 px extra at the bottom for perspective.
- The layer panel was taller than a 1366 x 768 screen and its last button (Present) unreachable; Present moved to the top and the
  panel scrolls.
- The presentation toolbar container swallowed canvas clicks along the bottom strip; only the visible bar is clickable now.
- X-ray: a ghosted building still cast a dark shadow; ghosts cast none.

## 12. Known limitations

- **Surface finishes are appearance, not specification.** Plaster, stone coursing, tile and timber are chosen from assumed substances;
  coursing (0.6 x 0.3 m) and the roof tile grid (0.6 m) are not modelled dimensions. Close-ups at a few centimetres show the noise
  texture's scale; there is no bump-mapped joint depth on geometry.
- (Superseded by A* below: screen-space AO now shades corners and soffits.) No ambient occlusion in corners or under balconies other than the sun shadow and the contact decal; interiors rely on the sky
  environment and a hemisphere light, so deep rooms are evenly lit rather than naturally graded.
- The shadow map is frozen between changes (A4 design) and refreshed for each change; with a very large exploded frustum its edges
  are slightly stepped (visible in the shadow of the exploded stack).
- Glass transmits by plain transparency; reflections are of the procedural sky, not of the surroundings.
- Not verified: touch devices, mobile layouts, browsers other than Chrome, GPUs weaker than an M3 Pro, and an actual projector. The
  guided captions and counts are for the default building config.
- The first exploded glide of a session still has one 50 - 67 ms frame while A4 binds its runtime to the scene.
- Auto-advance uses one fixed 9 s dwell; there is no per-scene timing, narration or recording.
- B5 sustainability step: not available because B5 does not exist.

---

# A* — Architectural Realism & Cinematic Rendering

Builds on A5 (nothing above is replaced). Before = the A5 look (`docs/screenshots/a5/final`); after = `docs/screenshots/astar/after`,
from the same `scripts/browser/shotsA5.mjs` camera set; side-by-side composites in `docs/screenshots/astar/compare`. Every change is
appearance only: no record, ID, geometry, quantity, assessment or plan is touched, and the procedural finishes remain visual
representations, not verified material specifications.

## A*.1 Audit of the A5 renders (ranked by visual impact)

1. **No ambient occlusion.** Wall / slab junctions, balcony and canopy soffits, window reveals and the building's foot were evenly lit:
   the main reason the model read as CG.
2. **Glass read as opaque pale paper** (a light tint at 30 % opacity over brightly lit interiors, weak reflection).
3. **Featureless ground.** A uniform grey plane fading into grey haze: the building floated in a void with no site context.
4. **Hero too high** (about 30 degrees, frame including the buried foundations): the pale roof dominated the silhouette.
5. **Washed-out palette**: beige on grey haze, flat sky gradient, low figure / ground contrast.
6. **Muddy facade accents**: taupe-brown fins and bands against beige walls.
7. **MEP systems indistinguishable**: lighting / power conduits and cables in near-identical browns and charcoals.
8. **Interiors flat**, with a blue-grey sky cast on shaded floors at grazing angles.
9. **Exploded "systems" incoherent with the site**: the systems move in plan, the ground stays a flat field.
10. **Over-bright, uniform roof field.**

## A*.2 What changed

- **Rendering pipeline** (`look/PostEffects.tsx`): EffectComposer with a 4x MSAA half-float target carrying a depth texture,
  three's GTAOPass, and the OutputPass (tone mapping + sRGB). The R3F frame loop stays "demand"; the composer only replaces the
  final draw. GTAO reads the main render's own resolved depth (normals reconstructed from depth, exact for this box-built model),
  so it never re-renders the scene: the draw-call count is unchanged. Because AO sees exactly what was drawn, the section plane,
  hidden layers / floors and removal-hidden members are respected for free; glass, X-ray ghosts, decals and overlays write no depth
  (the selection outline / tint and the A4 trace lines were given `depthWrite: false`, invisible otherwise since they already
  ignore depth). AO is limited to a box around the building (`AO.clipMargin`, room for exploded floors and the stage); beyond it the
  ground, seen at grazing angles, would stripe. AO is sized to CSS pixels (a retina buffer adds cost, not detail). `?ao=0` turns it
  off, `?ao=debug` shows the AO term. Tuned values (radius 0.7 m, exponent 1.8, 16 samples, wide denoise) came from the debug view:
  a larger radius or a half-resolution buffer speckled the balusters and sill tops; 24 samples looked no cleaner.
- **Site** (`surface/groundShader.ts`, on the existing ground plane; no geometry): a 2.6 m paved apron in running-bond 600 x 300
  pavers with a kerb line, a 4.8 m forecourt path from the entrance steps, and planted ground with dry patches from two rotated noise
  octaves (no visible repeat), settling toward a pale tone with distance. While the exploded view is active the ground becomes a
  plain, light stage (`setGroundStage`), so displaced floors and systems never sit on zones they no longer line up with. The site
  layout is presentation only: there is no site survey.
- **Materials** (`MATERIAL_LOOK` in `look/palette.ts`, applied in `arch/archMaterials.ts` to the GPU material only; the library
  records keep their values): float glass is a darker green-grey tint at 52 % with strong sky reflection (interiors still readable
  straight on); a cleaner two-tone facade (warm white field, stone-grey bands, neutral grey GRC fins); a slightly weathered roof
  tile; MEP identification colours made distinct within the library's own hue families (cold water blue, hot water red, amber
  lighting, slate power, grey soil / vent).
- **Light and sky** (`look/palette.ts`): deeper zenith, brighter warm horizon, a calmer neutral environment dome (removes the blue
  cast on shaded interior floors), sun slightly lower and warmer, exposure 1.02.
- **Composition** (`framing.ts`, `presentation/presets.ts`): the hero direction is lowered to about 18 degrees (`[0.78, 0.42, -1]`)
  and hero / front frame only what is above finished grade (`aboveGrade`), with tighter margins: the facades carry the silhouette,
  the horizon sits in the frame, and the building fills more of it. The other five presets are unchanged in direction and gain the
  AO / site / material improvements; the exploded preset frames as before.
- **Tooling**: `vite.config.ts` pre-bundles three's post-processing modules with three (`optimizeDeps.include`, `dedupe`), which
  removed a "Multiple instances of Three.js" warning. `verifyA5.mjs` assertions that pinned A5 appearance numbers (exposure exactly 1,
  glass opacity < 0.5, programs <= 30, the old hero direction) were updated to the A* values; all functional checks are unchanged.

## A*.3 Before / after evidence

Same camera poses before and after (`shotsA5.mjs` for the exterior / close-up / exploded set, `verifyA5.mjs` for the seven
presentation presets). Composites (left A5, right A*) in `docs/screenshots/astar/compare/`: `cmp_00_hero_default`, `cmp_a5_pm_hero`,
`cmp_a5_pm_front`, `cmp_03_entrance_closeup`, `cmp_04_balcony_closeup`, `cmp_06_typical_floor`, `cmp_08_structure`,
`cmp_10_mep_closeup`, `cmp_12_exploded_floors`, `cmp_13_exploded_systems`, `cmp_a5_pm_{exploded,mep,section,floor,plan}`.

## A*.4 Measurements (Apple M3 Pro, headless Chrome 1600 x 1000, dpr 1)

| | A5 | A* |
|---|---|---|
| draw calls / triangles, hero, MEP off | 1,192 / 657,138 | 1,192 / 657,138 (AO reuses the main depth: no extra scene pass) |
| camera flight (presentation) | 133 frames, p95 16.8 ms | 133 frames, median 16.7 ms, p95 16.8 ms |
| exploded glide | 152 frames, p95 16.8 ms | 154 frames, median 16.7 ms, p95 16.8 ms |
| A4 cinematic playback (9.4 s) | 566 frames, p95 16.8 ms | 554 frames, median 16.7 ms, p95 16.8 ms, max 33.4 ms |
| bundle (JS, minified / gzip) | — | 2,034 / 593 kB for the whole app at the end of A* (includes B4 - C3; the post-processing modules are a small part) |

A first version rendered a separate AO G-buffer (the whole scene again): the draw calls doubled and the glide / cinematic p95 fell
to 33 ms. Reading the main pass's depth instead restored parity. Frame cadence in headless Chrome is vsync-bound at 60 Hz, so these
numbers show "no dropped frames", not head-room; weaker GPUs and 4K output were not measured.

## A*.5 Verification actually run

- `npm run typecheck` clean; `npm test` 746 tests / 30 files pass; `npm run build` passes; `window.__reloop` / `__post` are absent
  from the production bundle.
- Browser checks, each run alone (headless Chrome, port 9333), after the final code: A1 `verify`, A2, A3, B1, B2 clean (no
  failures, no console problems); A4 78 / 78; **A5 99 / 99**; B3 106 / 106; B4 111 / 111; B5 81 / 81; C1 58 / 58; C2 142 / 142;
  C3 139 / 139; zero page exceptions. (A4 and A5 were re-run after the last post-processing change.) The earlier phases'
  screenshots were restored afterwards.
- Visual checks on the actual renders: AO on / off / debug comparisons at the entrance and on the south elevation, the far-ground
  striping traced to AO (off: clean) and removed, the exploded stage, the seven presets, the B2 / B3 overlays and the selection
  tint on top of AO.

## A*.6 Defects found and fixed during the phase

- "Multiple instances of Three.js" once the post-processing modules were imported: fixed by pre-bundling them with three.
- AO speckle on balusters and sill tops (half-resolution buffer, 1.2 m radius): full CSS-pixel buffer, 0.7 m radius, wider denoise.
- Horizontal striping of the far ground and the exploded stage (depth-reconstructed AO at grazing angles): AO limited to a box
  around the building. A 32-bit float depth buffer also reduced it but was not kept; the box alone is clean.
- Paved apron left at the original footprint while the exploded systems moved onto lawn: the ground turns into a plain stage while
  exploded.
- Blue-grey sky cast on shaded interior floors: neutral environment dome.

## A*.7 Files

New: `src/scene/look/PostEffects.tsx`, `src/scene/surface/groundShader.ts`. Changed: `src/scene/look/palette.ts` (sky, light, site,
AO, `MATERIAL_LOOK`), `src/scene/arch/archMaterials.ts` (applies `MATERIAL_LOOK`), `src/scene/SiteGround.tsx` (site shader, stage
mode, finer fade), `src/scene/Viewer.tsx` (PostEffects, entrance for the path), `src/scene/framing.ts` (`HERO_DIR`, `aboveGrade`),
`src/scene/presentation/presets.ts` (hero / front framing), `src/scene/SelectionOutline.tsx` and `src/scene/explode/ExplodeTraces.tsx`
(`depthWrite: false` on overlays that already ignore depth), `vite.config.ts`, `scripts/browser/verifyA5.mjs` (four appearance
assertions). No new dependencies; no record, ID, geometry or engineering value changed.

## A*.8 Known limitations

- AO is screen space: it cannot darken what is off screen or hidden behind the camera, and it fades out at the edge of the AO box
  (about 45 m beyond the building). Deep interiors are still lit evenly by the sky environment (no global illumination).
- The site (apron, path, lawn) is a presentation backdrop, not a survey; the path length and apron width are assumed.
- Glass is transparency over the procedural sky; it does not reflect the surroundings or the building itself.
- Railings, window frames and other thin parts were left as modelled; no geometry was added (by design).
- MEP colours are display identification colours in the library's hue families, not a specification of pipe or cable colours.
- Not verified: GPUs weaker than an M3 Pro, real 4K / projector output, browsers other than Chrome.
