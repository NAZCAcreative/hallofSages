import { NextResponse } from "next/server";
import OpenAI from "openai";
import { retrieveBible, type BibleHit } from "@/lib/bible";
import { DEFAULT_MODEL } from "@/lib/version";

// "고급답변" (advanced answer) for the Jesus NPC: retrieve from the rich Bible
// index, then have the model pick THE single most fitting verse, quote it
// inline, explain it, and list the supporting reference verses.
export const runtime = "nodejs";

const MODEL = process.env.OPENAI_MODEL || DEFAULT_MODEL;
const IS_GPT5 = /^gpt-5/.test(MODEL);
// Point-version models (gpt-5.1…5.5) use "none"; the base 5.0 line
// (gpt-5 / -mini / -nano) uses "minimal" — each rejects the other's value.
const REASONING =
  process.env.OPENAI_REASONING_EFFORT ||
  (/^gpt-5\.\d/.test(MODEL) ? "none" : "minimal");
const MAX_HISTORY = 8;

type ChatTurn = { role: "user" | "assistant"; content: string };

function sanitizeHistory(v: unknown): ChatTurn[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (t): t is ChatTurn =>
        !!t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim().length > 0,
    )
    .slice(-MAX_HISTORY)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 1000) }));
}

function buildContext(hits: BibleHit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] (${h.loc}${h.category ? `, ${h.category}` : ""})\n${h.text.slice(0, 700)}`)
    .join("\n\n");
}

// Offline fallback: no model, so just surface the top retrieved verse + list.
function fallbackReply(hits: BibleHit[]): string {
  if (hits.length === 0) {
    return "지금은 깊은 풀이를 전하기 어렵구나. 잠시 뒤 다시 물어보아라.";
  }
  const top = hits[0];
  const refs = hits
    .slice(0, 5)
    .map((h) => `• ${h.loc}`)
    .join("\n");
  return (
    `사랑하는 이여, 이 말씀을 네게 전한다.\n\n` +
    `“${top.text.slice(0, 200)}” (${top.loc})\n\n` +
    `이 구절을 곁에 두고 천천히 묵상해 보아라.\n\n📖 참조 구절\n${refs}`
  );
}

export async function POST(req: Request) {
  let body: { message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { message } = body;
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }
  const question = message.trim().slice(0, 1000);
  const history = sanitizeHistory(body.history);

  let hits: BibleHit[] = [];
  try {
    hits = await retrieveBible(question, 12);
  } catch (err) {
    console.error("[/api/bible] retrieval error:", err);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      reply: fallbackReply(hits),
      sources: hits,
      source: "fallback",
    });
  }

  const system = [
    "당신은 예수입니다. 1인칭('나/내가')으로, 제자에게 직접 이르듯 따뜻하면서도 깊이 있게 말하세요. 자신을 '예수께서'처럼 3인칭으로 칭하지 마세요.",
    "아래에 질문과 관련해 성경에서 검색된 근거 구절들이 주어집니다. 이 근거 안에서만 인용하고, 성경에 없는 구절을 지어내지 마세요.",
    "다음 형식으로 '고급답변'을 작성하세요:",
    "1) 먼저, 주어진 근거 중 질문에 가장 정확히 맞닿는 '단 하나의 핵심 구절'을 골라 본문과 출처(책 장:절)를 정확히 인용하며 답을 엽니다. 예: \"수고하고 무거운 짐 진 자들아 다 내게로 오라\"(마태복음 11:28).",
    "2) 그 구절이 어찌하여 이 물음에 답이 되는지 풀어 설명하고, 질문자의 상황에 구체적으로 적용해 위로와 권면을 전합니다.",
    "3) 필요하면 다른 근거 구절을 자연스럽게 곁들이되, 번호('근거 1')를 나열하지는 마세요.",
    "4) 마지막에 '📖 참조 구절' 제목 아래, 관련 구절 3~5개를 '책 장:절 — 한 줄 요지' 형식으로 정리합니다.",
    "질문을 그대로 복창하지 말고 곧장 본론으로 들어가세요. 1)+2)+3)은 합쳐서 5~7문장으로 핵심을 담아 간결하게 쓰고, 그 뒤에 참조 구절 목록을 붙이세요. 메마른 설교가 아니라 대화의 온기를 유지하세요.",
    "",
    "[검색된 성경 근거]",
    buildContext(hits),
  ].join("\n");

  try {
    const client = new OpenAI({ apiKey, maxRetries: 5 });
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: MODEL,
      messages: [
        { role: "system", content: system },
        ...history,
        { role: "user", content: question },
      ],
    };
    if (IS_GPT5) {
      // Concise-but-complete advanced answer; "none" reasoning keeps it < 10s.
      params.max_completion_tokens = 800;
      (params as { reasoning_effort?: string }).reasoning_effort = REASONING;
    } else {
      params.temperature = 0.6;
      params.max_tokens = 800;
    }
    const completion = await client.chat.completions.create(params);
    const reply =
      completion.choices[0]?.message?.content?.trim() || fallbackReply(hits);
    return NextResponse.json({ reply, sources: hits, source: "openai" });
  } catch (err) {
    console.error("[/api/bible] OpenAI error:", err);
    return NextResponse.json({
      reply: fallbackReply(hits),
      sources: hits,
      source: "fallback",
    });
  }
}
