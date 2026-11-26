"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowRight,
  Box,
  CheckCircle2,
  Download,
  Play,
  Terminal,
} from "lucide-react";
import type { CompilerTrace, CompilerToken, OptimizationLevel } from "@/types/search";
import { apiClient } from "@/lib/api-client";
import { compileQueryTrace } from "@/lib/compiler-engine";
import { formatIRPlan } from "@/lib/compiler/ir-dag";
import { sampleQueries } from "@/data/example-queries";
import { TraceSourceNotice, type TraceSource } from "../ui/trace-source-notice";

const Analyzer3D = dynamic(
  () => import("../3d/analyzer-3d").then((m) => m.Analyzer3D),
  { ssr: false }
);

interface AnalyzerViewProps {
  initialQuery?: string;
  onExecuteInSearch?: (q: string) => void;
}

export function AnalyzerView({
  initialQuery = "Find Python functions that process CSV files",
  onExecuteInSearch,
}: AnalyzerViewProps) {
  const [inputQuery, setInputQuery] = useState(initialQuery);
  const [trace, setTrace] = useState<CompilerTrace | null>(null);
  const [source, setSource] = useState<TraceSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const [selectedToken, setSelectedToken] = useState<CompilerToken | null>(null);
  const [activeTab, setActiveTab] = useState<"tokens" | "dfa" | "ast" | "semantic" | "ir" | "optimizer" | "vm">("tokens");
  const [optLevel, setOptLevel] = useState<OptimizationLevel>("O2");
  const [compiling, setCompiling] = useState(false);
  const [show3D, setShow3D] = useState(true);

  const handleCompile = useCallback(async (qToCompile: string, level: OptimizationLevel = optLevel) => {
    const text = qToCompile.trim();
    if (!text) return;
    const seq = ++requestSeq.current;
    setCompiling(true);
    setError(null);
    try {
      const realTrace =
        level === "O2" ? await apiClient.explain(text) : compileQueryTrace(text, level);
      if (seq !== requestSeq.current) return;
      setTrace(realTrace);
      setSource("local");
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setError(err instanceof Error ? err.message : "Compiler failed");
      setTrace(null);
      setSource(null);
    } finally {
      if (seq === requestSeq.current) {
        setCompiling(false);
        setSelectedToken(null);
      }
    }
  }, [optLevel]);

  // Compile when the app hands us a (new) query; typing in the box does not trigger this.
  useEffect(() => {
    setInputQuery(initialQuery);
    void handleCompile(initialQuery);
  }, [initialQuery, handleCompile]);

  const tokenColors: Record<string, { bg: string; text: string; border: string }> = {
    ACTION: { bg: "rgba(99, 102, 241, 0.15)", text: "var(--tok-action)", border: "rgba(99, 102, 241, 0.4)" },
    TARGET: { bg: "rgba(16, 185, 129, 0.15)", text: "var(--tok-target)", border: "rgba(16, 185, 129, 0.4)" },
    LANGUAGE: { bg: "rgba(59, 130, 246, 0.15)", text: "var(--tok-language)", border: "rgba(59, 130, 246, 0.4)" },
    RELATION: { bg: "rgba(245, 158, 11, 0.15)", text: "var(--tok-relation)", border: "rgba(245, 158, 11, 0.4)" },
    LIMIT: { bg: "rgba(236, 72, 153, 0.15)", text: "var(--tok-limit)", border: "rgba(236, 72, 153, 0.4)" },
    NUMBER: { bg: "rgba(168, 85, 247, 0.15)", text: "var(--tok-number)", border: "rgba(168, 85, 247, 0.4)" },
    WORD: { bg: "rgba(148, 163, 184, 0.15)", text: "var(--tok-word)", border: "rgba(148, 163, 184, 0.4)" },
    PHRASE: { bg: "rgba(20, 184, 166, 0.15)", text: "var(--tok-phrase)", border: "rgba(20, 184, 166, 0.4)" },
    AND: { bg: "rgba(245, 158, 11, 0.18)", text: "#fbbf24", border: "rgba(245, 158, 11, 0.45)" },
    OR: { bg: "rgba(245, 158, 11, 0.18)", text: "#fbbf24", border: "rgba(245, 158, 11, 0.45)" },
    NOT: { bg: "rgba(239, 68, 68, 0.16)", text: "#f87171", border: "rgba(239, 68, 68, 0.45)" },
    LPAREN: { bg: "rgba(148, 163, 184, 0.15)", text: "#cbd5e1", border: "rgba(148, 163, 184, 0.4)" },
    RPAREN: { bg: "rgba(148, 163, 184, 0.15)", text: "#cbd5e1", border: "rgba(148, 163, 184, 0.4)" },
    COLON: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    OP_EQ: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    OP_NEQ: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    OP_GT: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    OP_GTE: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    OP_LT: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    OP_LTE: { bg: "rgba(14, 165, 233, 0.15)", text: "#38bdf8", border: "rgba(14, 165, 233, 0.4)" },
    BOOLEAN: { bg: "rgba(168, 85, 247, 0.15)", text: "var(--tok-number)", border: "rgba(168, 85, 247, 0.4)" },
    INVALID: { bg: "rgba(239, 68, 68, 0.22)", text: "#fca5a5", border: "rgba(239, 68, 68, 0.6)" },
    EOF: { bg: "rgba(100, 116, 139, 0.15)", text: "var(--tok-eof)", border: "rgba(100, 116, 139, 0.4)" },
  };

  return (
    <div className="page-container">
      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-row">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Terminal size={22} style={{ color: "var(--accent-text)" }} />
            <h1 className="page-title">Query Analyzer</h1>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", gap: 3, background: "var(--bg-card-subtle)", border: "1px solid var(--border-card)", borderRadius: 6, padding: 2 }}>
              {(["O0", "O1", "O2"] as const).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => {
                    setOptLevel(lvl);
                    void handleCompile(inputQuery, lvl);
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "none",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    fontWeight: 700,
                    cursor: "pointer",
                    background: optLevel === lvl ? "var(--accent-primary)" : "transparent",
                    color: optLevel === lvl ? "#fff" : "var(--text-muted)",
                  }}
                >
                  -{lvl}
                </button>
              ))}
            </div>
            {trace && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 12 }}
                aria-pressed={show3D}
                onClick={() => setShow3D((v) => !v)}
              >
                <Box size={13} />
                <span>{show3D ? "2D Only" : "3D Stage"}</span>
              </button>
            )}
            {trace && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 12 }}
                onClick={() => {
                  const blob = new Blob([JSON.stringify(trace, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "compiler-trace.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={13} />
                <span>Export JSON</span>
              </button>
            )}
            {onExecuteInSearch && (
              <button
                onClick={() => onExecuteInSearch(inputQuery)}
                className="btn-primary"
                style={{ fontSize: 12 }}
              >
                <span>Execute in Search Workspace</span>
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
        <p className="page-description">
          Demonstrates compiler front-end query decomposition: Lexical Scanner, Recursive-Descent
          Parser, Abstract Syntax Tree (AST), Semantic Type Resolution, and Optimized QueryIR.
        </p>
      </div>

      {/* Query Compile Input */}
      <div className="surface-card" style={{ marginBottom: 20 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCompile(inputQuery);
          }}
          style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
        >
          <div
            className="search-input-box"
            style={{ flex: 1, minWidth: "min(100%, 200px)", padding: "10px 14px", boxShadow: "none" }}
          >
            <Terminal size={16} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              aria-label="Query to analyze"
              placeholder="Enter a natural-language query to analyze with compiler engine..."
              className="search-main-input"
            />
          </div>

          <button type="submit" className="btn-primary" style={{ padding: "10px 18px", flexShrink: 0 }} disabled={compiling || !inputQuery.trim()}>
            <Play size={14} />
            <span>{compiling ? "Compiling..." : "Compile & Analyze"}</span>
          </button>
        </form>

        {/* Query Presets */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 12 }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 700 }}>Presets:</span>
          {sampleQueries.map((sq) => (
            <button
              key={sq}
              type="button"
              onClick={() => {
                setInputQuery(sq);
                void handleCompile(sq);
              }}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 4,
                background: "var(--bg-card-subtle)",
                border: "1px solid var(--border-subtle)",
                color: inputQuery === sq ? "var(--accent-text)" : "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              {sq}
            </button>
          ))}
        </div>
      </div>

      <TraceSourceNotice source={source} error={error} />

      {error && source === null && (
        <div role="alert" data-testid="analyzer-error" className="backend-banner" style={{ margin: "0 0 20px" }}>
          <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <strong>Query rejected by the compiler.</strong> {error}
          </div>
        </div>
      )}

      {!trace && !error && (
        <div className="surface-card" role="status" style={{ textAlign: "center", color: "var(--text-muted)" }}>
          {compiling ? "Compiling…" : "Enter a query and choose Compile & Analyze."}
        </div>
      )}

      {trace && (<>
      {/* Compilation Summary Banner */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <div className="metric-card" style={{ padding: "12px 14px" }}>
          <span className="metric-label">Compiler Status</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <CheckCircle2 size={16} aria-hidden="true" style={{ color: source === "local" ? "var(--success)" : "var(--warning)" }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)" }}>
              {source === "local" ? "Browser compiler" : "Unavailable"}
            </span>
          </div>
        </div>

        <div className="metric-card" style={{ padding: "12px 14px" }}>
          <span className="metric-label">Total Tokens</span>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)", marginTop: 4 }}>
            {trace.tokens.length}
          </div>
        </div>

        <div className="metric-card" style={{ padding: "12px 14px" }}>
          <span className="metric-label">AST Target & Language</span>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-text)", marginTop: 4 }}>
            {trace.ast.target || "any"} · {trace.ast.language || "all"}
          </div>
        </div>

        <div className="metric-card" style={{ padding: "12px 14px" }}>
          <span className="metric-label">Active IR Filters</span>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-main)", marginTop: 4 }}>
            {Object.keys(trace.optimizedIr.filters).length}
          </div>
        </div>

        <div className="metric-card" style={{ padding: "12px 14px" }}>
          <span className="metric-label">Compile time</span>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--success)", marginTop: 4 }}>
            {trace.totalCompilationTimeMs} ms
          </div>
        </div>
      </div>

      {/* Compiler Inspector Tabs */}
      <div
        role="tablist"
        aria-label="Compiler stages"
        style={{
          display: "flex",
          overflowX: "auto",
          borderBottom: "1px solid var(--border-card)",
          marginBottom: 18,
          gap: 6,
        }}
      >
        {[
          { id: "tokens", label: "1. Token Stream", count: trace.tokens.length },
          { id: "dfa", label: "1b. DFA Explorer" },
          { id: "ast", label: "2. AST & Parse Tree" },
          { id: "semantic", label: "3. Semantic Analysis" },
          { id: "ir", label: "4. IR Operator DAG" },
          { id: "optimizer", label: "5. IR Optimizer" },
          { id: "vm", label: "6. VM & Bytecode" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id as typeof activeTab)}
            style={{
              whiteSpace: "nowrap",
              padding: "9px 16px",
              background: "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid var(--accent-primary)" : "2px solid transparent",
              color: activeTab === tab.id ? "var(--text-main)" : "var(--text-muted)",
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Token Stream */}
      {trace && show3D && <Analyzer3D trace={trace} activeTab={activeTab} />}
      {activeTab === "tokens" && (
        <div className="surface-card" role="tabpanel" id="panel-tokens" aria-labelledby="tab-tokens">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              Lexical Analysis Token Stream
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Hover or click on individual tokens to view lexical details, character positions, and category invariants.
            </p>
          </div>

          {/* Token Pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
            {trace.tokens.map((token, index) => {
              const color = tokenColors[token.kind] || tokenColors.WORD;
              const isSelected = selectedToken === token;
              return (
                <button
                  key={index}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedToken(token)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: "var(--radius-sm)",
                    background: isSelected ? "var(--accent-primary)" : color.bg,
                    color: isSelected ? "#fff" : color.text,
                    border: `1px solid ${isSelected ? "var(--accent-primary)" : color.border}`,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 800 }}>{token.kind}:</span>
                  <span style={{ fontWeight: 600 }}>&quot;{token.lexeme || token.value}&quot;</span>
                </button>
              );
            })}
          </div>

          {/* Token Detail Panel */}
          {selectedToken ? (
            <div
              style={{
                background: "var(--bg-card-subtle)",
                border: "1px solid var(--border-card)",
                borderRadius: "var(--radius-sm)",
                padding: "12px 16px",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>
                Selected Token Metadata
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, fontSize: 12 }}>
                <div>Kind: <strong style={{ color: "var(--accent-text)", fontFamily: "var(--font-mono)" }}>{selectedToken.kind}</strong></div>
                <div>Normalized Value: <strong style={{ color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>{selectedToken.value}</strong></div>
                <div>Lexeme: <strong style={{ color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>&quot;{selectedToken.lexeme}&quot;</strong></div>
                <div>Start Position: <strong style={{ color: "var(--info)", fontFamily: "var(--font-mono)" }}>Index {selectedToken.position}</strong></div>
                <div>Span: <strong style={{ color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>{selectedToken.span ? `${selectedToken.span.startLine}:${selectedToken.span.startColumn}–${selectedToken.span.endLine}:${selectedToken.span.endColumn} (${selectedToken.span.startOffset}..${selectedToken.span.endOffset})` : `Index ${selectedToken.position}`}</strong></div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--text-faint)", fontStyle: "italic" }}>
              Click any token above to inspect position and lexeme data.
            </div>
          )}
        </div>
      )}

      {/* Tab 1b: DFA Transition Explorer */}
      {activeTab === "dfa" && (
        <div className="surface-card" role="tabpanel" id="panel-dfa" aria-labelledby="tab-dfa">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              DFA Lexical Transition Explorer
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Deterministic Finite Automaton state transitions recorded while scanning the query.
            </p>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {(trace.dfaTrace?.statesVisited ?? []).map((st) => (
              <span key={st} className="badge badge-semantic" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {st}
              </span>
            ))}
          </div>

          {(trace.lexicalDiagnostics?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 14, padding: 10, borderRadius: 6, background: "var(--danger-subtle)", border: "1px solid var(--danger)" }}>
              {trace.lexicalDiagnostics?.map((d, idx) => (
                <div key={idx} style={{ fontSize: 12, color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>
                  [{d.code}] {d.message} {d.suggestion ? `(${d.suggestion})` : ""}
                </div>
              ))}
            </div>
          )}

          <div className="table-scroll" style={{ maxHeight: 320, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "left" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-faint)" }}>
                  <th style={{ padding: "6px 10px" }}>Step</th>
                  <th style={{ padding: "6px 10px" }}>From</th>
                  <th style={{ padding: "6px 10px" }}>Input</th>
                  <th style={{ padding: "6px 10px" }}>To</th>
                  <th style={{ padding: "6px 10px" }}>Loc</th>
                  <th style={{ padding: "6px 10px" }}>Emitted</th>
                </tr>
              </thead>
              <tbody>
                {(trace.dfaTrace?.transitions ?? []).slice(0, 120).map((tr) => (
                  <tr key={tr.step} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "5px 10px", color: "var(--text-muted)" }}>{tr.step}</td>
                    <td style={{ padding: "5px 10px", color: "var(--info)" }}>{tr.fromState}</td>
                    <td style={{ padding: "5px 10px", color: "var(--text-main)" }}>{JSON.stringify(tr.inputChar)}</td>
                    <td style={{ padding: "5px 10px", color: tr.toState === "ERROR" ? "var(--danger)" : "var(--success)" }}>{tr.toState}</td>
                    <td style={{ padding: "5px 10px", color: "var(--text-muted)" }}>{tr.line}:{tr.column}</td>
                    <td style={{ padding: "5px 10px", color: "var(--accent-text)" }}>{tr.emittedTokenKind ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: AST & Parse Tree */}
      {activeTab === "ast" && (
        <div className="surface-card" role="tabpanel" id="panel-ast" aria-labelledby="tab-ast">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              Abstract Syntax Tree (AST) &amp; Concrete Parse Tree
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Structured node hierarchy produced by recursive-descent and Pratt operator-precedence parsing.
            </p>
          </div>

          {(trace.syntaxDiagnostics?.length ?? 0) > 0 && (
            <div style={{ marginBottom: 14, padding: 10, borderRadius: 6, background: "var(--danger-subtle)", border: "1px solid var(--danger)" }}>
              {trace.syntaxDiagnostics?.map((d, idx) => (
                <div key={idx} style={{ fontSize: 12, color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>
                  [{d.code}] {d.message} (expected: {d.expected.join(" | ")}, found: {d.found})
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
            {/* Visual AST Node Tree */}
            <div
              style={{
                background: "var(--bg-code)",
                padding: 16,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                lineHeight: 1.8,
              }}
            >
              <div style={{ color: "#818cf8", fontWeight: 700 }}>QueryAST [Projected Summary]</div>
              <div style={{ paddingLeft: 18, borderLeft: "1px dashed var(--border-card)" }}>
                <div>├─ action: <span style={{ color: "#34d399" }}>&quot;{trace.ast.action}&quot;</span></div>
                <div>├─ target: <span style={{ color: trace.ast.target ? "#fbbf24" : "var(--text-faint)" }}>{trace.ast.target ? `"${trace.ast.target}"` : "None"}</span></div>
                <div>├─ language: <span style={{ color: trace.ast.language ? "#60a5fa" : "var(--text-faint)" }}>{trace.ast.language ? `"${trace.ast.language}"` : "None"}</span></div>
                <div>├─ topic: <span style={{ color: "#f472b6" }}>&quot;{trace.ast.topic}&quot;</span></div>
                <div>├─ limit: <span style={{ color: "#c084fc" }}>{trace.ast.limit}</span></div>
                <div>└─ source_text: <span style={{ color: "var(--text-muted)" }}>&quot;{trace.ast.sourceText}&quot;</span></div>
              </div>
            </div>

            {/* Typed AST & Parse Tree JSON */}
            <div
              style={{
                background: "var(--bg-code)",
                padding: 16,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
                maxHeight: 340,
                overflowY: "auto",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>
                Typed AstProgramNode
              </div>
              <pre style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#a5b4fc", overflowX: "auto" }}>
{JSON.stringify(trace.astTree ?? trace.ast, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Semantic Analysis */}
      {activeTab === "semantic" && (
        <div className="surface-card" role="tabpanel" id="panel-semantic" aria-labelledby="tab-semantic">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              Semantic Validation & Invariant Checking
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Validates semantic invariants: vocabulary presence, symbol resolution, and type/target coherence.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                padding: 12,
                borderRadius: 6,
                background: "var(--bg-card-subtle)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13, color: "var(--text-main)" }}>Target Symbol Resolution</strong>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Checks if requested symbol type exists in index schemas
                </div>
              </div>
              <span className="badge badge-lexical">
                {trace.semanticStatus.targetResolved ? `Resolved: ${trace.semanticStatus.targetResolved}` : "General (Unrestricted)"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                padding: 12,
                borderRadius: 6,
                background: "var(--bg-card-subtle)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13, color: "var(--text-main)" }}>Language Scope Invariant</strong>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Ensures target language is compatible with target symbol type
                </div>
              </div>
              <span className="badge badge-semantic">
                {trace.semanticStatus.languageResolved ? `Language: ${trace.semanticStatus.languageResolved}` : "All Languages"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                padding: 12,
                borderRadius: 6,
                background: "var(--bg-card-subtle)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 13, color: "var(--text-main)" }}>Search Vocabulary Invariant</strong>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                  Checks the query against the compiler&apos;s supported query vocabulary
                </div>
              </div>
              <span className="badge badge-lexical">
                {trace.semanticStatus.valid ? "Valid" : "Invalid"} · &quot;{trace.ast.topic}&quot;
              </span>
            </div>

            {(trace.semanticStatus.diagnostics?.length ?? 0) > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {trace.semanticStatus.diagnostics?.map((diag, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: 12,
                      borderRadius: 6,
                      background: diag.severity === "error" ? "var(--danger-subtle)" : "var(--warning-subtle)",
                      border: `1px solid ${diag.severity === "error" ? "var(--danger)" : "rgba(245, 158, 11, 0.35)"}`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <AlertTriangle size={15} style={{ color: diag.severity === "error" ? "var(--danger)" : "var(--warning)" }} />
                      <strong style={{ fontSize: 12.5, color: diag.severity === "error" ? "var(--danger)" : "var(--warning)" }}>
                        {diag.severity.toUpperCase()} [{diag.code}]: {diag.message}
                      </strong>
                    </div>
                    <pre style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "var(--text-main)", background: "var(--bg-code)", padding: 10, borderRadius: 4, overflowX: "auto" }}>
                      {diag.rendered}
                    </pre>
                  </div>
                ))}
              </div>
            )}

            {(trace.semanticStatus.symbolTable?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8, padding: 12, borderRadius: 6, background: "var(--bg-card-subtle)", border: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 8 }}>
                  Resolved Symbol Table ({trace.semanticStatus.symbolTable?.length ?? 0} entries)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {trace.semanticStatus.symbolTable?.map((sym, idx) => (
                    <span key={idx} className="badge badge-semantic" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {sym.category}: {sym.canonicalName}{sym.value !== undefined ? ` = ${String(sym.value)}` : ""} ({sym.dataType})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 4: Intermediate Representation (IR) */}
      {activeTab === "ir" && (
        <div className="surface-card" role="tabpanel" id="panel-ir" aria-labelledby="tab-ir">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              Intermediate Representation (QueryIR)
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Engine-agnostic intermediate representation specifying retrieval operation, metadata filter dictionary, and dual query channels.
            </p>
          </div>

          {trace.irPlan && (
            <div
              style={{
                background: "var(--bg-code)",
                padding: 16,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-subtle)",
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>
                Typed IR Operator Tree ({trace.irPlan.nodeCount} nodes, {trace.irPlan.edges.length} edges)
              </div>
              <pre style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "#a5b4fc", overflowX: "auto" }}>
{formatIRPlan(trace.irPlan.root)}
              </pre>
            </div>
          )}

          <div
            style={{
              background: "var(--bg-code)",
              padding: 16,
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              marginBottom: 16,
            }}
          >
            <pre style={{ fontSize: 12.5, fontFamily: "var(--font-mono)", color: "#34d399", overflowX: "auto" }}>
{JSON.stringify(trace.ir, null, 2)}
            </pre>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 12 }}>
            <div style={{ background: "var(--bg-card-subtle)", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 700 }}>OPERATION</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-main)", marginTop: 4 }}>
                {trace.ir.operation}
              </div>
            </div>
            <div style={{ background: "var(--bg-card-subtle)", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 700 }}>FUSION ALGORITHM</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-text)", marginTop: 4 }}>
                Reciprocal Rank Fusion ({trace.ir.fusion.toUpperCase()}) k=60
              </div>
            </div>
            <div style={{ background: "var(--bg-card-subtle)", padding: 12, borderRadius: 6 }}>
              <div style={{ fontSize: 11, color: "var(--text-faint)", fontWeight: 700 }}>DUAL QUERIES</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                PostgreSQL full-text + pgvector + MiniLM
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 5: Optimizer */}
      {activeTab === "optimizer" && (
        <div className="surface-card" role="tabpanel" id="panel-optimizer" aria-labelledby="tab-optimizer">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              Query IR Optimizer (Before vs. After)
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Applies filter canonicalization, key sorting for cache predictability, and whitespace collapse.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>
                Before Optimization (Raw IR)
              </div>
              <div
                style={{
                  background: "var(--bg-code)",
                  padding: 14,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <pre style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#f87171", overflowX: "auto" }}>
{JSON.stringify(trace.ir, null, 2)}
                </pre>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 6 }}>
                After Optimization (Normalized IR)
              </div>
              <div
                style={{
                  background: "var(--bg-code)",
                  padding: 14,
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                }}
              >
                <pre style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#34d399", overflowX: "auto" }}>
{JSON.stringify(trace.optimizedIr, null, 2)}
                </pre>
              </div>
            </div>
          </div>

          {trace.optimization && (
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div style={{ background: "var(--bg-card-subtle)", padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 700 }}>LEVEL</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--accent-text)" }}>-{trace.optimization.level}</div>
              </div>
              <div style={{ background: "var(--bg-card-subtle)", padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 700 }}>EST. COST (BEFORE → AFTER)</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--success)" }}>
                  {trace.optimization.costBefore.totalCost} → {trace.optimization.costAfter.totalCost}
                </div>
              </div>
              <div style={{ background: "var(--bg-card-subtle)", padding: 10, borderRadius: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontWeight: 700 }}>PASSES APPLIED</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-main)" }}>
                  {trace.optimization.appliedPasses.join(", ") || "None (O0)"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 6: VM & Bytecode */}
      {activeTab === "vm" && (
        <div className="surface-card" role="tabpanel" id="panel-vm" aria-labelledby="tab-vm">
          <div style={{ marginBottom: 14 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-main)", marginBottom: 4 }}>
              Query Bytecode &amp; Execution Plan
            </h3>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Stack-oriented bytecode instructions compiled from the optimized IR DAG and dispatched to Supabase hybrid_search_rrf().
            </p>
          </div>

          {trace.executionPlan ? (
            <div className="table-scroll">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-subtle)", color: "var(--text-faint)" }}>
                    <th style={{ padding: "6px 10px" }}>PC</th>
                    <th style={{ padding: "6px 10px" }}>Opcode</th>
                    <th style={{ padding: "6px 10px" }}>Operand</th>
                    <th style={{ padding: "6px 10px" }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.executionPlan.bytecode.map((inst) => (
                    <tr key={inst.pc} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                      <td style={{ padding: "6px 10px", color: "var(--text-muted)" }}>{inst.pc.toString().padStart(2, "0")}</td>
                      <td style={{ padding: "6px 10px", color: "var(--accent-text)", fontWeight: 700 }}>{inst.opcode}</td>
                      <td style={{ padding: "6px 10px", color: "#34d399" }}>{inst.operand ?? "–"}</td>
                      <td style={{ padding: "6px 10px", color: "var(--text-main)" }}>{inst.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No execution plan generated.</p>
          )}
        </div>
      )}
      </>)}
    </div>
  );
}
