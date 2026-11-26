"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Pause, Play } from "lucide-react";
import type { AnalyticsResponse } from "@/lib/api-client";
import type { IndexedFile, SearchHistoryEntry } from "@/types/search";
import { canRenderWebGL, isReducedMotionPreferred } from "./webgl-guard";

interface Dashboard3DProps {
  metrics: AnalyticsResponse | null;
  files: IndexedFile[] | null;
  recentHistory: SearchHistoryEntry[] | null;
}

function EngineNode({
  position,
  label,
  sublabel,
  color,
  scale = 1,
  playing,
}: {
  position: [number, number, number];
  label: string;
  sublabel: string;
  color: string;
  scale?: number;
  playing: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current && playing) {
      ref.current.rotation.y += delta * 0.55;
    }
  });
  return (
    <group position={position}>
      <mesh ref={ref} scale={scale}>
        <icosahedronGeometry args={[0.55, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.45}
          metalness={0.5}
          roughness={0.25}
        />
      </mesh>
      <Html position={[0, -0.9, 0]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
        <div
          style={{
            background: "rgba(9, 10, 15, 0.88)",
            border: `1px solid ${color}`,
            borderRadius: 6,
            padding: "3px 8px",
            color: "#f1f5f9",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 700 }}>{label}</div>
          <div style={{ color: "#94a3b8", fontSize: 9 }}>{sublabel}</div>
        </div>
      </Html>
    </group>
  );
}

function DataStreams({ active, playing }: { active: boolean; playing: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const mesh = ref.current;
    return () => {
      mesh?.geometry.dispose();
      if (mesh && !Array.isArray(mesh.material)) mesh.material.dispose();
    };
  }, []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = playing ? clock.getElapsedTime() : 0;
    const paths: Array<[[number, number, number], [number, number, number]]> = [
      [[-3.6, 0.9, 0], [0, 0, 0]],
      [[-3.6, -0.9, 0], [0, 0, 0]],
      [[0, 0, 0], [3.6, 0.9, 0]],
      [[0, 0, 0], [3.6, -0.9, 0]],
    ];
    for (let i = 0; i < paths.length; i++) {
      const [a, b] = paths[i];
      const u = ((t * (active ? 0.65 : 0.25) + i * 0.25) % 1);
      dummy.position.set(
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u
      );
      dummy.scale.setScalar(0.11);
      dummy.updateMatrix();
      ref.current.setMatrixAt(i, dummy.matrix);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 4]}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial color={active ? "#38bdf8" : "#64748b"} />
    </instancedMesh>
  );
}

export function Dashboard3D({ metrics, files, recentHistory }: Dashboard3DProps) {
  const [playing, setPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setReducedMotion(isReducedMotionPreferred());
      return;
    }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const docCount = files ? files.filter((f) => f.kind === "document").length : metrics?.totalDocuments ?? 0;
  const codeCount = files ? files.filter((f) => f.kind === "code").length : metrics?.totalCodeFiles ?? 0;
  const chunkCount = files ? files.reduce((s, f) => s + f.chunks, 0) : metrics?.totalChunks ?? 0;
  const searchCount = metrics?.totalSearches ?? recentHistory?.length ?? 0;
  const isActive = searchCount > 0;

  if (reducedMotion || !canRenderWebGL()) return null;

  return (
    <div className="surface-card" style={{ marginBottom: 24, padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-card-subtle)",
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-main)" }}>
          3D Search Engine Topology{" "}
          <span style={{ fontWeight: 500, color: "var(--text-muted)", fontSize: 11.5 }}>
            ({isActive ? `Live: ${searchCount} searches · ${chunkCount} chunks` : "Idle — awaiting search activity"})
          </span>
        </div>
        <button
          type="button"
          className="btn-secondary"
          style={{ padding: "4px 10px", fontSize: 11.5 }}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause size={12} /> : <Play size={12} />}
          <span>{playing ? "Pause" : "Play"}</span>
        </button>
      </div>

      <div style={{ height: 240, width: "100%", background: "#07090f" }}>
        <Canvas camera={{ position: [0, 0.8, 6.2], fov: 44 }}>
          <ambientLight intensity={0.65} />
          <pointLight position={[5, 5, 5]} intensity={1.1} />

          <Line points={[[-3.6, 0.9, 0], [0, 0, 0]]} color="#4f46e5" lineWidth={1.5} />
          <Line points={[[-3.6, -0.9, 0], [0, 0, 0]]} color="#3b82f6" lineWidth={1.5} />
          <Line points={[[0, 0, 0], [3.6, 0.9, 0]]} color="#10b981" lineWidth={1.5} />
          <Line points={[[0, 0, 0], [3.6, -0.9, 0]]} color="#0ea5e9" lineWidth={1.5} />

          <EngineNode
            position={[-3.6, 0.9, 0]}
            label="Documents"
            sublabel={`${docCount} files`}
            color="#f87171"
            playing={playing}
          />
          <EngineNode
            position={[-3.6, -0.9, 0]}
            label="Source Code"
            sublabel={`${codeCount} AST files`}
            color="#60a5fa"
            playing={playing}
          />
          <EngineNode
            position={[0, 0, 0]}
            label="Compiler + RRF"
            sublabel={`${chunkCount} chunks`}
            color="#818cf8"
            scale={1.25}
            playing={playing}
          />
          <EngineNode
            position={[3.6, 0.9, 0]}
            label="GIN FTS"
            sublabel="Lexical index"
            color="#34d399"
            playing={playing}
          />
          <EngineNode
            position={[3.6, -0.9, 0]}
            label="pgvector HNSW"
            sublabel={metrics && metrics.totalSearches > 0 ? `${metrics.avgLatencyMs} ms avg` : "384-D MiniLM"}
            color="#38bdf8"
            playing={playing}
          />

          <DataStreams active={isActive} playing={playing} />
          <OrbitControls enableZoom={false} enablePan={false} autoRotate={playing} autoRotateSpeed={0.4} />
        </Canvas>
      </div>
    </div>
  );
}
