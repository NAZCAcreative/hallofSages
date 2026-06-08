import GameShell from "@/game/GameShell";
import MysticBackground from "@/components/MysticBackground";
import MusicPlayer from "@/components/MusicPlayer";
import { APP_BUILD, DEFAULT_MODEL } from "@/lib/version";

export default function Home() {
  // Server-rendered, so it reflects the actual model the API will use.
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  return (
    <>
      <MysticBackground />
      <MusicPlayer />
      <main className="mx-auto flex min-h-[100svh] max-w-5xl flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6">
        <header className="text-center">
          <h1 className="font-bold leading-tight drop-shadow-[0_2px_16px_rgba(139,92,246,0.55)]">
            <span className="title-en block text-2xl sm:text-3xl">
              🏛️ Hall of Sages
            </span>
            <span className="title-ko mt-1 block text-lg text-amber-300 sm:text-xl">
              현자들의 전당
            </span>
          </h1>
          {/* keyboard hint on desktop (mobile touch hint moved to the bottom) */}
          <p className="mt-1 hidden text-sm text-white/55 lg:block">
방향키/<kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">WASD</kbd> 이동 · <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">E</kbd> 1:1 대화 · <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">Enter</kbd> 동시 질문
          </p>
        </header>

        <GameShell />

        {/* mobile touch hint — sits just above the footer */}
        <p className="text-center text-xs text-white/55 lg:hidden">
          아래 방향패드로 이동 · 💬 대화 · 🙏 동시질문
        </p>

        <footer className="text-center text-[11px] text-white/35 sm:text-xs">
          예수님 · 부처님 · 공자님 — 세 현자가 당신의 물음을 기다립니다.
        </footer>
      </main>

      {/* Always-visible build + model badge, pinned to the very bottom edge.
          Bump APP_BUILD (src/lib/version.ts) each deploy to confirm what's live. */}
      <div className="pointer-events-none fixed bottom-0 left-1.5 z-50 font-mono text-[10px] leading-none text-white/30">
        build {APP_BUILD} · {model}
      </div>
    </>
  );
}
