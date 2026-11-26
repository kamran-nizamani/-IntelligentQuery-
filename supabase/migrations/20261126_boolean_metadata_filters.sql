-- IntelligentQuery 2.0: Composite metadata index & v2 boolean-exclusion RPC
-- Preserves all existing tables, RLS policies, and the 9-parameter hybrid_search_rrf() RPC.

set search_path to public, extensions;

create index if not exists idx_chunks_user_metadata
  on public.document_chunks(user_id, source_kind, language, symbol_kind);

create or replace function public.hybrid_search_rrf_v2(
  query_text text,
  query_embedding vector(384),
  match_limit integer default 50,
  filter_kind text default null,
  filter_language text default null,
  filter_symbol text default null,
  rrf_k integer default 60,
  search_mode text default 'hybrid',
  min_similarity double precision default 0.35,
  excluded_languages text[] default null
)
returns table (
  chunk_id text, document_id text, file_name text, storage_path text, file_type text,
  source_kind text, chunk_text text, page_number integer, line_start integer, line_end integer,
  symbol_name text, symbol_kind text, language text, identifiers text[],
  lexical_rank bigint, vector_rank bigint, rrf_score double precision
)
language sql stable security invoker
set search_path = public, extensions
as $function$
with lexical_candidates as (
  select c.id, row_number() over (
    order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
  ) as rank
  from public.document_chunks c
  where search_mode <> 'semantic'
    and nullif(trim(query_text), '') is not null
    and c.fts @@ websearch_to_tsquery('english', query_text)
    and (filter_kind is null or c.source_kind = filter_kind)
    and (filter_language is null or c.language = lower(filter_language))
    and (filter_symbol is null or c.symbol_kind = lower(filter_symbol))
    and (excluded_languages is null or c.language is null or not (lower(c.language) = any(excluded_languages)))
  order by ts_rank_cd(c.fts, websearch_to_tsquery('english', query_text)) desc
  limit 100
),
vector_candidates as (
  select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
  from public.document_chunks c
  where search_mode <> 'lexical'
    and query_embedding is not null
    and c.embedding is not null
    and (1 - (c.embedding <=> query_embedding)) >= coalesce(min_similarity, 0.35)
    and (filter_kind is null or c.source_kind = filter_kind)
    and (filter_language is null or c.language = lower(filter_language))
    and (filter_symbol is null or c.symbol_kind = lower(filter_symbol))
    and (excluded_languages is null or c.language is null or not (lower(c.language) = any(excluded_languages)))
  order by c.embedding <=> query_embedding
  limit 100
),
candidate_ids as (
  select id from lexical_candidates union select id from vector_candidates
),
fused as (
  select ids.id, l.rank as lexical_rank, v.rank as vector_rank,
    coalesce(1.0 / (greatest(1, coalesce(rrf_k, 60)) + l.rank), 0.0)
      + coalesce(1.0 / (greatest(1, coalesce(rrf_k, 60)) + v.rank), 0.0) as rrf_score
  from candidate_ids ids
  left join lexical_candidates l on l.id = ids.id
  left join vector_candidates v on v.id = ids.id
)
select c.id::text, c.document_id::text, d.file_name, d.storage_path, d.file_type, c.source_kind,
  c.chunk_text, c.page_number, c.line_start, c.line_end, c.symbol_name, c.symbol_kind,
  c.language, c.identifiers, f.lexical_rank, f.vector_rank, f.rrf_score
from fused f
join public.document_chunks c on c.id = f.id
join public.documents d on d.id = c.document_id
order by f.rrf_score desc
limit greatest(1, least(coalesce(match_limit, 50), 100));
$function$;

revoke all on function public.hybrid_search_rrf_v2(text, vector, integer, text, text, text, integer, text, double precision, text[]) from public, anon;
grant execute on function public.hybrid_search_rrf_v2(text, vector, integer, text, text, text, integer, text, double precision, text[]) to authenticated;
