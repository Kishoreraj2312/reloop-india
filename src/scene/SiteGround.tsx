/**
 * Presentation-only site ground at finished grade (not a building component): anchors the
 * building visually and hides the below-grade foundations in exterior views. Hidden when
 * the foundation floor is isolated.
 */

import { ARCH_CONFIG } from "@/building/architecture/config";

const SIZE = 140;
const COLOR = 0xd4d1c9;

export function SiteGround({ visible }: { visible: boolean }) {
  // 3 mm below grade so the bottom faces of the entrance steps never share its plane.
  return (
    <mesh name="SiteGround" rotation={[-Math.PI / 2, 0, 0]} position={[0, ARCH_CONFIG.datums.siteGrade - 0.003, 0]} visible={visible} receiveShadow>
      <planeGeometry args={[SIZE, SIZE]} />
      <meshStandardMaterial color={COLOR} roughness={1} metalness={0} />
    </mesh>
  );
}
