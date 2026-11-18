# ReLoop India — Digital Material Passports (C1)

A passport is a **view of one existing component**, keyed by its stable record id and composed on demand from what the application
already knows: the model record (A1–A3), the B1 quantities, the B2 assessment, the B3 removal plan, the B4 scenario outcomes and the
B5 carbon assessment. A passport stores nothing of those; the only data it owns is the user's own metadata. Every field carries a
**status** (recorded, calculated, estimated, assumed, user entry, missing) and a **source** (model, B1, B2, B3, B4, B5, user); a value
that is not available is `null` with status "missing" and a reason, never a made-up value.

```
src/engine/passport/   pure: types, meta (validated edits), build (compose a passport), export (JSON, CSV), persist, passport.test.ts (24 tests)
src/scene/passport/    passportStore (localStorage), usePassport (live inputs from the stores), PassportPanel, download
```

## What a passport shows
Nine sections (the ninth, **recovery tracking (C3)**, shows the component's tracking record and C2 reuse allocations; see RECOVERY_TRACKING.md): **identity & location** (name, id, type, system, floor, apartment / room, parent, network), **material** (material id
and name, B2 material category, B1 component category, density used), **dimensions & quantity** (record dimensions; recorded quantity;
B1 primary quantity with its method and status, derived measures, estimated mass; for an assembly the roll-up of its parts, each counted
once), **condition & inspection**, **recovery potential (B2)**, **removal status (B3)**, **sustainability (B4, B5)**, **provenance** and **recovery tracking (C3)** (stage, planned from B2, recovered / reused / recycled / disposed / not recovered with their source as the field status, unaccounted; "not tracked" when nothing is recorded; the C2 allocations with what was reused against them).
Eligible components are every record of the model: a leaf component gets the full passport, an assembly gets an assembly passport (parts
rolled up, B2 progress of its parts, notes). An id that is not a component returns "not a component of this model" instead of throwing.

Honesty rules visible in the passport:
- The record's `condition` ("good") and `recoveryRoute` ("inspect") are generated defaults and are labelled **assumed**, "not an
  inspection". Observed condition and inspection status are the user's, and read **missing** until entered.
- Model values (dimensions, material, location) are **recorded** with the record's confidence ("assumed"), and the passport says model
  values are design assumptions, not site measurements.
- B1 values are calculated or estimated as B1 says; a missing density shows the mass as missing with B1's reason.
- B2: not assessed is missing; a recovery % is the user's **estimate**; the recoverable quantity shows B2's own formula.
- B3: no plan / not in the plan / planned step are distinguished; the state note says it does not show that anything has been removed.
- B4: the outcome of the component under each compared scenario (B4's own allocation). B5: the baseline carbon with its factor origin and
  boundary, an ILLUSTRATIVE factor is flagged with a caution, and "not assessed: <reason>" otherwise.

## Editing and persistence
Editable (the user's own entries only): inspection status, observed condition, inspection date, inspected by, condition note,
provenance note. Validation: known enumerations, a real calendar date YYYY-MM-DD (1900–2100), notes up to 2,000 characters, names up to
120; an invalid edit returns the same state and an error. Entries are saved to `localStorage` (`rematter.passports.v1`, versioned JSON,
sparse, keyed by component id; invalid fields are dropped on load, blocked storage degrades to a session). Entries whose component is
not in the current model are **kept and reported** (with a "remove them" action), never silently lost. B1 quantities and the B2–B5
results are read-only in the passport, with a link to where B2 is edited.

## Export
One passport as **JSON** (`rematter.passport/1`: component, data-quality counts, cautions, disclaimer and every field with value, unit,
status, source, note; null for missing) or **CSV** (header `section,field,value,unit,status,source,note`, one row per field, RFC 4180
quoting, UTF-8 BOM so spreadsheets read ₂ and ³). Numbers are exported to 12 significant digits (no float noise). File name
`passport_<id>.json|csv`; the download is a Blob in the browser (no server).

## Integration
Selecting a component (a canvas click, the inventory, a link) opens its passport in the left column above the inspector, so the model
stays visible; "–" folds it to its header without touching the selection, camera or highlights. The panel is hidden in presentation
mode with the rest of the panels. The `parent` field is a link that selects the parent. Draw calls and the rendered model are unchanged.

## Limitations
- One passport at a time; no bulk export or import of the user's entries (they live in this browser only).
- Photos and document attachments are not supported; provenance is free text.
- Dimensions are the model's design values; B1 quantities are as accurate as the generated geometry.
- The passport is a record for planning and handover discussion, not a certified product passport (no standard schema such as an EU
  digital product passport is claimed).
