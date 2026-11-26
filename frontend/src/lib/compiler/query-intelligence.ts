import type { SearchResult } from "@/types/search";

const DEVELOPER_EXPANSIONS: Record<string, readonly string[]> = {
  auth: ["authentication", "jwt", "session", "token"],
  jwt: ["token", "authentication", "refresh"],
  db: ["database", "sql", "postgres", "query"],
  err: ["error", "exception", "failure"],
  api: ["endpoint", "route", "handler"],
  fn: ["function", "method"],
  cls: ["class", "struct"],
  perf: ["performance", "latency", "benchmark"],
};

export interface QueryExpansionInfo {
  originalTerms: string[];
  expandedTerms: string[];
  expandedQuery: string;
}

export function expandDeveloperQuery(query: string): QueryExpansionInfo {
  const words = query.split(/\s+/).filter(Boolean);
  const originalTerms = words.map((w) => w.toLowerCase());
  const added: string[] = [];

  for (const w of originalTerms) {
    const clean = w.replace(/[^a-z0-9_]/g, "");
    const syns = DEVELOPER_EXPANSIONS[clean];
    if (syns) {
      for (const s of syns) {
        if (!originalTerms.includes(s) && !added.includes(s)) {
          added.push(s);
        }
      }
    }
  }

  return {
    originalTerms,
    expandedTerms: added,
    expandedQuery: added.length > 0 ? `${query} ${added.slice(0, 3).join(" ")}` : query,
  };
}

export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const item of results) {
    const fingerprint = `${item.path}::${item.preview.slice(0, 120).trim().toLowerCase()}`;
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      deduped.push(item);
    }
  }
  return deduped;
}

export function buildMatchExplanation(
  row: {
    lexicalRank?: number;
    vectorRank?: number;
    language?: string;
    symbolKind?: string;
    symbolName?: string;
  },
  appliedFilters: Record<string, string>
): string {
  const parts: string[] = [];
  if (row.lexicalRank && row.vectorRank) {
    parts.push(`Hybrid RRF (Lexical #${row.lexicalRank} + Vector #${row.vectorRank})`);
  } else if (row.lexicalRank) {
    parts.push(`Lexical FTS rank #${row.lexicalRank}`);
  } else if (row.vectorRank) {
    parts.push(`Semantic HNSW rank #${row.vectorRank}`);
  }

  if (row.symbolName) {
    parts.push(`Symbol ${row.symbolKind ?? "entity"} '${row.symbolName}'`);
  }
  if (row.language) {
    parts.push(`Lang: ${row.language}`);
  }
  const filterKeys = Object.keys(appliedFilters);
  if (filterKeys.length > 0) {
    parts.push(`Filters: ${filterKeys.map((k) => `${k}=${appliedFilters[k]}`).join(", ")}`);
  }
  return parts.join(" · ");
}
