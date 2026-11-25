import type { User } from "@supabase/supabase-js";
import type {
  CompilerTrace,
  IndexedFile,
  SearchHistoryEntry,
  SearchMode,
  SearchResult,
  SystemMetrics,
  SourceKind,
  SourceType,
} from "@/types/search";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase/client";
import { compileQueryTrace } from "./compiler-engine";
import { sanitizeFileName, validateUploads } from "./upload-validation";

let anonymousSignInPromise: Promise<User> | null = null;

const CHUNK_INSERT_BATCH_SIZE = 50;

export type HealthResponse = {
  status: string;
  database: string;
  chunk_count: number;
  embedding_model: string;
  fts_engine?: string;
  vector_engine?: string;
};

export type SearchOptions = {
  mode?: SearchMode;
  kind?: string;
  type?: string;
  limit?: number;
};

export type SearchResponse = {
  results: SearchResult[];
  latencyMs: number;
  trace: CompilerTrace;
  totalHits: number;
};

export type AnalyticsResponse = SystemMetrics & {
  modeBreakdown?: Record<string, number>;
};

export class ApiError extends Error {
  readonly status: number | null;
  readonly network: boolean;

  constructor(message: string, status: number | null = null, network = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.network = network;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mapSourceType(fileType: string): SourceType {
  const upper = fileType.toUpperCase();
  if (["PDF", "DOCX", "TXT", "PY", "JS", "JAVA"].includes(upper)) {
    return upper as SourceType;
  }
  if (["TS", "TSX", "JSX"].includes(upper)) return "JS";
  return "TXT";
}

function mapDocumentStatus(rawStatus: string | null | undefined): IndexedFile["status"] {
  const normalized = (rawStatus || "").toLowerCase();
  if (normalized === "indexed") return "Indexed";
  if (normalized === "failed" || normalized === "error") return "Error";
  return "Processing";
}

export class ApiClient {
  private requireSupabase() {
    if (!isSupabaseConfigured()) {
      throw new ApiError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in your environment.",
        null,
        true
      );
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new ApiError("Supabase client failed to initialize", null, true);
    }
    return supabase;
  }

  private async ensureUserSession(supabase: NonNullable<ReturnType<typeof getSupabaseClient>>) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData?.session?.user) return sessionData.session.user;

    const { data: current } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (current?.user) return current.user;

    if (!anonymousSignInPromise) {
      anonymousSignInPromise = (async () => {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error || !data?.user) {
          throw new ApiError(
            `Anonymous sign-in is required for this app. Enable Anonymous Sign-Ins in Supabase Authentication settings (Authentication > Providers > Anonymous). ${error?.message || ""}`.trim(),
            401
          );
        }
        return data.user;
      })().finally(() => {
        anonymousSignInPromise = null;
      });
    }
    return anonymousSignInPromise;
  }

  async checkHealth(): Promise<HealthResponse> {
    const supabase = this.requireSupabase();
    await this.ensureUserSession(supabase);
    const { count, error } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true });

    if (error) {
      throw new ApiError(`Supabase connection error: ${error.message}`, 500, true);
    }

    return {
      status: "healthy",
      database: "Supabase PostgreSQL 15+ (pgvector)",
      chunk_count: count ?? 0,
      embedding_model: "Xenova/all-MiniLM-L6-v2 (Client ONNX 384-D)",
      fts_engine: "PostgreSQL full-text search (GIN)",
      vector_engine: "pgvector HNSW (cosine distance)",
    };
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const supabase = this.requireSupabase();
    const user = await this.ensureUserSession(supabase);
    const t0 = performance.now();
    const trace = compileQueryTrace(query);
    const plan = trace.optimizedIr;

    const embedding =
      options.mode === "lexical"
        ? null
        : await (await import("./embeddings/web-embedder")).embedText(plan.semanticQuery || query);

    interface SupabaseChunkRow {
      chunk_id: string;
      document_id: string;
      file_name: string;
      storage_path: string;
      file_type: string;
      source_kind: SourceKind;
      chunk_text: string;
      page_number?: number;
      line_start?: number;
      line_end?: number;
      symbol_name?: string;
      symbol_kind?: string;
      language?: string;
      identifiers?: string[];
      lexical_rank?: number;
      vector_rank?: number;
      rrf_score: number;
    }

    // Fall back to compiler-derived content_kind when UI kind filter is unset or "all" (API-02)
    const rpcKind =
      options.kind && options.kind !== "all"
        ? options.kind
        : (plan.filters.content_kind as string) || null;
    const rpcLang = (plan.filters.language as string) || null;
    const rpcSymbol = (plan.filters.symbol_kind as string) || null;
    const requestedLimit = options.limit || plan.limit || 10;

    const { data: initialData, error } = await supabase.rpc("hybrid_search_rrf", {
      query_text: plan.lexicalQuery || query,
      query_embedding: embedding,
      match_limit: requestedLimit,
      filter_kind: rpcKind,
      filter_language: rpcLang,
      filter_symbol: rpcSymbol,
      rrf_k: 60,
      search_mode: options.mode || "hybrid",
    });
    let data = initialData;

    // Fallback: if narrow compiler filters produced 0 results, retry without language/symbol filters
    if (!error && (!data || (data as unknown[]).length === 0) && (rpcLang || rpcSymbol)) {
      const fallbackRes = await supabase.rpc("hybrid_search_rrf", {
        query_text: query,
        query_embedding: embedding,
        match_limit: requestedLimit,
        filter_kind: rpcKind,
        filter_language: null,
        filter_symbol: null,
        rrf_k: 60,
        search_mode: options.mode || "hybrid",
      });
      if (!fallbackRes.error && fallbackRes.data && (fallbackRes.data as unknown[]).length > 0) {
        data = fallbackRes.data;
      }
    }

    if (error) {
      throw new ApiError(`Search query execution failed: ${error.message}`, 500);
    }

    const rows = (data || []) as SupabaseChunkRow[];
    const latencyMs = +(performance.now() - t0).toFixed(1);

    let results: SearchResult[] = rows.map((row) => {
      const title = row.symbol_name || row.file_name;
      const location =
        row.source_kind === "code" && row.line_start && row.line_end
          ? `Lines ${row.line_start}–${row.line_end}${row.symbol_name ? ` · ${row.symbol_kind || "Symbol"} \`${row.symbol_name}\`` : ""}`
          : row.page_number
          ? `Page ${row.page_number}`
          : "Section";

      const tagSet = new Set<string>();
      if (row.language) tagSet.add(row.language);
      if (row.symbol_kind) tagSet.add(row.symbol_kind);
      if (row.identifiers && row.identifiers.length > 0) {
        for (const id of row.identifiers.slice(0, 3)) {
          tagSet.add(id);
        }
      }

      let matchType: "hybrid" | "semantic" | "lexical" = "hybrid";
      if (row.lexical_rank && !row.vector_rank) matchType = "lexical";
      else if (!row.lexical_rank && row.vector_rank) matchType = "semantic";

      const description =
        row.lexical_rank && row.vector_rank
          ? `Lexical rank #${row.lexical_rank} · Vector rank #${row.vector_rank}`
          : row.lexical_rank
          ? `Lexical rank #${row.lexical_rank}`
          : `Vector rank #${row.vector_rank}`;

      return {
        id: `chunk-${row.chunk_id}`,
        title,
        path: row.storage_path || row.file_name,
        kind: row.source_kind || "document",
        type: mapSourceType(row.file_type),
        description,
        preview: row.chunk_text,
        location,
        language: row.language,
        symbol: row.symbol_name,
        score: +row.rrf_score.toFixed(4),
        lexicalRank: row.lexical_rank,
        semanticRank: row.vector_rank,
        matchType,
        updated: "Indexed",
        tags: Array.from(tagSet),
      };
    });

    if (options.type && options.type !== "all") {
      const targetType = options.type.toUpperCase();
      results = results.filter((r) => r.type === targetType);
    }

    // Record to search_history as non-fatal so valid results are never discarded (API-03)
    if (user.id) {
      try {
        const { error: historyError } = await supabase.from("search_history").insert({
          user_id: user.id,
          query_text: query,
          mode: options.mode || "hybrid",
          match_count: results.length,
          latency_ms: latencyMs,
          top_result_title: results[0]?.title ?? null,
          filters: plan.filters,
        });
        if (historyError) {
          console.warn("Search history could not be saved:", historyError.message);
        }
      } catch (err) {
        console.warn("Search history insert failed:", err);
      }
    }

    return {
      results,
      latencyMs,
      trace,
      totalHits: results.length,
    };
  }

  explain(query: string): Promise<CompilerTrace> {
    return Promise.resolve(compileQueryTrace(query));
  }

  async listFiles(): Promise<IndexedFile[]> {
    const supabase = this.requireSupabase();

    interface DocumentRow {
      id: string;
      file_name: string;
      storage_path: string;
      file_type: string;
      content_kind: SourceKind;
      file_size: number;
      chunk_count: number;
      status: string;
      created_at: string;
    }

    await this.ensureUserSession(supabase);
    const { data, error } = await supabase
      .from("documents")
      .select("id, file_name, storage_path, file_type, content_kind, file_size, chunk_count, status, created_at")
      .order("created_at", { ascending: false });

    if (error) throw new ApiError(`Failed to list indexed files: ${error.message}`);
    if (!data) return [];

    return (data as DocumentRow[]).map((d) => ({
      id: d.id,
      name: d.file_name,
      path: d.storage_path,
      kind: d.content_kind || "document",
      type: mapSourceType(d.file_type),
      size: formatBytes(d.file_size || 0),
      rawSize: d.file_size || 0,
      chunks: d.chunk_count || 0,
      status: mapDocumentStatus(d.status),
      updated: new Date(d.created_at).toLocaleDateString(),
    }));
  }

  /**
   * Fetches the first indexed chunk(s) of a document on demand for Library PreviewModal (FE-02).
   */
  async getFilePreview(documentId: string): Promise<string> {
    const supabase = this.requireSupabase();
    await this.ensureUserSession(supabase);

    const { data, error } = await supabase
      .from("document_chunks")
      .select("chunk_text")
      .eq("document_id", documentId)
      .order("id", { ascending: true })
      .limit(2);

    if (error) {
      throw new ApiError(`Failed to load file preview: ${error.message}`);
    }
    const rows = (data || []) as Array<{ chunk_text: string }>;
    return rows.map((r) => r.chunk_text).join("\n\n").trim();
  }

  async uploadFiles(files: File[]): Promise<{ uploaded: unknown[]; totalFilesIndexed: number }> {
    const supabase = this.requireSupabase();
    const { valid, rejected } = validateUploads(files);
    if (rejected.length > 0 && valid.length === 0) {
      const reasons = rejected.map((r) => `${r.name} (${r.reason})`).join(", ");
      throw new ApiError(`Upload rejected: ${reasons}`, 400);
    }

    const user = await this.ensureUserSession(supabase);
    const { extractFileInBrowser } = await import("./extractors/client-extractors");
    const { embedBatch } = await import("./embeddings/web-embedder");

    const uploadedResults = [];

    for (const file of valid) {
      const extracted = await extractFileInBrowser(file);
      if (!extracted.chunks || extracted.chunks.length === 0) {
        throw new ApiError(
          `No searchable text or code chunks could be extracted from "${file.name}". Please ensure the file is not empty or password-protected.`
        );
      }

      // Sanitize filename before building Storage object key (API-05)
      const safeName = sanitizeFileName(file.name);
      const storagePath = `${user.id}/${Date.now()}_${safeName}`;
      const { error: storageError } = await supabase.storage
        .from("documents")
        .upload(storagePath, file, { upsert: true });

      if (storageError) {
        throw new ApiError(`Storage upload failed: ${storageError.message}`);
      }

      const { data: docRecord, error: docError } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          file_name: file.name,
          storage_path: storagePath,
          file_type: extracted.fileType,
          file_size: file.size,
          chunk_count: extracted.chunks.length,
          content_kind: extracted.contentKind,
          status: "processing",
        })
        .select("id")
        .single();

      if (docError || !docRecord) {
        try {
          await supabase.storage.from("documents").remove([storagePath]);
        } catch {
          /* ignore cleanup error */
        }
        throw new ApiError(`Document database record creation failed: ${docError?.message}`);
      }

      try {
        const chunkTexts = extracted.chunks.map((c) => c.chunkText);
        const embeddings = await embedBatch(chunkTexts);

        const chunkRows = extracted.chunks.map((chunk, idx) => ({
          document_id: docRecord.id,
          user_id: user.id,
          chunk_text: chunk.chunkText,
          source_kind: chunk.sourceKind,
          page_number: chunk.pageNumber ?? null,
          line_start: chunk.lineStart ?? null,
          line_end: chunk.lineEnd ?? null,
          symbol_name: chunk.symbolName ?? null,
          symbol_kind: chunk.symbolKind ? chunk.symbolKind.toLowerCase() : null,
          language: chunk.language ? chunk.language.toLowerCase() : null,
          identifiers: chunk.identifiers ?? [],
          embedding: embeddings[idx],
        }));

        // Batch chunk inserts to avoid oversized PostgREST payloads
        for (let i = 0; i < chunkRows.length; i += CHUNK_INSERT_BATCH_SIZE) {
          const batch = chunkRows.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
          const { error: chunkError } = await supabase
            .from("document_chunks")
            .insert(batch);

          if (chunkError) {
            throw new ApiError(`Chunk insertion failed: ${chunkError.message}`);
          }
        }

        const { error: statusError } = await supabase
          .from("documents")
          .update({ status: "indexed", chunk_count: chunkRows.length })
          .eq("id", docRecord.id)
          .eq("user_id", user.id);

        if (statusError) {
          throw new ApiError(`Indexed chunks but could not update document status: ${statusError.message}`);
        }

        uploadedResults.push({ id: docRecord.id, name: file.name, chunks: chunkRows.length });
      } catch (uploadErr) {
        try {
          await supabase.from("document_chunks").delete().eq("document_id", docRecord.id);
        } catch {
          /* ignore cleanup error */
        }
        try {
          await supabase.from("documents").delete().eq("id", docRecord.id);
        } catch {
          /* ignore cleanup error */
        }
        try {
          await supabase.storage.from("documents").remove([storagePath]);
        } catch {
          /* ignore cleanup error */
        }
        throw uploadErr;
      }
    }

    return { uploaded: uploadedResults, totalFilesIndexed: uploadedResults.length };
  }

  async deleteFile(fileId: string): Promise<{ deleted: string; status: string }> {
    const supabase = this.requireSupabase();
    await this.ensureUserSession(supabase);

    const { data: document, error: lookupError } = await supabase
      .from("documents")
      .select("storage_path")
      .eq("id", fileId)
      .single();
    if (lookupError) throw new ApiError(`Failed to find document: ${lookupError.message}`);

    // Delete database row first (cascades chunks) so a DB failure never leaves an orphaned record
    const { error } = await supabase.from("documents").delete().eq("id", fileId);
    if (error) {
      throw new ApiError(`Failed to delete document: ${error.message}`);
    }

    if (document?.storage_path) {
      const { error: storageError } = await supabase.storage
        .from("documents")
        .remove([document.storage_path]);
      if (storageError) {
        console.warn("Document deleted from DB, but storage cleanup failed:", storageError.message);
      }
    }

    return { deleted: fileId, status: "success" };
  }

  async getHistory(): Promise<SearchHistoryEntry[]> {
    const supabase = this.requireSupabase();

    interface HistoryRow {
      id: string;
      query_text: string;
      mode: SearchMode;
      match_count: number;
      latency_ms: number;
      top_result_title?: string | null;
      filters: Record<string, string>;
      created_at: string;
    }

    await this.ensureUserSession(supabase);
    const { data, error } = await supabase
      .from("search_history")
      .select("id, query_text, mode, match_count, latency_ms, top_result_title, filters, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new ApiError(`Failed to fetch search history: ${error.message}`);
    if (!data) return [];

    return (data as HistoryRow[]).map((row) => ({
      id: row.id,
      query: row.query_text,
      timestamp: new Date(row.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      date: new Date(row.created_at).toLocaleDateString(),
      mode: row.mode || "hybrid",
      resultsCount: row.match_count || 0,
      latencyMs: +row.latency_ms.toFixed(1),
      topResultTitle: row.top_result_title || undefined,
      filtersApplied: row.filters,
    }));
  }

  async clearHistory(): Promise<{ cleared: boolean }> {
    const supabase = this.requireSupabase();
    const user = await this.ensureUserSession(supabase);
    if (user) {
      const { error } = await supabase.from("search_history").delete().eq("user_id", user.id);
      if (error) throw new ApiError(`Failed to clear search history: ${error.message}`);
    }
    return { cleared: true };
  }

  async getAnalytics(): Promise<AnalyticsResponse> {
    const supabase = this.requireSupabase();
    await this.ensureUserSession(supabase);

    // Prefer server-side SQL aggregation RPC to avoid downloading unbounded rows
    const rpcRes = await supabase.rpc("get_workspace_analytics");
    if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === "object") {
      const stats = rpcRes.data as {
        docCount?: number;
        codeCount?: number;
        totalChunks?: number;
        totalQueries?: number;
        avgLatencyMs?: number;
        hybridQueries?: number;
        semanticQueries?: number;
        lexicalQueries?: number;
      };
      return {
        totalDocuments: Number(stats.docCount ?? 0),
        totalCodeFiles: Number(stats.codeCount ?? 0),
        totalChunks: Number(stats.totalChunks ?? 0),
        totalSearches: Number(stats.totalQueries ?? 0),
        avgLatencyMs: Number(stats.avgLatencyMs ?? 0),
        ftsStatus: "Online",
        faissStatus: "Online",
        embeddingModel: "Xenova/all-MiniLM-L6-v2 (Client ONNX 384-D)",
        precisionAt1: 0,
        precisionAt5: 0,
        recallAt5: 0,
        mrrScore: 0,
        modeBreakdown: {
          hybrid: Number(stats.hybridQueries ?? 0),
          semantic: Number(stats.semanticQueries ?? 0),
          lexical: Number(stats.lexicalQueries ?? 0),
        },
      };
    }

    // Fallback for environments where get_workspace_analytics RPC is not yet deployed
    const [docsRes, chunksRes, histRes] = await Promise.all([
      supabase.from("documents").select("content_kind"),
      supabase.from("document_chunks").select("id", { count: "exact", head: true }),
      supabase.from("search_history").select("latency_ms, mode").limit(500),
    ]);

    if (docsRes.error || chunksRes.error || histRes.error) {
      throw new ApiError(
        `Analytics query failed: ${docsRes.error?.message || chunksRes.error?.message || histRes.error?.message}`
      );
    }
    const docs = (docsRes.data || []) as { content_kind?: string }[];
    const totalDocuments = docs.filter((d) => d.content_kind === "document").length;
    const totalCodeFiles = docs.filter((d) => d.content_kind === "code").length;
    const totalChunks = chunksRes.count ?? 0;

    const historyData = (histRes.data || []) as { latency_ms?: number; mode?: string }[];
    const totalSearches = historyData.length;
    const avgLatencyMs =
      totalSearches > 0
        ? +(historyData.reduce((acc, h) => acc + (h.latency_ms || 0), 0) / totalSearches).toFixed(1)
        : 0;

    const modeBreakdown: Record<string, number> = { hybrid: 0, semantic: 0, lexical: 0 };
    for (const h of historyData) {
      const m = h.mode || "hybrid";
      modeBreakdown[m] = (modeBreakdown[m] || 0) + 1;
    }

    return {
      totalDocuments,
      totalCodeFiles,
      totalChunks,
      totalSearches,
      avgLatencyMs,
      ftsStatus: "Online",
      faissStatus: "Online",
      embeddingModel: "Xenova/all-MiniLM-L6-v2 (Client ONNX 384-D)",
      precisionAt1: 0,
      precisionAt5: 0,
      recallAt5: 0,
      mrrScore: 0,
      modeBreakdown,
    };
  }
}

export const apiClient = new ApiClient();
