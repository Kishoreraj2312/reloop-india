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

## Known Limitations
- Browser visual verification not performed in A0 (Playwright unavailable in env).
  Build + typecheck confirm code correctness; manual browser check recommended.
- Three.js bundle ~1.1 MB gzipped 311 KB — acceptable for desktop expo demo.
  Code-splitting can be added if needed.
- No lint tool configured yet (can add ESLint in A1 if desired).
