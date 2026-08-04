"use client";

import { useEffect, useState } from "react";

export function CountdownBar({
  startedAt,
  timeLimitMs,
}: {
  startedAt: number;
  timeLimitMs: number;
}) {
  const [left, setLeft] = useState(() =>
    Math.max(0, timeLimitMs - (Date.now() - startedAt)),
  );

  useEffect(() => {
    const tick = () => {
      setLeft(Math.max(0, timeLimitMs - (Date.now() - startedAt)));
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [startedAt, timeLimitMs]);

  const ratio = left / timeLimitMs;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
          Время
        </span>
        <span className="font-[family-name:var(--font-display)] text-2xl tabular-nums text-[var(--accent)]">
          {(left / 1000).toFixed(1)}с
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-100 ease-linear"
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
