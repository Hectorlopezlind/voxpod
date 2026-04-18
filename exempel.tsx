import type { ReactNode } from "react";

type Bookmark = {
  label: string;
  time: string;
};

const categories = ["Studier", "Nyheter", "Artiklar", "Personligt"] as const;
const voices = ["Sofia - varm", "Elias - klar", "Maya - lugn", "Daniel - energisk"] as const;
const bookmarks: Bookmark[] = [
  { time: "01:24", label: "Viktig poäng" },
  { time: "04:52", label: "Bra sammanfattning" },
  { time: "08:17", label: "Citat att spara" },
];
const navigationItems = ["Hem", "Bibliotek", "Skapa", "Profil"] as const;

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-3xl border border-white/5 bg-zinc-800/70 p-4 ${className}`}>
      {children}
    </section>
  );
}

function ActionButton({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <button type="button" className={`rounded-2xl py-3 font-medium ${className}`}>
      {children}
    </button>
  );
}

export default function VoxpodMobileLayout() {
  return (
    <div className="flex min-h-screen items-start justify-center bg-zinc-950 p-4 text-white">
      <div className="w-full max-w-sm overflow-hidden rounded-[34px] border border-white/10 bg-zinc-900 shadow-2xl">
        <header className="border-b border-white/10 bg-gradient-to-b from-violet-600/30 via-fuchsia-500/10 to-transparent p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.28em] text-zinc-400">Voxpod</p>
              <h1 className="mt-1 text-2xl font-semibold">Skapa podd från text</h1>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-lg">🎧</div>
          </div>

          <div className="flex gap-3 rounded-3xl bg-white/6 p-3 backdrop-blur">
            <ActionButton className="flex-1 bg-white text-zinc-950">Ladda upp fil</ActionButton>
            <ActionButton className="flex-1 bg-zinc-800 text-white">Ta bild</ActionButton>
          </div>
        </header>

        <main className="space-y-4 p-4">
          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Text från bild / fil</h2>
              <span className="text-xs text-emerald-400">OCR klar</span>
            </div>
            <div className="min-h-[130px] rounded-2xl bg-zinc-950/60 p-3 text-sm leading-6 text-zinc-300">
              Här visas texten automatiskt efter att användaren har laddat upp en fil eller tagit en bild...
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <ActionButton className="bg-violet-500 text-white">Översätt</ActionButton>
              <ActionButton className="bg-fuchsia-500 text-white">Skapa podd</ActionButton>
            </div>
          </Panel>

          <Panel>
            <h2 className="mb-3 text-sm font-medium text-zinc-200">Röst och kategori</h2>
            <div className="space-y-3">
              <div>
                <label htmlFor="voice-select" className="mb-2 block text-xs text-zinc-400">
                  Välj röst
                </label>
                <select
                  id="voice-select"
                  className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm"
                  defaultValue={voices[0]}
                >
                  {voices.map((voice) => (
                    <option key={voice}>{voice}</option>
                  ))}
                </select>
              </div>

              <div>
                <p className="mb-2 text-xs text-zinc-400">Kategori</p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category, index) => (
                    <button
                      key={category}
                      type="button"
                      className={`rounded-full px-3 py-2 text-sm ${
                        index === 0 ? "bg-white text-zinc-950" : "bg-zinc-950 text-zinc-300"
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="bg-gradient-to-br from-zinc-800 to-zinc-900">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-zinc-400">Nu spelas</p>
                <h2 className="font-semibold">Din genererade podd</h2>
              </div>
              <div className="text-2xl">🎙️</div>
            </div>

            <div className="mb-3 rounded-2xl bg-black/30 p-3">
              <div className="overflow-hidden rounded-full bg-white/10">
                <div className="h-2 w-1/2 rounded-full bg-white" />
              </div>
              <div className="mt-2 flex justify-between text-xs text-zinc-400">
                <span>07:12</span>
                <span>14:24</span>
              </div>
            </div>

            <div className="flex items-center justify-center gap-4">
              <button type="button" aria-label="Spola tillbaka" className="h-11 w-11 rounded-full bg-zinc-700">
                ⏪
              </button>
              <button type="button" aria-label="Spela upp" className="h-14 w-14 rounded-full bg-white text-xl text-zinc-950">
                ▶
              </button>
              <button type="button" aria-label="Spola fram" className="h-11 w-11 rounded-full bg-zinc-700">
                ⏩
              </button>
            </div>
          </Panel>

          <Panel className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Sammanfattning</h2>
              <button type="button" className="rounded-full bg-white/10 px-3 py-1.5 text-xs">
                Läs upp
              </button>
            </div>
            <p className="text-sm leading-6 text-zinc-300">
              Här kan användaren läsa en kort sammanfattning av innehållet, och även få den uppläst med vald röst.
            </p>
          </Panel>

          <Panel>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-200">Bokmärken i ljudfil</h2>
              <button type="button" className="rounded-full bg-violet-500/20 px-3 py-1.5 text-xs text-violet-300">
                + Nytt bokmärke
              </button>
            </div>
            <div className="space-y-2">
              {bookmarks.map((bookmark) => (
                <div key={bookmark.time} className="flex items-center justify-between rounded-2xl bg-zinc-950/60 p-3">
                  <div>
                    <p className="text-sm font-medium">{bookmark.label}</p>
                    <p className="text-xs text-zinc-400">{bookmark.time}</p>
                  </div>
                  <button type="button" className="rounded-full bg-white/10 px-3 py-1.5 text-sm">
                    Gå till
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <nav className="grid grid-cols-4 gap-2 pb-2 text-center text-xs text-zinc-400" aria-label="Primär navigation">
            {navigationItems.map((item, index) => (
              <div
                key={item}
                className={`rounded-2xl py-3 ${index === 0 ? "bg-white/10 text-white" : "bg-white/5"}`}
              >
                {item}
              </div>
            ))}
          </nav>
        </main>
      </div>
    </div>
  );
}
