# IntelligentQuery 2.0 — Compiler Design Architecture

This document maps each module of the **IntelligentQuery 2.0** TypeScript compiler (`frontend/src/lib/compiler/`) to classical compiler construction theory.

---

## 1. Compiler Pipeline Overview

```text
Source Query (.iq)
  │
  ▼  1. DFA Lexical Analyzer (dfa-lexer.ts)
Token Stream + SourceSpans + DFATransition[] + LexDiagnostic[]
  │
  ▼  2. Recursive-Descent + Pratt Parser (parser.ts)
Concrete Parse Tree + Typed AstProgramNode + SyntaxDiagnostic[]
  │
  ▼  3. Semantic Analyzer + Symbol Table (semantic-analyzer.ts, symbol-table.ts)
Validated AST + ResolvedSymbolEntry[] + Rust-Style SemanticDiagnostic[]
  │
  ▼  4. IR Lowering (ir-dag.ts)
Typed IR Operator DAG (LIMIT -> HYBRID_SEARCH -> BOOLEAN_* / METADATA_FILTER / SEARCH)
  │
  ▼  5. Cost-Based Optimization Pipeline (optimizer.ts) [O0 / O1 / O2]
Optimized IRPlan + Pass Snapshots + CostBreakdown
  │
  ▼  6. Bytecode Compilation & Query Execution VM (vm.ts)
QueryBytecodeInstruction[] -> Dispatched to Supabase hybrid_search_rrf()
```

---

## 2. Phase Mapping

### Phase 1 — Lexical Analysis (`dfa-lexer.ts`)
- Implemented as an explicit Deterministic Finite Automaton (DFA) with states `START`, `IN_WORD`, `IN_NUMBER`, `IN_NUMBER_DOT`, `IN_STRING`, `IN_STRING_ESCAPE`, `IN_BANG`, `IN_EQ`, `IN_GT`, `IN_LT`, `IN_AMP`, `IN_PIPE`, `ACCEPT`, and `ERROR`.
- Records every character transition `(step, fromState, inputChar, toState, line, column, emittedTokenKind)` for the visual DFA Explorer.

### Phase 2 — Syntax Analysis (`parser.ts`)
- Hybrid **Recursive-Descent** (top-level `Query`, `ActionClause`, `LimitClause`) + **Pratt Operator-Precedence Parsing** (`OR` bp 10 < `AND` bp 20 < prefix `NOT` bp 30 < `FieldFilter` < `GroupExpr`).
- Builds both a Concrete Syntax Tree (`ParseTreeNode`) and a typed Abstract Syntax Tree (`AstProgramNode` / `AstExprNode`).
- Uses panic-mode synchronization on `AND`, `OR`, `RPAREN`, `LIMIT`, and `EOF` to recover from syntax errors and report expected tokens.

### Phase 3 — Semantic Analysis & Diagnostics (`semantic-analyzer.ts`, `symbol-table.ts`, `diagnostics.ts`)
- Maintains a `SymbolTable` of queryable fields (`language`, `symbol`, `kind`, `framework`, `score`, `lines`, `active`, `file`), their types, allowed operators, and enum constraints.
- Uses **Damerau-Levenshtein** distance (treating adjacent transpositions as cost 1) to suggest typo fixes (`langauge` → `language`) and renders multi-diagnostic Rust-style error blocks.

### Phase 4 — Intermediate Representation (`ir-dag.ts`)
- Lowers the AST into a typed operator tree/DAG (`IRPlan`) with selectivity estimates per node, structural validation (`validateIR`), human-readable formatting (`formatIRPlan`), and JSON serialization/deserialization.

### Phase 5 — Optimization (`optimizer.ts`)
- Supports `O0` (unoptimized), `O1` (basic), and `O2` (full) optimization levels:
  - Query normalization, double negation elimination (`NOT NOT A → A`), De Morgan transformations, constant folding & dead branch elimination, boolean flattening + Common Subexpression Elimination (CSE), and cost-based predicate ordering (placing selective `METADATA_FILTER` nodes ahead of `LEXICAL_SEARCH` and `SEMANTIC_SEARCH`).

### Phase 6 — Bytecode & Query Execution VM (`vm.ts`)
- Compiles the optimized `IRPlan` into linear stack-oriented `QueryBytecodeInstruction[]` and dispatches the resulting search plan to Supabase's `hybrid_search_rrf()` RPC while recording execution traces and measured latency.
