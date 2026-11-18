# ReLoop India — Embodied Carbon & Environmental Impact (B5)

A decision-support prototype, **not a certified whole-life carbon assessment**. It prices B1 quantities with emission factors the
USER supplies, prices the recovery pathways of the B4 scenarios under the user's assumptions, and says plainly what could not be
assessed. It cannot reconstruct the building's historical emissions from an incomplete inventory.

```
src/engine/carbon/    pure: types, factors (library, validation, illustrative demo set), collect (quantities per category in the factor's
                      unit + B4 allocation), price (baseline and scenario terms), assumptions (validated edits), sensitivity, component
                      (inspector / highlight ids), persist, carbon.test.ts (29 tests)
src/scene/carbon/     carbonStore (localStorage), CarbonDrawer, FactorTable, AssumptionsPanel, ScenarioCarbonView, CarbonInfo (inspector)
```

## Emission factors: none ship, none are invented
The repository holds no documented emission factors and none were added. The library **starts empty**: every category is "not
assessed" until the user enters a factor. A factor stores category, unit (kgCO₂e per kg / m³ / m² / m / item), value, source name,
reference, geography, assessment boundary, quality and origin (measured / sourced / estimated / assumed). A "sourced" or "measured"
value must name its source (validated). One optional button loads an **illustrative** demonstration set (nine categories that have a
mass, kgCO₂e/kg): order-of-magnitude placeholders with no source, labelled ILLUSTRATIVE in the library, the banner, the chart
(hatched bars), the inspector and every scenario result that uses them; editing a value turns it into the user's own. They are not
verified data and not Indian data.

## Calculation
- **Quantities:** B1 only; leaves only (assemblies are never rows, nothing is counted twice). A component counts toward a category
  only through a measure in the FACTOR'S unit: its primary quantity, a B1 secondary measure, or its mass (B1 density × solid volume,
  or the user's density override × a modelled m³ volume). No other conversion is made; components with no such measure are listed
  as "not assessed" with the reason.
- **Baseline:** `kgCO₂e = Σ quantity × emission factor` over the assessed components, per category, ranked; totals are kept per
  assessment boundary (never added silently), shown with the boundary and "not a whole-life result", with coverage by components and
  by mass. Reinforcing and structural steel are not modelled in B1, so concrete excludes reinforcement (stated in the workspace).
- **Scenario terms** (from B4's allocation of the same quantities, per material category):
  `avoided = recovered × replacement rate % × factor` (like-for-like replacement assumed),
  `processing = refurbished × refurbish impact + recycled × processing impact`,
  `transport = recovered mass [t] × distance × factor [kgCO₂e/t·km]`,
  `potential net benefit = avoided − processing − transport`.
  Recycling is credited only through its own substitution rate; disposal gets no credit; the haul of disposed material is reported
  apart and not netted. **Every input starts unset.** A missing input makes the term "Not assessed" (null) and the category's net
  not assessed; partial terms are never netted against complete ones; 0 is used only when the user enters 0. Components the scenario
  recovers from that have no quantity in the factor's unit (for example no mass) also make the category not assessed. The scenario
  total sums only categories whose net is assessed and states how many are not.
- **Sensitivity:** each input that is set is scaled ±20 % and re-priced (instant: only the small second stage re-runs); nothing is
  returned while no category has an assessed net. It shows how the figure moves with the user's inputs, not an uncertainty range.

## Workspace
Carbon drawer (900 px, one drawer at a time, "View model" folds it): baseline overview and warnings, factor table with source details,
ranked material breakdown, not-assessed list with reasons, scenario comparison (cards, per-category table, missing inputs, B4 mass
pathway bars), assumptions panel (global rates, transport, per-category refurbish / processing / density / rate overrides),
sensitivity. Clicking a category or "not assessed" row marks the real components in the 3D model with B4's tint highlight
(teal = assessed, grey = not assessed); the inspector gains a "carbon" line (quantity × factor, origin and boundary, or why not).
Factors and assumptions are saved in `localStorage` (`rematter.carbon.v1`, versioned; invalid values are dropped to "not set", a
"sourced" value that lost its source is downgraded to "assumed"). B1, B2, B3 and B4 data are only read.

## Limitations
- No factor is supplied; results exist only after the user enters factors and assumptions, and are only as good as those inputs.
- Only the lifecycle modules a factor states are covered; there is no use-phase, end-of-life processing database, biogenic or
  grid-mix modelling. Replacement is like-for-like with the category's own factor.
- Components without a density are outside mass-based factors and transport (MEP, fixtures, finishes without a density).
- One set of assumptions applies to all compared scenarios; there is no per-scenario assumption set.
