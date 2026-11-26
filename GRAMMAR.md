# IntelligentQuery (`.iq`) Formal Query Language Grammar

This document defines the formal lexical specification, context-free EBNF grammar, operator precedence, and error-recovery rules for the **IntelligentQuery 2.0** query language.

---

## 1. Lexical Specification (DFA Scanner)

The lexical analyzer is implemented as a deterministic finite automaton (DFA) that scans UTF-8 input left-to-right while tracking:

- `startOffset`, `endOffset` (0-based character offsets)
- `startLine`, `startColumn`, `endLine`, `endColumn` (1-based line and column numbers)
- State transitions `(fromState, inputChar, toState)`

### 1.1 Token Classes

| Token Kind | Pattern / Lexemes | Examples |
| :--- | :--- | :--- |
| `ACTION` | Case-insensitive query imperative | `find`, `show`, `search`, `locate`, `get`, `list`, `fetch` |
| `TARGET` | Case-insensitive target entity | `function`, `functions`, `method`, `class`, `code`, `file`, `document`, `documents`, `docs`, `notes`, `papers` |
| `LANGUAGE` | Case-insensitive language qualifier | `python`, `py`, `java`, `javascript`, `js`, `typescript`, `ts` |
| `RELATION` | Case-insensitive natural-language connector | `that`, `which`, `where`, `with`, `in`, `about`, `for`, `handling`, `processing` |
| `LIMIT` | Case-insensitive result limit keyword | `limit`, `top`, `first` |
| `AND` | `AND` (exact uppercase) or `&&` | `AND`, `&&` |
| `OR` | `OR` (exact uppercase) or `\|\|` | `OR`, `\|\|` |
| `NOT` | `NOT` (exact uppercase) or `!` | `NOT`, `!` |
| `BOOLEAN` | `true` \| `false` (case-insensitive) | `true`, `false` |
| `NUMBER` | `[0-9]+(\.[0-9]+)?` | `5`, `10`, `0.85` |
| `PHRASE` | `"..."` or `'...'` with `\"`, `\'`, `\\`, `\n`, `\t`, `\r` escapes | `"data processing"`, `"JWT \"refresh\""` |
| `LPAREN` / `RPAREN` | `(` and `)` | `(`, `)` |
| `OP_EQ` | `=` or `==` | `=`, `==` |
| `OP_NEQ` | `!=` | `!=` |
| `OP_GT` / `OP_GTE` | `>` / `>=` | `>`, `>=` |
| `OP_LT` / `OP_LTE` | `<` / `<=` | `<`, `<=` |
| `COLON` | `:` | `:` |
| `WORD` | `[A-Za-z_][A-Za-z0-9_#+-]*` (non-keyword identifier/term) | `framework`, `django`, `CSV`, `auth_token` |
| `INVALID` | Unrecognized character, invalid escape, or unterminated string | `@`, `"unclosed` |
| `EOF` | End of input | `<EOF>` |

> **Design Note (Natural-Language Compatibility):** Lowercase `and`, `or`, `not` are tokenized as `WORD` so natural-language queries such as `"Search documents about hybrid search and RRF"` remain valid descriptive topic queries, while uppercase `AND`, `OR`, `NOT` (or `&&`, `||`, `!`) act as formal boolean operators.

---

## 2. Context-Free Grammar (EBNF)

```ebnf
Query          ::= [ ActionClause ] OrExpr [ LimitClause ] EOF ;

ActionClause   ::= ACTION ;

LimitClause    ::= LIMIT NUMBER ;

OrExpr         ::= AndExpr { OR AndExpr } ;

AndExpr        ::= NotExpr { [ AND ] NotExpr } ;

NotExpr        ::= NOT NotExpr
                 | Primary ;

Primary        ::= LPAREN OrExpr RPAREN
                 | FieldFilter
                 | TargetOrLangClause
                 | PHRASE
                 | NUMBER
                 | BOOLEAN
                 | WORD ;

FieldFilter    ::= FieldName FilterOp LiteralOrTerm ;

FieldName      ::= WORD | LANGUAGE | TARGET ;

FilterOp       ::= COLON | OP_EQ | OP_NEQ | OP_GT | OP_GTE | OP_LT | OP_LTE ;

LiteralOrTerm  ::= PHRASE | NUMBER | BOOLEAN | WORD | LANGUAGE | TARGET ;

TargetOrLangClause ::= ( LANGUAGE | TARGET | RELATION )+ ;
```

---

## 3. Operator Precedence & Associativity (Pratt Parser)

| Precedence (Binding Power) | Operator | Associativity | Description |
| :---: | :--- | :--- | :--- |
| `10` | `OR` / `\|\|` | Left-associative | Boolean disjunction |
| `20` | `AND` / `&&` (or implicit juxtaposition of clauses) | Left-associative | Boolean conjunction |
| `30` | `NOT` / `!` | Right-associative (prefix) | Boolean negation |
| `40` | `:` `=` `!=` `>` `>=` `<` `<=` | Non-associative | Field filter / comparison |
| `50` | `( ... )` | Grouping | Explicit subexpression grouping |

---

## 4. Representative Valid Queries

```text
Find Python functions that process CSV files
```

```text
find python functions AND (java OR javascript) NOT framework = "django" limit 15
```

```text
language:python AND (symbol:function OR symbol:class) AND "data processing"
```

```text
NOT (language = "java" OR score < 0.5) AND "JWT refresh token"
```

---

## 5. Syntax Error Recovery

When the parser encounters an unexpected token or missing delimiter (for example, an unclosed `(` or trailing `AND` without a right-hand operand):

1. It records a structured `SyntaxDiagnostic` containing `code`, `message`, `expected` token kinds, `found` token kind, and `span`.
2. It emits an `ErrorNode` in the AST/Parse Tree so downstream stages can inspect partial structure.
3. It synchronizes to the next safe boundary (`AND`, `OR`, `RPAREN`, `LIMIT`, or `EOF`) to continue parsing and report multiple diagnostics in a single pass.
