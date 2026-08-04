import Link from "next/link";

export default function HomePage() {
  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[min(70vh,640px)] opacity-90"
        style={{
          backgroundImage:
            "linear-gradient(180deg, transparent 55%, var(--bg)), url(\"data:image/svg+xml,%3Csvg viewBox='0 0 800 600' xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='%23171310' width='800' height='600'/%3E%3Ccircle cx='120' cy='140' r='90' fill='%23ffb020' opacity='0.35'/%3E%3Ccircle cx='640' cy='120' r='110' fill='%233ec6ff' opacity='0.28'/%3E%3Ccircle cx='420' cy='280' r='140' fill='%23ff5a36' opacity='0.22'/%3E%3Ccircle cx='220' cy='380' r='80' fill='%235dffb0' opacity='0.2'/%3E%3C/svg%3E\")",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      <header className="relative z-10 flex items-center justify-between px-5 py-6 sm:px-10">
        <p className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)] sm:text-2xl">
          QuizLive
        </p>
        <Link href="/join" className="btn-ghost text-sm">
          Войти в игру
        </Link>
      </header>

      <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 pb-16 pt-8 sm:px-10">
        <p
          className="animate-rise mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-[var(--line)] bg-black/25 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent)] backdrop-blur-sm"
          style={{ animationDelay: "0.05s" }}
        >
          Живые викторины
        </p>
        <h1
          className="animate-rise max-w-3xl font-[family-name:var(--font-display)] text-5xl leading-[0.95] tracking-tight text-[var(--ink)] sm:text-7xl lg:text-8xl"
          style={{ animationDelay: "0.12s" }}
        >
          QuizLive
        </h1>
        <p
          className="animate-rise mt-6 max-w-xl text-lg text-[var(--muted)] sm:text-xl"
          style={{ animationDelay: "0.22s" }}
        >
          Загрузи картинки, придумай четыре ответа — и запусти игру. Друзья
          заходят со своих телефонов, очки зависят от скорости.
        </p>
        <div
          className="animate-rise mt-10 flex flex-wrap gap-3"
          style={{ animationDelay: "0.32s" }}
        >
          <Link href="/create" className="btn-primary text-base">
            Создать викторину
          </Link>
          <Link href="/join" className="btn-ghost text-base">
            Присоединиться по коду
          </Link>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[var(--line)] px-5 py-5 text-sm text-[var(--muted)] sm:px-10">
        Создатель ведёт игру · игроки отвечают со своих устройств · быстрее =
        больше баллов
      </footer>
    </main>
  );
}
