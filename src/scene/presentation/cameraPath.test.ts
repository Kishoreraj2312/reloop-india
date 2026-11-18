import { describe, expect, it } from "vitest";
import { easeInOutCubic, planFlight, type Pose, type V3 } from "./cameraPath";

const A: Pose = { position: [60, 40, 60], target: [0, 9, 0] };
const B: Pose = { position: [-30, 12, -70], target: [3, 8, -2] };
const dist = (p: Pose) => Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2]);

describe("ease", () => {
  it("is exactly 0 and 1 at the ends, monotonic, never overshoots", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = easeInOutCubic(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });
});

describe("flight", () => {
  const f = planFlight(A, B);
  it("starts and ends exactly on the poses", () => {
    expect(f.at(0)).toEqual(A);
    expect(f.at(1)).toEqual(B);
  });
  it("orbits instead of cutting through: the camera never gets closer to the target than the nearer end", () => {
    const near = Math.min(dist(A), dist(B));
    for (let i = 0; i <= 50; i++) {
      const p = f.at(i / 50);
      expect(dist(p)).toBeGreaterThanOrEqual(near * 0.999);
    }
  });
  it("is smooth: no step between neighbouring samples exceeds a tenth of the whole move", () => {
    const total = Math.hypot(...(B.position.map((v, i) => v - A.position[i]!) as unknown as V3));
    let prev = f.at(0).position;
    for (let i = 1; i <= 100; i++) {
      const p = f.at(easeInOutCubic(i / 100)).position;
      expect(Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])).toBeLessThan(total * 0.1);
      prev = p;
    }
  });
  it("azimuth takes the shorter way round", () => {
    const from: Pose = { position: [10, 5, 1], target: [0, 5, 0] }; // just past +z toward +x
    const to: Pose = { position: [-10, 5, 1], target: [0, 5, 0] }; // just past +z toward -x
    const mid = planFlight(from, to).at(0.5).position;
    expect(mid[2]).toBeGreaterThan(5); // passes in front (+z), not behind the target
  });
  it("duration grows with the move and stays within bounds; an explicit duration wins", () => {
    expect(planFlight(A, A).ms).toBeGreaterThanOrEqual(900);
    expect(f.ms).toBeLessThanOrEqual(2200);
    expect(planFlight(A, B, 1234).ms).toBe(1234);
  });
});
