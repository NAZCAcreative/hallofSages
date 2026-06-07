import GameShell from "@/game/GameShell";
import MysticBackground from "@/components/MysticBackground";
import MusicPlayer from "@/components/MusicPlayer";

export default function Home() {
  return (
    <>
      <MysticBackground />
      <MusicPlayer />
      <main className="mx-auto flex min-h-[100svh] max-w-5xl flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6">
        <header className="mt-9 text-center lg:mt-0">
          <h1 className="text-2xl font-bold drop-shadow-[0_2px_16px_rgba(139,92,246,0.55)] sm:text-3xl">
            🏛️ <span className="title-en">Hall of Sages</span>{" "}
            <span className="title-ko text-amber-300">현자들의 전당</span>
          </h1>
          {/* keyboard hint on desktop, touch hint on mobile */}
          <p className="mt-1 hidden text-sm text-white/55 lg:block">
방향키/<kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">WASD</kbd> 이동 · <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">E</kbd> 1:1 대화 · <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">Enter</kbd> 동시 질문
          </p>
          <p className="mt-1 text-xs text-white/55 lg:hidden">
            아래 방향패드로 이동 · 💬 대화 · 🙏 동시질문
          </p>
        </header>

        <GameShell />

        <footer className="text-center text-[11px] text-white/35 sm:text-xs">
          예수님 · 부처님 · 공자님 — 세 현자가 당신의 물음을 기다립니다.
        </footer>
      </main>
    </>
  );
}
