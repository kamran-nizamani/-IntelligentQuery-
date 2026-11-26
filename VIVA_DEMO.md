# IntelligentQuery 2.0 — 5-Minute Viva Demonstration Guide

This walkthrough demonstrates the complete compiler engineering and hybrid AI search pipeline using 8 representative queries.

---

## Representative Viva Queries

1. **Natural-Language Hybrid Query:**
   `Find Python functions that process CSV files`
   - Shows DFA tokenization, implicit conjunction parsing, symbol table binding (`python`, `function`), IR DAG lowering, and RRF dispatch.

2. **Nested Boolean + Field Exclusion:**
   `find python functions AND (java OR javascript) NOT framework = "django" limit 15`
   - Demonstrates Pratt precedence (`OR` < `AND` < `NOT`), parenthesized grouping, field filter AST nodes, and `LIMIT(15)`.

3. **Field Qualifiers + Numeric Range + Exact Phrase:**
   `language:python AND score >= 0.75 AND "data processing"`
   - Shows colon/comparison operators, numeric type validation, and `minSimilarity` propagation to the VM.

4. **Natural-Language Conjunction Preservation:**
   `Search documents about hybrid search and RRF`
   - Shows why lowercase `and` remains a `WORD` token while uppercase `AND` is a boolean operator.

5. **Rust-Style Typo Diagnostic (Damerau-Levenshtein):**
   `langauge = "python"`
   - Triggers `error[SEM001]: unknown search field 'langauge'` with `help: did you mean 'language'?` and a quick-fix suggestion.

6. **Contradiction Detection:**
   `language = "python" AND language = "java"`
   - Triggers `error[SEM006]` for mutually exclusive conjunctive equality, contrasting with `language = "python" OR language = "java"` (valid).

7. **Algebraic Optimization (`O0` vs `O2`):**
   `NOT (language = "python" OR language = "java") AND NOT (NOT score >= 0.5)`
   - Demonstrates De Morgan transformation, double-negation elimination, and cost-based predicate ordering.

8. **Syntax Error Recovery:**
   `find (python OR java`
   - Demonstrates `SYN008` expected-token reporting (`expected: RPAREN`) while still producing a recoverable AST.
