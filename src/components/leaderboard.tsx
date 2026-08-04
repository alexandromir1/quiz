export function Leaderboard({
  players,
  highlightId,
  title = "Таблица лидеров",
}: {
  players: Array<{ id: string; name: string; score: number }>;
  highlightId?: string | null;
  title?: string;
}) {
  const sorted = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="w-full">
      <h2 className="font-[family-name:var(--font-display)] text-3xl tracking-tight text-[var(--ink)] sm:text-4xl">
        {title}
      </h2>
      <ul className="mt-6 space-y-2">
        {sorted.map((p, i) => {
          const mine = highlightId === p.id;
          return (
            <li
              key={p.id}
              className={`flex items-center gap-4 rounded-2xl px-4 py-3 transition ${
                mine
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "bg-white/5 text-[var(--ink)]"
              } ${i === 0 && !mine ? "ring-1 ring-[var(--accent)]/40" : ""}`}
              style={{
                animation: `rise-in 0.45s ease ${i * 0.06}s both`,
              }}
            >
              <span
                className={`w-8 font-[family-name:var(--font-display)] text-xl ${
                  mine ? "text-[var(--bg)]" : "text-[var(--accent)]"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex-1 truncate text-lg font-semibold">{p.name}</span>
              <span className="font-[family-name:var(--font-display)] text-xl tabular-nums">
                {p.score}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
