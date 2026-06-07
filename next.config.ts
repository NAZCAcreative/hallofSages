import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure the RAG data files are bundled with the /api/chat serverless function
  // (they are read via fs at runtime, not statically imported).
  outputFileTracingIncludes: {
    "/api/chat": [
      "./data/rag/documents/all_units.json",
      "./data/rag/characters/characters.json",
      // Optional hybrid-search embeddings (built via scripts/build-embeddings.mjs).
      // Bundled when present; retrieval falls back to BM25-only when absent.
      "./data/rag/documents/embeddings.i8",
      "./data/rag/documents/embeddings.meta.json",
    ],
  },
};

export default nextConfig;
