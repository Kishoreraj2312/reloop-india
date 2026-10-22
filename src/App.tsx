/**
 * ReLoop India — Main Application Entry
 *
 * A0: Minimal viewer with grid + placeholder slabs + click-to-select.
 */

import { useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { StubBuilding } from "@/scene/StubViewer";
import { registry } from "@/building/registry";

export default function App() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  const selectedComp = selectedId ? registry.getById(selectedId) : null;

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Canvas
        camera={{ position: [45, 30, 45], fov: 45, near: 0.1, far: 500 }}
        onPointerMissed={() => setSelectedId(null)}
        style={{ background: "#1a1a2e" }}
      >
        <ambientLight intensity={0.4} />
        <directionalLight position={[30, 40, 20]} intensity={0.8} />
        <StubBuilding onSelect={handleSelect} />
        <OrbitControls
          makeDefault
          minDistance={10}
          maxDistance={150}
          target={[0, 9, 0]}
        />
        <gridHelper args={[80, 40, 0x2d3748, 0x2d3748]} position={[0, -1.6, 0]} />
      </Canvas>

      {/* Dev overlay — selected component info */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          color: "#e2e8f0",
          fontFamily: "monospace",
          fontSize: 13,
          background: "rgba(26, 26, 46, 0.85)",
          padding: "12px 16px",
          borderRadius: 8,
          maxWidth: 380,
          pointerEvents: "none",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
          ReLoop India — A0 Stub
        </div>
        <div style={{ opacity: 0.6, fontSize: 11, marginBottom: 6 }}>
          Click a slab plane to test registry lookup
        </div>
        {selectedComp ? (
          <div style={{ borderTop: "1px solid #4a5568", paddingTop: 8 }}>
            <div><b>ID:</b> {selectedComp.id}</div>
            <div><b>Name:</b> {selectedComp.name}</div>
            <div><b>Floor:</b> {selectedComp.floor}</div>
            <div><b>System:</b> {selectedComp.system}</div>
            <div><b>Material:</b> {selectedComp.materialId}</div>
            <div><b>Qty:</b> {selectedComp.quantity.toFixed(2)} {selectedComp.unit}</div>
            <div><b>Confidence:</b> {selectedComp.confidence}</div>
            <div><b>Position:</b> [{selectedComp.originalPosition.join(", ")}]</div>
          </div>
        ) : (
          <div style={{ opacity: 0.5 }}>No selection</div>
        )}
        <div style={{ marginTop: 8, fontSize: 10, opacity: 0.4 }}>
          Registry: {registry.size} components
        </div>
      </div>
    </div>
  );
}
