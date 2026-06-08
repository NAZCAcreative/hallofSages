"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { bus } from "./bus";
import {
  NPCS,
  getWorldSize,
  WORLD_DESKTOP,
  type Npc,
  type NpcId,
} from "./npcs";

// Phaser game is client-only.
const PhaserGame = dynamic(() => import("./PhaserGame"), { ssr: false });

type Turn = { role: "user" | "assistant"; content: string };
type Source = {
  source: string;
  loc: string;
  category: string;
  text: string;
  score: number;
};
type Answer = { content: string; loading: boolean; sources: Source[] };
type LogEntry = {
  id: number;
  role: "user" | "sage";
  npc?: Npc;
  name: string;
  content: string;
  sources?: Source[];
};

const emptyHistory = (): Record<NpcId, Turn[]> => ({
  jesus: [],
  buddha: [],
  confucius: [],
});

export default function GameShell() {
  const [hint, setHint] = useState<Npc | null>(null);
  const [world, setWorld] = useState(WORLD_DESKTOP); // container aspect (responsive)

  // 1:1 chat (E key)
  const [chatNpc, setChatNpc] = useState<Npc | null>(null);
  const [messages, setMessages] = useState<Turn[]>([]);
  const [chatSources, setChatSources] = useState<Source[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [advLoading, setAdvLoading] = useState(false); // 고급답변 (Jesus)
  const [open, setOpen] = useState(false);

  // Ask-all (Enter key)
  const [askAll, setAskAll] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [sharedInput, setSharedInput] = useState("");
  const [sending, setSending] = useState(false);
  const [answers, setAnswers] = useState<Partial<Record<NpcId, Answer>>>({});
  const historyRef = useRef<Record<NpcId, Turn[]>>(emptyHistory());

  // Cooldown: after asking, block the next question for 10s (avoids spamming the
  // API, which would burst rate limits and degrade answers to fixed fallbacks).
  const [cooldown, setCooldown] = useState(0); // seconds left
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // RAG sources drawer (right sliding panel)
  const [drawer, setDrawer] = useState<{ name: string; sources: Source[] } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scoreHelp, setScoreHelp] = useState(false); // 관련도 설명 팝업

  // Conversation log (right chat-style panel)
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const logIdRef = useRef(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sharedRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logScrollRef = useRef<HTMLDivElement>(null);

  const addLog = (e: Omit<LogEntry, "id">) =>
    setLog((prev) => [...prev, { ...e, id: ++logIdRef.current }]);

  // Responsive container aspect ratio (set after mount to avoid SSR mismatch).
  useEffect(() => {
    const upd = () => setWorld(getWorldSize());
    upd();
    window.addEventListener("resize", upd);
    return () => window.removeEventListener("resize", upd);
  }, []);

  // Bridge: Phaser → React
  useEffect(() => {
    const offProx = bus.on("proximity", setHint);
    const offAsk = bus.on("ask", (npc) => {
      setChatNpc(npc);
      setMessages([]);
      setChatSources([]);
      setInput("");
    });
    const offAll = bus.on("askAll", () => setAskAll(true));
    return () => {
      offProx();
      offAsk();
      offAll();
    };
  }, []);

  // Open animations + focus.
  useEffect(() => {
    if (chatNpc) {
      const t = setTimeout(() => setOpen(true), 10);
      inputRef.current?.focus();
      return () => clearTimeout(t);
    }
    setOpen(false);
  }, [chatNpc]);

  useEffect(() => {
    if (askAll) {
      const t = setTimeout(() => setAllOpen(true), 10);
      sharedRef.current?.focus();
      return () => clearTimeout(t);
    }
    setAllOpen(false);
  }, [askAll]);

  useEffect(() => {
    if (drawer) {
      const t = setTimeout(() => setDrawerOpen(true), 10);
      return () => clearTimeout(t);
    }
  }, [drawer]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  useEffect(() => {
    if (logOpen)
      logScrollRef.current?.scrollTo({
        top: logScrollRef.current.scrollHeight,
        behavior: "smooth",
      });
  }, [log, logOpen]);

  function openDrawer(name: string, sources: Source[]) {
    if (!sources.length) return;
    setLogOpen(false); // only one right panel at a time
    setDrawer({ name, sources });
  }

  // Top chat panel height, packaged with the sage positions: desktop sages sit
  // a touch higher, so the panel is a bit shorter there to keep clear of them.
  const portrait = world.h > world.w;
  const panelHeight = portrait ? "48%" : "44%";

  function toggleLog() {
    closeDrawer();
    setLogOpen((v) => !v);
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setDrawer(null), 300);
  }

  // ---------- 1:1 chat ----------
  function closeChat() {
    setChatNpc(null);
    setMessages([]);
    setChatSources([]);
    setInput("");
    closeDrawer();
    bus.emit("resume", undefined);
  }

  // Send the current question in one of two modes, chosen up-front:
  //  • "normal"   → /api/chat   (conversational answer; all sages)
  //  • "advanced" → /api/bible  (Jesus only: precise verse citation + refs)
  async function send(mode: "normal" | "advanced" = "normal") {
    const npc = chatNpc;
    const text = input.trim();
    if (!npc || !text || loading || advLoading || cooldown > 0) return;
    const advanced = mode === "advanced" && npc.id === "jesus";

    const history = messages;
    const next = [...messages, { role: "user", content: text } as Turn];
    setMessages(next);
    setInput("");
    setCooldown(10); // start the 10s cooldown
    if (advanced) setAdvLoading(true);
    else setLoading(true);
    addLog({ role: "user", name: "나", content: text });

    try {
      const res = await fetch(advanced ? "/api/bible" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          advanced
            ? { message: text, history }
            : { npc: npc.id, message: text, history },
        ),
      });
      const data = await res.json();
      const reply = data.reply ?? data.error ?? "…";
      const content = advanced ? `📖 고급답변\n\n${reply}` : reply;
      setMessages([...next, { role: "assistant", content }]);
      setChatSources(data.sources ?? []);
      addLog({
        role: "sage",
        npc,
        name: advanced ? `${npc.name} · 고급답변` : npc.name,
        content: reply,
        sources: data.sources ?? [],
      });
      bus.emit("sageAnswered", { npc: npc.id });
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "(연결에 실패했어요. 다시 시도해 주세요.)" },
      ]);
    } finally {
      if (advanced) setAdvLoading(false);
      else setLoading(false);
      inputRef.current?.focus();
    }
  }

  // ---------- Ask all three ----------
  function closeAll() {
    setAskAll(false);
    setSharedInput("");
    closeDrawer();
    bus.emit("resume", undefined);
  }

  async function submitAll() {
    const text = sharedInput.trim();
    if (!text || sending || cooldown > 0) return;
    setSending(true);
    setSharedInput("");
    setCooldown(10); // start the 10s cooldown
    addLog({ role: "user", name: "나", content: text });
    setAnswers(() => {
      const next: Partial<Record<NpcId, Answer>> = {};
      for (const n of NPCS) next[n.id] = { content: "", loading: true, sources: [] };
      return next;
    });

    await Promise.all(
      NPCS.map(async (n, i) => {
        // Stagger the three calls a little so they don't burst the API at once
        // (a simultaneous burst can hit rate limits → identical fallback text).
        await new Promise((r) => setTimeout(r, i * 350));
        const history = historyRef.current[n.id] ?? [];
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ npc: n.id, message: text, history }),
          });
          const data = await res.json();
          const reply = data.reply ?? data.error ?? "…";
          historyRef.current[n.id] = [
            ...history,
            { role: "user", content: text },
            { role: "assistant", content: reply },
          ];
          setAnswers((prev) => ({
            ...prev,
            [n.id]: { content: reply, loading: false, sources: data.sources ?? [] },
          }));
          addLog({ role: "sage", npc: n, name: n.name, content: reply, sources: data.sources ?? [] });
          bus.emit("sageAnswered", { npc: n.id });
        } catch {
          setAnswers((prev) => ({
            ...prev,
            [n.id]: {
              content: "(연결 실패. 다시 시도해 주세요.)",
              loading: false,
              sources: [],
            },
          }));
        }
      }),
    );

    setSending(false);
    sharedRef.current?.focus();
  }

  return (
    <div
      className="relative mx-auto w-full max-w-5xl overflow-hidden rounded-xl border border-[#2c4a35] bg-[#1a2e1f] shadow-2xl"
      style={{ aspectRatio: `${world.w} / ${world.h}` }}
    >
      {/* key remounts the game when the world (portrait/landscape) changes so the
          canvas always matches the container aspect — no letterbox, bg fills */}
      <PhaserGame key={`${world.w}x${world.h}`} />

      {/* Hints */}
      {!chatNpc && !askAll && (
        <>
          {hint && (
            <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm text-white shadow">
              <span className="font-semibold text-amber-300">{hint.name}</span> 님께{" "}
              <span className="hidden lg:inline">
                <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-mono">E</kbd> 1:1 대화
              </span>
              <span className="lg:hidden">💬 대화 가능</span>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white/80 shadow lg:block">
            <kbd className="rounded bg-white/20 px-1.5 py-0.5 font-mono">Enter</kbd> 세 분께 동시에 질문
          </div>
        </>
      )}

      {/* Mobile touch controls (hidden on large screens with a keyboard) */}
      {!chatNpc && !askAll && <TouchControls />}

      {/* ===== Ask-all ===== */}
      {askAll && (
        <div className="absolute inset-0 z-20">
          <button
            onClick={closeAll}
            aria-label="닫기"
            className="absolute inset-0 cursor-default bg-black/25"
          />

          {/* Ask-all: same top WIDE panel as the 1:1 chat, so it never covers
              the sages (lower third). Three answers scroll inside with the wheel. */}
          <div
            className="absolute left-1/2 top-[2%] z-10 origin-top"
            style={{
              width: "min(920px, 95%)",
              height: panelHeight,
              transform: `translateX(-50%) scale(${allOpen ? 1 : 0.92})`,
              opacity: allOpen ? 1 : 0,
              transition:
                "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease",
            }}
          >
            <div
              onWheel={(e) => e.stopPropagation()}
              className="flex h-full flex-col overflow-hidden rounded-2xl border-[3px] border-black bg-[#fdfcf3] text-black shadow-[6px_6px_0_rgba(0,0,0,0.35)]"
            >
              <div className="flex shrink-0 items-center gap-2 border-b-2 border-black/15 px-4 py-2">
                <span className="font-extrabold">🙏 세 현자께 동시에 묻기</span>
                <button
                  onClick={closeAll}
                  className="ml-auto rounded-md px-1.5 text-lg leading-none text-black/40 hover:text-black"
                  aria-label="닫기"
                >
                  ✕
                </button>
              </div>

              {/* Scroll area: 3 columns on desktop, stacked on mobile */}
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {NPCS.map((n) => {
                    const a = answers[n.id];
                    return (
                      <div key={n.id} className="flex flex-col rounded-2xl bg-black/[0.05] p-2.5">
                        <div className="mb-1 flex items-center gap-2">
                          <Avatar npc={n} size={26} />
                          <span className="text-sm font-extrabold">{n.name}</span>
                          {a &&
                            !a.loading &&
                            (a.sources.length > 0 ? (
                              <button
                                onClick={() => openDrawer(n.name, a.sources)}
                                className="ml-auto rounded-full border border-emerald-600/40 bg-emerald-200 px-2 py-0.5 text-[11px] font-bold text-emerald-900"
                              >
                                📖 {a.sources.length}
                              </button>
                            ) : (
                              <span className="ml-auto text-[11px] text-black/35">
                                📖 근거 없음
                              </span>
                            ))}
                        </div>
                        <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed">
                          {!a ? (
                            <span className="text-black/35">대기 중…</span>
                          ) : a.loading ? (
                            <span className="inline-flex gap-1 py-1">
                              <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
                            </span>
                          ) : (
                            <Typewriter text={a.content} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex shrink-0 items-end gap-2 border-t-2 border-black/15 p-2.5">
                <textarea
                  ref={sharedRef}
                  value={sharedInput}
                  onChange={(e) => setSharedInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submitAll();
                    }
                    if (e.key === "Escape") closeAll();
                  }}
                  rows={1}
                  placeholder="세 분께 동시에 여쭤보세요… (Enter 전송, Esc 닫기)"
                  className="max-h-24 flex-1 resize-none rounded-xl border-2 border-black/20 bg-white px-3 py-1.5 text-[14px] text-black outline-none focus:border-black/50"
                />
                <button
                  onClick={submitAll}
                  disabled={!sharedInput.trim() || sending || cooldown > 0}
                  className="rounded-xl border-2 border-black bg-amber-400 px-4 py-1.5 text-sm font-bold text-black hover:bg-amber-300 disabled:opacity-40"
                >
                  {sending ? "묻는 중…" : cooldown > 0 ? `${cooldown}초 후` : "질문"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== 1:1 chat ===== */}
      {chatNpc && (
        <div className="absolute inset-0 z-20">
          <button
            onClick={closeChat}
            aria-label="대화 닫기"
            className="absolute inset-0 cursor-default bg-black/25"
          />
          {/* 1:1 chat lives as a WIDE panel pinned to the top, so it never
              covers the sages (who stand in the lower third). */}
          <div
            className="absolute left-1/2 top-[2%] z-10 origin-top"
            style={{
              width: "min(920px, 95%)",
              height: panelHeight,
              transform: `translateX(-50%) scale(${open ? 1 : 0.92})`,
              opacity: open ? 1 : 0,
              transition:
                "transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.18s ease",
            }}
          >
            <div
              onWheel={(e) => e.stopPropagation()}
              className="flex h-full flex-col overflow-hidden rounded-2xl border-[3px] border-black bg-[#fdfcf3] text-black shadow-[6px_6px_0_rgba(0,0,0,0.35)]"
            >
            <div className="flex shrink-0 items-center gap-2 border-b-2 border-black/15 px-4 py-2">
              <Avatar npc={chatNpc} size={30} />
              <span className="font-extrabold">{chatNpc.name}</span>
              <span className="text-xs text-black/40">{chatNpc.title}</span>
              <button
                onClick={closeChat}
                className="ml-auto rounded-md px-1.5 text-lg leading-none text-black/40 hover:text-black"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-3 py-3"
            >
              {messages.length === 0 && !loading && (
                <p className="my-auto text-center text-sm text-black/40">
                  {chatNpc.name}께 무엇이든 여쭤보세요.
                </p>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[82%] rounded-2xl rounded-br-md border-2 border-black bg-amber-300 px-3 py-1.5 text-[14px] font-medium">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex justify-start">
                    <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-black/[0.06] px-3 py-1.5 text-[14px] leading-relaxed">
                      {i === messages.length - 1 ? (
                        <Typewriter text={m.content} />
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ),
              )}
              {(loading || advLoading) && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-black/[0.06] px-3 py-2">
                    <span className="inline-flex gap-1">
                      <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
                    </span>
                  </div>
                </div>
              )}
            </div>

            {messages.some((m) => m.role === "assistant") && !loading && !advLoading && (
              <SourceBar
                count={chatSources.length}
                onClick={() => openDrawer(chatNpc.name, chatSources)}
              />
            )}

            <div className="flex shrink-0 flex-col gap-2 border-t-2 border-black/15 p-2.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send("normal");
                  }
                  if (e.key === "Escape") closeChat();
                }}
                rows={1}
                placeholder={
                  chatNpc.id === "jesus"
                    ? "여기에 입력… (Enter=일반답변)"
                    : "여기에 입력… (Enter 전송)"
                }
                className="max-h-24 w-full resize-none rounded-xl border-2 border-black/20 bg-white px-3 py-1.5 text-[14px] outline-none focus:border-black/50"
              />
              {chatNpc.id === "jesus" ? (
                <div className="flex items-stretch gap-2">
                  <button
                    onClick={() => send("normal")}
                    disabled={!input.trim() || loading || advLoading || cooldown > 0}
                    className="flex-1 rounded-xl border-2 border-black bg-amber-400 px-3 py-1.5 text-sm font-bold hover:bg-amber-300 disabled:opacity-40"
                    title="현자와 대화하듯 위로·권면하는 일반답변"
                  >
                    {loading
                      ? "답하는 중…"
                      : cooldown > 0 && !advLoading
                        ? `${cooldown}초 후`
                        : "🗨️ 일반답변"}
                  </button>
                  <button
                    onClick={() => send("advanced")}
                    disabled={!input.trim() || loading || advLoading || cooldown > 0}
                    className="flex-1 rounded-xl border-2 border-black bg-indigo-300 px-3 py-1.5 text-sm font-bold text-indigo-950 hover:bg-indigo-200 disabled:opacity-40"
                    title="성경 색인을 깊이 참고해 핵심 구절을 정확히 인용·풀이 (참조 구절 포함)"
                  >
                    {advLoading
                      ? "성경 살피는 중…"
                      : cooldown > 0 && !loading
                        ? `${cooldown}초 후`
                        : "📖 고급답변 ✦"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => send("normal")}
                  disabled={!input.trim() || loading || cooldown > 0}
                  className="self-end rounded-xl border-2 border-black bg-amber-400 px-4 py-1.5 text-sm font-bold hover:bg-amber-300 disabled:opacity-40"
                >
                  {loading ? "답하는 중…" : cooldown > 0 ? `${cooldown}초 후` : "질문"}
                </button>
              )}
            </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-edge tab to toggle the conversation log */}
      <button
        onClick={toggleLog}
        className="absolute right-0 bottom-[26%] z-40 flex items-center gap-1 rounded-l-xl border-2 border-r-0 border-amber-400/70 bg-black/75 py-3 pl-2 pr-1.5 text-xs font-bold text-white shadow-lg hover:bg-black"
        style={{ writingMode: "vertical-rl" }}
        title="질문 로그 열기/닫기"
      >
        💬 질문 로그
      </button>

      {/* ===== Conversation log: right chat-style sliding panel ===== */}
      <div
        className="absolute inset-y-0 right-0 z-40 transition-transform duration-300 ease-out"
        style={{ transform: logOpen ? "translateX(0)" : "translateX(100%)" }}
      >
        <div className="flex h-full w-[min(340px,85vw)] flex-col border-l-2 border-amber-400/50 bg-[#101820]/97 shadow-[-12px_0_40px_rgba(0,0,0,0.6)] backdrop-blur">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
            <span>💬</span>
            <span className="font-bold text-white">질문 로그</span>
            <span className="text-xs text-white/40">{log.length}개</span>
            {log.length > 0 && (
              <button
                onClick={() => setLog([])}
                className="ml-auto rounded px-2 py-0.5 text-xs text-white/40 hover:text-white"
              >
                전체 지우기
              </button>
            )}
            <button
              onClick={() => setLogOpen(false)}
              className={`${log.length > 0 ? "" : "ml-auto"} rounded-lg px-2 py-1 text-sm text-white/50 hover:text-white`}
            >
              닫기 ✕
            </button>
          </div>
          <div ref={logScrollRef} className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {log.length === 0 ? (
              <p className="mt-10 text-center text-sm text-white/35">
                아직 대화 기록이 없어요.
                <br />
                현자에게 질문하면 여기에 쌓입니다.
              </p>
            ) : (
              log.map((e) =>
                e.role === "user" ? (
                  <div key={e.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-amber-400 px-3 py-1.5 text-[13.5px] font-medium text-black">
                      {e.content}
                    </div>
                  </div>
                ) : (
                  <div key={e.id} className="flex items-start gap-2">
                    {e.npc && <Avatar npc={e.npc} size={26} />}
                    <div className="max-w-[78%]">
                      <div className="mb-0.5 text-[11px] font-semibold text-amber-300">
                        {e.name}
                      </div>
                      <div className="whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-white/10 px-3 py-1.5 text-[13.5px] leading-relaxed text-white">
                        {e.content}
                      </div>
                      {e.sources &&
                        (e.sources.length > 0 ? (
                          <button
                            onClick={() => openDrawer(e.name, e.sources!)}
                            className="mt-1 rounded-full border border-emerald-400/50 bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-400/25"
                          >
                            📖 관련 근거 {e.sources.length}건
                          </button>
                        ) : (
                          <span className="mt-1 inline-block text-[11px] text-white/35">
                            📖 관련 근거 없음
                          </span>
                        ))}
                    </div>
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </div>

      {/* ===== RAG sources: right-side sliding panel (cream, high-contrast) ===== */}
      {drawer && (
        <>
          {/* dim backdrop so the bright panel pops; click to close */}
          <button
            onClick={closeDrawer}
            aria-label="근거 닫기"
            className="absolute inset-0 z-40 cursor-default bg-black/40 transition-opacity duration-300"
            style={{ opacity: drawerOpen ? 1 : 0 }}
          />
          <div
            className="absolute inset-y-0 right-0 z-50 transition-transform duration-300 ease-out"
            style={{ transform: drawerOpen ? "translateX(0)" : "translateX(100%)" }}
          >
            <div className="flex h-full w-[min(380px,88vw)] flex-col border-l-4 border-amber-500 bg-[#fbf7e9] text-black shadow-[-12px_0_40px_rgba(0,0,0,0.6)]">
              <div className="flex items-center gap-2 border-b-2 border-black/10 bg-amber-400 px-4 py-3">
                <span>📖</span>
                <span className="font-extrabold">{drawer.name}</span>
                <span className="text-sm font-medium text-black/60">
                  관련 근거 {drawer.sources.length}건
                </span>
                <button
                  onClick={closeDrawer}
                  className="ml-auto rounded-lg border-2 border-black bg-white px-2 py-0.5 text-sm font-bold hover:bg-black hover:text-white"
                >
                  닫기 ✕
                </button>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {drawer.sources.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-xl border-2 border-black/15 bg-white p-3 shadow-sm"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded bg-amber-400 px-1.5 py-0.5 font-mono font-bold">
                        #{i + 1}
                      </span>
                      <span className="font-bold text-black/80">{s.source}</span>
                      <span className="rounded bg-black/10 px-1.5 py-0.5 text-black/60">
                        {s.loc}
                      </span>
                      <span className="rounded bg-emerald-200 px-1.5 py-0.5 text-emerald-900">
                        {s.category}
                      </span>
                      <span className="ml-auto flex items-center gap-1 text-black/35">
                        관련도 {s.score}
                        <button
                          type="button"
                          onClick={() => setScoreHelp(true)}
                          aria-label="관련도란?"
                          title="관련도가 어떻게 정해지는지 보기"
                          className="flex h-4 w-4 items-center justify-center rounded-full border border-black/30 text-[10px] font-bold leading-none text-black/50 hover:bg-black/10"
                        >
                          ?
                        </button>
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-black/80">
                      {formatVerses(s.text)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ===== 관련도 설명 레이어 팝업 ===== */}
      {scoreHelp && (
        <>
          <button
            onClick={() => setScoreHelp(false)}
            aria-label="닫기"
            className="absolute inset-0 z-[60] cursor-default bg-black/55"
          />
          <div className="absolute left-1/2 top-1/2 z-[61] w-[min(380px,90%)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border-[3px] border-black bg-[#fdfcf3] p-4 text-black shadow-[6px_6px_0_rgba(0,0,0,0.4)]">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-lg">❓</span>
              <span className="font-extrabold">‘관련도’는 어떻게 정해지나요?</span>
              <button
                onClick={() => setScoreHelp(false)}
                className="ml-auto rounded-md px-1.5 text-lg leading-none text-black/40 hover:text-black"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-[13px] leading-relaxed text-black/75">
              <p>
                질문과 이 문헌이 얼마나 맞닿아 있는지를 점수로 매긴 값입니다. 두
                가지 검색을 <b>RRF</b>(Reciprocal Rank Fusion)로 합쳐 계산해요 —
                각 검색의 순위를 <b>1/(60+순위)</b>로 점수화해 더한 뒤, 합산이 높은
                순으로 근거를 정렬합니다.
              </p>
              <p>
                <b className="text-black">① 키워드 검색(BM25)</b> — 질문 단어가 그
                문헌에 얼마나, 얼마나 드물게(=변별력 있게) 나오는지로 점수화.
              </p>
              <p>
                <b className="text-black">② 의미 검색(Dense·Semantic 임베딩)</b> —
                문장을 벡터로 바꿔 <b>코사인 유사도</b>로 비교. 단어가 안 겹쳐도
                뜻이 비슷하면 찾아냅니다.
              </p>
              <p>
                <b className="text-black">🗨️ 일반답변</b>과{" "}
                <b className="text-black">📖 고급답변</b> 모두 ①+②를 결합한
                하이브리드입니다. 고급답변은 성경 전체 색인(약 3.2만 구절)에 dense
                임베딩(text-embedding-3-small)을 적용해, 더 정밀한 구절을 찾습니다.
              </p>
              <p className="text-black/45">
                ※ 점수는 정렬을 위한 상대적 수치라 절대값 자체에 큰 의미는 없습니다.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Wrap Bible verse references ("책 장:절") in [] and put each verse on its own
// line so the verses inside a passage are visually separated. No-op for non-
// Bible sources (불교/유학), whose text has no such reference pattern.
function formatVerses(text: string): string {
  return text
    .replace(/\s*([가-힣]{2,8}\s?\d{1,3}:\d{1,3})\s*/g, "\n[$1] ")
    .replace(/^\n/, "")
    .trim();
}

function SourceBar({ count, onClick }: { count: number; onClick: () => void }) {
  if (count > 0) {
    return (
      <button
        onClick={onClick}
        className="flex w-full shrink-0 items-center justify-center gap-1 border-t-2 border-black/15 bg-emerald-200 px-3 py-2 text-[13px] font-bold text-emerald-900 hover:bg-emerald-300"
        title="RAG로 찾은 관련 문서 보기"
      >
        📖 관련 근거 {count}건 보기 ▸
      </button>
    );
  }
  return (
    <div className="shrink-0 border-t-2 border-black/15 px-3 py-2 text-center text-[12px] text-black/35">
      📖 관련 근거 없음
    </div>
  );
}

type Dir4 = "up" | "down" | "left" | "right";

/**
 * Single D-pad button. Defined at module scope (NOT inside TouchControls) so its
 * component identity is stable: re-rendering the parent must never UNMOUNT this
 * button. A remount while the finger is held swallows the pointer-up, leaving the
 * direction stuck "on" — which made the player keep walking after touching a sage
 * (proximity → setHint → parent re-render → remount).
 */
function DPadButton({
  dir,
  label,
  col,
  row,
  onPress,
  onRelease,
}: {
  dir: Dir4;
  label: string;
  col: number;
  row: number;
  onPress: (d: Dir4) => void;
  onRelease: (d: Dir4) => void;
}) {
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        onPress(dir);
      }}
      onPointerUp={() => onRelease(dir)}
      onPointerCancel={() => onRelease(dir)}
      onPointerLeave={() => onRelease(dir)}
      onLostPointerCapture={() => onRelease(dir)}
      onContextMenu={(e) => e.preventDefault()}
      style={{ gridColumn: col, gridRow: row }}
      className="flex h-12 w-12 select-none items-center justify-center rounded-xl border-2 border-white/30 bg-black/45 text-lg text-white active:bg-amber-500/70"
    >
      {label}
    </button>
  );
}

/** On-screen D-pad + action buttons for touch devices. */
function TouchControls() {
  const dirs = useRef({ up: false, down: false, left: false, right: false });

  const emit = () => {
    const d = dirs.current;
    bus.emit("touchMove", {
      x: (d.right ? 1 : 0) - (d.left ? 1 : 0),
      y: (d.down ? 1 : 0) - (d.up ? 1 : 0),
    });
  };
  const set = (k: Dir4, v: boolean) => {
    dirs.current[k] = v;
    emit();
  };
  const onPress = (k: Dir4) => set(k, true);
  const onRelease = (k: Dir4) => set(k, false);

  // Safety net: if the controls unmount (e.g. a modal opens) while a direction is
  // held, make sure the game stops moving instead of drifting indefinitely.
  useEffect(() => {
    return () => bus.emit("touchMove", { x: 0, y: 0 });
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 lg:hidden">
      {/* D-pad bottom-left */}
      <div
        className="pointer-events-auto absolute bottom-4 left-4 grid touch-none gap-1"
        style={{ gridTemplateColumns: "repeat(3,1fr)", gridTemplateRows: "repeat(3,1fr)" }}
      >
        <DPadButton dir="up" label="▲" col={2} row={1} onPress={onPress} onRelease={onRelease} />
        <DPadButton dir="left" label="◀" col={1} row={2} onPress={onPress} onRelease={onRelease} />
        <DPadButton dir="right" label="▶" col={3} row={2} onPress={onPress} onRelease={onRelease} />
        <DPadButton dir="down" label="▼" col={2} row={3} onPress={onPress} onRelease={onRelease} />
      </div>

      {/* Actions bottom-right */}
      <div className="pointer-events-auto absolute bottom-4 right-4 flex touch-none flex-col gap-2">
        <button
          onClick={() => bus.emit("reqInteract", undefined)}
          className="rounded-xl border-2 border-amber-400 bg-black/55 px-4 py-2.5 text-sm font-bold text-white active:bg-amber-500/70"
        >
          💬 대화
        </button>
        <button
          onClick={() => bus.emit("reqAskAll", undefined)}
          className="rounded-xl border-2 border-violet-400 bg-black/55 px-4 py-2.5 text-sm font-bold text-white active:bg-violet-500/70"
        >
          🙏 동시질문
        </button>
      </div>
    </div>
  );
}

/** Reveals text one character at a time. */
function Typewriter({ text, speed = 18 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return <>{shown}</>;
}

function Avatar({ npc, size = 40 }: { npc: Npc; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/assets/${npc.asset}.png`}
      alt={npc.name}
      width={size}
      height={size}
      onError={(e) => {
        (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
      }}
      className="shrink-0 rounded-full border border-[#3a5a44] object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-black/50"
      style={{ animationDelay: delay }}
    />
  );
}
