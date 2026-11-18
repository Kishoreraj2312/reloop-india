# Demo project & 10-minute tour

For a live presentation: one click fills every data-entry module with an illustrative demo project, and presentation mode's guided
demonstration becomes a 10-minute tour with one scene per module. Screenshots of every scene: `docs/screenshots/demo/`.

## Before the talk (expo machine)

1. **Just open the app.** An application that opens with nothing entered loads the demo project by itself (about a second), so
   Recovery, Removal, Scenarios, Carbon, Reuse and Tracking are already filled: nothing is typed or clicked during the talk. It does not
   load when you already have entries of your own, after **Exit demo**, or with `?demo=0`. `?demo=1` forces it; **Load demo data**
   (top bar) and **Present → Load demo project** load it by hand (for instance after Exit demo).
2. Check the dark **DEMO PROJECT · illustrative data** badge at the bottom left (in presentation mode: **DEMO DATA** next to Exit).
3. Press **Present**, then **Start 10-minute demo tour ›**. Use **→ / ←** (or Next / Prev); **F** for full screen; **Esc** leaves.
4. After the talk: leave presentation mode and press **Exit demo** → your own entries come back exactly as they were.

## The tour (4 steps, 11 scenes, about 55 s each)

| # | Scene | What is on screen | Say |
|---|---|---|---|
| 1 | Building | Hero view of the G+4 block | 87,380 components, each with a stable ID, geometry, material and assembly links. |
| 2 | Exploded | Floors separated | How it is put together; a display transform, data unchanged. |
| 3 | Services | One floor, plumbing + electrical, building ghosted | Pipes, conduits and cables are real parts, colour-coded by system. |
| 4 | Inventory | B1 drawer | Quantities and mass taken off the geometry, by material / floor / system. |
| 5 | Recovery | Model coloured by B2 classification | Reuse, refurbish, recycle per component, with a recovery %. |
| 6 | Sequence | B3 removal plan, top storey half stripped | 93 steps ordered by dependencies; the simulation hides what is out. |
| 7 | Scenarios | B4 comparison | Demolition 0 % vs deconstruction about 81 % diverted (by estimated mass). |
| 8 | Carbon | B5 drawer | Embodied carbon per scenario; factors are the labelled ILLUSTRATIVE set. |
| 9 | Passport | Close-up of a balcony handrail, inspector + passport | One component's passport, composed from every module. |
| 10 | Reuse | C2 allocation | Three receiving-project needs matched and allocated (128 components). |
| 11 | Tracking | C3 report | 152 components tracked; recovered vs planned, reused / recycled, 18 in progress. |

The toolbar's Data group also opens Scenarios, Carbon, Reuse and Tracking directly while the demo is loaded (for questions).

## What the demo writes (and what it does not)

Everything goes through the modules' own store actions, so validation, balances and every derived figure are exactly as for typed-in
data. Source: `src/demo/demoPlan.ts` (pure rules, unit-tested) and `src/demo/demoStore.ts` (loader).

- **B2**: about 12,050 assessments, the rules of B2's own starter sample (`src/engine/recovery/starter.ts`; see "Starter sample" in
  RECOVERY_ASSESSMENT.md) noted "Demo (illustrative)" instead: structure, masonry (interior partitions as refurbish-and-reuse), screed,
  concrete (balcony slabs as "further assessment"), stone, timber and laminate doors, metal frames and railings, glass, kitchen units,
  sanitary ware and appliances, covering about 97 % of the modelled mass. Conduit, pipe runs, ceiling boards, small hardware and the
  1,700 single balusters are left unassessed (storage budget; a real survey would also not assess everything). While the demo is
  loaded it replaces the starter sample; Exit demo gives the sample back with the rest of the user's own state.
- **B3**: three plans: "Demo: strip-out of F04" (the storey's door, window and balcony assemblies, 93 steps, the active plan, with the
  simulation stood about 65 % through when the app opens), "Demo: F03 balcony refurbishment" and "Demo: ground and F01 door reuse".
- **B4**: the three starter scenarios. **B5**: the existing labelled illustrative factor set (9 categories) plus five more placeholder
  factors (copper, CPVC, stainless steel, aluminium, bitumen), still "ILLUSTRATIVE PLACEHOLDER, no source": about 70 % of the
  components have a factor; conduit, appliances and some others stay "not assessed" on purpose.
- **C1**: inspection notes on twelve components across the storeys (good, fair, damaged, two surveys still scheduled), marked as demo.
- **C2**: six requirements of hypothetical receiving projects, quantities set from the model's own totals. Three are fully allocated
  (doors strong matches; railings and sills conditional, they need refurbishment); two later needs for the same doors and rails are
  only partly supplied (what the first needs left); one is open with matches listed and nothing allocated.
- **C3**: about 535 components tracked, spread over the stages of a project under way: F04 doors and handrails recovered and reused
  (linked to every C2 allocation they carry), F04 and F02 glazing recycled, F03 doors recovered and being inspected, F02 and F01 doors
  and F02 handrails recovered and allocated (or inspected), F03 handrails in progress, twelve F03 panes on hold, the first storey
  planned. Every quantity states its source; the share B2 does not expect to recover is recorded as an explicit loss, so the only
  flags are the in-progress and on-hold items. The localStorage budget is about 3 of roughly 5 million characters.

None of this is an assessment of a real building. The badge stays on screen while the demo is loaded, and Exit demo restores the
previous entries from a backup taken at load time (`rematter.demo.v1`).

## Checks

`npm run verify:browser:demo` (16 checks: load, labelling, backup, all 11 scenes, captions, tracking flags, console, exact restore; the browser checks start with the automatic load switched off, `launch({ autoDemo: true })` switches it on);
`src/demo/demoPlan.test.ts` (rules valid, > 90 % mass coverage, storage budget, every referenced component exists). Without the
demo loaded the application and the A5 guided demonstration are unchanged (A5 99 / 99, B3 106 / 106 re-run).
