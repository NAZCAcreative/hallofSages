import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure the RAG data files are bundled with the /api/chat serverless function
  // (they are read via fs at runtime, not statically imported).
  outputFileTracingIncludes: {
    "/api/chat": [
      "./data/rag/documents/all_units.json",
      "./data/rag/characters/characters.json",
    ],
  },
};

export default nextConfig;
