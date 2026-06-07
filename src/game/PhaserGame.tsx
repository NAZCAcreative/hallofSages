"use client";

import { useEffect, useRef } from "react";

// Mounts the Phaser game into a div. Phaser is imported dynamically so it never
// runs during SSR (it needs `window`).
export default function PhaserGame() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let game: import("phaser").Game | undefined;
    let cancelled = false;

    (async () => {
      // Ensure web fonts are downloaded before Phaser draws canvas text labels.
      try {
        await Promise.all([
          document.fonts.load('700 24px "Gowun Batang"'),
          document.fonts.load('400 24px "Song Myung"'),
        ]);
      } catch {
        /* fall back to system font */
      }
      const { createGame } = await import("./MainScene");
      if (cancelled || !containerRef.current) return;
      game = createGame(containerRef.current);
    })();

    return () => {
      cancelled = true;
      game?.destroy(true);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      aria-label="Hall of Sages game canvas"
    />
  );
}
