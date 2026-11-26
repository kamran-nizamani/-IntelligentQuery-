"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { NavItem } from "../shell/sidebar";
import { canRenderWebGL, isReducedMotionPreferred } from "./webgl-guard";

interface GlobalBackdrop3DProps {
  currentView: NavItem;
  enabled: boolean;
}

const VIEW_ACCENT: Record<NavItem, string> = {
  overview: "#6366f1",
  search: "#0ea5e9",
  analyzer: "#8b5cf6",
  pipeline: "#10b981",
  library: "#3b82f6",
  history: "#06b6d4",
  analytics: "#a855f7",
  settings: "#64748b",
};

const PARTICLE_COUNT = 90;

function InstancedField({ accentColor }: { accentColor: string }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        x: ((i * 37) % 24) - 12,
        y: ((i * 53) % 14) - 7,
        z: -2 - ((i * 19) % 10),
        speed: 0.15 + ((i * 13) % 10) * 0.02,
        phase: i * 0.7,
      })),
    []
  );

  useEffect(() => {
    const mesh = meshRef.current;
    return () => {
      mesh?.geometry.dispose();
      if (mesh && !Array.isArray(mesh.material)) {
        mesh.material.dispose();
      }
    };
  }, []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const s = seeds[i];
      dummy.position.set(
        s.x + Math.sin(t * s.speed + s.phase) * 0.35,
        s.y + Math.cos(t * s.speed * 0.8 + s.phase) * 0.35,
        s.z
      );
      const scale = 0.045 + Math.sin(t * 1.4 + s.phase) * 0.015;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, PARTICLE_COUNT]}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color={accentColor} transparent opacity={0.32} />
    </instancedMesh>
  );
}

export function GlobalBackdrop3D({ currentView, enabled }: GlobalBackdrop3DProps) {
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

  if (!enabled || reducedMotion || !canRenderWebGL()) return null;

  const accent = VIEW_ACCENT[currentView] ?? "#6366f1";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity: 0.45,
      }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 8], fov: 50 }}
        gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
      >
        <InstancedField accentColor={accent} />
      </Canvas>
    </div>
  );
}
