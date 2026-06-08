// Precompute dense (semantic) embeddings for the Bible "passage" units that the
// 고급답변 (/api/bible) retrieves over — so it can do hybrid BM25 + semantic
// search, just like /api/chat does for the main corpus.
//
//   node scripts/build-bible-embeddings.mjs
//
// Embeds with text-embedding-3-small (512 dims), L2-normalizes, quantizes to
// int8, and writes — aligned 1:1 with passage order in bible_units.json:
//
//   data/rag/bibleIndex/passages.i8        (count * DIM signed bytes)
//   data/rag/bibleIndex/passages.meta.json ({ model, dim, count, builtAt })
//
// Requires OPENAI_API_KEY (env or .env.local).
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();
const DIR = path.join(ROOT, "data", "rag", "bibleIndex");
const UNITS = path.join(DIR, "bible_units.json");
const OUT_BIN = path.join(DIR, "passages.i8");
const OUT_META = path.join(DIR, "passages.meta.json");

const MODEL = "text-embedding-3-small";
const DIM = 512;
const BATCH = 256;
const MAX_CHARS = 1500;

function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
    const m = env.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* none */
  }
  return null;
}

function quantize(vec) {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++)
    out[i] = Math.max(-127, Math.min(127, Math.round((vec[i] / norm) * 127)));
  return out;
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY not found. Aborting.");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey });

  // Same selection + order as src/lib/bible.ts (unit_type === "passage").
  const all = JSON.parse(fs.readFileSync(UNITS, "utf8"));
  const passages = all.filter((u) => u.unit_type === "passage");
  const n = passages.length;
  console.log(`Embedding ${n} bible passages with ${MODEL} (dim=${DIM})…`);

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const embedBatch = async (input) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.embeddings.create({ model: MODEL, dimensions: DIM, input });
      } catch (e) {
        if (e?.status === 429 && attempt < 6) {
          const wait = 2000 * (attempt + 1);
          process.stdout.write(`  (429 — retrying in ${wait}ms)`);
          await sleep(wait);
          continue;
        }
        throw e;
      }
    }
  };

  const out = new Int8Array(n * DIM);
  let done = 0;
  for (let start = 0; start < n; start += BATCH) {
    const slice = passages.slice(start, start + BATCH);
    const input = slice.map((u) => (u.text || "").slice(0, MAX_CHARS) || " ");
    const res = await embedBatch(input);
    res.data.forEach((d, j) => out.set(quantize(d.embedding), (start + j) * DIM));
    done += slice.length;
    process.stdout.write(`\r  ${done}/${n}`);
    await sleep(250); // stay under the tokens-per-minute limit
  }
  process.stdout.write("\n");

  fs.writeFileSync(OUT_BIN, Buffer.from(out.buffer));
  fs.writeFileSync(
    OUT_META,
    JSON.stringify(
      { model: MODEL, dim: DIM, count: n, builtAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log(
    `✓ Wrote ${OUT_BIN} (${(out.byteLength / 1048576).toFixed(2)} MB) + meta. ${n} vectors.`,
  );
}

main().catch((e) => {
  console.error("\n✗ Build failed:", e?.message || e);
  process.exit(1);
});
