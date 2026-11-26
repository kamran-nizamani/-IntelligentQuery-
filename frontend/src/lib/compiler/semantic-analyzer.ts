import {
  LANGUAGE_WORDS,
  TARGET_WORDS,
  type AstExprNode,
  type AstProgramNode,
  type SourceSpan,
} from "./tokens";
import {
  findClosestMatch,
  formatRustDiagnostic,
  type SemanticDiagnostic,
} from "./diagnostics";
import { SymbolTable, type ResolvedSymbolEntry } from "./symbol-table";
import type { QueryAST } from "@/types/search";

export interface SemanticAnalysisResult {
  ast: QueryAST;
  valid: boolean;
  targetResolved: string | null;
  languageResolved: string | null;
  warnings: string[];
  diagnostics: SemanticDiagnostic[];
  symbolTable: ResolvedSymbolEntry[];
  vocabularyChecked: boolean;
}

interface FilterConstraint {
  field: string;
  operator: string;
  value: string | number | boolean;
  negated: boolean;
  span: SourceSpan;
}

const KNOWN_LANGUAGES = Array.from(LANGUAGE_WORDS.keys());
const KNOWN_TARGETS = Array.from(TARGET_WORDS.keys());

function normalizeEnumVal(field: string, value: string): string {
  const lower = value.toLowerCase();
  if (field === "language") return LANGUAGE_WORDS.get(lower) ?? lower;
  if (field === "symbol") return TARGET_WORDS.get(lower) ?? lower;
  return lower;
}

export class SemanticAnalyzer {
  private readonly table = new SymbolTable();
  private readonly diagnostics: SemanticDiagnostic[] = [];
  private readonly constraints: FilterConstraint[] = [];
  private readonly sourceText: string;
  private hasSearchableContent = false;

  constructor(sourceText: string) {
    this.sourceText = sourceText;
  }

  private emit(
    code: string,
    severity: "error" | "warning",
    message: string,
    span: SourceSpan,
    suggestion?: string,
    replacement?: string
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      span,
      suggestion,
      quickFix:
        replacement !== undefined
          ? { title: `Replace with '${replacement}'`, replacement, span }
          : undefined,
      rendered: formatRustDiagnostic(
        this.sourceText,
        severity,
        code,
        message,
        span,
        suggestion
      ),
    });
  }

  analyze(program: AstProgramNode, flatAst: QueryAST): SemanticAnalysisResult {
    // Record leading action in symbol table
    this.table.recordSymbol({
      symbol: program.action,
      canonicalName: program.action,
      category: "action",
      dataType: "keyword",
      span: program.span,
    });

    if (program.body) {
      this.visitExpr(program.body, false, false);
    }

    // Check contradictions in collected constraints (conjunctive conflicts)
    this.checkContradictions();

    // Language + Document conflict check
    if (flatAst.language && flatAst.target === "document") {
      this.emit(
        "SEMW01",
        "warning",
        `Language '${flatAst.language}' specified for target 'document'. Query may yield zero document chunks.`,
        program.span,
        "Remove the language qualifier or change target to 'code' or 'function'."
      );
    }

    // Limit bounds check
    let clampedLimit = flatAst.limit;
    if (flatAst.limit <= 0 || flatAst.limit > 100) {
      this.emit(
        "SEM008",
        "error",
        `Query limit ${flatAst.limit} is out of valid bounds (1–100).`,
        program.span,
        "Specify a limit between 1 and 100 (e.g. 'limit 10')."
      );
      clampedLimit = Math.max(1, Math.min(100, flatAst.limit));
    }

    // Vocabulary / empty search content check
    if (!this.hasSearchableContent && !flatAst.target && !flatAst.language) {
      this.emit(
        "SEM009",
        "error",
        "Query contains no searchable terms, phrases, or metadata filters.",
        program.span,
        "Add descriptive keywords, a quoted phrase, or a field filter."
      );
    }

    const hasErrors = this.diagnostics.some((d) => d.severity === "error");
    const warnings = this.diagnostics.map((d) => `[${d.code}] ${d.message}`);

    return {
      ast: {
        ...flatAst,
        limit: clampedLimit,
      },
      valid: !hasErrors,
      targetResolved: flatAst.target,
      languageResolved: flatAst.language,
      warnings,
      diagnostics: this.diagnostics,
      symbolTable: this.table.getResolvedSymbols(),
      vocabularyChecked: true,
    };
  }

  private visitExpr(node: AstExprNode, negated: boolean, inOrBranch: boolean): void {
    switch (node.kind) {
      case "BinaryExpr": {
        const childInOr = inOrBranch || node.operator === "OR";
        this.visitExpr(node.left, negated, childInOr);
        this.visitExpr(node.right, negated, childInOr);
        break;
      }
      case "UnaryExpr":
        this.visitExpr(node.operand, !negated, inOrBranch);
        break;
      case "GroupExpr":
        this.visitExpr(node.expression, negated, inOrBranch);
        break;
      case "Phrase":
        this.hasSearchableContent = true;
        break;
      case "Term": {
        if (node.role === "word") {
          this.hasSearchableContent = true;
          // Near-miss typo check against known languages/targets for bare words >= 4 chars
          if (node.value.length >= 4) {
            const langMatch = findClosestMatch(node.value, KNOWN_LANGUAGES, 1);
            if (langMatch) {
              this.emit(
                "SEMW03",
                "warning",
                `Term '${node.lexeme}' looks like a typo for language '${langMatch}'.`,
                node.span,
                `did you mean '${langMatch}'?`,
                langMatch
              );
            } else {
              const targetMatch = findClosestMatch(node.value, KNOWN_TARGETS, 1);
              if (targetMatch) {
                this.emit(
                  "SEMW03",
                  "warning",
                  `Term '${node.lexeme}' looks like a typo for target '${targetMatch}'.`,
                  node.span,
                  `did you mean '${targetMatch}'?`,
                  targetMatch
                );
              }
            }
          }
        } else if (node.role === "language") {
          this.hasSearchableContent = true;
          this.table.recordSymbol({
            symbol: node.lexeme,
            canonicalName: LANGUAGE_WORDS.get(node.value) ?? node.value,
            category: "language",
            dataType: "enum",
            value: node.value,
            span: node.span,
          });
        } else if (node.role === "target") {
          this.hasSearchableContent = true;
          this.table.recordSymbol({
            symbol: node.lexeme,
            canonicalName: TARGET_WORDS.get(node.value) ?? node.value,
            category: "target",
            dataType: "enum",
            value: node.value,
            span: node.span,
          });
        } else {
          this.hasSearchableContent = true;
        }
        break;
      }
      case "FieldFilter": {
        this.hasSearchableContent = true;
        const schema = this.table.lookupField(node.field);
        if (!schema) {
          const closest = findClosestMatch(node.field, this.table.canonicalFieldNames(), 2);
          this.emit(
            "SEM001",
            "error",
            `unknown search field '${node.field}'`,
            node.span,
            closest ? `did you mean '${closest}'?` : `Valid fields: ${this.table.canonicalFieldNames().join(", ")}.`,
            closest
          );
          break;
        }

        this.table.recordSymbol({
          symbol: node.field,
          canonicalName: schema.name,
          category: "field",
          dataType: schema.dataType,
          value: node.value,
          span: node.span,
        });

        // Operator compatibility check
        if (!schema.allowedOperators.includes(node.operator)) {
          this.emit(
            "SEM002",
            "error",
            `operator '${node.operator}' is not valid for ${schema.dataType} field '${schema.name}'`,
            node.span,
            `Use one of: ${schema.allowedOperators.join(", ")}`
          );
        }

        // Data type check
        if (schema.dataType === "number" && node.valueType !== "number") {
          this.emit(
            "SEM003",
            "error",
            `field '${schema.name}' expects a numeric value, found ${node.valueType} '${String(node.value)}'`,
            node.span,
            `Provide a number (e.g. ${schema.name} >= 0.5).`
          );
        } else if (schema.dataType === "boolean" && node.valueType !== "boolean") {
          this.emit(
            "SEM003",
            "error",
            `field '${schema.name}' expects a boolean (true/false), found ${node.valueType} '${String(node.value)}'`,
            node.span,
            `Use true or false (e.g. ${schema.name} = true).`
          );
        } else if (
          (schema.dataType === "string" || schema.dataType === "enum") &&
          node.valueType !== "string"
        ) {
          this.emit(
            "SEM003",
            "error",
            `field '${schema.name}' expects a string/identifier, found ${node.valueType}`,
            node.span
          );
        }

        // Enum value validation with Damerau-Levenshtein suggestion
        if (schema.allowedValues && node.valueType === "string") {
          const valLower = String(node.value).toLowerCase();
          if (!schema.allowedValues.includes(valLower)) {
            const closestVal = findClosestMatch(valLower, schema.allowedValues, 2);
            this.emit(
              "SEM004",
              "error",
              `unsupported value '${String(node.value)}' for field '${schema.name}'`,
              node.span,
              closestVal
                ? `did you mean '${closestVal}'?`
                : `Allowed values: ${schema.allowedValues.join(", ")}.`,
              closestVal
            );
          }
        }

        // Numeric range validation
        if (schema.dataType === "number" && node.valueType === "number") {
          const num = Number(node.value);
          if (
            (schema.min !== undefined && num < schema.min) ||
            (schema.max !== undefined && num > schema.max)
          ) {
            this.emit(
              "SEM005",
              "error",
              `numeric value ${num} for '${schema.name}' is outside valid range [${schema.min ?? "-∞"}, ${schema.max ?? "+∞"}]`,
              node.span
            );
          }
        }

        if (!inOrBranch) {
          this.constraints.push({
            field: schema.name,
            operator: node.operator,
            value:
              node.valueType === "string"
                ? normalizeEnumVal(schema.name, String(node.value))
                : node.value,
            negated,
            span: node.span,
          });
        }
        break;
      }
      case "ErrorNode":
        break;
    }
  }

  private checkContradictions(): void {
    const positiveEqByField = new Map<string, FilterConstraint>();
    const negativeEqByField = new Map<string, FilterConstraint[]>();

    for (const c of this.constraints) {
      const isPositiveEq = !c.negated && (c.operator === "=" || c.operator === ":");
      const isNegativeEq =
        (c.negated && (c.operator === "=" || c.operator === ":")) ||
        (!c.negated && c.operator === "!=");

      if (isPositiveEq) {
        const prev = positiveEqByField.get(c.field);
        if (prev && prev.value !== c.value && (c.field === "language" || c.field === "kind" || c.field === "active")) {
          this.emit(
            "SEM006",
            "error",
            `contradictory filter on '${c.field}': cannot equal both '${String(prev.value)}' and '${String(c.value)}' simultaneously`,
            c.span,
            `Use '${c.field} = "${String(prev.value)}" OR ${c.field} = "${String(c.value)}"' if you want either.`
          );
        } else {
          positiveEqByField.set(c.field, c);
        }
      } else if (isNegativeEq) {
        const list = negativeEqByField.get(c.field) ?? [];
        list.push(c);
        negativeEqByField.set(c.field, list);
      }
    }

    for (const [field, pos] of positiveEqByField.entries()) {
      const negs = negativeEqByField.get(field) ?? [];
      for (const neg of negs) {
        if (neg.value === pos.value) {
          this.emit(
            "SEM006",
            "error",
            `contradictory condition: '${field}' is required to both equal and not equal '${String(pos.value)}'`,
            neg.span,
            "Remove one of the conflicting conditions."
          );
        }
      }
    }
  }
}

export function analyzeSemantics(
  program: AstProgramNode,
  flatAst: QueryAST
): SemanticAnalysisResult {
  return new SemanticAnalyzer(program.sourceText).analyze(program, flatAst);
}
