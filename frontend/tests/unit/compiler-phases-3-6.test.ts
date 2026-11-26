import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileQueryTrace } from "@/lib/compiler-engine";
import { deserializeIRPlan, formatIRPlan, serializeIRPlan } from "@/lib/compiler/ir-dag";
import { compileIrToBytecode, QueryExecutionVM } from "@/lib/compiler/vm";
import {
  buildMatchExplanation,
  deduplicateResults,
  expandDeveloperQuery,
} from "@/lib/compiler/query-intelligence";
import type { SearchResult } from "@/types/search";

describe("Phases 3–6: IR DAG, Optimization, Bytecode VM & Search Intelligence", () => {
  it("lowers AST to a valid typed IR DAG and round-trips JSON serialization", () => {
    const trace = compileQueryTrace('language:python AND "JWT refresh" limit 12');
    expect(trace.irPlan).toBeDefined();
    expect(trace.irPlan?.valid).toBe(true);
    expect(trace.irPlan?.nodeCount).toBeGreaterThan(3);

    const text = formatIRPlan(trace.irPlan!.root);
    expect(text).toContain("LIMIT(12)");
    expect(text).toContain("HYBRID_SEARCH");

    const serialized = serializeIRPlan(trace.irPlan!);
    const deserialized = deserializeIRPlan(serialized);
    expect(deserialized.valid).toBe(true);
    expect(deserialized.nodeCount).toBe(trace.irPlan?.nodeCount);
  });

  it("applies O0 vs O1 vs O2 optimization passes and orders selective filters first", () => {
    const traceO0 = compileQueryTrace("find python functions AND python AND CSV", "O0");
    const traceO2 = compileQueryTrace("find python functions AND python AND CSV", "O2");

    expect(traceO0.optimization?.appliedPasses).toHaveLength(0);
    expect(traceO2.optimization?.appliedPasses.length).toBeGreaterThan(0);
    expect(traceO2.optimization?.costAfter.totalCost).toBeLessThanOrEqual(
      traceO2.optimization?.costBefore.totalCost ?? Infinity
    );
  });

  it("eliminates double negation and applies De Morgan transformations", () => {
    const trace = compileQueryTrace('NOT (NOT language = "python")');
    expect(trace.optimization?.appliedPasses).toContain("DoubleNegationElimination");

    const deMorgan = compileQueryTrace('NOT (language = "python" OR language = "java")');
    expect(deMorgan.optimization?.appliedPasses).toContain("DeMorganTransformation");
  });

  it("compiles IR into bytecode and executes via QueryExecutionVM", async () => {
    const trace = compileQueryTrace('find python functions AND score >= 0.5 NOT language = "java" limit 7');
    const plan = compileIrToBytecode(trace.irPlan!);
    expect(plan.bytecode.length).toBeGreaterThan(3);
    expect(plan.limit).toBe(7);
    expect(plan.minSimilarity).toBe(0.5);
    expect(plan.excludedLanguages).toContain("java");

    const vm = new QueryExecutionVM();
    const out = await vm.execute(trace.irPlan!, async (compiled) => ({
      count: compiled.limit,
    }));
    expect(out.result.count).toBe(7);
    expect(out.vmTrace.dispatchedToBackend).toBe(true);
    expect(out.vmTrace.stepsExecuted).toBeGreaterThan(3);
  });

  it("expands developer queries, builds match explanations, and deduplicates results", () => {
    const expanded = expandDeveloperQuery("auth jwt");
    expect(expanded.expandedTerms).toContain("authentication");

    const explanation = buildMatchExplanation(
      { lexicalRank: 1, vectorRank: 2, language: "python", symbolKind: "function", symbolName: "verify_jwt" },
      { language: "python" }
    );
    expect(explanation).toContain("Hybrid RRF");
    expect(explanation).toContain("verify_jwt");

    const sample: SearchResult = {
      id: "1",
      title: "a.py",
      path: "src/a.py",
      kind: "code",
      type: "PY",
      description: "match",
      preview: "def verify_jwt(token): return True",
      location: "Lines 1-2",
      score: 0.9,
      updated: "Indexed",
      tags: [],
    };
    expect(deduplicateResults([sample, { ...sample, id: "2" }])).toHaveLength(1);
  });

  it("validates all canonical golden_queries.json expectations", () => {
    const goldenPath = path.resolve(process.cwd(), "..", "golden_queries.json");
    const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as Array<{
      id: string;
      query: string;
      expectedValid: boolean;
      expectedLanguage?: string;
      expectedTarget?: string;
      expectedLimit?: number;
      expectedDiagnosticCodes?: string[];
      expectedSyntaxCodes?: string[];
    }>;

    expect(golden.length).toBeGreaterThanOrEqual(8);
    for (const g of golden) {
      const trace = compileQueryTrace(g.query);
      expect(trace.semanticStatus.valid, `Golden ${g.id} valid mismatch`).toBe(g.expectedValid);
      if (g.expectedLanguage) expect(trace.ast.language).toBe(g.expectedLanguage);
      if (g.expectedTarget) expect(trace.ast.target).toBe(g.expectedTarget);
      if (g.expectedLimit) expect(trace.ast.limit).toBe(g.expectedLimit);
      if (g.expectedDiagnosticCodes) {
        const codes = trace.semanticStatus.diagnostics?.map((d) => d.code) ?? [];
        for (const c of g.expectedDiagnosticCodes) expect(codes).toContain(c);
      }
      if (g.expectedSyntaxCodes) {
        const codes = trace.syntaxDiagnostics?.map((d) => d.code) ?? [];
        for (const c of g.expectedSyntaxCodes) expect(codes).toContain(c);
      }
    }
  });
});
