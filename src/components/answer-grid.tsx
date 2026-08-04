const ANSWER_STYLES = [
  {
    bg: "bg-[var(--a1)]",
    text: "text-[#1a1208]",
    label: "A",
  },
  {
    bg: "bg-[var(--a2)]",
    text: "text-[#081018]",
    label: "B",
  },
  {
    bg: "bg-[var(--a3)]",
    text: "text-[#140a08]",
    label: "C",
  },
  {
    bg: "bg-[var(--a4)]",
    text: "text-[#0a1010]",
    label: "D",
  },
] as const;

export { ANSWER_STYLES };

export function AnswerGrid({
  answers,
  disabled,
  selected,
  correctIndex,
  showCorrect,
  onSelect,
}: {
  answers: [string, string, string, string];
  disabled?: boolean;
  selected?: number | null;
  correctIndex?: number;
  showCorrect?: boolean;
  onSelect?: (index: number) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {answers.map((answer, i) => {
        const style = ANSWER_STYLES[i];
        const isSelected = selected === i;
        const isCorrect = showCorrect && correctIndex === i;
        const isWrong = showCorrect && isSelected && correctIndex !== i;

        let ring = "ring-transparent";
        if (isCorrect) ring = "ring-[var(--accent)] scale-[1.02]";
        else if (isWrong) ring = "ring-white/70 opacity-60";
        else if (isSelected) ring = "ring-white";

        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onSelect?.(i)}
            className={`group relative min-h-[4.5rem] overflow-hidden rounded-2xl ${style.bg} ${style.text} px-4 py-4 text-left font-semibold shadow-[0_12px_40px_rgba(0,0,0,0.25)] ring-4 transition duration-200 ${ring} disabled:cursor-default`}
          >
            <span className="mb-1 block font-[family-name:var(--font-display)] text-xs tracking-[0.2em] opacity-70">
              {style.label}
            </span>
            <span className="block text-lg leading-snug sm:text-xl">{answer}</span>
          </button>
        );
      })}
    </div>
  );
}
