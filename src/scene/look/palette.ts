/**
 * Presentation palette and light rig numbers (A5, retuned in A*). Appearance only: nothing here is building data.
 * Colours are sRGB hex; the sun direction is a unit vector pointing FROM the building TOWARD the sun.
 * World axes follow the model: +x east, -z south (the entrance and the south balconies are at z < 0), +y up.
 */

export const SKY = {
  zenith: 0x7f9cbd,
  horizon: 0xd9dcd8,
  /** The colour the ground fades into; also the lower half of the backdrop, so the horizon never shows an edge. */
  haze: 0xcfd0c8,
  below: 0x8a8272,
  /** The dome used for image-based light is calmer than the backdrop: up-facing surfaces in shade get a neutral sky, not a blue cast. */
  envZenith: 0xb9c0c4,
  envHorizon: 0xdcd8cd,
} as const;

export const GROUND = {
  /** Base tone of the site beyond the paving (muted, dry lawn; zone colours below). */
  color: 0xffffff,
  /** Radius (m) of the opaque centre and of the full fade-out. */
  solidRadius: 85,
  fadeRadius: 300,
} as const;

/**
 * Site zones painted by the ground shader (presentation only: no site survey exists). A paved apron around the plinth and a
 * forecourt path from the entrance steps, then planted ground. Colours are linear-light friendly sRGB hex.
 */
export const SITE = {
  paver: 0xb9b3a8,
  paverAlt: 0xb1ab9f,
  kerb: 0x8c877e,
  lawn: 0x8b9a6c,
  soil: 0xa39a82,
  /** Width (m) of the paved apron around the footprint, and half-width of the entrance path. */
  apron: 2.6,
  path: 2.4,
  /** Paver module (m). */
  paverSize: [0.6, 0.3] as const,
} as const;

/** Sun from the south-west: the south facade (entrance, balconies) is lit, the east facade falls into shade, and the shadow lands on the ground to the east, in view of the hero camera. */
const SUN_RAW = [-0.5, 0.78, -0.62] as const;
const SUN_LEN = Math.hypot(...SUN_RAW);
export const SUN_DIR = [SUN_RAW[0] / SUN_LEN, SUN_RAW[1] / SUN_LEN, SUN_RAW[2] / SUN_LEN] as const;

export const LIGHT = {
  sun: 0xfff1df,
  sunIntensity: 3.1,
  fill: 0xc9d9ef,
  fillIntensity: 0.55,
  hemiSky: 0xeef0ee,
  hemiGround: 0xa89d88,
  hemiIntensity: 0.36,
  environmentIntensity: 0.68,
  exposure: 1.02,
} as const;

/** Screen-space ambient occlusion (look/PostEffects.tsx). Radius and thickness are world metres. */
export const AO = {
  radius: 0.7,
  thickness: 1.2,
  /** Exponent on the AO term (> 1 deepens it). */
  power: 1.8,
  /** AO and denoise samples per pixel (16 keeps the A4 cinematic playback at 60 fps on an M3 Pro; 24 was visibly no cleaner). */
  samples: 16,
  /** AO is limited to the building bounds grown by [horizontal, below, above] metres (covers the exploded floors and systems). */
  clipMargin: [45, 40, 80] as const,
  /** How strongly the AO term multiplies the image (0..1). */
  intensity: 1,
  /** AO buffer size relative to the CSS-pixel canvas (0.5 = a quarter of the pixels; below 1 the denoised term speckles on thin ledges). */
  resolution: 1,
} as const;

/**
 * Presentation overrides of library render values (by material id). The library records keep their values (passports and
 * quantities never read these); only the GPU material changes, for a more convincing response under the A* light rig.
 *  - glass: a darker, slightly green float-glass tint with strong sky reflection; interiors stay visible straight on.
 *  - facade accent bands and plaster: a cleaner two-tone (warm white field, stone-grey bands) instead of beige on taupe.
 *  - MEP identification colours: clearer hues so cold / hot water, soil, vent, lighting and power runs read apart at a glance
 *    (same hue families as the library's identification colours).
 */
export const MATERIAL_LOOK: Readonly<Record<string, { color?: number; roughness?: number; opacity?: number; envMapIntensity?: number; metalness?: number }>> = {
  glass_clear: { color: 0x41565c, opacity: 0.52, roughness: 0.03, envMapIntensity: 2.4 },
  masonry_paint_ext: { color: 0xede8de },
  lintel_rcc_ext: { color: 0xe8e2d7 },
  concrete_band: { color: 0xbdb8ae },
  concrete_fin: { color: 0x8b8984 },
  concrete_balcony: { color: 0xe2ddd3 },
  roof_finish: { color: 0xbfbcb4 },
  metal_railing: { color: 0x34383d, roughness: 0.42 },
  cpvc_cold: { color: 0x3f7fb4 },
  cpvc_hot: { color: 0xb5473a },
  gi_pipe: { color: 0x7d93a3 },
  upvc_swr: { color: 0x6f7377 },
  upvc_vent: { color: 0xb4b8ba },
  conduit_lighting: { color: 0xc98a2e },
  cable_lighting: { color: 0xd19a3c },
  conduit_power: { color: 0x3d4a5c },
  cable_power: { color: 0x46536d },
};
