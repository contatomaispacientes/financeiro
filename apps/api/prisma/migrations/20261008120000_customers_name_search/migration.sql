-- CLI-NF1: busca de clientes por nome sem acento e sem diferenciar maiúsculas, com índice.
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() é STABLE e não pode entrar em índice. Este wrapper fixa o dicionário e,
-- com BEGIN ATOMIC (PG 14+), resolve as referências na criação: não depende do search_path.
CREATE OR REPLACE FUNCTION public.f_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE PARALLEL SAFE STRICT
BEGIN ATOMIC
  SELECT public.unaccent('public.unaccent'::regdictionary, $1);
END;

-- Consultas devem usar exatamente esta expressão para aproveitar o índice:
--   WHERE public.f_unaccent(lower(name)) LIKE '%' || public.f_unaccent(lower($1)) || '%'
CREATE INDEX "customers_name_search_idx" ON "customers" USING gin (public.f_unaccent(lower("name")) gin_trgm_ops);
