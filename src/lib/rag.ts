import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { NpcId } from "@/game/npcs";

// Hybrid retrieval over data/rag/documents/all_units.json:
//   • BM25 (lexical) — always available, no API needed.
//   • Semantic — cosine over precomputed int8 embeddings (embeddings.i8),
//     using a query embedding from OpenAI. Falls back silently to BM25-only
//     when there is no API key / no embeddings file / the embed call fails.
// The two ranked lists are fused with Reciprocal Rank Fusion (RRF).
// Build the embeddings once with:  node scripts/build-embeddings.mjs

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
  // `gi` is the row index into all_units.json (== row in embeddings.i8).
  chunks: { meta: Unit; tf: Map<string, number>; len: number; gi: number }[];
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

// Tokenize: Hangul → whole word + 2-grams (robust to josa/OCR noise),
// latin/number words as-is. The whole-word token is rare → high IDF, so an exact
// concept match (e.g. "무기력") outranks spurious 2-gram overlaps ("무기"=weapon).
export function tokenize(s: string): string[] {
  const out: string[] = [];
  const words = s.toLowerCase().match(/[가-힣]+|[a-z0-9]{2,}/g) || [];
  for (const w of words) {
    if (/[가-힣]/.test(w)) {
      if (w.length <= 2) {
        out.push(w);
      } else {
        out.push(w); // whole word — exact, high-signal match
        for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
      }
    } else {
      out.push(w);
    }
  }
  return out;
}

function buildIndex(group: string): GroupIndex {
  const all = loadUnits();
  const df = new Map<string, number>();
  let totalLen = 0;

  // Keep the global array index (gi) so a chunk can find its embedding row.
  const chunks = all
    .map((meta, gi) => ({ meta, gi }))
    .filter(({ meta }) => meta.group === group)
    .map(({ meta, gi }) => {
      const tokens = tokenize((meta.text || "").slice(0, 1200));
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
      totalLen += tokens.length;
      return { meta, tf, len: tokens.length, gi };
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

type Chunk = GroupIndex["chunks"][number];

// BM25 scoring for one group → chunks sorted best-first (score > 0 only).
function bm25Rank(idx: GroupIndex, query: string): { c: Chunk; score: number }[] {
  const qTokens = [...new Set(tokenize(query))];
  if (qTokens.length === 0) return [];
  const k1 = 1.5;
  const b = 0.75;
  return idx.chunks
    .map((c) => {
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
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score);
}

// ---- Semantic side: precomputed int8 embeddings (embeddings.i8) ----
type EmbStore = { data: Int8Array; dim: number; count: number };
let embStore: EmbStore | null | undefined; // undefined = not tried, null = absent

function loadEmbeddings(): EmbStore | null {
  if (embStore !== undefined) return embStore;
  try {
    const dir = path.join(process.cwd(), "data", "rag", "documents");
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, "embeddings.meta.json"), "utf-8"),
    ) as { dim: number; count: number };
    const buf = fs.readFileSync(path.join(dir, "embeddings.i8"));
    const data = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (data.length !== meta.dim * meta.count) throw new Error("size mismatch");
    embStore = { data, dim: meta.dim, count: meta.count };
  } catch {
    embStore = null; // no embeddings → BM25-only mode
  }
  return embStore;
}

// Embed the query (normalized Float32) via OpenAI; null on any failure.
export async function embedQuery(query: string, dim: number): Promise<Float32Array | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey });
    const res = await client.embeddings.create({
      model: process.env.RAG_EMBED_MODEL || "text-embedding-3-small",
      dimensions: dim,
      input: query.slice(0, 1500),
    });
    const v = res.data[0]?.embedding;
    if (!v || v.length !== dim) return null;
    const out = new Float32Array(dim);
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dim; i++) out[i] = v[i] / norm;
    return out;
  } catch (err) {
    console.error("[rag] query embedding failed → BM25-only:", err);
    return null;
  }
}

// Cosine rank: dot(query, unit_int8/127) for each chunk → sorted best-first.
function semanticRank(
  idx: GroupIndex,
  qVec: Float32Array,
  store: EmbStore,
): { c: Chunk; score: number }[] {
  const { data, dim } = store;
  return idx.chunks
    .map((c) => {
      const base = c.gi * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += qVec[i] * data[base + i];
      return { c, score: dot / 127 };
    })
    .sort((a, b) => b.score - a.score);
}

// Reciprocal Rank Fusion of any number of ranked lists (keyed by chunk gi).
function rrfFuse(
  lists: { c: Chunk; score: number }[][],
  k = 60,
): { c: Chunk; score: number }[] {
  const acc = new Map<number, { c: Chunk; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const cur = acc.get(item.c.gi);
      const add = 1 / (k + rank + 1);
      if (cur) cur.score += add;
      else acc.set(item.c.gi, { c: item.c, score: add });
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score);
}

/**
 * Retrieve top-k grounding passages for a sage. Hybrid (BM25 + semantic) when
 * embeddings + API key are available; otherwise pure BM25. Always resolves.
 */
export async function retrieve(
  npc: NpcId,
  query: string,
  k = 4,
): Promise<Passage[]> {
  const idx = getIndex(GROUP[npc]);
  const bm25 = bm25Rank(idx, query);

  let fused = bm25;
  const store = loadEmbeddings();
  if (store) {
    const qVec = await embedQuery(query, store.dim);
    if (qVec) {
      // Over-fetch each side, then fuse, so semantic recall can surface
      // passages BM25 missed (and vice versa).
      const sem = semanticRank(idx, qVec, store).slice(0, 30);
      fused = rrfFuse([bm25.slice(0, 30), sem]);
    }
  }

  return fused.slice(0, k).map(({ c, score }) => ({
    source: c.meta.source,
    loc: c.meta.loc,
    category: c.meta.category,
    text: c.meta.text,
    score: Math.round(score * 1000) / 1000,
  }));
}
