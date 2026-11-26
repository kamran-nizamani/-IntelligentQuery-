import {
  LANGUAGE_WORDS,
  TARGET_WORDS,
  type AstExprNode,
  type AstProgramNode,
  type CompilerToken,
  type FilterOperator,
  type ParseTreeNode,
  type SourceSpan,
  type SyntaxDiagnostic,
  type TokenKind,
} from "./tokens";
import type { QueryAST } from "@/types/search";

const COMPARISON_OPS = new Map<TokenKind, FilterOperator>([
  ["COLON", ":"],
  ["OP_EQ", "="],
  ["OP_NEQ", "!="],
  ["OP_GT", ">"],
  ["OP_GTE", ">="],
  ["OP_LT", "<"],
  ["OP_LTE", "<="],
]);

export interface ParserResult {
  astTree: AstProgramNode;
  parseTree: ParseTreeNode;
  flatAst: QueryAST;
  diagnostics: SyntaxDiagnostic[];
}

function defaultSpan(pos = 0): SourceSpan {
  return {
    startOffset: pos,
    endOffset: pos,
    startLine: 1,
    startColumn: pos + 1,
    endLine: 1,
    endColumn: pos + 1,
  };
}

function tokenSpan(token: CompilerToken): SourceSpan {
  if (token.span) return token.span;
  const end = token.endPosition ?? token.position + token.lexeme.length;
  return {
    startOffset: token.position,
    endOffset: end,
    startLine: 1,
    startColumn: token.position + 1,
    endLine: 1,
    endColumn: end + 1,
  };
}

function mergeSpan(a: SourceSpan, b: SourceSpan): SourceSpan {
  return {
    startOffset: Math.min(a.startOffset, b.startOffset),
    endOffset: Math.max(a.endOffset, b.endOffset),
    startLine: a.startLine,
    startColumn: a.startColumn,
    endLine: b.endLine,
    endColumn: b.endColumn,
  };
}

function isPrimaryStart(kind: TokenKind): boolean {
  return (
    kind === "LPAREN" ||
    kind === "NOT" ||
    kind === "PHRASE" ||
    kind === "WORD" ||
    kind === "NUMBER" ||
    kind === "BOOLEAN" ||
    kind === "LANGUAGE" ||
    kind === "TARGET" ||
    kind === "RELATION" ||
    kind === "ACTION"
  );
}

export class QueryParser {
  private readonly tokens: CompilerToken[];
  private readonly sourceText: string;
  private readonly diagnostics: SyntaxDiagnostic[] = [];
  private pos = 0;
  private nodeCounter = 0;

  constructor(tokens: CompilerToken[], sourceText: string) {
    this.tokens = tokens;
    this.sourceText = sourceText;
  }

  private nextId(prefix: string): string {
    this.nodeCounter += 1;
    return `${prefix}_${this.nodeCounter}`;
  }

  private peek(offset = 0): CompilerToken {
    const idx = Math.min(this.pos + offset, this.tokens.length - 1);
    return this.tokens[idx];
  }

  private advance(): CompilerToken {
    const cur = this.peek();
    if (cur.kind !== "EOF") {
      this.pos += 1;
    }
    return cur;
  }

  private reportError(code: string, message: string, expected: TokenKind[], found: CompilerToken): void {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      expected,
      found: found.kind,
      span: tokenSpan(found),
    });
  }

  private synchronize(): void {
    while (this.peek().kind !== "EOF") {
      const k = this.peek().kind;
      if (k === "AND" || k === "OR" || k === "RPAREN" || k === "LIMIT") {
        return;
      }
      this.advance();
    }
  }

  parse(): ParserResult {
    const children: ParseTreeNode[] = [];
    let action = "search";

    // Optional leading ActionClause
    if (this.peek().kind === "ACTION") {
      const actionTok = this.advance();
      action = actionTok.value;
      children.push({
        id: this.nextId("pt"),
        rule: "ActionClause",
        lexeme: actionTok.lexeme,
        tokenKind: actionTok.kind,
        span: tokenSpan(actionTok),
        children: [],
      });
    }

    let body: AstExprNode | null = null;
    if (this.peek().kind !== "EOF" && this.peek().kind !== "LIMIT") {
      const exprRes = this.parseExpression(0);
      body = exprRes.ast;
      children.push(exprRes.cst);
    }

    // Optional trailing LimitClause
    let limit: number | null = null;
    if (this.peek().kind === "LIMIT") {
      const limitTok = this.advance();
      const limitChildren: ParseTreeNode[] = [
        {
          id: this.nextId("pt"),
          rule: "LIMIT",
          lexeme: limitTok.lexeme,
          tokenKind: limitTok.kind,
          span: tokenSpan(limitTok),
          children: [],
        },
      ];
      const next = this.peek();
      if (next.kind === "NUMBER") {
        const numTok = this.advance();
        limit = parseInt(numTok.value, 10);
        limitChildren.push({
          id: this.nextId("pt"),
          rule: "NUMBER",
          lexeme: numTok.lexeme,
          tokenKind: numTok.kind,
          span: tokenSpan(numTok),
          children: [],
        });
        children.push({
          id: this.nextId("pt"),
          rule: "LimitClause",
          span: mergeSpan(tokenSpan(limitTok), tokenSpan(numTok)),
          children: limitChildren,
        });
      } else {
        this.reportError(
          "SYN001",
          `Expected a whole number after '${limitTok.lexeme}', found ${next.kind}.`,
          ["NUMBER"],
          next
        );
        children.push({
          id: this.nextId("pt"),
          rule: "LimitClause",
          span: tokenSpan(limitTok),
          children: limitChildren,
        });
      }
    }

    if (this.peek().kind !== "EOF") {
      const stray = this.peek();
      this.reportError(
        "SYN002",
        `Unexpected token '${stray.lexeme || stray.kind}' after query expression.`,
        ["EOF", "AND", "OR", "LIMIT"],
        stray
      );
    }

    const fullSpan =
      this.tokens.length > 0
        ? mergeSpan(tokenSpan(this.tokens[0]), tokenSpan(this.tokens[this.tokens.length - 1]))
        : defaultSpan();

    const astTree: AstProgramNode = {
      id: this.nextId("ast"),
      kind: "QueryProgram",
      action,
      body,
      limit,
      sourceText: this.sourceText,
      span: fullSpan,
    };

    const parseTree: ParseTreeNode = {
      id: this.nextId("pt"),
      rule: "Query",
      span: fullSpan,
      children,
    };

    const flatAst = this.projectFlatAst(astTree);

    return {
      astTree,
      parseTree,
      flatAst,
      diagnostics: this.diagnostics,
    };
  }

  /**
   * Pratt parser for boolean precedence:
   * OR (bp 10) < AND / implicit conjunction (bp 20) < NOT (prefix bp 30) < Primary
   */
  private parseExpression(minBp: number): { ast: AstExprNode; cst: ParseTreeNode } {
    let left = this.parsePrefix();

    while (true) {
      const next = this.peek();
      if (next.kind === "EOF" || next.kind === "RPAREN" || next.kind === "LIMIT") {
        break;
      }

      let op: "AND" | "OR" | null = null;
      let lBp = 0;
      let rBp = 0;
      let explicitOpToken: CompilerToken | null = null;

      if (next.kind === "OR") {
        op = "OR";
        lBp = 10;
        rBp = 11;
      } else if (next.kind === "AND") {
        op = "AND";
        lBp = 20;
        rBp = 21;
      } else if (isPrimaryStart(next.kind)) {
        // Implicit conjunction between adjacent natural-language terms/clauses
        op = "AND";
        lBp = 20;
        rBp = 21;
      } else {
        this.reportError(
          "SYN003",
          `Unexpected token '${next.lexeme || next.kind}' inside expression.`,
          ["AND", "OR", "RPAREN", "LIMIT", "EOF"],
          next
        );
        this.synchronize();
        break;
      }

      if (lBp < minBp) {
        break;
      }

      if (next.kind === "AND" || next.kind === "OR") {
        explicitOpToken = this.advance();
      }

      // Handle trailing operator with no RHS operand (e.g., "python AND")
      const afterOp = this.peek();
      if (afterOp.kind === "EOF" || afterOp.kind === "RPAREN" || afterOp.kind === "LIMIT") {
        const errSpan = explicitOpToken ? tokenSpan(explicitOpToken) : tokenSpan(afterOp);
        this.reportError(
          "SYN004",
          `Expected search expression after '${op}' operator, found ${afterOp.kind}.`,
          ["WORD", "PHRASE", "LPAREN", "NOT"],
          afterOp
        );
        const errNode: AstExprNode = {
          id: this.nextId("ast"),
          kind: "ErrorNode",
          message: `Missing right-hand operand for ${op}`,
          span: errSpan,
        };
        const errCst: ParseTreeNode = {
          id: this.nextId("pt"),
          rule: "Error",
          span: errSpan,
          children: [],
        };
        left = {
          ast: {
            id: this.nextId("ast"),
            kind: "BinaryExpr",
            operator: op,
            left: left.ast,
            right: errNode,
            span: mergeSpan(left.ast.span, errSpan),
          },
          cst: {
            id: this.nextId("pt"),
            rule: op === "OR" ? "OrExpr" : "AndExpr",
            span: mergeSpan(left.cst.span, errSpan),
            children: explicitOpToken
              ? [
                  left.cst,
                  {
                    id: this.nextId("pt"),
                    rule: op,
                    lexeme: explicitOpToken.lexeme,
                    tokenKind: explicitOpToken.kind,
                    span: tokenSpan(explicitOpToken),
                    children: [],
                  },
                  errCst,
                ]
              : [left.cst, errCst],
          },
        };
        break;
      }

      const right = this.parseExpression(rBp);
      const combinedSpan = mergeSpan(left.ast.span, right.ast.span);
      const cstChildren: ParseTreeNode[] = [left.cst];
      if (explicitOpToken) {
        cstChildren.push({
          id: this.nextId("pt"),
          rule: op,
          lexeme: explicitOpToken.lexeme,
          tokenKind: explicitOpToken.kind,
          span: tokenSpan(explicitOpToken),
          children: [],
        });
      }
      cstChildren.push(right.cst);

      left = {
        ast: {
          id: this.nextId("ast"),
          kind: "BinaryExpr",
          operator: op,
          left: left.ast,
          right: right.ast,
          span: combinedSpan,
        },
        cst: {
          id: this.nextId("pt"),
          rule: op === "OR" ? "OrExpr" : "AndExpr",
          span: combinedSpan,
          children: cstChildren,
        },
      };
    }

    return left;
  }

  private parsePrefix(): { ast: AstExprNode; cst: ParseTreeNode } {
    const tok = this.peek();

    if (tok.kind === "INVALID") {
      const bad = this.advance();
      const span = tokenSpan(bad);
      this.reportError(
        "SYN005",
        `Invalid token '${bad.lexeme}' encountered during parsing.`,
        ["WORD", "PHRASE", "LPAREN", "NOT"],
        bad
      );
      return {
        ast: {
          id: this.nextId("ast"),
          kind: "ErrorNode",
          message: `Invalid token '${bad.lexeme}'`,
          span,
        },
        cst: {
          id: this.nextId("pt"),
          rule: "InvalidToken",
          lexeme: bad.lexeme,
          tokenKind: bad.kind,
          span,
          children: [],
        },
      };
    }

    if (tok.kind === "NOT") {
      const notTok = this.advance();
      const after = this.peek();
      if (after.kind === "EOF" || after.kind === "RPAREN" || after.kind === "LIMIT") {
        this.reportError(
          "SYN006",
          `Expected expression after '${notTok.lexeme}', found ${after.kind}.`,
          ["WORD", "PHRASE", "LPAREN"],
          after
        );
        const span = tokenSpan(notTok);
        const errNode: AstExprNode = {
          id: this.nextId("ast"),
          kind: "ErrorNode",
          message: "Missing operand after NOT",
          span,
        };
        return {
          ast: {
            id: this.nextId("ast"),
            kind: "UnaryExpr",
            operator: "NOT",
            operand: errNode,
            span,
          },
          cst: {
            id: this.nextId("pt"),
            rule: "NotExpr",
            span,
            children: [
              {
                id: this.nextId("pt"),
                rule: "NOT",
                lexeme: notTok.lexeme,
                tokenKind: notTok.kind,
                span,
                children: [],
              },
            ],
          },
        };
      }

      const operand = this.parseExpression(30);
      const combinedSpan = mergeSpan(tokenSpan(notTok), operand.ast.span);
      return {
        ast: {
          id: this.nextId("ast"),
          kind: "UnaryExpr",
          operator: "NOT",
          operand: operand.ast,
          span: combinedSpan,
        },
        cst: {
          id: this.nextId("pt"),
          rule: "NotExpr",
          span: combinedSpan,
          children: [
            {
              id: this.nextId("pt"),
              rule: "NOT",
              lexeme: notTok.lexeme,
              tokenKind: notTok.kind,
              span: tokenSpan(notTok),
              children: [],
            },
            operand.cst,
          ],
        },
      };
    }

    if (tok.kind === "LPAREN") {
      const lparen = this.advance();
      if (this.peek().kind === "RPAREN") {
        const rparen = this.advance();
        const span = mergeSpan(tokenSpan(lparen), tokenSpan(rparen));
        this.reportError(
          "SYN007",
          "Empty parenthesized expression '()' is not allowed.",
          ["WORD", "PHRASE", "NOT"],
          rparen
        );
        return {
          ast: {
            id: this.nextId("ast"),
            kind: "ErrorNode",
            message: "Empty group '()'",
            span,
          },
          cst: {
            id: this.nextId("pt"),
            rule: "GroupExpr",
            span,
            children: [],
          },
        };
      }

      const inner = this.parseExpression(0);
      let endSpan = inner.ast.span;
      const children: ParseTreeNode[] = [
        {
          id: this.nextId("pt"),
          rule: "LPAREN",
          lexeme: lparen.lexeme,
          tokenKind: lparen.kind,
          span: tokenSpan(lparen),
          children: [],
        },
        inner.cst,
      ];

      if (this.peek().kind === "RPAREN") {
        const rparen = this.advance();
        endSpan = tokenSpan(rparen);
        children.push({
          id: this.nextId("pt"),
          rule: "RPAREN",
          lexeme: rparen.lexeme,
          tokenKind: rparen.kind,
          span: endSpan,
          children: [],
        });
      } else {
        this.reportError(
          "SYN008",
          `Expected closing ')' for group opened at line ${tokenSpan(lparen).startLine}, column ${tokenSpan(lparen).startColumn}.`,
          ["RPAREN"],
          this.peek()
        );
      }

      const fullSpan = mergeSpan(tokenSpan(lparen), endSpan);
      return {
        ast: {
          id: this.nextId("ast"),
          kind: "GroupExpr",
          expression: inner.ast,
          span: fullSpan,
        },
        cst: {
          id: this.nextId("pt"),
          rule: "GroupExpr",
          span: fullSpan,
          children,
        },
      };
    }

    // Check for FieldFilter: (WORD | LANGUAGE | TARGET) (COLON | OP_*) LiteralOrTerm
    if (
      (tok.kind === "WORD" || tok.kind === "LANGUAGE" || tok.kind === "TARGET") &&
      COMPARISON_OPS.has(this.peek(1).kind)
    ) {
      const fieldTok = this.advance();
      const opTok = this.advance();
      const op = COMPARISON_OPS.get(opTok.kind)!;
      const valTok = this.peek();

      if (
        valTok.kind === "PHRASE" ||
        valTok.kind === "NUMBER" ||
        valTok.kind === "BOOLEAN" ||
        valTok.kind === "WORD" ||
        valTok.kind === "LANGUAGE" ||
        valTok.kind === "TARGET"
      ) {
        const v = this.advance();
        const span = mergeSpan(tokenSpan(fieldTok), tokenSpan(v));
        let parsedVal: string | number | boolean = v.value;
        let valueType: "string" | "number" | "boolean" = "string";
        if (v.kind === "NUMBER") {
          parsedVal = Number(v.value);
          valueType = "number";
        } else if (v.kind === "BOOLEAN") {
          parsedVal = v.value === "true";
          valueType = "boolean";
        }
        return {
          ast: {
            id: this.nextId("ast"),
            kind: "FieldFilter",
            field: fieldTok.value.toLowerCase(),
            operator: op,
            value: parsedVal,
            valueType,
            span,
          },
          cst: {
            id: this.nextId("pt"),
            rule: "FieldFilter",
            span,
            children: [
              {
                id: this.nextId("pt"),
                rule: "FieldName",
                lexeme: fieldTok.lexeme,
                tokenKind: fieldTok.kind,
                span: tokenSpan(fieldTok),
                children: [],
              },
              {
                id: this.nextId("pt"),
                rule: "FilterOp",
                lexeme: opTok.lexeme,
                tokenKind: opTok.kind,
                span: tokenSpan(opTok),
                children: [],
              },
              {
                id: this.nextId("pt"),
                rule: "FilterValue",
                lexeme: v.lexeme,
                tokenKind: v.kind,
                span: tokenSpan(v),
                children: [],
              },
            ],
          },
        };
      }

      this.reportError(
        "SYN009",
        `Expected value after '${fieldTok.lexeme}${opTok.lexeme}', found ${valTok.kind}.`,
        ["PHRASE", "WORD", "NUMBER", "BOOLEAN"],
        valTok
      );
      const errSpan = mergeSpan(tokenSpan(fieldTok), tokenSpan(opTok));
      return {
        ast: {
          id: this.nextId("ast"),
          kind: "ErrorNode",
          message: `Missing value for field filter '${fieldTok.lexeme}'`,
          span: errSpan,
        },
        cst: {
          id: this.nextId("pt"),
          rule: "FieldFilterError",
          span: errSpan,
          children: [],
        },
      };
    }

    // Quoted phrase
    if (tok.kind === "PHRASE") {
      const p = this.advance();
      const span = tokenSpan(p);
      return {
        ast: {
          id: this.nextId("ast"),
          kind: "Phrase",
          value: p.value,
          span,
        },
        cst: {
          id: this.nextId("pt"),
          rule: "Phrase",
          lexeme: p.lexeme,
          tokenKind: p.kind,
          span,
          children: [],
        },
      };
    }

    // Standard term / keyword
    const term = this.advance();
    const span = tokenSpan(term);
    const role: "word" | "language" | "target" | "relation" | "number" | "boolean" =
      term.kind === "LANGUAGE"
        ? "language"
        : term.kind === "TARGET"
        ? "target"
        : term.kind === "RELATION"
        ? "relation"
        : term.kind === "NUMBER"
        ? "number"
        : term.kind === "BOOLEAN"
        ? "boolean"
        : "word";

    return {
      ast: {
        id: this.nextId("ast"),
        kind: "Term",
        value: term.value,
        lexeme: term.lexeme,
        role,
        span,
      },
      cst: {
        id: this.nextId("pt"),
        rule: term.kind,
        lexeme: term.lexeme,
        tokenKind: term.kind,
        span,
        children: [],
      },
    };
  }

  /**
   * Projects the recursive AST onto the backward-compatible flat QueryAST shape
   * used by existing UI and search callers.
   */
  private projectFlatAst(program: AstProgramNode): QueryAST {
    let target: string | null = null;
    let language: string | null = null;
    const topicWords: string[] = [];

    const walk = (node: AstExprNode | null, negated = false) => {
      if (!node) return;
      switch (node.kind) {
        case "BinaryExpr":
          walk(node.left, negated);
          walk(node.right, negated);
          break;
        case "UnaryExpr":
          walk(node.operand, !negated);
          break;
        case "GroupExpr":
          walk(node.expression, negated);
          break;
        case "FieldFilter":
          if (!negated && (node.operator === ":" || node.operator === "=")) {
            const valStr = String(node.value).toLowerCase();
            if (node.field === "language" || node.field === "lang") {
              language = LANGUAGE_WORDS.get(valStr) ?? valStr;
            } else if (node.field === "symbol" || node.field === "target" || node.field === "kind") {
              target = TARGET_WORDS.get(valStr) ?? valStr;
            } else {
              topicWords.push(String(node.value));
            }
          }
          break;
        case "Phrase":
          if (!negated) {
            topicWords.push(`"${node.value}"`);
          }
          break;
        case "Term":
          if (node.role === "language" && !negated) {
            language = LANGUAGE_WORDS.get(node.value) ?? node.value;
          } else if (node.role === "target" && !negated) {
            const mappedTarget = TARGET_WORDS.get(node.value) ?? node.value;
            if (target === null || target === "file") {
              target = mappedTarget;
            } else if (mappedTarget === "file") {
              topicWords.push(node.lexeme);
            } else {
              target = mappedTarget;
            }
          } else if (node.role === "word" && !negated) {
            topicWords.push(node.lexeme);
          }
          break;
        case "ErrorNode":
          break;
      }
    };

    walk(program.body);

    const topic =
      topicWords.join(" ").trim() ||
      (program.sourceText.trim() ? program.sourceText.trim() : "general query");

    return {
      action: program.action,
      target,
      language,
      topic,
      limit: program.limit ?? 10,
      sourceText: program.sourceText,
    };
  }
}

export function parseQueryTokens(tokens: CompilerToken[], sourceText: string): ParserResult {
  return new QueryParser(tokens, sourceText).parse();
}
