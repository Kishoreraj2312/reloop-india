import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from "three";
import { modelRecords } from "@/engine/quantities";
import { ExplodeSolver, buildExplodeModel, defaultParams, EXPLODE_MODES, type ExplodeParams } from "@/engine/explode";
import { buildBatches } from "../arch/batches";
import { hideInstance, restoreInstance } from "../removal/hide";
import { GroupDriver } from "./groups";
import { InstanceExplosion } from "./instances";

const recs = modelRecords();
const model = buildExplodeModel(recs);
const batches = buildBatches(recs);
const P = (o: Partial<ExplodeParams> = {}): ExplodeParams => ({ ...defaultParams(), ...o });
const geo = new BoxGeometry(1, 1, 1);
const mat = new MeshBasicMaterial();

function mesh(b: (typeof batches)[number]): InstancedMesh {
  const m = new InstancedMesh(geo, mat, b.ids.length);
  m.instanceMatrix.array.set(b.matrices);
  m.computeBoundingSphere();
  m.userData = { componentIds: b.ids };
  return m;
}
/** Bit-for-bit equality (also tells -0 from +0 and compares NaN payloads). */
const identical = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

/** A driver with every real batch registered, as the viewer would have after mounting. */
function rig() {
  const driver = new InstanceExplosion();
  const meshes = batches.map((b) => ({ b, m: mesh(b) }));
  for (const { b, m } of meshes) driver.register(m, b.ids, b.matrices);
  driver.attachModel(model);
  return { driver, meshes };
}
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

describe("instance driver (assembly decomposition)", () => {
  it("registering and attaching the model changes nothing until a factor is non-zero", () => {
    const { driver, meshes } = rig();
    const s = new ExplodeSolver(model).solve(P({ mode: "floors", t: 1 })); // floors only: no assembly factors
    expect(driver.apply(s.assemblyFactor)).toBe(0);
    for (const { b, m } of meshes) expect(identical(m.instanceMatrix.array as Float32Array, b.matrices)).toBe(true);
  });

  it("writes canonical + unit x factor to the translation of decomposable instances, and nothing else", () => {
    const { driver, meshes } = rig();
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    expect(driver.apply(s.assemblyFactor)).toBeGreaterThan(100);
    let moved = 0;
    for (const { b, m } of meshes) {
      const a = m.instanceMatrix.array as Float32Array;
      b.ids.forEach((id, i) => {
        const o = i * 16;
        for (const j of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]) expect(Object.is(a[o + j], b.matrices[o + j])).toBe(true); // linear part untouched
        const asm = model.memberAssembly.get(id);
        if (asm === undefined) {
          for (const j of [12, 13, 14]) expect(Object.is(a[o + j], b.matrices[o + j])).toBe(true); // not decomposable: untouched
          return;
        }
        const u = model.memberUnit.get(id)!;
        const f = s.assemblyFactor[asm]!;
        for (let k = 0; k < 3; k++) expect(a[o + 12 + k]!).toBeCloseTo(b.matrices[o + 12 + k]! + Math.fround(u[k]!) * f, 4);
        if (f > 0) moved++;
      });
    }
    expect(moved).toBeGreaterThan(20000);
  });

  it("zero drift: after many random parameter changes, parameter 0 restores bit-identical matrices and spheres", () => {
    const { driver, meshes } = rig();
    const radius0 = new Map(meshes.map(({ m }) => [m, m.boundingSphere!.radius]));
    const s = new ExplodeSolver(model);
    const rnd = lcg(7);
    const focusable = model.assemblies;
    for (let i = 0; i < 80; i++) {
      const mode = EXPLODE_MODES[Math.floor(rnd() * EXPLODE_MODES.length)]!;
      s.solve(P({ mode, t: rnd(), assemblyGap: 0.05 + rnd() * 0.5, focus: focusable[Math.floor(rnd() * focusable.length)]!.id }));
      driver.apply(s.assemblyFactor);
    }
    s.solve(P({ mode: "cinematic", t: 0 }));
    driver.apply(s.assemblyFactor);
    for (const { b, m } of meshes) {
      expect(identical(m.instanceMatrix.array as Float32Array, b.matrices)).toBe(true);
      expect(m.boundingSphere!.radius).toBe(radius0.get(m));
    }
  });

  it("assembly focus moves only the focused assembly's members", () => {
    const { driver, meshes } = rig();
    const a = model.assemblies.find((x) => x.type === "kitchen_assembly")!;
    const s = new ExplodeSolver(model).solve(P({ mode: "assembly", t: 1, focus: a.id }));
    driver.apply(s.assemblyFactor);
    const members = new Set(a.members);
    let moved = 0;
    for (const { b, m } of meshes) {
      const arr = m.instanceMatrix.array as Float32Array;
      b.ids.forEach((id, i) => {
        const changed = [12, 13, 14].some((j) => !Object.is(arr[i * 16 + j], b.matrices[i * 16 + j]));
        if (changed) {
          moved++;
          expect(members.has(id)).toBe(true);
        }
      });
    }
    expect(moved).toBeGreaterThan(30);
    expect(moved).toBeLessThanOrEqual(a.members.length);
  });

  it("composes with B3: a hidden instance stays hidden while exploded, and B3's restore leaves the explosion alone", () => {
    const { driver, meshes } = rig();
    const a = model.assemblies.find((x) => x.type === "window_assembly")!;
    const id = a.members.find((m) => Math.hypot(...model.memberUnit.get(m)!) > 0)!; // a member that actually moves
    const ax = a.axis!.findIndex((v) => v !== 0); // the translation component the decomposition writes
    const { b, m } = meshes.find((x) => x.b.ids.includes(id))!;
    const arr = m.instanceMatrix.array as Float32Array;
    const i = b.ids.indexOf(id);
    const T = (k: number) => arr[i * 16 + 12 + k]!;
    const s = new ExplodeSolver(model);
    s.solve(P({ mode: "cinematic", t: 0.8 }));
    driver.apply(s.assemblyFactor);
    const before = T(ax);
    const saved = hideInstance(arr, i); // B3 simulates the removal while exploded
    expect(T(ax)).toBe(before); // hiding keeps the translation
    expect([arr[i * 16], arr[i * 16 + 5], arr[i * 16 + 10]]).toEqual([0, 0, 0]);
    s.solve(P({ mode: "cinematic", t: 1 })); // the explosion keeps moving
    driver.apply(s.assemblyFactor);
    expect([arr[i * 16], arr[i * 16 + 5], arr[i * 16 + 10]]).toEqual([0, 0, 0]); // still hidden
    const f = s.assemblyFactor[model.memberAssembly.get(id)!]!;
    const u = model.memberUnit.get(id)!;
    expect(T(ax)).toBeCloseTo(b.matrices[i * 16 + 12 + ax]! + Math.fround(u[ax]!) * f, 4); // and it follows the explosion
    expect(T(ax)).not.toBe(before);
    const now = [T(0), T(1), T(2)];
    restoreInstance(arr, i, saved); // B3 un-hides
    expect([T(0), T(1), T(2)]).toEqual(now); // the displayed position is the explosion's, not the stale one B3 saw
    for (const j of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 15]) expect(Object.is(arr[i * 16 + j], b.matrices[i * 16 + j])).toBe(true);
    s.solve(P({ mode: "cinematic", t: 0 }));
    driver.apply(s.assemblyFactor);
    expect(identical(arr, b.matrices)).toBe(true);
  });

  it("hidden-while-exploded then reset: the instance ends hidden at its canonical position until B3 restores it", () => {
    const { driver, meshes } = rig();
    const id = model.assemblies.find((x) => x.type === "door_assembly")!.members[2]!;
    const { b, m } = meshes.find((x) => x.b.ids.includes(id))!;
    const arr = m.instanceMatrix.array as Float32Array;
    const i = b.ids.indexOf(id);
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    driver.apply(s.assemblyFactor);
    const saved = hideInstance(arr, i);
    s.solve(P({ mode: "assembled" }));
    driver.apply(s.assemblyFactor);
    expect([12, 13, 14].map((j) => arr[i * 16 + j])).toEqual([12, 13, 14].map((j) => b.matrices[i * 16 + j]));
    expect(arr[i * 16 + 5]).toBe(0); // still removed
    restoreInstance(arr, i, saved);
    expect(identical(arr, b.matrices)).toBe(true);
  });

  it("keeps culling and picking correct for displaced instances (the bounding sphere grows, then is restored exactly)", () => {
    const { driver, meshes } = rig();
    const sphere0 = new Map(meshes.map(({ m }) => [m, { c: m.boundingSphere!.center.clone(), r: m.boundingSphere!.radius }]));
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1, assemblyGap: 0.5 }));
    driver.apply(s.assemblyFactor);
    // find a decomposable instance whose displaced centre lies outside the ORIGINAL sphere: unpickable and cullable without the growth
    let found: { m: InstancedMesh; i: number; id: string } | null = null;
    for (const { b, m } of meshes) {
      const s0 = sphere0.get(m)!;
      const a = m.instanceMatrix.array as Float32Array;
      for (let i = 0; i < b.ids.length; i++) {
        if (!model.memberAssembly.has(b.ids[i]!)) continue;
        const p = new Vector3(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]);
        if (p.distanceTo(s0.c) > s0.r) {
          found = { m, i, id: b.ids[i]! };
          break;
        }
      }
      if (found) break;
    }
    expect(found, "some displaced instance lies outside its canonical sphere (so the growth is needed)").not.toBeNull();
    const { m, i, id } = found!;
    expect(m.boundingSphere!.radius).toBeGreaterThan(sphere0.get(m)!.r);
    const a = m.instanceMatrix.array as Float32Array;
    m.updateMatrixWorld(true);
    const centre = new Vector3(a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]);
    const ids = m.userData.componentIds as string[];
    const hitIds = (p: Vector3) => new Raycaster(p.clone().add(new Vector3(0, 0, 200)), new Vector3(0, 0, -1)).intersectObject(m, false).map((h) => ids[h.instanceId!]);
    expect(hitIds(centre)).toContain(id); // a click on the displaced component resolves to it
    // picking is exact: at the canonical position the component is no longer there
    const canon = new Vector3(...(model.byId.get(id)!.originalPosition as [number, number, number]));
    if (canon.distanceTo(centre) > 1) expect(hitIds(canon)).not.toContain(id);
    // reset: the sphere is exactly as generated and the component is pickable at its canonical position again
    s.solve(P({ mode: "assembled" }));
    driver.apply(s.assemblyFactor);
    for (const { m: mm } of meshes) expect(mm.boundingSphere!.radius).toBe(sphere0.get(mm)!.r);
    expect(hitIds(canon)).toContain(id);
  });

  it("followers (B3 tints, selection outlines) move with their source and come back exactly", () => {
    const { driver, meshes } = rig();
    const a = model.assemblies.find((x) => x.type === "window_assembly")!;
    const ids = a.members.slice(0, 3);
    const { b, m } = meshes.find((x) => x.b.ids.includes(ids[0]!))!;
    // an overlay mesh holding copies of three instances' canonical matrices (what a tint does)
    const idxs = ids.map((id) => b.ids.indexOf(id)).filter((i) => i >= 0);
    const ovIds = idxs.map((i) => b.ids[i]!);
    const copy = new Float32Array(idxs.length * 16);
    idxs.forEach((i, k) => copy.set(b.matrices.subarray(i * 16, i * 16 + 16), k * 16));
    const overlay = new InstancedMesh(geo, mat, idxs.length);
    overlay.instanceMatrix.array.set(copy);
    driver.follow(overlay, ovIds, copy);
    const outline = new Object3D();
    outline.matrixAutoUpdate = false;
    outline.matrix.fromArray(b.matrices, idxs[0]! * 16);
    const unfollow = driver.followObject(outline, ovIds[0]!);
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    driver.apply(s.assemblyFactor);
    const src = m.instanceMatrix.array as Float32Array;
    const ov = overlay.instanceMatrix.array as Float32Array;
    idxs.forEach((i, k) => {
      for (const j of [12, 13, 14]) expect(ov[k * 16 + j]).toBe(src[i * 16 + j]);
    });
    for (const j of [12, 13, 14]) expect(outline.matrix.elements[j]!).toBeCloseTo(src[idxs[0]! * 16 + j]!, 5); // double vs float32 storage
    expect(outline.matrixWorldNeedsUpdate).toBe(true);
    s.solve(P({ mode: "assembled" }));
    driver.apply(s.assemblyFactor);
    expect(identical(ov, copy)).toBe(true);
    expect(Array.from(outline.matrix.elements)).toEqual(Array.from(b.matrices.subarray(idxs[0]! * 16, idxs[0]! * 16 + 16)));
    // a follower created while exploded starts exploded; unfollowing restores canonical
    s.solve(P({ mode: "cinematic", t: 1 }));
    driver.apply(s.assemblyFactor);
    const late = new Object3D();
    late.matrixAutoUpdate = false;
    late.matrix.fromArray(b.matrices, idxs[0]! * 16);
    const un2 = driver.followObject(late, ovIds[0]!);
    expect(late.matrix.elements[12]!).toBeCloseTo(src[idxs[0]! * 16 + 12]!, 5);
    un2();
    expect(late.matrix.elements[12]).toBe(b.matrices[idxs[0]! * 16 + 12]);
    unfollow();
    driver.unregister(overlay);
    expect(driver.canonicalOf(overlay)).toBeUndefined();
  });

  it("detaching the model restores canonical; meshes registered after attaching behave the same as before", () => {
    const { driver, meshes } = rig();
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    driver.apply(s.assemblyFactor);
    driver.attachModel(null);
    for (const { b, m } of meshes) expect(identical(m.instanceMatrix.array as Float32Array, b.matrices)).toBe(true);
    driver.attachModel(model);
    const late = batches.find((b) => b.ids.some((id) => model.memberAssembly.has(id)))!;
    const lm = mesh(late);
    driver.register(lm, late.ids, late.matrices);
    driver.apply(s.assemblyFactor);
    expect(identical(lm.instanceMatrix.array as Float32Array, late.matrices)).toBe(false);
    expect(driver.meshCount).toBe(batches.length + 1);
  });

  it("detaching the model sends followers (outlines) back to their canonical position too", () => {
    const { driver, meshes } = rig();
    const a = model.assemblies.find((x) => x.type === "door_assembly")!;
    const id = a.members.find((m) => Math.hypot(...model.memberUnit.get(m)!) > 0)!;
    const { b } = meshes.find((x) => x.b.ids.includes(id))!;
    const i = b.ids.indexOf(id);
    const outline = new Object3D();
    outline.matrixAutoUpdate = false;
    outline.matrix.fromArray(b.matrices, i * 16);
    driver.followObject(outline, id);
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    driver.apply(s.assemblyFactor);
    expect(Array.from(outline.matrix.elements)).not.toEqual(Array.from(b.matrices.subarray(i * 16, i * 16 + 16)));
    driver.attachModel(null);
    expect(Array.from(outline.matrix.elements)).toEqual(Array.from(b.matrices.subarray(i * 16, i * 16 + 16)));
  });

  it("never changes the instance -> component mapping", () => {
    const { driver, meshes } = rig();
    const before = meshes.map(({ m }) => (m.userData.componentIds as string[]).join("|"));
    const s = new ExplodeSolver(model);
    for (let k = 0; k < 10; k++) {
      s.solve(P({ mode: "cinematic", t: k / 9 }));
      driver.apply(s.assemblyFactor);
    }
    expect(meshes.map(({ m }) => (m.userData.componentIds as string[]).join("|"))).toEqual(before);
    for (const { b, m } of meshes) expect(m.count).toBe(b.ids.length);
  });
});

describe("group driver (floors and systems)", () => {
  function hierarchy() {
    const root = new Group();
    root.name = "Building_G4";
    for (const f of model.floors) {
      const fg = new Group();
      fg.name = `Floor_${f}`;
      root.add(fg);
      for (const sys of model.systems) {
        const sg = new Group();
        sg.name = `${f}_${sys}`;
        fg.add(sg);
      }
    }
    root.updateMatrixWorld(true);
    return root;
  }
  const world = (root: Group, floor: string, sys: string): number[] => {
    root.updateMatrixWorld(true);
    return new Vector3().setFromMatrixPosition(root.getObjectByName(`${floor}_${sys}`)!.matrixWorld).toArray();
  };

  it("sets floor and system offsets on the existing groups; world position = floor + system", () => {
    const root = hierarchy();
    const gd = new GroupDriver();
    gd.bind(root, model);
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    expect(gd.apply(s)).toBe(model.floors.length + model.systems.length);
    for (const f of model.floors)
      for (const sys of model.systems) {
        const fo = s.floorOffsetOf(f);
        const so = s.systemOffsetOf(sys);
        expect(world(root, f, sys)).toEqual([fo[0] + so[0], fo[1] + so[1], fo[2] + so[2]]);
      }
    expect(root.getObjectByName("Floor_ROOF")!.position.y).toBe(30);
    expect(gd.apply(s)).toBe(0); // unchanged parameters write nothing: only dirty groups are touched
    s.solve(P({ mode: "cinematic", t: 0.5 }));
    expect(gd.apply(s)).toBeGreaterThan(0);
  });

  it("zero drift: after random parameter cycles, parameter 0 puts every group at exactly (0, 0, 0) with an identity matrix", () => {
    const root = hierarchy();
    const gd = new GroupDriver();
    gd.bind(root, model);
    const s = new ExplodeSolver(model);
    const rnd = lcg(11);
    for (let i = 0; i < 100; i++) {
      s.solve(P({ mode: EXPLODE_MODES[Math.floor(rnd() * 5)]!, t: rnd(), floorGap: rnd() * 12, systemGap: rnd() * 20, layout: (["grid", "row-x", "row-z"] as const)[Math.floor(rnd() * 3)]! }));
      gd.apply(s);
    }
    s.solve(P({ mode: "cinematic", t: 0 }));
    gd.apply(s);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      expect(o.position.toArray().every((v) => Object.is(v, 0))).toBe(true);
      expect(Array.from(o.matrixWorld.elements)).toEqual(Array.from(new Matrix4().elements));
    });
  });

  it("restore() and unbind() return to canonical; rebinding re-applies everything", () => {
    const root = hierarchy();
    const gd = new GroupDriver();
    gd.bind(root, model);
    const s = new ExplodeSolver(model).solve(P({ mode: "floors", t: 1 }));
    gd.apply(s);
    gd.restore();
    expect(root.getObjectByName("Floor_L4")!.position.toArray()).toEqual([0, 0, 0]);
    gd.bind(root, model); // e.g. the scene tree was re-created
    expect(gd.apply(s)).toBe(model.floors.length + model.systems.length); // every group is written again, including the zero-offset ones
    gd.unbind();
    expect(root.getObjectByName("Floor_L4")!.position.toArray()).toEqual([0, 0, 0]);
    expect(gd.bound).toBe(false);
  });

  it("plain meshes (structure) in a displaced group are picked where they are displayed, not where they were", () => {
    const root = hierarchy();
    const gd = new GroupDriver();
    gd.bind(root, model);
    const col = model.byId.get("STR-COL-F02-A1")!;
    const mesh = new Mesh(new BoxGeometry(0.45, 3.6, 0.45), new MeshBasicMaterial());
    mesh.position.set(...(col.originalPosition as [number, number, number]));
    root.getObjectByName("L2_structure")!.add(mesh);
    const s = new ExplodeSolver(model).solve(P({ mode: "floors", t: 1 }));
    gd.apply(s);
    root.updateMatrixWorld(true);
    const [x, y, z] = col.originalPosition;
    const hits = (at: Vector3) => new Raycaster(at.clone().add(new Vector3(0, 0, 50)), new Vector3(0, 0, -1)).intersectObject(root, true).map((h) => h.object);
    expect(hits(new Vector3(x, y + 12, z))).toContain(mesh); // displayed 12 m higher (floor L2 = 2 floors up)
    expect(hits(new Vector3(x, y, z))).not.toContain(mesh); // canonical position: empty now
    const sp = new Vector3().setFromMatrixPosition(mesh.matrixWorld);
    expect([sp.x, sp.y, sp.z]).toEqual([x, y + 12, z]);
    gd.restore();
    root.updateMatrixWorld(true);
    expect(hits(new Vector3(x, y, z))).toContain(mesh);
  });

  it("tolerates missing groups (e.g. a floor that is not in the tree)", () => {
    const root = new Group();
    root.name = "Building_G4";
    const gd = new GroupDriver();
    gd.bind(root, model);
    const s = new ExplodeSolver(model).solve(P({ mode: "cinematic", t: 1 }));
    expect(() => gd.apply(s)).not.toThrow();
  });
});
