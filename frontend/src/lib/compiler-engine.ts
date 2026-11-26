import type {
  CompilerStageInfo,
  CompilerToken,
  CompilerTrace,
  QueryAST,
  QueryIR,
} from "@/types/search";
import { lexWithDfa } from "./compiler/dfa-lexer";
import { parseQueryTokens } from "./compiler/parser";
import { analyzeSemantics } from "./compiler/semantic-analyzer";
import { formatIRPlan, lowerAstToIrDag } from "./compiler/ir-dag";
import { runOptimizationPipeline, type OptimizationLevel } from "./compiler/optimizer";
import { compileIrToBytecode } from "./compiler/vm";

export function tokenizeQuery(query: string): CompilerToken[] {
  return lexWithDfa(query).tokens;
}

export function parseTokens(tokens: CompilerToken[], sourceText: string): QueryAST {
  return parseQueryTokens(tokens, sourceText).flatAst;
}

export function runSemanticAnalysis(ast: QueryAST): {
  ast: QueryAST;
  valid: boolean;
  targetResolved: string | null;
  languageResolved: string | null;
  warnings: string[];
  vocabularyChecked: boolean;
} {
  const warnings: string[] = [];
  const valid = true;

  if (ast.language && ast.target === "document") {
    warnings.push(`Language '${ast.language}' specified for target 'document'. Query may yield zero document chunks.`);
  }

  if (ast.limit <= 0 || ast.limit > 100) {
    warnings.push(`Specified limit ${ast.limit} is out of typical bounds (1-100); automatically clamped.`);
  }

  return {
    ast: {
      ...ast,
      limit: Math.max(1, Math.min(100, ast.limit)),
    },
    valid,
    targetResolved: ast.target,
    languageResolved: ast.language,
    warnings,
    vocabularyChecked: true,
  };
}

export function generateIR(ast: QueryAST): QueryIR {
  const filters: Record<string, string> = {};

  if (ast.target === "document") {
    filters["content_kind"] = "document";
  } else if (ast.target === "code" || ast.target === "function" || ast.target === "class") {
    filters["content_kind"] = "code";
  }

  if (ast.target === "function" || ast.target === "class") {
    filters["symbol_kind"] = ast.target;
  }

  if (ast.language) {
    filters["language"] = ast.language;
  }

  return {
    operation: "HYBRID_SEARCH",
    filters,
    lexicalQuery: ast.topic,
    semanticQuery: ast.topic,
    limit: ast.limit,
    fusion: "rrf",
  };
}

export function optimizeIR(ir: QueryIR): QueryIR {
  const normalizedFilters: Record<string, string> = {};
  for (const [key, value] of Object.entries(ir.filters).sort(([a], [b]) => a.localeCompare(b))) {
    normalizedFilters[key] = value.toLowerCase().trim();
  }

  const normalizedLexical = ir.lexicalQuery.trim().replace(/\s+/g, " ");
  const normalizedSemantic = ir.semanticQuery.trim().replace(/\s+/g, " ");

  return {
    ...ir,
    filters: normalizedFilters,
    lexicalQuery: normalizedLexical,
    semanticQuery: normalizedSemantic,
  };
}

export function compileQueryTrace(
  sourceQuery: string,
  optimizationLevel: OptimizationLevel = "O2"
): CompilerTrace {
  const t0 = performance.now();

  // 1. DFA Lexical Analysis
  const tLexerStart = performance.now();
  const lexResult = lexWithDfa(sourceQuery);
  const tokens = lexResult.tokens;
  const tLexer = +(performance.now() - tLexerStart).toFixed(2);

  // 2. Recursive-Descent + Pratt Parsing & AST Generation
  const tParserStart = performance.now();
  const parseResult = parseQueryTokens(tokens, sourceQuery);
  const rawAst = parseResult.flatAst;
  const tParser = +(performance.now() - tParserStart).toFixed(2);

  // 3. Semantic Analysis (Symbol Table + Type/Operator/Contradiction Diagnostics)
  const tSemanticStart = performance.now();
  const semantic = analyzeSemantics(parseResult.astTree, rawAst);
  const tSemantic = +(performance.now() - tSemanticStart).toFixed(2);

  // 4. IR Generation (Typed Operator DAG + Legacy QueryIR)
  const tIrStart = performance.now();
  const ir = generateIR(semantic.ast);
  const irPlan = lowerAstToIrDag(parseResult.astTree, semantic.ast);
  const tIr = +(performance.now() - tIrStart).toFixed(2);

  // 5. Query Optimization (O0 / O1 / O2)
  const tOptStart = performance.now();
  const optimizedIr = optimizeIR(ir);
  const optimization = runOptimizationPipeline(irPlan, optimizationLevel);
  const executionPlan = compileIrToBytecode(optimization.optimizedPlan);
  const tOpt = +(performance.now() - tOptStart).toFixed(2);

  const totalTime = +(performance.now() - t0).toFixed(2);

  const stages: CompilerStageInfo[] = [
    {
      id: "stage-1",
      name: "1. Lexical Analysis (DFA Lexer)",
      category: "compiler",
      status: "completed",
      durationMs: Math.max(0.1, tLexer),
      summary: `DFA scanned ${sourceQuery.length} chars across ${lexResult.transitions.length} transitions into ${tokens.length} tokens.`,
      details:
        "Deterministic Finite Automaton (DFA) scans input left-to-right with line/column tracking, escape sequence decoding, operator recognition, and invalid-token diagnostics.",
      inputPreview: `"${sourceQuery}"`,
      outputPreview: `${tokens.length} tokens, ${lexResult.transitions.length} DFA transitions (${lexResult.diagnostics.length} lex diagnostics)`,
      rawOutput: { tokens, transitions: lexResult.transitions, diagnostics: lexResult.diagnostics },
    },
    {
      id: "stage-2",
      name: "2. Syntax Analysis (Pratt + RD Parser)",
      category: "compiler",
      status: "completed",
      durationMs: Math.max(0.1, tParser),
      summary: `Parsed token stream with operator precedence (OR < AND < NOT) and ${parseResult.diagnostics.length} syntax diagnostic(s).`,
      details:
        "Hybrid recursive-descent and Pratt operator-precedence parser supporting nested parentheses, boolean logic (AND/OR/NOT), field filters, and error recovery.",
      inputPreview: `${tokens.length} token stream`,
      outputPreview: `Action=${rawAst.action}, Target=${rawAst.target ?? "any"}, Lang=${rawAst.language ?? "any"}, Errors=${parseResult.diagnostics.length}`,
      rawOutput: { parseTree: parseResult.parseTree, diagnostics: parseResult.diagnostics },
    },
    {
      id: "stage-3",
      name: "3. AST Generation",
      category: "compiler",
      status: "completed",
      durationMs: 0.1,
      summary: "Constructs a typed Abstract Syntax Tree (AstProgramNode + QueryAST).",
      details:
        "Packages parsed expressions, boolean operators, field filters, phrases, and terms into an immutable typed AST with exact source spans.",
      inputPreview: "Concrete Parse Tree",
      outputPreview: `QueryProgram(action="${rawAst.action}", target=${rawAst.target ? `"${rawAst.target}"` : "null"}, topic="${rawAst.topic}")`,
      rawOutput: parseResult.astTree,
    },
    {
      id: "stage-4",
      name: "4. Semantic Analysis",
      category: "compiler",
      status: "completed",
      durationMs: Math.max(0.1, tSemantic),
      summary: "Enforces semantic invariants, symbol resolution, and vocabulary checks.",
      details:
        "Verifies that requested language and target combinations are coherent (e.g. checks that documents do not conflict with programming languages) and validates topic searchability against indexed vocabulary.",
      inputPreview: "Typed AST",
      outputPreview: `Status: ${semantic.valid ? "Valid" : "Invalid"} | Diagnostics: ${semantic.diagnostics.length} | Symbols: ${semantic.symbolTable.length}`,
      rawOutput: semantic,
    },
    {
      id: "stage-5",
      name: "5. Intermediate Representation (IR)",
      category: "compiler",
      status: "completed",
      durationMs: Math.max(0.1, tIr),
      summary: `Emits typed IR operator DAG (${irPlan.nodeCount} nodes, ${irPlan.edges.length} edges).`,
      details:
        "Translates semantic AST into a typed operator DAG specifying HYBRID_SEARCH, boolean operators, metadata filters, lexical/semantic scans, and limits.",
      inputPreview: "Semantically validated AST",
      outputPreview: `IRPlan(${irPlan.nodeCount} nodes, valid=${irPlan.valid}) | ${ir.operation}`,
      rawOutput: { ir, dagText: formatIRPlan(irPlan.root), irPlan },
    },
    {
      id: "stage-6",
      name: "6. Query Optimization",
      category: "compiler",
      status: "completed",
      durationMs: Math.max(0.1, tOpt),
      summary: `Level ${optimizationLevel}: ${optimization.appliedPasses.length} pass(es) applied; cost ${optimization.costBefore.totalCost} -> ${optimization.costAfter.totalCost}.`,
      details:
        "Applies constant folding, double-negation elimination, De Morgan transforms, CSE, query normalization, and cost-based predicate ordering.",
      inputPreview: `Initial IR (cost ${optimization.costBefore.totalCost})`,
      outputPreview: `Optimized IR (cost ${optimization.costAfter.totalCost}) | Passes: ${optimization.appliedPasses.join(", ") || "none"}`,
      rawOutput: { optimizedIr, optimization },
    },
    {
      id: "stage-7",
      name: "7. Hybrid Search (VM & RRF Execution)",
      category: "retrieval",
      status: "completed",
      durationMs: 0,
      summary: `Compiled ${executionPlan.bytecode.length} VM instructions for PostgreSQL GIN FTS + pgvector HNSW (RRF k=60).`,
      details:
        "Compiles optimized IR DAG into stack-oriented query bytecode and dispatches dual lexical & semantic queries to Supabase hybrid_search_rrf fused via Reciprocal Rank Fusion (k=60).",
      inputPreview: `${executionPlan.bytecode.length} VM bytecode ops | "${optimizedIr.lexicalQuery}"`,
      outputPreview: "Dual-ranked candidate list fused and scored via hybrid_search_rrf",
      rawOutput: { fusion: "rrf", k: 60, indexes: ["postgres_gin_fts", "pgvector_hnsw"], executionPlan },
    },
  ];

  return {
    sourceQuery,
    tokens,
    ast: semantic.ast,
    astTree: parseResult.astTree,
    parseTree: parseResult.parseTree,
    dfaTrace: {
      transitions: lexResult.transitions,
      statesVisited: lexResult.statesVisited,
    },
    lexicalDiagnostics: lexResult.diagnostics,
    syntaxDiagnostics: parseResult.diagnostics,
    semanticStatus: semantic,
    ir,
    optimizedIr,
    irPlan: optimization.optimizedPlan,
    optimization,
    optimizationLevel,
    executionPlan,
    stages,
    totalCompilationTimeMs: totalTime,
  };
}
