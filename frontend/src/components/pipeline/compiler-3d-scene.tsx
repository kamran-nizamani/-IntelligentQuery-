"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { CompilerStageInfo, CompilerTrace } from "@/types/search";
import { canRenderWebGL, isReducedMotionPreferred } from "../3d/webgl-guard";

interface Compiler3DSceneProps {
  trace: CompilerTrace;
  selectedStageIndex: number;
  onSelectStage: (index: number) => void;
}

const STAGE_POSITIONS: Array<[number, number, number]> = [
  [-6.0, 0.3, 0],
  [-4.0, -0.3, 0.4],
  [-2.0, 0.4, -0.3],
  [0.0, -0.2, 0.3],
  [2.0, 0.4, -0.3],
  [4.0, -0.3, 0.4],
  [6.0, 0.3, 0],
];

function StageNode({
  stage,
  index,
  position,
  isActive,
  isCompleted,
  hasError,
  onClick,
}: {
  stage: CompilerStageInfo;
  index: number;
  position: [number, number, number];
  isActive: boolean;
  isCompleted: boolean;
  hasError: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    if (isActive) {
      meshRef.current.rotation.y += delta * 1.1;
      meshRef.current.rotation.x += delta * 0.35;
    } else {
      meshRef.current.rotation.y += delta * 0.25;
    }
  });

  const color = hasError
    ? "#ef4444"
    : isActive
    ? "#818cf8"
    : isCompleted
    ? "#10b981"
    : "#475569";

  const shortTitle = stage.name.replace(/^\d+\.\s*/, "").split("(")[0].trim();

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        scale={isActive || hovered ? 1.22 : 1.0}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        {stage.category === "retrieval" ? (
          <octahedronGeometry args={[0.55, 0]} />
        ) : (
          <boxGeometry args={[0.85, 0.85, 0.85]} />
        )}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isActive ? 0.65 : isCompleted ? 0.25 : 0.08}
          roughness={0.3}
          metalness={0.5}
        />
      </mesh>

      <Html position={[0, -0.95, 0]} center distanceFactor={10} style={{ pointerEvents: "none" }}>
        <div
          style={{
            background: "rgba(9, 10, 15, 0.85)",
            border: `1px solid ${isActive ? "#818cf8" : "rgba(255,255,255,0.14)"}`,
            borderRadius: 6,
            padding: "3px 7px",
            color: "#f1f5f9",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            {index + 1}. {shortTitle}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 9 }}>
            {stage.durationMs > 0 ? `${stage.durationMs} ms` : "runtime"}
          </div>
        </div>
      </Html>
    </group>
  );
}

function DataPulse({
  activeStage,
  playing,
  speed,
}: {
  activeStage: number;
  playing: boolean;
  speed: number;
}) {
  const pulseRef = useRef<THREE.Mesh>(null);
  const progressRef = useRef(0);

  useFrame((_, delta) => {
    if (!pulseRef.current) return;
    if (playing) {
      progressRef.current = (progressRef.current + delta * speed * 0.9) % 1;
    }
    const fromIdx = Math.min(activeStage, STAGE_POSITIONS.length - 2);
    const toIdx = fromIdx + 1;
    const p0 = STAGE_POSITIONS[fromIdx];
    const p1 = STAGE_POSITIONS[toIdx];
    const t = progressRef.current;
    pulseRef.current.position.set(
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t
    );
  });

  return (
    <mesh ref={pulseRef}>
      <sphereGeometry args={[0.16, 16, 16]} />
      <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={1.2} />
    </mesh>
  );
}

export function Compiler3DScene({
  trace,
  selectedStageIndex,
  onSelectStage,
}: Compiler3DSceneProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [fullscreen, setFullscreen] = useState(false);
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

  useEffect(() => {
    if (!playing) return;
    const interval = setInterval(() => {
      onSelectStage((selectedStageIndex + 1) % trace.stages.length);
    }, Math.round(1400 / speed));
    return () => clearInterval(interval);
  }, [playing, speed, selectedStageIndex, trace.stages.length, onSelectStage]);

  const hasLexOrSyntaxError =
    (trace.lexicalDiagnostics?.some((d) => d.severity === "error") ?? false) ||
    (trace.syntaxDiagnostics?.some((d) => d.severity === "error") ?? false);
  const hasSemanticError = !trace.semanticStatus.valid;

  const linePoints = useMemo(
    () => STAGE_POSITIONS.slice(0, trace.stages.length),
    [trace.stages.length]
  );

  if (reducedMotion || !canRenderWebGL()) {
    return (
      <div
        className="surface-card"
        style={{ padding: 16, marginBottom: 20, textAlign: "center", color: "var(--text-muted)" }}
      >
        3D studio is unavailable ({reducedMotion ? "reduced motion enabled" : "WebGL context unavailable"}). Use the 2D pipeline stepper below to inspect all {trace.stages.length} stages.
      </div>
    );
  }

  return (
    <div
      className="surface-card"
      style={{
        marginBottom: 24,
        padding: 0,
        overflow: "hidden",
        position: fullscreen ? "fixed" : "relative",
        inset: fullscreen ? 16 : undefined,
        zIndex: fullscreen ? 70 : undefined,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Controls Bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
          padding: "10px 14px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-card-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: "5px 9px", fontSize: 12 }}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause 3D pipeline" : "Play 3D pipeline"}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
            <span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Step backward"
            onClick={() => {
              setPlaying(false);
              onSelectStage(Math.max(0, selectedStageIndex - 1));
            }}
          >
            <SkipBack size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Step forward"
            onClick={() => {
              setPlaying(false);
              onSelectStage(Math.min(trace.stages.length - 1, selectedStageIndex + 1));
            }}
          >
            <SkipForward size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Reset pipeline timeline"
            onClick={() => {
              setPlaying(false);
              onSelectStage(0);
            }}
          >
            <RotateCcw size={14} />
          </button>
        </div>

        {/* Timeline Scrubber */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 160, maxWidth: 320 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            Stage {selectedStageIndex + 1}/{trace.stages.length}
          </span>
          <input
            type="range"
            aria-label="Pipeline stage timeline"
            min={0}
            max={Math.max(0, trace.stages.length - 1)}
            value={selectedStageIndex}
            onChange={(e) => {
              setPlaying(false);
              onSelectStage(Number(e.target.value));
            }}
            style={{ flex: 1, accentColor: "var(--accent-primary)" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {([0.5, 1, 2] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className="btn-secondary"
              style={{
                padding: "4px 8px",
                fontSize: 11,
                borderColor: speed === s ? "var(--accent-primary)" : undefined,
                color: speed === s ? "var(--accent-text)" : undefined,
              }}
            >
              {s}x
            </button>
          ))}
          <button
            type="button"
            className="btn-icon"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={() => setFullscreen((f) => !f)}
          >
            {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* 3D Canvas */}
      <div style={{ height: fullscreen ? "calc(100% - 54px)" : 340, width: "100%", background: "#07090f" }}>
        <Canvas camera={{ position: [0, 2.5, 9.5], fov: 46 }}>
          <ambientLight intensity={0.65} />
          <pointLight position={[6, 6, 6]} intensity={1.2} />
          <pointLight position={[-6, -4, 4]} intensity={0.6} color="#6366f1" />
          <gridHelper args={[18, 18, "#1e293b", "#0f172a"]} position={[0, -1.6, 0]} />

          {linePoints.length > 1 && (
            <Line points={linePoints} color="#4f46e5" lineWidth={2} />
          )}

          {trace.stages.map((stage, idx) => {
            const pos = STAGE_POSITIONS[idx] ?? [idx * 2 - 6, 0, 0];
            const stageHasError =
              (idx <= 1 && hasLexOrSyntaxError) || (idx === 3 && hasSemanticError);
            return (
              <StageNode
                key={stage.id}
                stage={stage}
                index={idx}
                position={pos}
                isActive={idx === selectedStageIndex}
                isCompleted={idx < selectedStageIndex}
                hasError={stageHasError}
                onClick={() => {
                  setPlaying(false);
                  onSelectStage(idx);
                }}
              />
            );
          })}

          <DataPulse activeStage={selectedStageIndex} playing={playing} speed={speed} />
          <OrbitControls enableDamping dampingFactor={0.08} minDistance={4} maxDistance={16} />
        </Canvas>
      </div>
    </div>
  );
}
