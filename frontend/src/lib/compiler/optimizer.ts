import {
  collectIrEdges,
  formatIRPlan,
  validateIR,
  type BooleanAndIRNode,
  type BooleanOrIRNode,
  type IRNode,
  type IRPlan,
} from "./ir-dag";

export type OptimizationLevel = "O0" | "O1" | "O2";

export interface CostBreakdown {
  totalCost: number;
  vectorSearchCost: number;
  lexicalSearchCost: number;
  filterEvaluationCost: number;
  rankingCost: number;
  estimatedCandidateRows: number;
}

export interface OptimizationPassSnapshot {
  passName: string;
  changed: boolean;
  costBefore: number;
  costAfter: number;
  irTextBefore: string;
  irTextAfter: string;
}

export interface OptimizationResult {
  level: OptimizationLevel;
  originalPlan: IRPlan;
  optimizedPlan: IRPlan;
  appliedPasses: string[];
  snapshots: OptimizationPassSnapshot[];
  costBefore: CostBreakdown;
  costAfter: CostBreakdown;
}

export function estimatePlanCost(root: IRNode, corpusChunks = 1000): CostBreakdown {
  let vectorSearchCost = 0;
  let lexicalSearchCost = 0;
  let filterEvaluationCost = 0;
  let rankingCost = 0;

  const walk = (node: IRNode, selectivityBudget: number) => {
    switch (node.kind) {
      case "LIMIT":
        rankingCost += Math.min(node.limit, 100) * 0.05;
        walk(node.child, selectivityBudget);
        break;
      case "HYBRID_SEARCH":
        rankingCost += 4.5;
        walk(node.child, selectivityBudget);
        break;
      case "BOOLEAN_AND":
        for (const c of node.children) {
          walk(c, selectivityBudget * c.estimatedSelectivity);
        }
        break;
      case "BOOLEAN_OR":
        for (const c of node.children) {
          walk(c, selectivityBudget);
        }
        break;
      case "BOOLEAN_NOT":
        filterEvaluationCost += 0.5;
        walk(node.operand, selectivityBudget);
        break;
      case "METADATA_FILTER":
        // Indexed metadata predicate is cheap (B-tree / equality)
        filterEvaluationCost += 0.8;
        break;
      case "LEXICAL_SEARCH":
        // PostgreSQL GIN FTS scan cost
        lexicalSearchCost += 3.0 * Math.max(0.15, selectivityBudget);
        break;
      case "SEMANTIC_SEARCH":
        // pgvector HNSW approximate nearest neighbor cost
        vectorSearchCost += 8.5 * Math.max(0.2, selectivityBudget);
        break;
      case "CONSTANT_BOOL":
        break;
    }
  };

  walk(root, 1.0);
  const totalCost = +(
    vectorSearchCost +
    lexicalSearchCost +
    filterEvaluationCost +
    rankingCost
  ).toFixed(2);

  return {
    totalCost,
    vectorSearchCost: +vectorSearchCost.toFixed(2),
    lexicalSearchCost: +lexicalSearchCost.toFixed(2),
    filterEvaluationCost: +filterEvaluationCost.toFixed(2),
    rankingCost: +rankingCost.toFixed(2),
    estimatedCandidateRows: Math.max(1, Math.round(corpusChunks * root.estimatedSelectivity)),
  };
}

function nodeSignature(node: IRNode): string {
  switch (node.kind) {
    case "METADATA_FILTER":
      return `F(${node.field}:${node.operator}:${String(node.value).toLowerCase()})`;
    case "LEXICAL_SEARCH":
      return `L(${node.query.trim().toLowerCase()}:${node.isPhrase})`;
    case "SEMANTIC_SEARCH":
      return `S(${node.query.trim().toLowerCase()})`;
    case "CONSTANT_BOOL":
      return `C(${node.value})`;
    case "BOOLEAN_NOT":
      return `NOT(${nodeSignature(node.operand)})`;
    case "BOOLEAN_AND":
      return `AND(${node.children.map(nodeSignature).join(",")})`;
    case "BOOLEAN_OR":
      return `OR(${node.children.map(nodeSignature).join(",")})`;
    case "HYBRID_SEARCH":
      return `HYBRID(${nodeSignature(node.child)})`;
    case "LIMIT":
      return `LIMIT(${node.limit},${nodeSignature(node.child)})`;
  }
}

function mapIr(node: IRNode, fn: (n: IRNode) => IRNode): IRNode {
  let mapped: IRNode = node;
  switch (node.kind) {
    case "LIMIT":
      mapped = { ...node, child: mapIr(node.child, fn) };
      break;
    case "HYBRID_SEARCH":
      mapped = { ...node, child: mapIr(node.child, fn) };
      break;
    case "BOOLEAN_NOT":
      mapped = { ...node, operand: mapIr(node.operand, fn) };
      break;
    case "BOOLEAN_AND":
    case "BOOLEAN_OR":
      mapped = { ...node, children: node.children.map((c) => mapIr(c, fn)) };
      break;
    default:
      mapped = node;
  }
  return fn(mapped);
}

/** Pass 1: Double negation elimination: NOT (NOT X) -> X */
function passDoubleNegation(root: IRNode): IRNode {
  return mapIr(root, (node) => {
    if (node.kind === "BOOLEAN_NOT" && node.operand.kind === "BOOLEAN_NOT") {
      return node.operand.operand;
    }
    return node;
  });
}

/** Pass 2: De Morgan transformations: NOT (A AND B) -> (NOT A) OR (NOT B), etc. */
function passDeMorgan(root: IRNode): IRNode {
  return mapIr(root, (node) => {
    if (node.kind === "BOOLEAN_NOT" && node.operand.kind === "BOOLEAN_AND") {
      const orNode: BooleanOrIRNode = {
        id: node.id,
        kind: "BOOLEAN_OR",
        estimatedSelectivity: node.estimatedSelectivity,
        children: node.operand.children.map((c, idx) => ({
          id: `${node.id}_dm_${idx}`,
          kind: "BOOLEAN_NOT",
          operand: c,
          estimatedSelectivity: +(1 - c.estimatedSelectivity).toFixed(3),
        })),
      };
      return orNode;
    }
    if (node.kind === "BOOLEAN_NOT" && node.operand.kind === "BOOLEAN_OR") {
      const andNode: BooleanAndIRNode = {
        id: node.id,
        kind: "BOOLEAN_AND",
        estimatedSelectivity: node.estimatedSelectivity,
        children: node.operand.children.map((c, idx) => ({
          id: `${node.id}_dm_${idx}`,
          kind: "BOOLEAN_NOT",
          operand: c,
          estimatedSelectivity: +(1 - c.estimatedSelectivity).toFixed(3),
        })),
      };
      return andNode;
    }
    return node;
  });
}

/** Pass 3: Constant folding & Dead branch elimination */
function passConstantFoldingAndDeadBranch(root: IRNode): IRNode {
  return mapIr(root, (node) => {
    if (node.kind === "BOOLEAN_NOT" && node.operand.kind === "CONSTANT_BOOL") {
      return {
        id: node.id,
        kind: "CONSTANT_BOOL",
        value: !node.operand.value,
        estimatedSelectivity: !node.operand.value ? 1 : 0,
      };
    }
    if (node.kind === "BOOLEAN_AND") {
      if (node.children.some((c) => c.kind === "CONSTANT_BOOL" && c.value === false)) {
        return { id: node.id, kind: "CONSTANT_BOOL", value: false, estimatedSelectivity: 0 };
      }
      const filtered = node.children.filter(
        (c) => !(c.kind === "CONSTANT_BOOL" && c.value === true)
      );
      if (filtered.length === 1) return filtered[0];
      if (filtered.length !== node.children.length) {
        return { ...node, children: filtered };
      }
    }
    if (node.kind === "BOOLEAN_OR") {
      if (node.children.some((c) => c.kind === "CONSTANT_BOOL" && c.value === true)) {
        return { id: node.id, kind: "CONSTANT_BOOL", value: true, estimatedSelectivity: 1 };
      }
      const filtered = node.children.filter(
        (c) => !(c.kind === "CONSTANT_BOOL" && c.value === false)
      );
      if (filtered.length === 1) return filtered[0];
      if (filtered.length !== node.children.length) {
        return { ...node, children: filtered };
      }
    }
    return node;
  });
}

/** Pass 4: Flatten nested AND/OR + Boolean simplification & CSE / Redundant filter elimination */
function passSimplifyAndDeduplicate(root: IRNode): IRNode {
  return mapIr(root, (node) => {
    if (node.kind === "BOOLEAN_AND" || node.kind === "BOOLEAN_OR") {
      const flattened: IRNode[] = [];
      for (const child of node.children) {
        if (child.kind === node.kind) {
          flattened.push(...child.children);
        } else {
          flattened.push(child);
        }
      }
      const seen = new Set<string>();
      const unique: IRNode[] = [];
      for (const item of flattened) {
        const sig = nodeSignature(item);
        if (!seen.has(sig)) {
          seen.add(sig);
          unique.push(item);
        }
      }
      if (unique.length === 1) return unique[0];
      return { ...node, children: unique };
    }
    return node;
  });
}

/** Pass 5: Query normalization (whitespace & lowercase filter values) */
function passQueryNormalization(root: IRNode): IRNode {
  return mapIr(root, (node) => {
    if (node.kind === "METADATA_FILTER") {
      return {
        ...node,
        field: node.field.toLowerCase().trim(),
        value: typeof node.value === "string" ? node.value.toLowerCase().trim() : node.value,
      };
    }
    if (node.kind === "LEXICAL_SEARCH" || node.kind === "SEMANTIC_SEARCH") {
      return {
        ...node,
        query: node.query.trim().replace(/\s+/g, " "),
      };
    }
    return node;
  });
}

/** Pass 6: Cost-based predicate ordering (cheapest/most-selective filters first) */
function passPredicateOrdering(root: IRNode): IRNode {
  const rankKind = (n: IRNode): number => {
    if (n.kind === "METADATA_FILTER") return 1;
    if (n.kind === "LEXICAL_SEARCH") return 2;
    if (n.kind === "BOOLEAN_NOT") return 3;
    if (n.kind === "BOOLEAN_AND" || n.kind === "BOOLEAN_OR") return 4;
    if (n.kind === "SEMANTIC_SEARCH") return 5;
    return 6;
  };

  return mapIr(root, (node) => {
    if (node.kind === "BOOLEAN_AND") {
      const sorted = [...node.children].sort((a, b) => {
        const kr = rankKind(a) - rankKind(b);
        if (kr !== 0) return kr;
        return a.estimatedSelectivity - b.estimatedSelectivity;
      });
      return { ...node, children: sorted };
    }
    return node;
  });
}

export function runOptimizationPipeline(
  plan: IRPlan,
  level: OptimizationLevel = "O2"
): OptimizationResult {
  const costBefore = estimatePlanCost(plan.root);

  if (level === "O0") {
    return {
      level,
      originalPlan: plan,
      optimizedPlan: plan,
      appliedPasses: [],
      snapshots: [],
      costBefore,
      costAfter: costBefore,
    };
  }

  const passes: Array<{ name: string; fn: (n: IRNode) => IRNode }> =
    level === "O1"
      ? [
          { name: "QueryNormalization", fn: passQueryNormalization },
          { name: "DoubleNegationElimination", fn: passDoubleNegation },
          { name: "ConstantFoldingAndDeadBranch", fn: passConstantFoldingAndDeadBranch },
        ]
      : [
          { name: "QueryNormalization", fn: passQueryNormalization },
          { name: "DoubleNegationElimination", fn: passDoubleNegation },
          { name: "DeMorganTransformation", fn: passDeMorgan },
          { name: "ConstantFoldingAndDeadBranch", fn: passConstantFoldingAndDeadBranch },
          { name: "BooleanSimplificationAndCSE", fn: passSimplifyAndDeduplicate },
          { name: "CostBasedPredicateOrdering", fn: passPredicateOrdering },
        ];

  let currentRoot = plan.root;
  const snapshots: OptimizationPassSnapshot[] = [];
  const appliedPasses: string[] = [];

  for (const pass of passes) {
    const beforeText = formatIRPlan(currentRoot);
    const beforeCost = estimatePlanCost(currentRoot).totalCost;
    const nextRoot = pass.fn(currentRoot);
    const afterText = formatIRPlan(nextRoot);
    const afterCost = estimatePlanCost(nextRoot).totalCost;
    const changed = beforeText !== afterText;

    if (changed) {
      appliedPasses.push(pass.name);
    }

    snapshots.push({
      passName: pass.name,
      changed,
      costBefore: beforeCost,
      costAfter: afterCost,
      irTextBefore: beforeText,
      irTextAfter: afterText,
    });

    currentRoot = nextRoot;
  }

  const { edges, nodeCount } = collectIrEdges(currentRoot);
  const validationErrors = validateIR(currentRoot);
  const optimizedPlan: IRPlan = {
    root: currentRoot,
    edges,
    nodeCount,
    valid: validationErrors.length === 0,
    validationErrors,
  };

  return {
    level,
    originalPlan: plan,
    optimizedPlan,
    appliedPasses,
    snapshots,
    costBefore,
    costAfter: estimatePlanCost(currentRoot),
  };
}
