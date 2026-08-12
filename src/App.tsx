import { useEffect, useMemo, useState } from 'react'

const primaryGradient = 'from-[#6d5dff] via-[#9e7bff] to-[#d49aff]'
const accentGradient = 'from-[#2ac6d1] via-[#60c0ff] to-[#b27bff]'

const sections = [
  { label: 'Current task', description: 'Define a quick task to focus on for this session.' },
  { label: 'Session tabs', description: 'Focus / Short break / Long break overview.' },
  { label: 'Timer', description: 'Large circular timer with remaining time and countdown.' },
  { label: 'Controls', description: 'Start, pause, skip, and reset actions.' },
  { label: 'Progress snapshot', description: 'Pomodoro cycle progress and streaks.' },
  { label: 'History & stats', description: 'Session history timeline and metrics.' },
]

const historyEntries = [
  { label: 'Focus session • 25m', time: 'Today • 9:00 AM' },
  { label: 'Short break • 5m', time: 'Today • 9:25 AM' },
  { label: 'Focus session • 25m', time: 'Today • 9:30 AM' },
  { label: 'Long break • 15m', time: 'Yesterday • 5:10 PM' },
]

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const themeLabel = useMemo(() => (theme === 'light' ? 'Premium light' : 'Premium dark'), [theme])
  const rootClasses = theme === 'light' ? 'min-h-screen bg-slate-50 text-slate-900' : 'min-h-screen bg-slate-950 text-slate-100'
  const mutedText = theme === 'light' ? 'text-slate-500' : 'text-slate-400'
  const sectionBg = theme === 'light' ? 'bg-white/80 border-slate-200/70 shadow-[0_25px_60px_rgba(15,23,42,0.3)]' : 'bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-white/5 shadow-[0_20px_45px_rgba(8,15,32,0.5)]'
  const tabBg = theme === 'light' ? 'border border-slate-200/80 bg-white/80 text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,0.15)]' : 'border border-white/10 bg-slate-900/80 text-white shadow-inner shadow-black/40'
  const controlBg = theme === 'light' ? 'bg-gradient-to-br from-slate-100 to-slate-200' : 'bg-gradient-to-br from-slate-900 to-slate-950'

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))

  return (
    <div className={rootClasses}>
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10 space-y-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className={`text-sm uppercase tracking-[0.4em] ${mutedText}`}>Premium Pomodoro</p>
            <h1 className="text-3xl md:text-4xl font-semibold">Focus workspace</h1>
            <p className={`text-sm md:text-base mt-1 ${mutedText}`}>Clear sessions, track cycles, stay intentional.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs tracking-[0.3em] uppercase text-slate-500">Theme</div>
            <button
              className="relative inline-flex items-center px-4 py-2 rounded-full bg-gradient-to-r from-slate-800 via-slate-900 to-slate-900 border border-white/10 shadow-lg shadow-slate-950/30"
              onClick={toggleTheme}
            >
              <span className="text-sm font-medium text-white">{themeLabel}</span>
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-6">
            <div className={`rounded-2xl p-6 ${sectionBg}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm uppercase tracking-[0.3em] ${mutedText}`}>Task</p>
                  <h2 className="text-2xl font-semibold">Plan next design review</h2>
                  <p className={`text-sm ${mutedText}`}>Keep a single priority task for the session.</p>
                </div>
                <button
                  className="px-4 py-1 rounded-full border border-white/20 text-sm text-white/80 transition hover:bg-white/10"
                  type="button"
                >
                  Edit
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {['Focus', 'Short break', 'Long break'].map((tab) => (
                <div key={tab} className={`flex flex-col gap-1 rounded-2xl p-4 ${tabBg}`}>
                  <p className={`text-xs uppercase tracking-[0.4em] ${mutedText}`}>{tab}</p>
                  <p className="text-2xl font-semibold text-white">25:00</p>
                  <p className={`text-xs ${mutedText}`}>Cycle • 3/4</p>
                </div>
              ))}
            </div>

            <div className={`rounded-3xl border border-white/10 p-6 text-center ${theme === 'light' ? 'bg-gradient-to-br from-white via-slate-100 to-slate-200 shadow-[0_25px_60px_rgba(15,23,42,0.3)]' : 'bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 shadow-[0_25px_60px_rgba(12,17,33,0.65)]'}`}>
              <div className={`mx-auto h-[260px] w-[260px] rounded-full border border-white/10 bg-gradient-to-br ${primaryGradient}`}></div>
              <div className="mt-6 text-left">
                <p className={`text-sm uppercase tracking-[0.35em] ${mutedText}`}>Session</p>
                <h3 className="text-4xl font-bold">21:43</h3>
                <p className={`text-sm ${mutedText}`}>Next break in 3 sessions</p>
              </div>
            </div>

            <div className={`group grid grid-cols-2 rounded-2xl border border-white/10 p-4 ${theme === 'light' ? 'bg-white/80 shadow-[0_20px_40px_rgba(15,23,42,0.3)]' : 'bg-slate-900/70 shadow-[0_25px_60px_rgba(5,6,20,0.75)]'}`}>
              {['Start', 'Pause', 'Reset', 'Skip'].map((control) => (
                <button
                  key={control}
                  className={`rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold uppercase tracking-[0.35em] transition hover:border-white/40 ${theme === 'light' ? 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-900 hover:text-slate-900' : 'bg-gradient-to-br from-slate-900 to-slate-950 text-slate-300 text-white'}`}
                  type="button"
                >
                  {control}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className={`rounded-3xl border border-white/10 p-6 ${accentGradient} bg-gradient-to-br shadow-[0_20px_45px_rgba(7,10,30,0.5)]`}>
              <p className={`text-sm uppercase tracking-[0.4em] ${theme === 'light' ? 'text-slate-900/80' : 'text-white/80'}`}>Progress</p>
              <div className="mt-4 flex justify-between items-end text-white">
                <div>
                  <p className="text-4xl font-extrabold">4</p>
                  <p className="text-xs text-white/80">Pomodoros today</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">Streak</p>
                  <p className="text-2xl">5 🔥</p>
                </div>
              </div>
            </div>

            <div className={`rounded-3xl border border-white/10 p-5 shadow-[0_15px_35px_rgba(2,4,10,0.8)] ${theme === 'light' ? 'bg-white/70' : 'bg-slate-900/70'}`}>
              <div className="flex items-center justify-between">
                <p className={`text-sm uppercase tracking-[0.4em] ${mutedText}`}>Focus history</p>
                <button className={`text-xs uppercase tracking-[0.3em] ${theme === 'light' ? 'text-slate-900/70' : 'text-white/70'}`} type="button">
                  View all
                </button>
              </div>
              <div className="mt-4 space-y-3">
                {historyEntries.map((entry) => (
                  <div
                    key={entry.time}
                    className={`flex items-center justify-between rounded-2xl border border-white/5 px-4 py-3 text-sm ${theme === 'light' ? 'bg-slate-100/60 text-slate-900' : 'bg-slate-950/60 text-white'}`}
                  >
                    <div>
                      <p className="font-medium">{entry.label}</p>
                      <p className={`text-xs ${mutedText}`}>{entry.time}</p>
                    </div>
                    <span className={`text-xs uppercase tracking-[0.3em] ${mutedText}`}>Done</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`rounded-3xl border border-white/10 p-5 ${theme === 'light' ? 'bg-white/70 shadow-[0_15px_40px_rgba(15,23,42,0.18)]' : 'bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 shadow-[0_15px_40px_rgba(0,0,0,0.65)]'}`}>
              <p className={`text-sm uppercase tracking-[0.4em] ${mutedText}`}>Checklist</p>
              <div className="mt-4 space-y-3">
                {sections.map((item) => (
                  <div
                    key={item.label}
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${theme === 'light' ? 'border-slate-200/60 bg-slate-100/80 text-slate-900' : 'border-white/5 bg-white/5 text-white'}`}
                  >
                    <div className={`flex h-8 w-8 items-center justify-center rounded-2xl border bg-slate-900/80 text-xs font-semibold uppercase tracking-[0.3em] ${theme === 'light' ? 'border-slate-200/70 text-slate-50 bg-slate-900/80' : 'border-white/20'}`}>
                      {item.label[0]}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className={`text-xs ${mutedText}`}>{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
