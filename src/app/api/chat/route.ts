import { NextResponse } from "next/server";
import OpenAI from "openai";
import { PERSONAS } from "@/lib/npcPrompts";
import { retrieve, type Passage } from "@/lib/rag";
import { getCharacter } from "@/lib/characters";
import type { NpcId } from "@/game/npcs";

// Design Ref: requirements 6, 7 + RAG — receive {npc, message, history},
// retrieve grounding passages, answer with citations, return sources.
export const runtime = "nodejs";

const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const MAX_HISTORY = 12;
// GPT-5 family (gpt-5, gpt-5.x) only accepts `max_completion_tokens` and the
// default temperature; older models (gpt-4o…) use `max_tokens` + temperature.
const IS_GPT5 = /^gpt-5/.test(MODEL);

type ChatTurn = { role: "user" | "assistant"; content: string };

// Distinct speaking voice per sage so the three never sound alike.
const VOICE: Record<NpcId, string> = {
  jesus:
    "당신은 예수입니다. 사랑하는 제자에게 이르는 스승처럼 부드럽고 자애롭게, 그러나 강연이 아니라 '대화'하듯 말하세요. " +
    "먼저 상대의 마음에 따뜻하게 공감한 뒤, 충분히 깊이 있게 풀어 답하세요. 보통 6~9문장 정도로, 위로 → 비유나 말씀 한 자락 → 구체적인 권면 → 마지막 축복의 말 순으로 넉넉하게 이어가세요. " +
    "때로는 '요즘 많이 지쳤구나' '무엇이 너를 그리 무겁게 하느냐' 처럼 부드럽게 되물으며 곁에서 도란도란 이야기 나누듯 하세요. " +
    "'사랑하는 이여', '내 아이야' 같은 호칭을 자연스럽게 쓰되, 길게 말하더라도 메마른 설교조로 빠지지 말고 다정한 대화의 온기를 끝까지 유지하세요.",
  buddha:
    "당신은 석가모니입니다. 고요하고 평온하며 사색적인 말투로 말하세요. 서두르지 않고 한 박자 느리게, " +
    "집착과 마음의 작용을 차분히 짚어주며, 때로 '그 마음은 어디에서 오는가?' 같은 되물음으로 스스로 깨닫게 합니다. " +
    "물, 바람, 구름처럼 무상(無常)을 보여주는 자연의 비유를 즐기고, 담담하고 잔잔하게 말하세요.",
  confucius:
    "당신은 공자입니다. 학식 높은 선생님이 제자를 가르치듯, 차분하고 또박또박한 '학구적인 선생님' 말투로 말하세요. " +
    "배움(學)과 사색, 예(禮)와 인(仁)을 중시하여, 핵심을 짚고 그 까닭을 조리 있게 일러주며, 때로 '그것이 무엇이겠는가?' 처럼 물어 스스로 생각하게 합니다. " +
    "옛 사극투('~하느니라')는 줄이고, '~한다네', '~하는 법이라네', '~하지 않겠는가' 같은 점잖고 단정한 선생님의 어조를 쓰세요. " +
    "논어의 가르침을 자연스럽게 곁들이되 현학적으로 늘어놓지 말고, 제자가 깨치도록 명료하게 이끌어 주세요.",
};

// Per-sage answer length. Jesus speaks at length; the other two stay concise.
const LENGTH: Record<NpcId, string> = {
  jesus:
    "보통 6~9문장으로 넉넉하고 깊이 있게 답하되, 강의가 아니라 마주 앉아 도란도란 나누는 대화의 흐름을 유지하세요.",
  buddha:
    "보통 2~4문장으로 짧고 담담하게, 상대의 말과 감정에 먼저 반응하세요.",
  confucius:
    "보통 2~4문장으로 단정하고 절제되게, 상대의 말과 감정에 먼저 반응하세요.",
};

function isNpcId(v: unknown): v is NpcId {
  return v === "jesus" || v === "buddha" || v === "confucius";
}

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

function buildContext(passages: Passage[]): string {
  if (passages.length === 0) return "";
  const blocks = passages
    .map(
      (p, i) =>
        `[근거 ${i + 1}] (출처: ${p.source}, ${p.loc})\n${p.text.slice(0, 700)}`,
    )
    .join("\n\n");
  return `다음은 검색된 관련 문헌 근거입니다. 이 근거에 기반해 답하세요.\n\n${blocks}`;
}

export async function POST(req: Request) {
  let body: { npc?: unknown; message?: unknown; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { npc, message } = body;

  if (!isNpcId(npc)) {
    return NextResponse.json(
      { error: "npc must be one of: jesus, buddha, confucius." },
      { status: 400 },
    );
  }
  if (typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const persona = PERSONAS[npc];
  const character = getCharacter(npc);
  const question = message.trim().slice(0, 1000);
  const history = sanitizeHistory(body.history);

  // --- RAG retrieval (works with or without OpenAI) ---
  let sources: Passage[] = [];
  try {
    sources = await retrieve(npc, question, 6);
  } catch (err) {
    console.error("[/api/chat] RAG retrieval error:", err);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      npc,
      reply: persona.fallback(question),
      sources,
      source: "fallback",
    });
  }

  const system = [
    character?.system_prompt?.trim() || persona.system,
    VOICE[npc],
    "당신은 해설자가 아니라 그 현자 '본인'입니다. 자신을 제3자처럼 '공자께서', '석가모니께서', '예수께서 말씀하시길'이라고 지칭하지 말고, 반드시 '나/내가' 1인칭으로 제자에게 직접 말하듯 답하세요. 특히 공자는 스승이 제자를 가르치듯 1인칭으로 이르세요.",
    "한국어로 답하되, 강의가 아니라 마주 앉아 대화하듯 답하세요. " +
      LENGTH[npc] +
      " 세 현자의 말투가 또렷이 구별되도록 자신만의 어조와 호칭을 일관되게 유지하세요.",
    "제시된 근거는 답에 자연스럽게 스며들게만 하고, 내용을 일일이 풀어 설명하거나 '근거 1' 같은 번호를 나열하지 마세요.",
    "상대의 질문을 그대로 따라 말하거나 되풀이하지 마세요('당신은 ~을 물으셨군요', '\"…\"라고 하셨는데' 같은 인용·복창 금지). 곧장 본론으로 들어가세요. 먼저 질문에 담긴 핵심 의도와 진짜 고민이 무엇인지 스스로 파악한 뒤, 그 요지에 정면으로 답하고, 한 걸음 더 나아가 상대가 미처 보지 못한 통찰(insight) 한 가지를 덧붙이세요.",
    buildContext(sources),
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const client = new OpenAI({ apiKey });
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: MODEL,
      messages: [
        { role: "system", content: system },
        ...history,
        { role: "user", content: question },
      ],
    };
    if (IS_GPT5) {
      // Includes reasoning tokens, so give generous headroom for Jesus's
      // longer (6–9 sentence) answers; temperature must stay at the default.
      params.max_completion_tokens = 2000;
    } else {
      params.temperature = 0.7;
      params.max_tokens = 800;
    }
    const completion = await client.chat.completions.create(params);

    const reply =
      completion.choices[0]?.message?.content?.trim() ||
      persona.fallback(question);

    return NextResponse.json({ npc, reply, sources, source: "openai" });
  } catch (err) {
    console.error("[/api/chat] OpenAI error:", err);
    return NextResponse.json({
      npc,
      reply: persona.fallback(question),
      sources,
      source: "fallback",
    });
  }
}
