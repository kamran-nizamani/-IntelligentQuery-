import { describe, expect, it } from "vitest";
import { lexWithDfa } from "@/lib/compiler/dfa-lexer";
import { parseQueryTokens } from "@/lib/compiler/parser";
import { compileQueryTrace } from "@/lib/compiler-engine";

describe("Phase 1: DFA Lexer", () => {
  it("tracks offsets, line/column spans, and DFA transitions", () => {
    const res = lexWithDfa('find python functions\nAND "JWT \\"refresh\\""');
    expect(res.diagnostics).toHaveLength(0);
    expect(res.transitions.length).toBeGreaterThan(10);
    expect(res.statesVisited).toContain("IN_STRING_ESCAPE");

    const andTok = res.tokens.find((t) => t.kind === "AND");
    expect(andTok).toBeDefined();
    expect(andTok?.span?.startLine).toBe(2);
    expect(andTok?.span?.startColumn).toBe(1);

    const phraseTok = res.tokens.find((t) => t.kind === "PHRASE");
    expect(phraseTok?.value).toBe('JWT "refresh"');
  });

  it("keeps lowercase 'and'/'or' as WORD tokens for natural-language queries", () => {
    const res = lexWithDfa("Search documents about hybrid search and RRF");
    expect(res.tokens.some((t) => t.kind === "AND")).toBe(false);
    expect(res.tokens.some((t) => t.kind === "WORD" && t.value === "and")).toBe(true);
  });

  it("detects unterminated strings and unexpected characters with diagnostics", () => {
    const res = lexWithDfa('find @ "unterminated');
    expect(res.diagnostics).toHaveLength(2);
    expect(res.diagnostics.map((d) => d.code)).toEqual(["LEX004", "LEX003"]);
    expect(res.tokens.filter((t) => t.kind === "INVALID")).toHaveLength(2);
  });

  it("tokenizes comparison operators, parentheses, booleans, and decimals", () => {
    const res = lexWithDfa('(score >= 0.75 && active = true) OR framework != "django"');
    expect(res.diagnostics).toHaveLength(0);
    expect(res.tokens.map((t) => t.kind)).toEqual([
      "LPAREN",
      "WORD",
      "OP_GTE",
      "NUMBER",
      "AND",
      "WORD",
      "OP_EQ",
      "BOOLEAN",
      "RPAREN",
      "OR",
      "WORD",
      "OP_NEQ",
      "PHRASE",
      "EOF",
    ]);
  });
});

describe("Phase 1: Recursive-Descent & Pratt Parser", () => {
  it("respects operator precedence (OR < AND < NOT) and parenthesized grouping", () => {
    const lex = lexWithDfa('find python functions AND (java OR javascript) NOT framework = "django" limit 15');
    const parsed = parseQueryTokens(lex.tokens, 'find python functions AND (java OR javascript) NOT framework = "django" limit 15');

    expect(parsed.diagnostics).toHaveLength(0);
    expect(parsed.astTree.action).toBe("find");
    expect(parsed.astTree.limit).toBe(15);
    expect(parsed.astTree.body?.kind).toBe("BinaryExpr");
    expect(parsed.parseTree.rule).toBe("Query");
  });

  it("parses field filters with colon and comparison operators", () => {
    const trace = compileQueryTrace('language:python AND score >= 0.8 AND "data processing"');
    expect(trace.syntaxDiagnostics).toHaveLength(0);
    expect(trace.ast.language).toBe("python");
    expect(trace.ast.topic).toContain('"data processing"');
  });

  it("recovers from syntax errors and reports expected tokens", () => {
    const lex = lexWithDfa("find (python OR ) AND");
    const parsed = parseQueryTokens(lex.tokens, "find (python OR ) AND");
    expect(parsed.diagnostics.length).toBeGreaterThan(0);
    expect(parsed.diagnostics.some((d) => d.code === "SYN004")).toBe(true);
  });

  it("reports missing closing parenthesis", () => {
    const lex = lexWithDfa("find (python OR java");
    const parsed = parseQueryTokens(lex.tokens, "find (python OR java");
    expect(parsed.diagnostics.some((d) => d.code === "SYN008")).toBe(true);
    expect(parsed.diagnostics[0].expected).toContain("RPAREN");
  });
});
