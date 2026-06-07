import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { NpcId } from "@/game/npcs";

// Lightweight BM25 retrieval over data/rag/documents/all_units.json.
// The original Chroma/pickle index is Python-only; we re-index the raw passages
// here so the Next.js (Node) server can do RAG without an embeddings service.

export type Passage = {
  source: string; // file/book the passage came from
  loc: string; // page / location
  category: string;
  text: string;
  score: number;
};

type Unit = {
  source: string;
  loc: string;
  category: string;
  group: string;
  text: string;
  quality_score?: number;
};

// NPC → corpus group (per data/rag/characters/characters.json)
const GROUP: Record<NpcId, string> = {
  jesus: "성경",
  buddha: "불교",
  confucius: "유학·인문",
};

type GroupIndex = {
  chunks: { meta: Unit; tf: Map<string, number>; len: number }[];
  df: Map<string, number>;
  n: number;
  avgdl: number;
};

let allUnits: Unit[] | null = null;
const indexes = new Map<string, GroupIndex>();

function loadUnits(): Unit[] {
  if (allUnits) return allUnits;
  const file = path.join(
    process.cwd(),
    "data",
    "rag",
    "documents",
    "all_units.json",
  );
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  allUnits = (Array.isArray(raw) ? raw : []) as Unit[];
  return allUnits;
}

// Tokenize: Hangul → 2-grams (robust to josa/OCR noise), latin/number words as-is.
function tokenize(s: string): string[] {
  const out: string[] = [];
  const words = s.toLowerCase().match(/[가-힣]+|[a-z0-9]{2,}/g) || [];
  for (const w of words) {
    if (/[가-힣]/.test(w)) {
      if (w.length <= 2) out.push(w);
      else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
    } else {
      out.push(w);
    }
  }
  return out;
}

function buildIndex(group: string): GroupIndex {
  const units = loadUnits().filter((u) => u.group === group);
  const df = new Map<string, number>();
  let totalLen = 0;

  const chunks = units.map((meta) => {
    const tokens = tokenize((meta.text || "").slice(0, 1200));
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    totalLen += tokens.length;
    return { meta, tf, len: tokens.length };
  });

  return {
    chunks,
    df,
    n: chunks.length,
    avgdl: chunks.length ? totalLen / chunks.length : 1,
  };
}

function getIndex(group: string): GroupIndex {
  let idx = indexes.get(group);
  if (!idx) {
    idx = buildIndex(group);
    indexes.set(group, idx);
  }
  return idx;
}

/** Retrieve top-k grounding passages for a sage given the user's query. */
export function retrieve(npc: NpcId, query: string, k = 4): Passage[] {
  const idx = getIndex(GROUP[npc]);
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];

  const k1 = 1.5;
  const b = 0.75;

  const scored = idx.chunks.map((c) => {
    let score = 0;
    for (const t of qTokens) {
      const f = c.tf.get(t);
      if (!f) continue;
      const dft = idx.df.get(t) || 1;
      const idf = Math.log(1 + (idx.n - dft + 0.5) / (dft + 0.5));
      score +=
        idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / idx.avgdl)));
    }
    // gentle preference for higher-quality OCR chunks
    score *= 0.6 + (c.meta.quality_score ?? 0.5);
    return { c, score };
  });

  return scored
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map(({ c, score }) => ({
      source: c.meta.source,
      loc: c.meta.loc,
      category: c.meta.category,
      text: c.meta.text,
      score: Math.round(score * 1000) / 1000,
    }));
}
