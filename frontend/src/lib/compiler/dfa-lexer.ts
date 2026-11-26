import {
  ACTION_WORDS,
  LANGUAGE_WORDS,
  LIMIT_WORDS,
  RELATION_WORDS,
  TARGET_WORDS,
  type CompilerToken,
  type DFAState,
  type DFATransition,
  type LexDiagnostic,
  type LexerResult,
  type SourceSpan,
  type TokenKind,
} from "./tokens";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isWordStart(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_";
}

function isWordContinue(ch: string): boolean {
  return (
    isWordStart(ch) ||
    isDigit(ch) ||
    ch === "_" ||
    ch === "-" ||
    ch === "#" ||
    ch === "+" ||
    ch === "."
  );
}

function isControlChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  return code < 32 || code === 127;
}

function classifyWord(lexeme: string): { kind: TokenKind; value: string } {
  if (lexeme === "AND") return { kind: "AND", value: "AND" };
  if (lexeme === "OR") return { kind: "OR", value: "OR" };
  if (lexeme === "NOT") return { kind: "NOT", value: "NOT" };

  const lower = lexeme.toLowerCase();
  if (lower === "true" || lower === "false") {
    return { kind: "BOOLEAN", value: lower };
  }
  if (ACTION_WORDS.has(lower)) {
    return { kind: "ACTION", value: lower };
  }
  if (TARGET_WORDS.has(lower)) {
    return { kind: "TARGET", value: lower };
  }
  if (LANGUAGE_WORDS.has(lower)) {
    return { kind: "LANGUAGE", value: lower };
  }
  if (RELATION_WORDS.has(lower)) {
    return { kind: "RELATION", value: lower };
  }
  if (LIMIT_WORDS.has(lower)) {
    return { kind: "LIMIT", value: lower };
  }
  return { kind: "WORD", value: lower };
}

export class DfaLexer {
  private readonly transitions: DFATransition[] = [];
  private readonly diagnostics: LexDiagnostic[] = [];
  private readonly statesVisited = new Set<DFAState>(["START"]);
  private step = 0;

  private record(
    fromState: DFAState,
    toState: DFAState,
    inputChar: string,
    offset: number,
    line: number,
    column: number,
    emittedTokenKind?: TokenKind
  ): void {
    this.statesVisited.add(toState);
    this.transitions.push({
      step: ++this.step,
      fromState,
      toState,
      inputChar,
      offset,
      line,
      column,
      emittedTokenKind,
    });
  }

  tokenize(source: string): LexerResult {
    const tokens: CompilerToken[] = [];
    let i = 0;
    let line = 1;
    let col = 1;

    const advancePos = (ch: string) => {
      if (ch === "\n") {
        line += 1;
        col = 1;
      } else {
        col += 1;
      }
      i += 1;
    };

    while (i < source.length) {
      const ch = source[i];

      if (isWhitespace(ch)) {
        advancePos(ch);
        continue;
      }

      const startOffset = i;
      const startLine = line;
      const startColumn = col;

      if (isControlChar(ch)) {
        this.record("START", "ERROR", ch, i, line, col, "INVALID");
        advancePos(ch);
        const span: SourceSpan = {
          startOffset,
          endOffset: i,
          startLine,
          startColumn,
          endLine: line,
          endColumn: col,
        };
        this.diagnostics.push({
          code: "LEX001",
          severity: "error",
          message: `Unsupported control character at line ${startLine}, column ${startColumn}.`,
          span,
          suggestion: "Remove non-printable control characters from the query.",
        });
        tokens.push({
          kind: "INVALID",
          value: ch,
          lexeme: ch,
          position: startOffset,
          endPosition: i,
          span,
          valid: false,
        });
        continue;
      }

      // Single-character delimiters & colon
      if (ch === "(" || ch === ")" || ch === ":") {
        const kind: TokenKind =
          ch === "(" ? "LPAREN" : ch === ")" ? "RPAREN" : "COLON";
        this.record("START", "ACCEPT", ch, i, line, col, kind);
        advancePos(ch);
        const span: SourceSpan = {
          startOffset,
          endOffset: i,
          startLine,
          startColumn,
          endLine: line,
          endColumn: col,
        };
        tokens.push({
          kind,
          value: ch,
          lexeme: ch,
          position: startOffset,
          endPosition: i,
          span,
          valid: true,
        });
        continue;
      }

      // Quoted string / phrase literal with escape sequences
      if (ch === '"' || ch === "'") {
        const quote = ch;
        this.record("START", "IN_STRING", ch, i, line, col);
        advancePos(ch);

        let value = "";
        let terminated = false;

        while (i < source.length) {
          const cur = source[i];
          if (cur === "\n" || cur === "\r") {
            break;
          }
          if (cur === "\\") {
            this.record("IN_STRING", "IN_STRING_ESCAPE", cur, i, line, col);
            advancePos(cur);
            if (i >= source.length) {
              break;
            }
            const esc = source[i];
            let decoded = esc;
            let validEscape = true;
            if (esc === "n") decoded = "\n";
            else if (esc === "t") decoded = "\t";
            else if (esc === "r") decoded = "\r";
            else if (esc === "\\" || esc === '"' || esc === "'") decoded = esc;
            else {
              validEscape = false;
            }

            if (!validEscape) {
              const escSpan: SourceSpan = {
                startOffset: i - 1,
                endOffset: i + 1,
                startLine: line,
                startColumn: Math.max(1, col - 1),
                endLine: line,
                endColumn: col + 1,
              };
              this.diagnostics.push({
                code: "LEX002",
                severity: "warning",
                message: `Unknown escape sequence '\\${esc}' in string literal.`,
                span: escSpan,
                suggestion: `Use \\\\${esc} if you intended a literal backslash.`,
              });
            }
            value += decoded;
            this.record("IN_STRING_ESCAPE", "IN_STRING", esc, i, line, col);
            advancePos(esc);
            continue;
          }

          if (cur === quote) {
            this.record("IN_STRING", "ACCEPT", cur, i, line, col, "PHRASE");
            advancePos(cur);
            terminated = true;
            break;
          }

          value += cur;
          this.record("IN_STRING", "IN_STRING", cur, i, line, col);
          advancePos(cur);
        }

        const lexeme = source.slice(startOffset, i);
        const span: SourceSpan = {
          startOffset,
          endOffset: i,
          startLine,
          startColumn,
          endLine: line,
          endColumn: col,
        };

        if (!terminated) {
          this.record("IN_STRING", "ERROR", "<EOL>", i, line, col, "INVALID");
          this.diagnostics.push({
            code: "LEX003",
            severity: "error",
            message: `Unterminated quoted phrase starting at line ${startLine}, column ${startColumn}.`,
            span,
            suggestion: `Add a closing ${quote} quote.`,
          });
          tokens.push({
            kind: "INVALID",
            value,
            lexeme,
            position: startOffset,
            endPosition: i,
            span,
            valid: false,
          });
        } else {
          tokens.push({
            kind: "PHRASE",
            value,
            lexeme,
            position: startOffset,
            endPosition: i,
            span,
            valid: true,
          });
        }
        continue;
      }

      // Comparison and symbolic boolean operators
      if (ch === "=" || ch === "!" || ch === ">" || ch === "<" || ch === "&" || ch === "|") {
        const next = source[i + 1] ?? "";
        if (ch === "=") {
          this.record("START", "IN_EQ", ch, i, line, col);
          advancePos(ch);
          if (next === "=") {
            this.record("IN_EQ", "ACCEPT", next, i, line, col, "OP_EQ");
            advancePos(next);
          } else {
            this.record("IN_EQ", "ACCEPT", "<DELIM>", i, line, col, "OP_EQ");
          }
          const lexeme = source.slice(startOffset, i);
          const span: SourceSpan = {
            startOffset,
            endOffset: i,
            startLine,
            startColumn,
            endLine: line,
            endColumn: col,
          };
          tokens.push({
            kind: "OP_EQ",
            value: "=",
            lexeme,
            position: startOffset,
            endPosition: i,
            span,
            valid: true,
          });
          continue;
        }

        if (ch === "!") {
          this.record("START", "IN_BANG", ch, i, line, col);
          advancePos(ch);
          if (next === "=") {
            this.record("IN_BANG", "ACCEPT", next, i, line, col, "OP_NEQ");
            advancePos(next);
            const span: SourceSpan = {
              startOffset,
              endOffset: i,
              startLine,
              startColumn,
              endLine: line,
              endColumn: col,
            };
            tokens.push({
              kind: "OP_NEQ",
              value: "!=",
              lexeme: "!=",
              position: startOffset,
              endPosition: i,
              span,
              valid: true,
            });
          } else {
            this.record("IN_BANG", "ACCEPT", "<DELIM>", i, line, col, "NOT");
            const span: SourceSpan = {
              startOffset,
              endOffset: i,
              startLine,
              startColumn,
              endLine: line,
              endColumn: col,
            };
            tokens.push({
              kind: "NOT",
              value: "NOT",
              lexeme: "!",
              position: startOffset,
              endPosition: i,
              span,
              valid: true,
            });
          }
          continue;
        }

        if (ch === ">") {
          this.record("START", "IN_GT", ch, i, line, col);
          advancePos(ch);
          const isEq = next === "=";
          const kind: TokenKind = isEq ? "OP_GTE" : "OP_GT";
          if (isEq) {
            this.record("IN_GT", "ACCEPT", next, i, line, col, kind);
            advancePos(next);
          } else {
            this.record("IN_GT", "ACCEPT", "<DELIM>", i, line, col, kind);
          }
          const lexeme = source.slice(startOffset, i);
          const span: SourceSpan = {
            startOffset,
            endOffset: i,
            startLine,
            startColumn,
            endLine: line,
            endColumn: col,
          };
          tokens.push({
            kind,
            value: lexeme,
            lexeme,
            position: startOffset,
            endPosition: i,
            span,
            valid: true,
          });
          continue;
        }

        if (ch === "<") {
          this.record("START", "IN_LT", ch, i, line, col);
          advancePos(ch);
          const isEq = next === "=";
          const kind: TokenKind = isEq ? "OP_LTE" : "OP_LT";
          if (isEq) {
            this.record("IN_LT", "ACCEPT", next, i, line, col, kind);
            advancePos(next);
          } else {
            this.record("IN_LT", "ACCEPT", "<DELIM>", i, line, col, kind);
          }
          const lexeme = source.slice(startOffset, i);
          const span: SourceSpan = {
            startOffset,
            endOffset: i,
            startLine,
            startColumn,
            endLine: line,
            endColumn: col,
          };
          tokens.push({
            kind,
            value: lexeme,
            lexeme,
            position: startOffset,
            endPosition: i,
            span,
            valid: true,
          });
          continue;
        }

        if (ch === "&" && next === "&") {
          this.record("START", "IN_AMP", ch, i, line, col);
          advancePos(ch);
          this.record("IN_AMP", "ACCEPT", next, i, line, col, "AND");
          advancePos(next);
          const span: SourceSpan = {
            startOffset,
            endOffset: i,
            startLine,
            startColumn,
            endLine: line,
            endColumn: col,
          };
          tokens.push({
            kind: "AND",
            value: "AND",
            lexeme: "&&",
            position: startOffset,
            endPosition: i,
            span,
            valid: true,
          });
          continue;
        }

        if (ch === "|" && next === "|") {
          this.record("START", "IN_PIPE", ch, i, line, col);
          advancePos(ch);
          this.record("IN_PIPE", "ACCEPT", next, i, line, col, "OR");
          advancePos(next);
          const span: SourceSpan = {
            startOffset,
            endOffset: i,
            startLine,
            startColumn,
            endLine: line,
            endColumn: col,
          };
          tokens.push({
            kind: "OR",
            value: "OR",
            lexeme: "||",
            position: startOffset,
            endPosition: i,
            span,
            valid: true,
          });
          continue;
        }
      }

      // Numeric literals (integers and decimals)
      if (isDigit(ch)) {
        this.record("START", "IN_NUMBER", ch, i, line, col);
        advancePos(ch);
        let state: DFAState = "IN_NUMBER";

        while (i < source.length) {
          const cur = source[i];
          if (isDigit(cur)) {
            this.record(state, "IN_NUMBER", cur, i, line, col);
            state = "IN_NUMBER";
            advancePos(cur);
          } else if (cur === "." && state === "IN_NUMBER" && isDigit(source[i + 1] ?? "")) {
            this.record("IN_NUMBER", "IN_NUMBER_DOT", cur, i, line, col);
            state = "IN_NUMBER_DOT";
            advancePos(cur);
          } else {
            break;
          }
        }

        const lexeme = source.slice(startOffset, i);
        this.record(state, "ACCEPT", "<DELIM>", i, line, col, "NUMBER");
        const span: SourceSpan = {
          startOffset,
          endOffset: i,
          startLine,
          startColumn,
          endLine: line,
          endColumn: col,
        };
        tokens.push({
          kind: "NUMBER",
          value: lexeme,
          lexeme,
          position: startOffset,
          endPosition: i,
          span,
          valid: true,
        });
        continue;
      }

      // Identifiers & Keywords
      if (isWordStart(ch)) {
        this.record("START", "IN_WORD", ch, i, line, col);
        advancePos(ch);

        while (i < source.length && isWordContinue(source[i])) {
          this.record("IN_WORD", "IN_WORD", source[i], i, line, col);
          advancePos(source[i]);
        }

        const lexeme = source.slice(startOffset, i);
        const classified = classifyWord(lexeme);
        this.record("IN_WORD", "ACCEPT", "<DELIM>", i, line, col, classified.kind);
        const span: SourceSpan = {
          startOffset,
          endOffset: i,
          startLine,
          startColumn,
          endLine: line,
          endColumn: col,
        };
        tokens.push({
          kind: classified.kind,
          value: classified.value,
          lexeme,
          position: startOffset,
          endPosition: i,
          span,
          valid: true,
        });
        continue;
      }

      // Unrecognized / illegal character
      this.record("START", "ERROR", ch, i, line, col, "INVALID");
      advancePos(ch);
      const span: SourceSpan = {
        startOffset,
        endOffset: i,
        startLine,
        startColumn,
        endLine: line,
        endColumn: col,
      };
      this.diagnostics.push({
        code: "LEX004",
        severity: "error",
        message: `Unexpected character '${ch}' at line ${startLine}, column ${startColumn}.`,
        span,
        suggestion: "Quote special characters inside a phrase or remove unsupported symbols.",
      });
      tokens.push({
        kind: "INVALID",
        value: ch,
        lexeme: ch,
        position: startOffset,
        endPosition: i,
        span,
        valid: false,
      });
    }

    const eofSpan: SourceSpan = {
      startOffset: source.length,
      endOffset: source.length,
      startLine: line,
      startColumn: col,
      endLine: line,
      endColumn: col,
    };
    this.record("START", "ACCEPT", "<EOF>", source.length, line, col, "EOF");
    tokens.push({
      kind: "EOF",
      value: "<EOF>",
      lexeme: "",
      position: source.length,
      endPosition: source.length,
      span: eofSpan,
      valid: true,
    });

    return {
      tokens,
      transitions: this.transitions,
      diagnostics: this.diagnostics,
      statesVisited: Array.from(this.statesVisited),
    };
  }
}

export function lexWithDfa(source: string): LexerResult {
  return new DfaLexer().tokenize(source);
}
