import type { FilterOperator, SourceSpan } from "./tokens";

export type FieldDataType = "string" | "number" | "boolean" | "enum";

export interface FieldSchema {
  name: string;
  aliases: readonly string[];
  dataType: FieldDataType;
  allowedOperators: readonly FilterOperator[];
  allowedValues?: readonly string[];
  min?: number;
  max?: number;
  description: string;
}

export const QUERY_FIELD_SCHEMAS: readonly FieldSchema[] = [
  {
    name: "language",
    aliases: ["lang"],
    dataType: "enum",
    allowedOperators: [":", "=", "!="],
    allowedValues: ["python", "py", "java", "javascript", "js", "typescript", "ts"],
    description: "Programming language of indexed source code",
  },
  {
    name: "symbol",
    aliases: ["target", "symbol_kind"],
    dataType: "enum",
    allowedOperators: [":", "=", "!="],
    allowedValues: ["function", "functions", "method", "methods", "class", "classes", "code", "file", "files", "document", "documents"],
    description: "Target code symbol or content entity kind",
  },
  {
    name: "kind",
    aliases: ["content_kind", "type"],
    dataType: "enum",
    allowedOperators: [":", "=", "!="],
    allowedValues: ["document", "code", "pdf", "docx", "txt", "py", "js", "java", "ts"],
    description: "Document or source-code format/kind",
  },
  {
    name: "framework",
    aliases: [],
    dataType: "string",
    allowedOperators: [":", "=", "!="],
    description: "Library or framework identifier (e.g. django, react, fastapi)",
  },
  {
    name: "score",
    aliases: ["similarity"],
    dataType: "number",
    allowedOperators: [">", ">=", "<", "<=", "=", "!="],
    min: 0,
    max: 1,
    description: "Minimum or bounded similarity/relevance score (0.0 to 1.0)",
  },
  {
    name: "lines",
    aliases: ["line_count"],
    dataType: "number",
    allowedOperators: [">", ">=", "<", "<=", "=", "!="],
    min: 1,
    description: "Line count threshold for code chunks",
  },
  {
    name: "active",
    aliases: ["indexed"],
    dataType: "boolean",
    allowedOperators: ["=", "!=", ":"],
    description: "Whether the target chunk is actively indexed",
  },
  {
    name: "file",
    aliases: ["path", "repo", "repository"],
    dataType: "string",
    allowedOperators: [":", "=", "!="],
    description: "File name, storage path, or repository qualifier",
  },
];

export interface ResolvedSymbolEntry {
  symbol: string;
  canonicalName: string;
  category: "field" | "language" | "target" | "action";
  dataType: FieldDataType | "keyword";
  value?: string | number | boolean;
  span: SourceSpan;
}

export class SymbolTable {
  private readonly fieldsByName = new Map<string, FieldSchema>();
  private readonly resolved: ResolvedSymbolEntry[] = [];

  constructor(schemas: readonly FieldSchema[] = QUERY_FIELD_SCHEMAS) {
    for (const schema of schemas) {
      this.fieldsByName.set(schema.name, schema);
      for (const alias of schema.aliases) {
        this.fieldsByName.set(alias, schema);
      }
    }
  }

  lookupField(name: string): FieldSchema | undefined {
    return this.fieldsByName.get(name.toLowerCase());
  }

  allFieldNames(): string[] {
    return Array.from(this.fieldsByName.keys());
  }

  canonicalFieldNames(): string[] {
    return QUERY_FIELD_SCHEMAS.map((s) => s.name);
  }

  recordSymbol(entry: ResolvedSymbolEntry): void {
    this.resolved.push(entry);
  }

  getResolvedSymbols(): ResolvedSymbolEntry[] {
    return [...this.resolved];
  }
}
