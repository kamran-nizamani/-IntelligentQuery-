import type { AstExprNode, AstProgramNode, FilterOperator, SourceSpan } from "./tokens";
import type { QueryAST } from "@/types/search";

export type IRNodeKind =
  | "HYBRID_SEARCH"
  | "BOOLEAN_AND"
  | "BOOLEAN_OR"
  | "BOOLEAN_NOT"
  | "METADATA_FILTER"
  | "LEXICAL_SEARCH"
  | "SEMANTIC_SEARCH"
  | "LIMIT"
  | "CONSTANT_BOOL";

export interface IRNodeBase {
  id: string;
  kind: IRNodeKind;
  span?: SourceSpan;
  estimatedSelectivity: number;
}

export interface HybridSearchIRNode extends IRNodeBase {
  kind: "HYBRID_SEARCH";
  fusion: "rrf";
  rrfK: number;
  child: IRNode;
}

export interface BooleanAndIRNode extends IRNodeBase {
  kind: "BOOLEAN_AND";
  children: IRNode[];
}

export interface BooleanOrIRNode extends IRNodeBase {
  kind: "BOOLEAN_OR";
  children: IRNode[];
}

export interface BooleanNotIRNode extends IRNodeBase {
  kind: "BOOLEAN_NOT";
  operand: IRNode;
}

export interface MetadataFilterIRNode extends IRNodeBase {
  kind: "METADATA_FILTER";
  field: string;
  operator: FilterOperator;
  value: string | number | boolean;
}

export interface LexicalSearchIRNode extends IRNodeBase {
  kind: "LEXICAL_SEARCH";
  query: string;
  isPhrase: boolean;
}

export interface SemanticSearchIRNode extends IRNodeBase {
  kind: "SEMANTIC_SEARCH";
  query: string;
}

export interface LimitIRNode extends IRNodeBase {
  kind: "LIMIT";
  limit: number;
  child: IRNode;
}

export interface ConstantBoolIRNode extends IRNodeBase {
  kind: "CONSTANT_BOOL";
  value: boolean;
}

export type IRNode =
  | HybridSearchIRNode
  | BooleanAndIRNode
  | BooleanOrIRNode
  | BooleanNotIRNode
  | MetadataFilterIRNode
  | LexicalSearchIRNode
  | SemanticSearchIRNode
  | LimitIRNode
  | ConstantBoolIRNode;

export interface IRDagEdge {
  from: string;
  to: string;
  label?: string;
}

export interface IRPlan {
  root: IRNode;
  edges: IRDagEdge[];
  nodeCount: number;
  valid: boolean;
  validationErrors: string[];
}

function estimateFilterSelectivity(field: string, operator: FilterOperator): number {
  if (operator === "=" || operator === ":") {
    if (field === "language") return 0.25;
    if (field === "symbol") return 0.3;
    if (field === "kind") return 0.45;
    return 0.2;
  }
  if (operator === "!=") return 0.75;
  return 0.4;
}

export function collectIrEdges(root: IRNode): { edges: IRDagEdge[]; nodeCount: number } {
  const edges: IRDagEdge[] = [];
  const seen = new Set<string>();

  const walk = (node: IRNode) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);

    switch (node.kind) {
      case "HYBRID_SEARCH":
      case "LIMIT":
        edges.push({ from: node.id, to: node.child.id });
        walk(node.child);
        break;
      case "BOOLEAN_NOT":
        edges.push({ from: node.id, to: node.operand.id, label: "NOT" });
        walk(node.operand);
        break;
      case "BOOLEAN_AND":
      case "BOOLEAN_OR":
        for (const child of node.children) {
          edges.push({ from: node.id, to: child.id });
          walk(child);
        }
        break;
      case "METADATA_FILTER":
      case "LEXICAL_SEARCH":
      case "SEMANTIC_SEARCH":
      case "CONSTANT_BOOL":
        break;
    }
  };

  walk(root);
  return { edges, nodeCount: seen.size };
}

export function validateIR(root: IRNode): string[] {
  const errors: string[] = [];

  const walk = (node: IRNode) => {
    if (node.estimatedSelectivity < 0 || node.estimatedSelectivity > 1) {
      errors.push(`Node ${node.id} (${node.kind}) has invalid selectivity ${node.estimatedSelectivity}.`);
    }
    switch (node.kind) {
      case "HYBRID_SEARCH":
        if (node.rrfK < 1) errors.push(`HYBRID_SEARCH ${node.id} has invalid rrfK=${node.rrfK}.`);
        walk(node.child);
        break;
      case "LIMIT":
        if (node.limit < 1 || node.limit > 100) {
          errors.push(`LIMIT ${node.id} out of range (1..100): ${node.limit}.`);
        }
        walk(node.child);
        break;
      case "BOOLEAN_NOT":
        walk(node.operand);
        break;
      case "BOOLEAN_AND":
      case "BOOLEAN_OR":
        if (node.children.length === 0) {
          errors.push(`${node.kind} ${node.id} has zero children.`);
        }
        for (const c of node.children) walk(c);
        break;
      case "LEXICAL_SEARCH":
      case "SEMANTIC_SEARCH":
        if (!node.query.trim()) {
          errors.push(`${node.kind} ${node.id} has empty query text.`);
        }
        break;
      case "METADATA_FILTER":
      case "CONSTANT_BOOL":
        break;
    }
  };

  walk(root);
  return errors;
}

export function lowerAstToIrDag(program: AstProgramNode, flatAst: QueryAST): IRPlan {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  const lowerExpr = (node: AstExprNode): IRNode | null => {
    switch (node.kind) {
      case "BinaryExpr": {
        const l = lowerExpr(node.left);
        const r = lowerExpr(node.right);
        if (l && r) {
          const sel =
            node.operator === "AND"
              ? +(l.estimatedSelectivity * r.estimatedSelectivity).toFixed(3)
              : +Math.min(1, l.estimatedSelectivity + r.estimatedSelectivity).toFixed(3);
          return {
            id: nextId("ir"),
            kind: node.operator === "AND" ? "BOOLEAN_AND" : "BOOLEAN_OR",
            children: [l, r],
            span: node.span,
            estimatedSelectivity: sel,
          };
        }
        return l ?? r;
      }
      case "UnaryExpr": {
        const inner = lowerExpr(node.operand);
        if (!inner) return null;
        return {
          id: nextId("ir"),
          kind: "BOOLEAN_NOT",
          operand: inner,
          span: node.span,
          estimatedSelectivity: +(1 - inner.estimatedSelectivity).toFixed(3),
        };
      }
      case "GroupExpr":
        return lowerExpr(node.expression);
      case "FieldFilter":
        return {
          id: nextId("ir"),
          kind: "METADATA_FILTER",
          field: node.field,
          operator: node.operator,
          value: node.value,
          span: node.span,
          estimatedSelectivity: estimateFilterSelectivity(node.field, node.operator),
        };
      case "Phrase":
        return {
          id: nextId("ir"),
          kind: "LEXICAL_SEARCH",
          query: `"${node.value}"`,
          isPhrase: true,
          span: node.span,
          estimatedSelectivity: 0.15,
        };
      case "Term": {
        if (node.role === "language") {
          return {
            id: nextId("ir"),
            kind: "METADATA_FILTER",
            field: "language",
            operator: "=",
            value: node.value,
            span: node.span,
            estimatedSelectivity: 0.25,
          };
        }
        if (node.role === "target") {
          return {
            id: nextId("ir"),
            kind: "METADATA_FILTER",
            field: "symbol",
            operator: "=",
            value: node.value,
            span: node.span,
            estimatedSelectivity: 0.3,
          };
        }
        if (node.role === "relation") {
          return null;
        }
        return {
          id: nextId("ir"),
          kind: "LEXICAL_SEARCH",
          query: node.lexeme,
          isPhrase: false,
          span: node.span,
          estimatedSelectivity: 0.35,
        };
      }
      case "ErrorNode":
        return null;
    }
  };

  const bodyNode = program.body ? lowerExpr(program.body) : null;
  const semanticNode: SemanticSearchIRNode = {
    id: nextId("ir"),
    kind: "SEMANTIC_SEARCH",
    query: flatAst.topic || program.sourceText.trim() || "general query",
    span: program.span,
    estimatedSelectivity: 0.4,
  };

  const combinedChild: IRNode = bodyNode
    ? {
        id: nextId("ir"),
        kind: "BOOLEAN_AND",
        children: [bodyNode, semanticNode],
        span: program.span,
        estimatedSelectivity: +(bodyNode.estimatedSelectivity * semanticNode.estimatedSelectivity).toFixed(3),
      }
    : semanticNode;

  const hybridNode: HybridSearchIRNode = {
    id: nextId("ir"),
    kind: "HYBRID_SEARCH",
    fusion: "rrf",
    rrfK: 60,
    child: combinedChild,
    span: program.span,
    estimatedSelectivity: combinedChild.estimatedSelectivity,
  };

  const root: LimitIRNode = {
    id: nextId("ir"),
    kind: "LIMIT",
    limit: flatAst.limit,
    child: hybridNode,
    span: program.span,
    estimatedSelectivity: hybridNode.estimatedSelectivity,
  };

  const { edges, nodeCount } = collectIrEdges(root);
  const validationErrors = validateIR(root);

  return {
    root,
    edges,
    nodeCount,
    valid: validationErrors.length === 0,
    validationErrors,
  };
}

export function formatIRPlan(node: IRNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  switch (node.kind) {
    case "LIMIT":
      return `${pad}LIMIT(${node.limit}) [sel=${node.estimatedSelectivity}]\n${formatIRPlan(node.child, indent + 1)}`;
    case "HYBRID_SEARCH":
      return `${pad}HYBRID_SEARCH(fusion=${node.fusion}, k=${node.rrfK}) [sel=${node.estimatedSelectivity}]\n${formatIRPlan(node.child, indent + 1)}`;
    case "BOOLEAN_AND":
    case "BOOLEAN_OR":
      return `${pad}${node.kind} [sel=${node.estimatedSelectivity}]\n${node.children.map((c) => formatIRPlan(c, indent + 1)).join("\n")}`;
    case "BOOLEAN_NOT":
      return `${pad}BOOLEAN_NOT [sel=${node.estimatedSelectivity}]\n${formatIRPlan(node.operand, indent + 1)}`;
    case "METADATA_FILTER":
      return `${pad}METADATA_FILTER(${node.field} ${node.operator} ${JSON.stringify(node.value)}) [sel=${node.estimatedSelectivity}]`;
    case "LEXICAL_SEARCH":
      return `${pad}LEXICAL_SEARCH(${JSON.stringify(node.query)}, phrase=${node.isPhrase}) [sel=${node.estimatedSelectivity}]`;
    case "SEMANTIC_SEARCH":
      return `${pad}SEMANTIC_SEARCH(${JSON.stringify(node.query)}) [sel=${node.estimatedSelectivity}]`;
    case "CONSTANT_BOOL":
      return `${pad}CONSTANT_BOOL(${node.value})`;
  }
}

export function serializeIRPlan(plan: IRPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function deserializeIRPlan(raw: string): IRPlan {
  const parsed = JSON.parse(raw) as IRPlan;
  const validationErrors = validateIR(parsed.root);
  return {
    ...parsed,
    valid: validationErrors.length === 0,
    validationErrors,
  };
}
