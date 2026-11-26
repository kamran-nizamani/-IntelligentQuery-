import type { IRNode, IRPlan } from "./ir-dag";

export type BytecodeOpcode =
  | "PUSH_FILTER"
  | "PUSH_NEGATED_FILTER"
  | "PUSH_LEXICAL"
  | "PUSH_SEMANTIC"
  | "BOOL_AND"
  | "BOOL_OR"
  | "BOOL_NOT"
  | "EXEC_HYBRID_RRF"
  | "APPLY_LIMIT"
  | "RETURN";

export interface QueryBytecodeInstruction {
  pc: number;
  opcode: BytecodeOpcode;
  operand?: string;
  comment: string;
}

export interface CompiledExecutionPlan {
  bytecode: QueryBytecodeInstruction[];
  lexicalQuery: string;
  semanticQuery: string;
  limit: number;
  rrfK: number;
  minSimilarity: number | null;
  filterKind: string | null;
  filterLanguage: string | null;
  filterSymbol: string | null;
  excludedLanguages: string[];
  excludedTerms: string[];
}

export interface VMExecutionTrace {
  stepsExecuted: number;
  dispatchedToBackend: boolean;
  executionTimeMs: number;
  planSummary: CompiledExecutionPlan;
  warnings: string[];
}

export function compileIrToBytecode(plan: IRPlan): CompiledExecutionPlan {
  const bytecode: QueryBytecodeInstruction[] = [];
  let pc = 0;

  const emit = (opcode: BytecodeOpcode, comment: string, operand?: string) => {
    bytecode.push({ pc: pc++, opcode, operand, comment });
  };

  let filterKind: string | null = null;
  let filterLanguage: string | null = null;
  let filterSymbol: string | null = null;
  let minSimilarity: number | null = null;
  const excludedLanguages: string[] = [];
  const excludedTerms: string[] = [];
  const lexicalTerms: string[] = [];
  let semanticQuery = "";
  let limit = 10;
  let rrfK = 60;

  const visit = (node: IRNode, negated = false) => {
    switch (node.kind) {
      case "LIMIT":
        limit = node.limit;
        visit(node.child, negated);
        emit("APPLY_LIMIT", `Cap candidate results to ${node.limit}`, String(node.limit));
        break;
      case "HYBRID_SEARCH":
        rrfK = node.rrfK;
        visit(node.child, negated);
        emit("EXEC_HYBRID_RRF", `Dispatch dual GIN FTS + pgvector HNSW (k=${node.rrfK})`, `rrf_k=${node.rrfK}`);
        break;
      case "BOOLEAN_AND":
        for (const c of node.children) visit(c, negated);
        if (node.children.length > 1) {
          emit("BOOL_AND", `Intersect ${node.children.length} predicate branches`, String(node.children.length));
        }
        break;
      case "BOOLEAN_OR":
        for (const c of node.children) visit(c, negated);
        if (node.children.length > 1) {
          emit("BOOL_OR", `Union ${node.children.length} predicate branches`, String(node.children.length));
        }
        break;
      case "BOOLEAN_NOT":
        visit(node.operand, !negated);
        emit("BOOL_NOT", "Negate top predicate on stack");
        break;
      case "METADATA_FILTER": {
        const valStr = String(node.value).toLowerCase();
        const isNegatedOp = negated || node.operator === "!=";
        if (node.field === "language") {
          if (isNegatedOp) {
            excludedLanguages.push(valStr);
            emit("PUSH_NEGATED_FILTER", `Exclude language != ${valStr}`, `language!=${valStr}`);
          } else {
            filterLanguage = valStr;
            emit("PUSH_FILTER", `Filter language = ${valStr}`, `language=${valStr}`);
          }
        } else if (node.field === "symbol") {
          if (!isNegatedOp) {
            if (valStr === "document") filterKind = "document";
            else if (valStr === "code") filterKind = "code";
            else if (valStr === "function" || valStr === "class") {
              filterKind = "code";
              filterSymbol = valStr;
            }
          }
          emit(
            isNegatedOp ? "PUSH_NEGATED_FILTER" : "PUSH_FILTER",
            `Symbol filter ${node.field} ${node.operator} ${valStr}`,
            `${node.field}${node.operator}${valStr}`
          );
        } else if (node.field === "kind") {
          if (!isNegatedOp && (valStr === "document" || valStr === "code")) {
            filterKind = valStr;
          }
          emit(
            isNegatedOp ? "PUSH_NEGATED_FILTER" : "PUSH_FILTER",
            `Kind filter ${valStr}`,
            `kind=${valStr}`
          );
        } else if (node.field === "score" && (node.operator === ">=" || node.operator === ">")) {
          const parsed = Number(node.value);
          if (!Number.isNaN(parsed)) {
            minSimilarity = Math.max(0, Math.min(1, parsed));
          }
          emit("PUSH_FILTER", `Score threshold ${node.operator} ${parsed}`, `score${node.operator}${parsed}`);
        } else {
          emit(
            isNegatedOp ? "PUSH_NEGATED_FILTER" : "PUSH_FILTER",
            `Metadata predicate ${node.field} ${node.operator} ${valStr}`,
            `${node.field}${node.operator}${valStr}`
          );
        }
        break;
      }
      case "LEXICAL_SEARCH":
        if (negated) {
          excludedTerms.push(node.query);
          emit("PUSH_NEGATED_FILTER", `Exclude lexical term ${node.query}`, node.query);
        } else {
          lexicalTerms.push(node.query);
          emit("PUSH_LEXICAL", `Push lexical query term ${node.query}`, node.query);
        }
        break;
      case "SEMANTIC_SEARCH":
        semanticQuery = node.query;
        emit("PUSH_SEMANTIC", `Push semantic vector target "${node.query}"`, node.query);
        break;
      case "CONSTANT_BOOL":
        break;
    }
  };

  visit(plan.root);
  emit("RETURN", "Return ranked result set");

  return {
    bytecode,
    lexicalQuery: lexicalTerms.join(" ").trim() || semanticQuery,
    semanticQuery,
    limit,
    rrfK,
    minSimilarity,
    filterKind,
    filterLanguage,
    filterSymbol,
    excludedLanguages,
    excludedTerms,
  };
}

export class QueryExecutionVM {
  async execute<T>(
    plan: IRPlan,
    dispatch: (compiled: CompiledExecutionPlan) => Promise<T>,
    timeoutMs = 15000
  ): Promise<{ result: T; vmTrace: VMExecutionTrace }> {
    const t0 = performance.now();
    const warnings: string[] = [];
    if (!plan.valid) {
      warnings.push(...plan.validationErrors);
    }

    const compiled = compileIrToBytecode(plan);

    let timerId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error(`Query VM execution timed out after ${timeoutMs} ms.`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([dispatch(compiled), timeoutPromise]);
      const executionTimeMs = +(performance.now() - t0).toFixed(2);
      return {
        result,
        vmTrace: {
          stepsExecuted: compiled.bytecode.length,
          dispatchedToBackend: true,
          executionTimeMs,
          planSummary: compiled,
          warnings,
        },
      };
    } finally {
      if (timerId !== null) clearTimeout(timerId);
    }
  }
}
