import { describe, expect, it } from "vitest";
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { hiddenMatrix } from "./hide";

function scene() {
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
  mesh.setMatrixAt(0, new Matrix4().makeTranslation(0, 0, 0));
  mesh.setMatrixAt(1, new Matrix4().makeRotationY(0.4).setPosition(5, 0, 0));
  mesh.updateMatrixWorld(true);
  return mesh;
}
const hit = (mesh: InstancedMesh, x: number) => {
  const rc = new Raycaster(new Vector3(x, 0, 10), new Vector3(0, 0, -1));
  return [...new Set(rc.intersectObject(mesh, false).map((h) => h.instanceId))]; // a box is hit on both faces
};

describe("hiding an instance", () => {
  it("makes it unpickable, leaves its neighbour pickable, and restores exactly", () => {
    const mesh = scene();
    expect(hit(mesh, 0)).toEqual([0]);
    expect(hit(mesh, 5)).toEqual([1]);
    const original = new Matrix4();
    mesh.getMatrixAt(1, original);
    const saved = Float32Array.from(original.elements);
    const m = new Matrix4();
    mesh.getMatrixAt(1, m);
    mesh.setMatrixAt(1, hiddenMatrix(m));
    mesh.instanceMatrix.needsUpdate = true;
    expect(hit(mesh, 5)).toEqual([]); // clicking where it was no longer selects it
    expect(hit(mesh, 0)).toEqual([0]);
    expect(mesh.instanceMatrix.array.slice(16, 32)).not.toEqual(saved);
    mesh.instanceMatrix.array.set(saved, 16); // what the overlay's cleanup does
    expect(Array.from(mesh.instanceMatrix.array.slice(16, 32))).toEqual(Array.from(saved));
    expect(hit(mesh, 5)).toEqual([1]);
  });

  it("keeps the translation and zeroes rotation and scale", () => {
    const m = new Matrix4().makeRotationY(1).scale(new Vector3(2, 3, 4)).setPosition(7, 8, 9);
    const h = hiddenMatrix(m, new Matrix4());
    expect(Array.from(h.elements)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 8, 9, 1]);
  });
});
