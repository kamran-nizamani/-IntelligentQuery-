export type TokenKind =
  | "ACTION"
  | "TARGET"
  | "LANGUAGE"
  | "RELATION"
  | "LIMIT"
  | "NUMBER"
  | "WORD"
  | "PHRASE"
  | "AND"
  | "OR"
  | "NOT"
  | "LPAREN"
  | "RPAREN"
  | "OP_EQ"
  | "OP_NEQ"
  | "OP_GT"
  | "OP_GTE"
  | "OP_LT"
  | "OP_LTE"
  | "COLON"
  | "BOOLEAN"
  | "INVALID"
  | "EOF";

export interface SourceSpan {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface CompilerToken {
  kind: TokenKind;
  value: string;
  lexeme: string;
  position: number;
  endPosition?: number;
  span?: SourceSpan;
  valid?: boolean;
}

export type DFAState =
  | "START"
  | "IN_WORD"
  | "IN_NUMBER"
  | "IN_NUMBER_DOT"
  | "IN_STRING"
  | "IN_STRING_ESCAPE"
  | "IN_BANG"
  | "IN_EQ"
  | "IN_GT"
  | "IN_LT"
  | "IN_AMP"
  | "IN_PIPE"
  | "ACCEPT"
  | "ERROR";

export interface DFATransition {
  step: number;
  fromState: DFAState;
  toState: DFAState;
  inputChar: string;
  offset: number;
  line: number;
  column: number;
  emittedTokenKind?: TokenKind;
}

export interface LexDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  span: SourceSpan;
  suggestion?: string;
}

export interface LexerResult {
  tokens: CompilerToken[];
  transitions: DFATransition[];
  diagnostics: LexDiagnostic[];
  statesVisited: DFAState[];
}

export interface SyntaxDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  expected: TokenKind[];
  found: TokenKind;
  span: SourceSpan;
}

export interface ParseTreeNode {
  id: string;
  rule: string;
  lexeme?: string;
  tokenKind?: TokenKind;
  span: SourceSpan;
  children: ParseTreeNode[];
}

export type FilterOperator = ":" | "=" | "!=" | ">" | ">=" | "<" | "<=";

export type AstExprNode =
  | {
      id: string;
      kind: "BinaryExpr";
      operator: "AND" | "OR";
      left: AstExprNode;
      right: AstExprNode;
      span: SourceSpan;
    }
  | {
      id: string;
      kind: "UnaryExpr";
      operator: "NOT";
      operand: AstExprNode;
      span: SourceSpan;
    }
  | {
      id: string;
      kind: "GroupExpr";
      expression: AstExprNode;
      span: SourceSpan;
    }
  | {
      id: string;
      kind: "FieldFilter";
      field: string;
      operator: FilterOperator;
      value: string | number | boolean;
      valueType: "string" | "number" | "boolean";
      span: SourceSpan;
    }
  | {
      id: string;
      kind: "Phrase";
      value: string;
      span: SourceSpan;
    }
  | {
      id: string;
      kind: "Term";
      value: string;
      lexeme: string;
      role: "word" | "language" | "target" | "relation" | "number" | "boolean";
      span: SourceSpan;
    }
  | {
      id: string;
      kind: "ErrorNode";
      message: string;
      span: SourceSpan;
    };

export interface AstProgramNode {
  id: string;
  kind: "QueryProgram";
  action: string;
  body: AstExprNode | null;
  limit: number | null;
  sourceText: string;
  span: SourceSpan;
}

export const ACTION_WORDS = new Set([
  "find",
  "show",
  "search",
  "locate",
  "get",
  "list",
  "fetch",
]);

export const TARGET_WORDS = new Map<string, string>([
  ["functions", "function"],
  ["function", "function"],
  ["methods", "function"],
  ["method", "function"],
  ["classes", "class"],
  ["class", "class"],
  ["code", "code"],
  ["files", "file"],
  ["file", "file"],
  ["documents", "document"],
  ["document", "document"],
  ["docs", "document"],
  ["notes", "document"],
  ["papers", "document"],
]);

export const LANGUAGE_WORDS = new Map<string, string>([
  ["python", "python"],
  ["py", "python"],
  ["javascript", "javascript"],
  ["js", "javascript"],
  ["java", "java"],
  ["typescript", "typescript"],
  ["ts", "typescript"],
]);

export const RELATION_WORDS = new Set([
  "that",
  "which",
  "where",
  "with",
  "in",
  "about",
  "for",
  "handling",
  "processing",
]);

export const LIMIT_WORDS = new Set(["top", "first", "limit"]);
