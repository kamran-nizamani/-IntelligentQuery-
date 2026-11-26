import { describe, expect, it } from "vitest";
import { damerauLevenshtein, findClosestMatch } from "@/lib/compiler/diagnostics";
import { compileQueryTrace } from "@/lib/compiler-engine";

describe("Phase 2: Damerau-Levenshtein & Rust Diagnostics", () => {
  it("computes transposition distance as 1", () => {
    expect(damerauLevenshtein("langauge", "language")).toBe(1);
    expect(findClosestMatch("langauge", ["language", "symbol", "framework"])).toBe("language");
  });

  it("reports unknown field with Rust-style rendered diagnostic and quick fix", () => {
    const trace = compileQueryTrace('langauge = "python"');
    expect(trace.semanticStatus.valid).toBe(false);
    const diag = trace.semanticStatus.diagnostics?.find((d) => d.code === "SEM001");
    expect(diag).toBeDefined();
    expect(diag?.suggestion).toContain("language");
    expect(diag?.quickFix?.replacement).toBe("language");
    expect(diag?.rendered).toContain("error[SEM001]");
    expect(diag?.rendered).toContain("help: did you mean 'language'?");
  });

  it("detects invalid operator and data type mismatches", () => {
    const trace = compileQueryTrace('language > "python" AND score >= "fast"');
    expect(trace.semanticStatus.valid).toBe(false);
    const codes = trace.semanticStatus.diagnostics?.map((d) => d.code) ?? [];
    expect(codes).toContain("SEM002");
    expect(codes).toContain("SEM003");
  });

  it("detects contradictory conjunctive filters but allows OR alternatives", () => {
    const bad = compileQueryTrace('language = "python" AND language = "java"');
    expect(bad.semanticStatus.valid).toBe(false);
    expect(bad.semanticStatus.diagnostics?.some((d) => d.code === "SEM006")).toBe(true);

    const good = compileQueryTrace('language = "python" OR language = "java"');
    expect(good.semanticStatus.valid).toBe(true);
    expect(good.semanticStatus.diagnostics?.some((d) => d.code === "SEM006")).toBe(false);
  });

  it("detects contradiction between positive filter and negated filter", () => {
    const trace = compileQueryTrace('language = "python" AND NOT language = "python"');
    expect(trace.semanticStatus.valid).toBe(false);
    expect(trace.semanticStatus.diagnostics?.some((d) => d.code === "SEM006")).toBe(true);
  });

  it("populates resolved symbol table entries", () => {
    const trace = compileQueryTrace('find python functions AND framework = "fastapi"');
    expect(trace.semanticStatus.valid).toBe(true);
    const categories = trace.semanticStatus.symbolTable?.map((s) => s.category) ?? [];
    expect(categories).toContain("action");
    expect(categories).toContain("language");
    expect(categories).toContain("target");
    expect(categories).toContain("field");
  });

  it("collects multiple diagnostics in a single compilation pass", () => {
    const trace = compileQueryTrace('langauge = "pytohn" AND score = "high" limit 200');
    expect(trace.semanticStatus.valid).toBe(false);
    expect((trace.semanticStatus.diagnostics?.length ?? 0)).toBeGreaterThanOrEqual(3);
  });
});
