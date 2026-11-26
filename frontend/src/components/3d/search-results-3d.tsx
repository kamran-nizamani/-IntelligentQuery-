"use client";

import React, { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import type { CompilerTrace, SearchResult } from "@/types/search";
import { canRenderWebGL, isReducedMotionPreferred } from "./webgl-guard";

interface SearchResults3DProps {
  results: SearchResult[];
  trace: CompilerTrace | null;
  onSelectResult: (item: SearchResult) => void;
}

export function SearchResults3D({ results, trace, onSelectResult }: SearchResults3DProps) {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(isReducedMotionPreferred());
  }, []);

  if (reducedMotion || results.length === 0 || !canRenderWebGL()) return null;

  const top = results.slice(0, 10);

  return (
    <div className="surface-card" style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-card-subtle)",
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--text-main)" }}>
          3D RRF Ranking &amp; Lexical/Vector Fusion Space
        </span>
        <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
          {top.length} hits · {trace ? `${trace.tokens.length} tokens` : "active"} · Click node to preview
        </span>
      </div>

      <div style={{ height: 220, width: "100%", background: "#07090f" }}>
        <Canvas camera={{ position: [0, 2.2, 6.8], fov: 45 }}>
          <ambientLight intensity={0.7} />
          <pointLight position={[5, 5, 5]} intensity={1.1} />
          <gridHelper args={[10, 10, "#1e293b", "#0f172a"]} position={[0, -1.2, 0]} />

          {/* Query Origin */}
          <mesh position={[0, 1.4, 0]}>
            <octahedronGeometry args={[0.35, 0]} />
            <meshStandardMaterial color="#818cf8" emissive="#818cf8" emissiveIntensity={0.7} />
          </mesh>

          {top.map((res, idx) => {
            const angle = (idx / Math.max(1, top.length)) * Math.PI * 2;
            const radius = Math.max(1.2, 3.6 - res.score * 25);
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius * 0.65;
            const y = (res.matchType === "hybrid" ? 0.35 : res.matchType === "semantic" ? -0.15 : -0.55);
            const color =
              res.matchType === "hybrid"
                ? "#818cf8"
                : res.matchType === "semantic"
                ? "#38bdf8"
                : "#34d399";

            return (
              <group key={res.id}>
                <Line points={[[0, 1.4, 0], [x, y, z]]} color={color} lineWidth={1.2} />
                <mesh
                  position={[x, y, z]}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectResult(res);
                  }}
                >
                  <sphereGeometry args={[0.24, 16, 16]} />
                  <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} />
                </mesh>
                {idx < 5 && (
                  <Html position={[x, y - 0.38, z]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
                    <div
                      style={{
                        background: "rgba(9,10,15,0.85)",
                        border: `1px solid ${color}`,
                        borderRadius: 4,
                        padding: "1px 5px",
                        fontSize: 9,
                        color: "#f1f5f9",
                        fontFamily: "var(--font-mono)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      #{idx + 1} {res.title.slice(0, 18)}
                    </div>
                  </Html>
                )}
              </group>
            );
          })}

          <OrbitControls enableDamping dampingFactor={0.08} minDistance={3} maxDistance={11} />
        </Canvas>
      </div>
    </div>
  );
}
