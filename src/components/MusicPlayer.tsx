"use client";

import { useEffect, useRef, useState } from "react";

type Track = { title: string; src: string };

const PLAYLIST: Track[] = [
  { title: "Hall of Sages", src: "/sound/hall-of-sages.mp3" },
  { title: "Lantern Hall of Wisdom", src: "/sound/lantern-hall-of-wisdom.mp3" },
  { title: "Lantern Hall", src: "/sound/lantern-hall.mp3" },
  { title: "Lantern Sanctum", src: "/sound/lantern-sanctum.mp3" },
  { title: "Temple of Echoes", src: "/sound/temple-of-echoes.mp3" },
  { title: "Fantasy Sanctuary", src: "/sound/fantasy-sanctuary.mp3" },
  { title: "Hall of Sages (Reborn)", src: "/sound/reborn-hall-of-sages.mp3" },
  { title: "Lantern Hall (Reborn)", src: "/sound/reborn-lantern-hall.mp3" },
  { title: "Lantern Sanctum (Reborn)", src: "/sound/reborn-lantern-sanctum.mp3" },
  { title: "Temple of Echoes (Reborn)", src: "/sound/reborn-temple-of-echoes.mp3" },
  { title: "Fantasy Sanctuary (Reborn)", src: "/sound/reborn-fantasy-sanctuary.mp3" },
];

const wrap = (i: number) => (i + PLAYLIST.length) % PLAYLIST.length;
const randIdx = (exclude = -1) => {
  if (PLAYLIST.length < 2) return 0;
  let n = exclude;
  while (n === exclude) n = Math.floor(Math.random() * PLAYLIST.length);
  return n;
};

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [volume, setVolume] = useState(0.5);

  // Client mount: pick a random starting track (avoids SSR hydration mismatch).
  useEffect(() => {
    setIdx(randIdx());
    setMounted(true);
    const saved = Number(localStorage.getItem("hos-volume"));
    if (localStorage.getItem("hos-volume") !== null && saved >= 0 && saved <= 1) {
      setVolume(saved);
    }
  }, []);

  // Apply + remember the chosen volume.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try {
      localStorage.setItem("hos-volume", String(volume));
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [volume]);

  // Autoplay ASAP; if the browser blocks it, start on the first user interaction.
  useEffect(() => {
    if (!mounted) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    const tryPlay = () => audio.play().then(() => setPlaying(true)).catch(() => {});
    tryPlay();
    const onFirst = () => {
      tryPlay();
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
    window.addEventListener("pointerdown", onFirst);
    window.addEventListener("keydown", onFirst);
    return () => {
      window.removeEventListener("pointerdown", onFirst);
      window.removeEventListener("keydown", onFirst);
    };
  }, [mounted]);

  // Play the new track when it changes (if we were playing).
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && playing) audio.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // Close the playlist when clicking outside of the player.
  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setListOpen(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [listOpen]);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => {});
    else {
      audio.pause();
      setPlaying(false);
    }
  }

  const prev = () => {
    setIdx((i) => wrap(i - 1));
    setPlaying(true);
  };
  const next = () => {
    setIdx((i) => wrap(i + 1));
    setPlaying(true);
  };
  const select = (i: number) => {
    setIdx(i);
    setPlaying(true);
    setListOpen(false);
  };

  if (!mounted) return null;
  const track = PLAYLIST[idx];

  return (
    <div
      ref={rootRef}
      className="fixed bottom-2 left-1/2 z-50 -translate-x-1/2"
    >
      <div className="flex items-center gap-0.5 rounded-full border border-amber-400/40 bg-black/65 px-1.5 py-1 text-white shadow-lg backdrop-blur">
        <audio
          ref={audioRef}
          src={track.src}
          onEnded={next}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          preload="auto"
        />

        <button
          onClick={prev}
          title="이전 곡"
          className="flex h-7 w-7 items-center justify-center rounded-full text-sm hover:bg-white/15"
        >
          ⏮
        </button>
        <button
          onClick={toggle}
          title={playing ? "정지" : "재생"}
          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          onClick={next}
          title="다음 곡"
          className="flex h-7 w-7 items-center justify-center rounded-full text-sm hover:bg-white/15"
        >
          ⏭
        </button>

        <span className="mx-1 max-w-[110px] truncate text-xs text-white/75 sm:max-w-[180px]">
          {playing ? "♪" : "❚❚"} {track.title}
        </span>

        <span className="text-xs text-white/55" aria-hidden>
          🔊
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          title="볼륨"
          aria-label="볼륨"
          className="h-1 w-14 cursor-pointer accent-amber-400 sm:w-20"
        />

        <button
          onClick={() => setListOpen((v) => !v)}
          title="재생목록"
          aria-expanded={listOpen}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm hover:bg-white/15 ${
            listOpen ? "bg-white/15" : ""
          }`}
        >
          ☰
        </button>
      </div>

      {/* Playlist dropdown (opens upward — the bar sits at the bottom) */}
      {listOpen && (
        <div className="absolute bottom-full left-1/2 mb-1.5 w-60 -translate-x-1/2 overflow-hidden rounded-2xl border border-amber-400/40 bg-black/85 text-white shadow-2xl backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <span className="text-xs font-bold text-amber-300">🎵 재생목록</span>
            <span className="text-[11px] text-white/40">{PLAYLIST.length}곡</span>
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {PLAYLIST.map((t, i) => {
              const active = i === idx;
              return (
                <li key={t.src}>
                  <button
                    onClick={() => select(i)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/10 ${
                      active ? "bg-amber-400/15 text-amber-200" : "text-white/80"
                    }`}
                  >
                    <span className="w-4 shrink-0 text-center">
                      {active ? (playing ? "🔊" : "❚❚") : i + 1}
                    </span>
                    <span className="truncate">{t.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
