-- Nexus Claire 4.0: Supabase LTM (Long-Term Memory) Setup
-- Execute this script in your Supabase SQL Editor to enable the vector memory.

-- 1. Enable the pgvector extension to work with embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create the target facts table
CREATE TABLE IF NOT EXISTS facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  content text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  embedding vector(768), -- Google's text-embedding-004 produces 768 dimensions
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create an index for faster similarity searches (optional but recommended for scale)
CREATE INDEX IF NOT EXISTS facts_embedding_idx ON facts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 4. Create the match_facts function for semantic hybrid search
-- This RPC is directly called by Nexus in vault.ts
CREATE OR REPLACE FUNCTION match_facts (
  query_embedding vector(768),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  entity text,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    facts.id,
    facts.entity,
    facts.content,
    facts.metadata,
    1 - (facts.embedding <=> query_embedding) AS similarity
  FROM facts
  WHERE 1 - (facts.embedding <=> query_embedding) > match_threshold
  ORDER BY facts.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
