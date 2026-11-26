"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, Line, OrbitControls } from "@react-three/drei";
import {
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import type { CompilerTrace } from "@/types/search";
import { canRenderWebGL, isReducedMotionPreferred } from "./webgl-guard";

export type AnalyzerTab = "tokens" | "dfa" | "ast" | "semantic" | "ir" | "optimizer" | "vm";

interface Analyzer3DProps {
  trace: CompilerTrace;
  activeTab: AnalyzerTab;
}

interface Node3D {
  id: string;
  label: string;
  sublabel?: string;
  position: [number, number, number];
  color: string;
}

interface Edge3D {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
}

function buildStageGraph(trace: CompilerTrace, tab: AnalyzerTab): { nodes: Node3D[]; edges: Edge3D[] } {
  const nodes: Node3D[] = [];
  const edges: Edge3D[] = [];

  if (tab === "tokens") {
    const toks = trace.tokens.slice(0, 12);
    toks.forEach((t, idx) => {
      const x = (idx - (toks.length - 1) / 2) * 1.35;
      const color =
        t.kind === "INVALID"
          ? "#ef4444"
          : t.kind === "AND" || t.kind === "OR" || t.kind === "NOT"
          ? "#f59e0b"
          : t.kind === "LANGUAGE"
          ? "#60a5fa"
          : t.kind === "TARGET"
          ? "#34d399"
          : "#818cf8";
      nodes.push({
        id: `tok-${idx}`,
        label: t.kind,
        sublabel: t.lexeme || t.value,
        position: [x, 0, 0],
        color,
      });
      if (idx > 0) {
        edges.push({ from: nodes[idx - 1].position, to: [x, 0, 0], color: "#4f46e5" });
      }
    });
    return { nodes, edges };
  }

  if (tab === "dfa") {
    const states = trace.dfaTrace?.statesVisited ?? ["START", "ACCEPT"];
    states.forEach((st, idx) => {
      const angle = (idx / Math.max(1, states.length)) * Math.PI * 2;
      const r = 2.6;
      const pos: [number, number, number] = [Math.cos(angle) * r, Math.sin(angle) * 1.1, Math.sin(angle) * 1.2];
      nodes.push({
        id: st,
        label: st,
        sublabel: st === "ERROR" ? "diagnostic" : "state",
        position: pos,
        color: st === "ERROR" ? "#ef4444" : st === "ACCEPT" ? "#10b981" : "#38bdf8",
      });
    });
    const byId = new Map(nodes.map((n) => [n.id, n.position]));
    for (const tr of (trace.dfaTrace?.transitions ?? []).slice(0, 24)) {
      const a = byId.get(tr.fromState);
      const b = byId.get(tr.toState);
      if (a && b && tr.fromState !== tr.toState) {
        edges.push({ from: a, to: b, color: tr.toState === "ERROR" ? "#ef4444" : "#6366f1" });
      }
    }
    return { nodes, edges };
  }

  if (tab === "ast") {
    const rootPos: [number, number, number] = [0, 1.5, 0];
    nodes.push({
      id: "ast-root",
      label: "QueryProgram",
      sublabel: trace.ast.action,
      position: rootPos,
      color: "#818cf8",
    });
    const branches = [
      { label: "Target", val: trace.ast.target ?? "any", color: "#34d399" },
      { label: "Language", val: trace.ast.language ?? "all", color: "#60a5fa" },
      { label: "Topic", val: trace.ast.topic.slice(0, 18), color: "#f472b6" },
      { label: "Limit", val: String(trace.ast.limit), color: "#c084fc" },
    ];
    branches.forEach((b, idx) => {
      const pos: [number, number, number] = [(idx - 1.5) * 2.1, -0.8, 0];
      nodes.push({ id: b.label, label: b.label, sublabel: b.val, position: pos, color: b.color });
      edges.push({ from: rootPos, to: pos, color: "#4f46e5" });
    });
    return { nodes, edges };
  }

  if (tab === "semantic") {
    const syms = trace.semanticStatus.symbolTable ?? [];
    if (syms.length === 0) {
      nodes.push({
        id: "sem-ok",
        label: trace.semanticStatus.valid ? "Valid" : "Invalid",
        sublabel: `${trace.semanticStatus.diagnostics?.length ?? 0} diagnostics`,
        position: [0, 0, 0],
        color: trace.semanticStatus.valid ? "#10b981" : "#ef4444",
      });
      return { nodes, edges };
    }
    syms.slice(0, 10).forEach((s, idx) => {
      const pos: [number, number, number] = [(idx - (Math.min(syms.length, 10) - 1) / 2) * 1.7, 0.3, 0];
      nodes.push({
        id: `sym-${idx}`,
        label: s.canonicalName,
        sublabel: `${s.category} (${s.dataType})`,
        position: pos,
        color: trace.semanticStatus.valid ? "#10b981" : "#f59e0b",
      });
    });
    (trace.semanticStatus.diagnostics ?? []).slice(0, 4).forEach((d, idx) => {
      const pos: [number, number, number] = [(idx - 1.5) * 2.1, -1.2, 0.5];
      nodes.push({
        id: `diag-${idx}`,
        label: d.code,
        sublabel: d.severity,
        position: pos,
        color: d.severity === "error" ? "#ef4444" : "#f59e0b",
      });
    });
    return { nodes, edges };
  }

  if (tab === "ir") {
    const plan = trace.irPlan;
    if (!plan) return { nodes, edges };
    const collect = (node: typeof plan.root, depth: number, xOffset: number): void => {
      const pos: [number, number, number] = [xOffset, 1.5 - depth * 1.0, 0];
      nodes.push({
        id: node.id,
        label: node.kind,
        sublabel: `sel=${node.estimatedSelectivity}`,
        position: pos,
        color: node.kind === "METADATA_FILTER" ? "#34d399" : node.kind === "SEMANTIC_SEARCH" ? "#38bdf8" : "#818cf8",
      });
      if (node.kind === "LIMIT" || node.kind === "HYBRID_SEARCH") {
        collect(node.child, depth + 1, xOffset);
        const childNode = nodes.find((n) => n.id === node.child.id);
        if (childNode) edges.push({ from: pos, to: childNode.position, color: "#4f46e5" });
      } else if (node.kind === "BOOLEAN_NOT") {
        collect(node.operand, depth + 1, xOffset);
        const childNode = nodes.find((n) => n.id === node.operand.id);
        if (childNode) edges.push({ from: pos, to: childNode.position, color: "#ef4444" });
      } else if (node.kind === "BOOLEAN_AND" || node.kind === "BOOLEAN_OR") {
        node.children.forEach((c, idx) => {
          const cx = xOffset + (idx - (node.children.length - 1) / 2) * 2.2;
          collect(c, depth + 1, cx);
          const childNode = nodes.find((n) => n.id === c.id);
          if (childNode) edges.push({ from: pos, to: childNode.position, color: "#6366f1" });
        });
      }
    };
    collect(plan.root, 0, 0);
    return { nodes, edges };
  }

  if (tab === "optimizer") {
    const opt = trace.optimization;
    nodes.push({
      id: "before",
      label: "Before Opt",
      sublabel: opt ? `Cost ${opt.costBefore.totalCost}` : "Raw IR",
      position: [-2.2, 0, 0],
      color: "#f87171",
    });
    nodes.push({
      id: "after",
      label: `After -${opt?.level ?? "O2"}`,
      sublabel: opt ? `Cost ${opt.costAfter.totalCost}` : "Optimized",
      position: [2.2, 0, 0],
      color: "#34d399",
    });
    edges.push({ from: [-2.2, 0, 0], to: [2.2, 0, 0], color: "#818cf8" });
    return { nodes, edges };
  }

  // vm
  const insts = trace.executionPlan?.bytecode.slice(0, 10) ?? [];
  insts.forEach((inst, idx) => {
    const pos: [number, number, number] = [(idx - (insts.length - 1) / 2) * 1.45, 0, 0];
    nodes.push({
      id: `vm-${inst.pc}`,
      label: inst.opcode,
      sublabel: inst.operand ?? `pc=${inst.pc}`,
      position: pos,
      color: inst.opcode === "EXEC_HYBRID_RRF" ? "#10b981" : "#38bdf8",
    });
    if (idx > 0) {
      edges.push({ from: nodes[idx - 1].position, to: pos, color: "#0ea5e9" });
    }
  });
  return { nodes, edges };
}

export function Analyzer3D({ trace, activeTab }: Analyzer3DProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const [stepIdx, setStepIdx] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(isReducedMotionPreferred());
  }, []);

  const { nodes, edges } = useMemo(() => buildStageGraph(trace, activeTab), [trace, activeTab]);

  useEffect(() => {
    setStepIdx(0);
  }, [activeTab, trace.sourceQuery]);

  useEffect(() => {
    if (!playing || nodes.length === 0) return;
    const timer = setInterval(() => {
      setStepIdx((prev) => (prev + 1) % nodes.length);
    }, Math.round(1100 / speed));
    return () => clearInterval(timer);
  }, [playing, speed, nodes.length]);

  if (reducedMotion || nodes.length === 0 || !canRenderWebGL()) return null;

  return (
    <div
      className="surface-card"
      style={{
        marginBottom: 18,
        padding: 0,
        overflow: "hidden",
        position: fullscreen ? "fixed" : "relative",
        inset: fullscreen ? 16 : undefined,
        zIndex: fullscreen ? 70 : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 14px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-card-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: "4px 9px", fontSize: 11.5 }}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
            <span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Previous node"
            onClick={() => {
              setPlaying(false);
              setStepIdx((s) => Math.max(0, s - 1));
            }}
          >
            <SkipBack size={13} />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Next node"
            onClick={() => {
              setPlaying(false);
              setStepIdx((s) => Math.min(nodes.length - 1, s + 1));
            }}
          >
            <SkipForward size={13} />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Reset stage animation"
            onClick={() => {
              setPlaying(false);
              setStepIdx(0);
            }}
          >
            <RotateCcw size={13} />
          </button>
        </div>

        <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          3D {activeTab.toUpperCase()} Inspector · Node {Math.min(stepIdx + 1, nodes.length)}/{nodes.length}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {([0.5, 1, 2] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="btn-secondary"
              style={{
                padding: "3px 7px",
                fontSize: 11,
                borderColor: speed === s ? "var(--accent-primary)" : undefined,
              }}
              onClick={() => setSpeed(s)}
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
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      <div style={{ height: fullscreen ? "calc(100% - 48px)" : 220, width: "100%", background: "#07090f" }}>
        <Canvas camera={{ position: [0, 1.2, 7.2], fov: 46 }}>
          <ambientLight intensity={0.7} />
          <pointLight position={[6, 6, 6]} intensity={1.1} />
          <gridHelper args={[14, 14, "#1e293b", "#0f172a"]} position={[0, -1.6, 0]} />

          {edges.map((e, idx) => (
            <Line key={idx} points={[e.from, e.to]} color={e.color} lineWidth={1.4} />
          ))}

          {nodes.map((n, idx) => {
            const active = idx === stepIdx;
            return (
              <group key={n.id} position={n.position}>
                <mesh
                  scale={active ? 1.28 : 0.95}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPlaying(false);
                    setStepIdx(idx);
                  }}
                >
                  <boxGeometry args={[0.62, 0.62, 0.62]} />
                  <meshStandardMaterial
                    color={n.color}
                    emissive={n.color}
                    emissiveIntensity={active ? 0.8 : 0.25}
                  />
                </mesh>
                <Html position={[0, -0.62, 0]} center distanceFactor={9} style={{ pointerEvents: "none" }}>
                  <div
                    style={{
                      background: "rgba(9,10,15,0.88)",
                      border: `1px solid ${active ? "#fff" : n.color}`,
                      borderRadius: 4,
                      padding: "2px 6px",
                      fontSize: 9.5,
                      color: "#f1f5f9",
                      fontFamily: "var(--font-mono)",
                      whiteSpace: "nowrap",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{n.label}</div>
                    {n.sublabel && <div style={{ color: "#94a3b8", fontSize: 8.5 }}>{n.sublabel}</div>}
                  </div>
                </Html>
              </group>
            );
          })}

          <OrbitControls enableDamping dampingFactor={0.08} minDistance={3} maxDistance={14} />
        </Canvas>
      </div>
    </div>
  );
}
