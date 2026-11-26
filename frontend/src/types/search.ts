export type SourceKind = "document" | "code";
export type SourceType = "PDF" | "DOCX" | "TXT" | "PY" | "JS" | "JAVA";

export type SearchMode = "hybrid" | "semantic" | "lexical";

export type SearchResult = {
  id: string;
  title: string;
  path: string;
  kind: SourceKind;
  type: SourceType;
  description: string;
  preview: string;
  location: string;
  size?: string;
  language?: string;
  symbol?: string;
  score: number;
  lexicalRank?: number;
  semanticRank?: number;
  matchType?: "hybrid" | "semantic" | "lexical";
  updated: string;
  tags: string[];
};

export type IndexedFile = {
  id: string;
  name: string;
  path: string;
  kind: SourceKind;
  type: SourceType;
  size: string;
  rawSize: number;
  chunks: number;
  status: "Indexed" | "Processing" | "Error";
  updated: string;
  contentPreview?: string;
};

import type {
  AstProgramNode,
  CompilerToken,
  DFAState,
  DFATransition,
  LexDiagnostic,
  ParseTreeNode,
  SyntaxDiagnostic,
} from "@/lib/compiler/tokens";
import type { SemanticDiagnostic } from "@/lib/compiler/diagnostics";
import type { ResolvedSymbolEntry } from "@/lib/compiler/symbol-table";
import type { IRPlan } from "@/lib/compiler/ir-dag";
import type { OptimizationLevel, OptimizationResult } from "@/lib/compiler/optimizer";
import type { CompiledExecutionPlan } from "@/lib/compiler/vm";

export type {
  AstExprNode,
  AstProgramNode,
  CompilerToken,
  DFAState,
  DFATransition,
  FilterOperator,
  LexDiagnostic,
  ParseTreeNode,
  SourceSpan,
  SyntaxDiagnostic,
  TokenKind,
} from "@/lib/compiler/tokens";
export type { SemanticDiagnostic } from "@/lib/compiler/diagnostics";
export type { ResolvedSymbolEntry } from "@/lib/compiler/symbol-table";
export type { IRNode, IRPlan } from "@/lib/compiler/ir-dag";
export type { OptimizationLevel, OptimizationResult, CostBreakdown } from "@/lib/compiler/optimizer";
export type { CompiledExecutionPlan, QueryBytecodeInstruction, VMExecutionTrace } from "@/lib/compiler/vm";

export type QueryAST = {
  action: string;
  target: string | null;
  language: string | null;
  topic: string;
  limit: number;
  sourceText: string;
};

export type QueryIR = {
  operation: string;
  filters: Record<string, string>;
  lexicalQuery: string;
  semanticQuery: string;
  limit: number;
  fusion: string;
};

export type CompilerStageInfo = {
  id: string;
  name: string;
  category: "compiler" | "retrieval";
  status: "completed" | "active" | "ready";
  durationMs: number;
  summary: string;
  details: string;
  inputPreview: string;
  outputPreview: string;
  rawOutput: unknown;
};

export type CompilerTrace = {
  sourceQuery: string;
  tokens: CompilerToken[];
  ast: QueryAST;
  astTree?: AstProgramNode;
  parseTree?: ParseTreeNode;
  dfaTrace?: {
    transitions: DFATransition[];
    statesVisited: DFAState[];
  };
  lexicalDiagnostics?: LexDiagnostic[];
  syntaxDiagnostics?: SyntaxDiagnostic[];
  semanticStatus: {
    valid: boolean;
    targetResolved: string | null;
    languageResolved: string | null;
    warnings: string[];
    diagnostics?: SemanticDiagnostic[];
    symbolTable?: ResolvedSymbolEntry[];
    vocabularyChecked: boolean;
  };
  ir: QueryIR;
  optimizedIr: QueryIR;
  irPlan?: IRPlan;
  optimization?: OptimizationResult;
  optimizationLevel?: OptimizationLevel;
  executionPlan?: CompiledExecutionPlan;
  stages: CompilerStageInfo[];
  totalCompilationTimeMs: number;
};

export type SearchHistoryEntry = {
  id: string;
  query: string;
  timestamp: string;
  date: string;
  mode: SearchMode;
  resultsCount: number;
  latencyMs: number;
  topResultTitle?: string;
  filtersApplied?: {
    kind?: string;
    type?: string;
  };
};

export type SystemMetrics = {
  totalDocuments: number;
  totalCodeFiles: number;
  totalChunks: number;
  totalSearches: number;
  avgLatencyMs: number;
  ftsStatus: "Online" | "Degraded" | "Offline";
  faissStatus: "Online" | "Degraded" | "Offline";
  embeddingModel: string;
  precisionAt1: number;
  precisionAt5: number;
  recallAt5: number;
  mrrScore: number;
};

export type AppTheme = "dark" | "light" | "system";

export type AppSettings = {
  theme: AppTheme;
  defaultSearchMode: SearchMode;
  resultsPerPage: number;
  autoHighlight: boolean;
  enableVoiceInput: boolean;
  voiceLanguage: string;
  showCompilerDrawer: boolean;
  compactMode: boolean;
};
