import type { SourceSpan } from "./tokens";

export interface DiagnosticQuickFix {
  title: string;
  replacement: string;
  span: SourceSpan;
}

export interface SemanticDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  span: SourceSpan;
  suggestion?: string;
  quickFix?: DiagnosticQuickFix;
  rendered: string;
}

/**
 * Optimal String Alignment / Damerau-Levenshtein distance.
 * Treats adjacent character transpositions (e.g. "langauge" -> "language") as cost 1.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      let val = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) {
        val = Math.min(val, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = val;
    }
  }
  return dp[m][n];
}

export function findClosestMatch(
  input: string,
  candidates: readonly string[],
  maxDistance = 2
): string | undefined {
  let best: string | undefined;
  let bestDist = maxDistance + 1;

  for (const candidate of candidates) {
    const dist = damerauLevenshtein(input, candidate);
    if (dist > 0 && dist <= maxDistance && dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  return best;
}

/**
 * Formats a diagnostic in Rust-compiler style with line numbers, source underline, and help hint.
 */
export function formatRustDiagnostic(
  sourceText: string,
  severity: "error" | "warning",
  code: string,
  message: string,
  span: SourceSpan,
  suggestion?: string
): string {
  const lines = sourceText.split(/\r?\n/);
  const lineIndex = Math.max(0, Math.min(lines.length - 1, span.startLine - 1));
  const lineText = lines[lineIndex] ?? "";
  const lineNumStr = String(span.startLine);
  const gutterPad = " ".repeat(lineNumStr.length);
  const caretOffset = Math.max(0, span.startColumn - 1);
  const caretLen = Math.max(1, span.endOffset - span.startOffset);
  const carets = "^".repeat(Math.min(caretLen, Math.max(1, lineText.length - caretOffset + 1)));

  const out = [
    `${severity}[${code}]: ${message}`,
    `  --> query.iq:${span.startLine}:${span.startColumn}`,
    ` ${gutterPad} |`,
    ` ${lineNumStr} | ${lineText}`,
    ` ${gutterPad} | ${" ".repeat(caretOffset)}${carets}`,
  ];

  if (suggestion) {
    out.push(` ${gutterPad} |`);
    out.push(`help: ${suggestion}`);
  }

  return out.join("\n");
}
