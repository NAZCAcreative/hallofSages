// One-time precompute of passage embeddings for hybrid (BM25 + semantic) RAG.
//
//   node scripts/build-embeddings.mjs
//
// Reads data/rag/documents/all_units.json, embeds each passage with
// text-embedding-3-small (512 dims), L2-normalizes, quantizes to int8, and
// writes a compact binary aligned 1:1 with the all_units.json array order:
//
//   data/rag/documents/embeddings.i8        (count * DIM signed bytes)
//   data/rag/documents/embeddings.meta.json ({ model, dim, count, builtAt })
//
// Requires OPENAI_API_KEY (read from env or .env.local).
import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";

const ROOT = process.cwd();
const DOCS = path.join(ROOT, "data", "rag", "documents");
const UNITS = path.join(DOCS, "all_units.json");
const OUT_BIN = path.join(DOCS, "embeddings.i8");
const OUT_META = path.join(DOCS, "embeddings.meta.json");

const MODEL = "text-embedding-3-small";
const DIM = 512;
const BATCH = 256; // inputs per embeddings request
const MAX_CHARS = 1500; // cap per passage to keep token use small

function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
    const m = env.match(/^OPENAI_API_KEY\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* no .env.local */
  }
  return null;
}

function quantize(vec) {
  // L2-normalize then map to int8 (cosine of unit vectors == dot product).
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round((vec[i] / norm) * 127)));
  }
  return out;
}

async function main() {
  const apiKey = loadKey();
  if (!apiKey) {
    console.error("✗ OPENAI_API_KEY not found (env or .env.local). Aborting.");
    process.exit(1);
  }
  const client = new OpenAI({ apiKey });

  const units = JSON.parse(fs.readFileSync(UNITS, "utf8"));
  const n = units.length;
  console.log(`Embedding ${n} units with ${MODEL} (dim=${DIM})…`);

  const out = new Int8Array(n * DIM);
  let done = 0;
  for (let start = 0; start < n; start += BATCH) {
    const slice = units.slice(start, start + BATCH);
    const input = slice.map((u) => (u.text || "").slice(0, MAX_CHARS) || " ");
    const res = await client.embeddings.create({
      model: MODEL,
      dimensions: DIM,
      input,
    });
    res.data.forEach((d, j) => {
      out.set(quantize(d.embedding), (start + j) * DIM);
    });
    done += slice.length;
    process.stdout.write(`\r  ${done}/${n}`);
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
  const mb = (out.byteLength / 1048576).toFixed(2);
  console.log(`✓ Wrote ${OUT_BIN} (${mb} MB) + meta. ${n} vectors.`);
}

main().catch((e) => {
  console.error("\n✗ Embedding build failed:", e?.message || e);
  process.exit(1);
});
