import "server-only";
import fs from "node:fs";
import path from "node:path";
import { tokenize, embedQuery } from "./rag";

// Hybrid retrieval over data/rag/bibleIndex/bible_units.json — the rich, verse-
// level Bible index (68k units). We index the "passage" units (a ~5-verse
// window each, loc like "창세기 1:1-3").
//   • BM25 (lexical keyword match) — always available.
//   • Dense / semantic embeddings (text-embedding-3-small, 512d, int8 in
//     passages.i8) — finds passages by meaning even with no shared words.
// The two ranked lists are fused with Reciprocal Rank Fusion (RRF). The exact
// verse to quote is then picked from the passage text by the LLM in /api/bible.
// Falls back to BM25-only when embeddings / API key are unavailable.
//
// (The companion .pkl/.npz/.joblib files are Python-only and unused here.)

export type BibleHit = {
  source: string; // book name
  loc: string; // e.g. "요한복음 3:16-18"
  category: string; // section title, when present
  text: string;
  score: number;
};

type BUnit = {
  unit_type: string;
  book?: string;
  chapter?: number;
  verse?: number;
  loc: string;
  section_title?: string;
  text: string;
};

type Heading = { ch: number; v: number; title: string };

type Chunk = {
  book: string;
  loc: string;
  section: string;
  text: string;
  tf: Map<string, number>;
  len: number;
  emb: number; // row index into passages.i8 (passage order in bible_units.json)
};

type Index = { chunks: Chunk[]; df: Map<string, number>; n: number; avgdl: number };

let index: Index | null = null;

function buildIndex(): Index {
  const file = path.join(
    process.cwd(),
    "data",
    "rag",
    "bibleIndex",
    "bible_units.json",
  );
  const units = JSON.parse(fs.readFileSync(file, "utf-8")) as BUnit[];
  const df = new Map<string, number>();
  let totalLen = 0;

  // Section headings (개역개정 소제목, e.g. "여호와께서 사울을 버리시다") are stored
  // only on the heading's first verse. Collect them per book so a passage with
  // no title of its own can inherit the section it falls under — a light summary.
  const headings = new Map<string, Heading[]>();
  for (const u of units) {
    const t = u.section_title?.trim();
    if (!t || u.chapter == null || u.verse == null) continue;
    const book = u.book || u.loc.split(" ")[0] || "성경";
    (headings.get(book) ?? headings.set(book, []).get(book)!).push({
      ch: u.chapter,
      v: u.verse,
      title: t,
    });
  }
  for (const list of headings.values())
    list.sort((a, b) => a.ch - b.ch || a.v - b.v);

  // Latest heading at or before (ch, v) within a book.
  const sectionFor = (book: string, ch?: number, v?: number): string => {
    const list = headings.get(book);
    if (!list || ch == null || v == null) return "";
    let found = "";
    for (const h of list) {
      if (h.ch < ch || (h.ch === ch && h.v <= v)) found = h.title;
      else break;
    }
    return found;
  };

  const chunks: Chunk[] = [];
  let pi = -1; // passage counter — aligned 1:1 with rows in passages.i8
  for (const u of units) {
    if (u.unit_type !== "passage") continue; // windowed, context-rich units
    pi++;
    const tokens = tokenize((u.text || "").slice(0, 1200));
    if (tokens.length === 0) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    totalLen += tokens.length;
    const book = u.book || u.loc.split(" ")[0] || "성경";
    chunks.push({
      book,
      loc: u.loc,
      section: u.section_title?.trim() || sectionFor(book, u.chapter, u.verse),
      text: u.text,
      tf,
      len: tokens.length,
      emb: pi,
    });
  }
  return {
    chunks,
    df,
    n: chunks.length,
    avgdl: chunks.length ? totalLen / chunks.length : 1,
  };
}

function getIndex(): Index {
  if (!index) index = buildIndex();
  return index;
}

// Warm the index in the background at module load so the first user click
// doesn't pay the ~30s build cost. (In a long-running server this happens at
// boot; on serverless it runs once per cold start.)
setTimeout(() => {
  try {
    getIndex();
  } catch (err) {
    console.error("[bible] index warmup failed:", err);
  }
}, 0);

// BM25 ranking → chunks sorted best-first (score > 0 only).
function bm25Rank(idx: Index, query: string): { c: Chunk; score: number }[] {
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
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score);
}

// ---- Dense / semantic side: precomputed int8 embeddings (passages.i8) ----
type EmbStore = { data: Int8Array; dim: number; count: number };
let embStore: EmbStore | null | undefined; // undefined = untried, null = absent

function loadEmbeddings(): EmbStore | null {
  if (embStore !== undefined) return embStore;
  try {
    const dir = path.join(process.cwd(), "data", "rag", "bibleIndex");
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, "passages.meta.json"), "utf-8"),
    ) as { dim: number; count: number };
    const buf = fs.readFileSync(path.join(dir, "passages.i8"));
    const data = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    if (data.length !== meta.dim * meta.count) throw new Error("size mismatch");
    embStore = { data, dim: meta.dim, count: meta.count };
  } catch {
    embStore = null; // BM25-only mode
  }
  return embStore;
}

// Cosine rank: dot(query, passage_int8/127) for each chunk → sorted best-first.
function semanticRank(
  idx: Index,
  qVec: Float32Array,
  store: EmbStore,
): { c: Chunk; score: number }[] {
  const { data, dim } = store;
  return idx.chunks
    .map((c) => {
      const base = c.emb * dim;
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += qVec[i] * data[base + i];
      return { c, score: dot / 127 };
    })
    .sort((a, b) => b.score - a.score);
}

// Reciprocal Rank Fusion of ranked lists, keyed by passage row (emb).
function rrfFuse(
  lists: { c: Chunk; score: number }[][],
  k = 60,
): { c: Chunk; score: number }[] {
  const acc = new Map<number, { c: Chunk; score: number }>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const cur = acc.get(item.c.emb);
      const add = 1 / (k + rank + 1);
      if (cur) cur.score += add;
      else acc.set(item.c.emb, { c: item.c, score: add });
    });
  }
  return [...acc.values()].sort((a, b) => b.score - a.score);
}

/**
 * Hybrid (BM25 + dense/semantic) top-k Bible passages. Falls back to BM25-only
 * when embeddings or the API key are unavailable. Always resolves.
 */
export async function retrieveBible(query: string, k = 12): Promise<BibleHit[]> {
  const idx = getIndex();
  const bm25 = bm25Rank(idx, query);
  const bm25Of = new Map(bm25.map((x) => [x.c.emb, x.score]));

  // RRF is used for *ordering*; the *displayed* relevance is the cosine
  // similarity (0..1) — a true, per-result semantic score (not the tiny,
  // clustered RRF values that looked "stuck" around 0.016).
  let ordered = bm25;
  let cosOf: Map<number, number> | null = null;
  const store = loadEmbeddings();
  if (store) {
    const qVec = await embedQuery(query, store.dim);
    if (qVec) {
      const sem = semanticRank(idx, qVec, store);
      cosOf = new Map(sem.map((s) => [s.c.emb, s.score]));
      ordered = rrfFuse([bm25.slice(0, 40), sem.slice(0, 40)]);
    }
  }

  return ordered.slice(0, k).map(({ c }) => {
    const rel = cosOf?.get(c.emb) ?? bm25Of.get(c.emb) ?? 0;
    return {
      source: c.book,
      loc: c.loc,
      category: c.section || "성경",
      text: c.text,
      score: Math.round(rel * 1000) / 1000,
    };
  });
}
