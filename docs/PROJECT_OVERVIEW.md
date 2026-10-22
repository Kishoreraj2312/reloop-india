# ReLoop India — Project Overview

## Problem
Conventional demolition treats buildings as monolithic waste. Decision-makers lack
component-level visibility into what a building contains, making it difficult to
evaluate material recovery opportunities before dismantling.

## Solution
An interactive 3D digital twin linked to a material inventory and circularity
calculation engine. Users explore a G+4 residential building, inspect components,
simulate selective deconstruction, and compare recovery scenarios.

## Three Workstreams
- **Part A** — 3D Digital Twin: Detailed G+4 building with structural, architectural,
  plumbing and electrical systems; exploded-view animation; component selection.
- **Part B** — Engineering Engine: Quantity take-off, material passports, removal
  simulation with dependency chains, scenario comparison (demolition vs deconstruction),
  circularity and cost metrics.
- **Part C** — Integrated Application: Unified viewport + dashboard for expo
  demonstration.

## Core Principles
1. One stable ID links 3D object → registry → panel → inventory → calculations → reports.
2. Geometry and data come from the same generator. No fake totals.
3. Baseline records are immutable; scenarios are overlays.
4. All arithmetic is deterministic TypeScript. AI never produces numbers.
5. Inputs labelled assumed/estimated/measured. No claims of structural adequacy.
6. Per-component identity always reachable (no merged meshes).
7. Planning tool, not reuse certification.
