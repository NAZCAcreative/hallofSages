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
];

const randIdx = (exclude = -1) => {
  if (PLAYLIST.length < 2) return 0;
  let n = exclude;
  while (n === exclude) n = Math.floor(Math.random() * PLAYLIST.length);
  return n;
};

export default function MusicPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Client mount: pick a random starting track (avoids SSR hydration mismatch).
  useEffect(() => {
    setIdx(randIdx());
    setMounted(true);
  }, []);

  // Autoplay ASAP; if the browser blocks it, start on the first user interaction.
  useEffect(() => {
    if (!mounted) return;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.5;
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

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().then(() => setPlaying(true)).catch(() => {});
    else {
      audio.pause();
      setPlaying(false);
    }
  }

  function next() {
    setIdx((i) => randIdx(i)); // random next track
    setPlaying(true);
  }

  if (!mounted) return null;
  const track = PLAYLIST[idx];

  return (
    <div className="fixed left-2 top-2 z-50 flex items-center gap-1 rounded-full border border-amber-400/40 bg-black/65 px-1.5 py-1 text-white shadow-lg backdrop-blur">
      <audio
        ref={audioRef}
        src={track.src}
        onEnded={next}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        preload="auto"
      />
      <button
        onClick={toggle}
        title={playing ? "음악 끄기" : "음악 켜기"}
        className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
      >
        {playing ? "🔊" : "🔈"}
      </button>
      <span className="hidden max-w-[130px] truncate text-xs text-white/70 sm:inline">
        ♪ {track.title}
      </span>
      <button
        onClick={next}
        title="다음 곡 (랜덤)"
        className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
      >
        ⏭
      </button>
    </div>
  );
}
