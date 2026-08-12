import {
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useState,
} from 'react'

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

const THEME_KEY = 'pomodoro_theme'
const TIMER_SETTINGS_KEY = 'pomodoro_timer_settings'
const CURRENT_TASK_KEY = 'pomodoro_current_task'
const HISTORY_KEY = 'pomodoro_history'

type TimerSettings = {
  focus: number
  shortBreak: number
  longBreak: number
  sessionsBeforeLongBreak: number
  autoStartFocus: boolean
  autoStartBreaks: boolean
  soundEnabled: boolean
}

type HistoryEntry = {
  label: string
  time: string
  type: 'focus' | 'shortBreak' | 'longBreak'
}

const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  sessionsBeforeLongBreak: 4,
  autoStartFocus: false,
  autoStartBreaks: false,
  soundEnabled: true,
}

const DEFAULT_HISTORY_ENTRIES: HistoryEntry[] = [
  { label: 'Focus session • 25m', time: 'Today • 9:00 AM', type: 'focus' },
  { label: 'Short break • 5m', time: 'Today • 9:25 AM', type: 'shortBreak' },
  { label: 'Focus session • 25m', time: 'Today • 9:30 AM', type: 'focus' },
  { label: 'Long break • 15m', time: 'Yesterday • 5:10 PM', type: 'longBreak' },
]

type StorageValidator<T> = (value: unknown) => value is T

const isBrowser = typeof window !== 'undefined'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const readLocalValue = <T,>(
  key: string,
  fallback: () => T,
  validator?: StorageValidator<T>,
): T => {
  if (!isBrowser) {
    return fallback()
  }

  try {
    const stored = window.localStorage.getItem(key)
    if (!stored) {
      return fallback()
    }

    const parsed = JSON.parse(stored)
    if (validator && !validator(parsed)) {
      return fallback()
    }

    return parsed as T
  } catch (error) {
    console.warn(`Unable to read localStorage key "${key}":`, error)
    return fallback()
  }
}

const writeLocalValue = (key: string, value: unknown) => {
  if (!isBrowser) {
    return
  }

  try {
    const serialized = JSON.stringify(value)
    window.localStorage.setItem(key, serialized)
  } catch (error) {
    console.warn(`Unable to write localStorage key "${key}":`, error)
  }
}

const usePersistedState = <T,>(
  key: string,
  fallback: () => T,
  validator?: StorageValidator<T>,
): [T, Dispatch<SetStateAction<T>>] => {
  const [state, setState] = useState<T>(() => readLocalValue(key, fallback, validator))

  useEffect(() => {
    writeLocalValue(key, state)
  }, [key, state])

  return [state, setState]
}

const isTheme = (value: unknown): value is 'light' | 'dark' => value === 'light' || value === 'dark'

const resolvePreferredTheme = (): 'light' | 'dark' => {
  if (!isBrowser) {
    return 'dark'
  }

  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  return prefersDark ? 'dark' : 'light'
}

const isTimerSettings = (value: unknown): value is TimerSettings => {
  if (!isObject(value)) {
    return false
  }

  const {
    focus,
    shortBreak,
    longBreak,
    sessionsBeforeLongBreak,
    autoStartFocus,
    autoStartBreaks,
    soundEnabled,
  } = value

  const isPositiveNumber = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0

  const isBoolean = (candidate: unknown): candidate is boolean => typeof candidate === 'boolean'

  return (
    isPositiveNumber(focus) &&
    isPositiveNumber(shortBreak) &&
    isPositiveNumber(longBreak) &&
    isPositiveNumber(sessionsBeforeLongBreak) &&
    isBoolean(autoStartFocus) &&
    isBoolean(autoStartBreaks) &&
    isBoolean(soundEnabled)
  )
}

const isHistoryEntry = (value: unknown): value is HistoryEntry => {
  if (!isObject(value)) {
    return false
  }

  const { label, time, type } = value

  const isValidType = type === 'focus' || type === 'shortBreak' || type === 'longBreak'

  return typeof label === 'string' && typeof time === 'string' && isValidType
}

const isHistoryEntryArray = (value: unknown): value is HistoryEntry[] =>
  Array.isArray(value) && value.every((entry) => isHistoryEntry(entry))

const formatDuration = (minutes: number) => `${String(minutes).padStart(2, '0')}:00`

type DurationFieldKey = 'focus' | 'shortBreak' | 'longBreak' | 'sessionsBeforeLongBreak'
type ToggleFieldKey = 'autoStartFocus' | 'autoStartBreaks' | 'soundEnabled'

const sharedTokens = {
  motion: 'motion-safe:transition motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none',
  focusRing: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400',
  cardPadding: 'p-6 md:p-8',
  cardCorners: 'rounded-3xl',
  panelSpacing: 'space-y-6',
  heading: 'font-semibold tracking-tight',
  labelCaps: 'text-xs uppercase tracking-[0.4em] text-slate-500',
  buttonBase: 'rounded-2xl border px-4 py-2 text-sm font-semibold uppercase tracking-[0.35em]',
  inputBase: 'rounded-2xl border px-3 py-2 text-sm font-semibold uppercase tracking-[0.3em] placeholder:text-slate-400',
  badge: 'rounded-full px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.45em]',
}

const lightSurfaces = {
  shell: 'bg-slate-50 text-slate-900',
  card: 'bg-white/80 border-slate-200/70 shadow-[0_25px_60px_rgba(15,23,42,0.3)]',
  input: 'bg-slate-50 border-slate-200 text-slate-900',
  button: 'bg-gradient-to-br from-slate-100 to-slate-200 border-slate-300 text-slate-900 hover:text-slate-900',
  tab: 'border border-slate-200/80 bg-white/80 text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,0.15)]',
  checklist: 'border-slate-200/60 bg-slate-100/80 text-slate-900',
  badge: 'border-slate-200/70 text-slate-50 bg-slate-900/80',
}

const darkSurfaces = {
  shell: 'bg-slate-950 text-slate-100',
  card: 'bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-white/5 shadow-[0_20px_45px_rgba(8,15,32,0.5)]',
  input: 'bg-slate-800/80 border-white/10 text-white',
  button: 'bg-gradient-to-br from-slate-900 to-slate-950 text-slate-300',
  tab: 'border border-white/10 bg-slate-900/80 text-white shadow-inner shadow-black/40',
  checklist: 'border-white/5 bg-white/5 text-white',
  badge: 'border-white/20',
}

const getSurfaceStyles = (theme: 'light' | 'dark', key: keyof typeof lightSurfaces) =>
  theme === 'light' ? lightSurfaces[key] : darkSurfaces[key]

const focusControls = ['Start', 'Pause', 'Reset', 'Skip'] as const

export default function App() {
  const [theme, setTheme] = usePersistedState<'light' | 'dark'>(THEME_KEY, resolvePreferredTheme, isTheme)
  const [timerSettings, setTimerSettings] = usePersistedState<TimerSettings>(
    TIMER_SETTINGS_KEY,
    () => ({ ...DEFAULT_TIMER_SETTINGS }),
    isTimerSettings,
  )
  const [currentTask, setCurrentTask] = usePersistedState<string>(
    CURRENT_TASK_KEY,
    () => '',
    (value): value is string => typeof value === 'string',
  )
  const [historyEntries, setHistoryEntries] = usePersistedState<HistoryEntry[]>(
    HISTORY_KEY,
    () => DEFAULT_HISTORY_ENTRIES,
    isHistoryEntryArray,
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const themeLabel = useMemo(() => (theme === 'light' ? 'Premium light' : 'Premium dark'), [theme])
  const rootClasses = `${getSurfaceStyles(theme, 'shell')} min-h-screen ${sharedTokens.motion}`
  const mutedText = theme === 'light' ? 'text-slate-500' : 'text-slate-400'
  const cardBase = `${sharedTokens.cardCorners} ${sharedTokens.cardPadding} ${getSurfaceStyles(theme, 'card')} ${sharedTokens.motion}`
  const tabBase = `${sharedTokens.cardCorners} p-4 ${getSurfaceStyles(theme, 'tab')} ${sharedTokens.motion}`
  const controlButtonBase = `${sharedTokens.buttonBase} ${sharedTokens.motion} ${sharedTokens.focusRing}`
  const inputBase = `${sharedTokens.inputBase} ${getSurfaceStyles(theme, 'input')} ${sharedTokens.motion} ${sharedTokens.focusRing}`

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))

  const headers = [
    { label: 'Focus', duration: timerSettings.focus },
    { label: 'Short break', duration: timerSettings.shortBreak },
    { label: 'Long break', duration: timerSettings.longBreak },
  ]

  const focusEntries = useMemo(
    () => historyEntries.filter((entry) => entry.type === 'focus'),
    [historyEntries],
  )

  const pomodorosToday = useMemo(
    () => focusEntries.filter((entry) => entry.time.startsWith('Today')).length,
    [focusEntries],
  )

  const streak = useMemo(() => {
    let count = 0
    for (const entry of historyEntries) {
      if (entry.type === 'focus') {
        count += 1
      } else {
        break
      }
    }
    return count
  }, [historyEntries])

  const cycleIndex = useMemo(() => {
    if (focusEntries.length === 0) {
      return 1
    }

    return ((focusEntries.length - 1) % timerSettings.sessionsBeforeLongBreak) + 1
  }, [focusEntries.length, timerSettings.sessionsBeforeLongBreak])

  const cycleLabel = `Cycle • ${cycleIndex}/${timerSettings.sessionsBeforeLongBreak}`
  const badgeClasses = `${sharedTokens.badge} ${getSurfaceStyles(theme, 'badge')} ${sharedTokens.motion}`

  const sessionsUntilLongBreak = Math.max(1, timerSettings.sessionsBeforeLongBreak - cycleIndex)

  const logFocusSession = () => {
    const now = new Date()
    const formattedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

    setHistoryEntries((prev) => [
      {
        label: `Focus session • ${formatDuration(timerSettings.focus)}`,
        time: `Today • ${formattedTime}`,
        type: 'focus',
      },
      ...prev,
    ])
  }

  const updateDuration = (field: DurationFieldKey, rawValue: string) => {
    const parsed = Number(rawValue)
    if (Number.isNaN(parsed)) {
      return
    }

    setTimerSettings((prev) => ({
      ...prev,
      [field]: Math.max(1, Math.round(parsed)),
    }))
  }

  const toggleBoolean = (field: ToggleFieldKey) => {
    setTimerSettings((prev) => ({
      ...prev,
      [field]: !prev[field],
    }))
  }

  return (
    <div className={rootClasses}>
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10 space-y-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className={`${sharedTokens.labelCaps} ${mutedText}`}>Premium Pomodoro</p>
            <h1 className="text-3xl md:text-4xl font-semibold">Focus workspace</h1>
            <p className={`text-sm md:text-base ${mutedText}`}>Clear sessions, track cycles, stay intentional.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs tracking-[0.3em] uppercase text-slate-500">Theme</div>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className={`group relative inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 shadow-lg shadow-slate-950/30 bg-gradient-to-r from-slate-800 via-slate-900 to-slate-900 text-sm font-semibold uppercase tracking-[0.35em] ${sharedTokens.motion} ${sharedTokens.focusRing}`}
            >
              <span className="text-white">{themeLabel}</span>
              <span
                className={`inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 text-base transition-transform duration-200 ${
                  theme === 'dark' ? 'translate-x-0 bg-slate-900 text-slate-50' : 'translate-x-0 bg-slate-50 text-slate-900'
                }`}
              >
                {theme === 'light' ? '☀' : '☾'}
              </span>
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <section className="space-y-6">
            <div className={`${sharedTokens.cardCorners} ${sharedTokens.cardPadding} ${getSurfaceStyles(theme, 'card')} ${sharedTokens.motion} shadow-lg`}> 
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex-1 space-y-3">
                  <div>
                    <p className={`${sharedTokens.labelCaps} ${mutedText}`}>Task</p>
                    <p className="text-2xl font-semibold">Stay focused</p>
                    <p className={`text-sm ${mutedText}`}>Keep a single priority task for the session.</p>
                  </div>
                  <label className="relative block">
                    <span className="sr-only">Current task</span>
                    <textarea
                      value={currentTask}
                      onChange={(event) => setCurrentTask(event.target.value)}
                      className={`min-h-[80px] w-full shadow-inner ${inputBase}`}
                      placeholder="Describe what you want to accomplish this session..."
                    />
                  </label>
                </div>
                <button
                  className={`${controlButtonBase} ${getSurfaceStyles(theme, 'button')} ${sharedTokens.motion}`}
                  type="button"
                  onClick={logFocusSession}
                >
                  Sync
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {headers.map((tab) => (
                <article key={tab.label} className={`${tabBase}`}>
                  <p className={`${sharedTokens.labelCaps} ${mutedText}`}>{tab.label}</p>
                  <p className={`text-2xl font-semibold ${theme === 'light' ? 'text-slate-900' : 'text-white'}`}>{formatDuration(tab.duration)}</p>
                  <span className={badgeClasses}>{cycleLabel}</span>
                </article>
              ))}
            </div>

            <div className={`${sharedTokens.cardCorners} border border-white/10 p-6 text-center ${getSurfaceStyles(theme, 'card')} ${sharedTokens.motion}`}>
              <div className={`mx-auto h-[260px] w-[260px] rounded-full border border-white/10 bg-gradient-to-br ${primaryGradient}`}>
                <span className="sr-only">Circular timer placeholder</span>
              </div>
              <div className="mt-6 text-left space-y-1">
                <p className={`${sharedTokens.labelCaps} ${mutedText}`}>Session</p>
                <h3 className="text-4xl font-bold tracking-tight">21:43</h3>
                <p className={`text-sm ${mutedText}`}>Next break in {sessionsUntilLongBreak} sessions</p>
              </div>
            </div>

            <div className={`grid grid-cols-2 gap-3 ${sharedTokens.motion}`}>
              {focusControls.map((control) => (
                <button
                  key={control}
                  className={`${controlButtonBase} ${getSurfaceStyles(theme, 'button')} ${sharedTokens.motion}`}
                  type="button"
                >
                  {control}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-6">
            <div className={`${sharedTokens.cardCorners} ${sharedTokens.cardPadding} ${getSurfaceStyles(theme, 'button')} ${accentGradient} bg-gradient-to-br shadow-[0_20px_45px_rgba(7,10,30,0.5)] ${sharedTokens.motion}`}>
              <p className={`${sharedTokens.labelCaps} ${theme === 'light' ? 'text-slate-900/80' : 'text-white/80'}`}>Progress</p>
              <div className="mt-4 flex justify-between items-end text-white">
                <div>
                  <p className="text-4xl font-extrabold tracking-tight">{pomodorosToday}</p>
                  <p className="text-xs uppercase tracking-[0.35em] text-white/80">Pomodoros today</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">Streak</p>
                  <p className="text-2xl">{streak} 🔥</p>
                </div>
              </div>
            </div>

            <div className={`${cardBase} shadow-[0_15px_35px_rgba(2,4,10,0.8)]`}>
              <div className="flex items-center justify-between">
                <p className={`${sharedTokens.labelCaps} ${mutedText}`}>Timer settings</p>
                <p className={`text-xs uppercase tracking-[0.3em] ${mutedText}`}>Auto-saved</p>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {
                  ([
                    { label: 'Focus', key: 'focus' },
                    { label: 'Short break', key: 'shortBreak' },
                    { label: 'Long break', key: 'longBreak' },
                    { label: 'Sessions till long break', key: 'sessionsBeforeLongBreak' },
                  ] as const).map((field) => (
                    <label key={field.key} className="text-xs uppercase tracking-[0.35em] text-slate-400">
                      <span className="block text-[0.65rem] text-slate-400">{field.label}</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={timerSettings[field.key]}
                        onChange={(event) => updateDuration(field.key, event.target.value)}
                        className={inputBase}
                      />
                    </label>
                  ))}
              </div>
              <div className="mt-5 space-y-3">
                {
                  ([
                    {
                      label: 'Auto-start focus sessions',
                      key: 'autoStartFocus',
                      description: 'Immediately move into focus when a session completes.',
                    },
                    {
                      label: 'Auto-start breaks',
                      key: 'autoStartBreaks',
                      description: 'Begin break timers automatically.',
                    },
                    {
                      label: 'Sound cues',
                      key: 'soundEnabled',
                      description: 'Play a gentle tone when sessions end.',
                    },
                  ] as const).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => toggleBoolean(option.key)}
                      className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left text-sm transition ${getSurfaceStyles(
                        theme,
                        'checklist',
                      )} ${sharedTokens.motion} ${sharedTokens.focusRing}`}
                    >
                      <div>
                        <p className="font-semibold tracking-[0.3em] uppercase">{option.label}</p>
                        <p className={`text-[0.65rem] tracking-[0.2em] ${mutedText}`}>{option.description}</p>
                      </div>
                      <span className="text-xs tracking-[0.35em]">{timerSettings[option.key] ? 'On' : 'Off'}</span>
                    </button>
                  ))}
              </div>
            </div>

            <div className={`${cardBase} shadow-[0_15px_40px_rgba(15,23,42,0.18)]`}>
              <p className={`${sharedTokens.labelCaps} ${mutedText}`}>Focus history</p>
              <div className="mt-4 space-y-3">
                {historyEntries.map((entry) => (
                  <article
                    key={`${entry.time}-${entry.label}`}
                    className={`flex items-center justify-between rounded-2xl border border-white/5 px-4 py-3 text-sm ${
                      theme === 'light' ? 'bg-slate-100/60 text-slate-900' : 'bg-slate-950/60 text-white'
                    } ${sharedTokens.motion}`}
                  >
                    <div>
                      <p className="font-medium">{entry.label}</p>
                      <p className={`text-xs ${mutedText}`}>{entry.time}</p>
                    </div>
                    <span className={`text-xs uppercase tracking-[0.3em] ${mutedText}`}>Done</span>
                  </article>
                ))}
              </div>
            </div>

            <div className={`${cardBase} shadow-[0_15px_40px_rgba(0,0,0,0.65)]`}>
              <p className={`${sharedTokens.labelCaps} ${mutedText}`}>Checklist</p>
              <div className="mt-4 space-y-3">
                {sections.map((item) => (
                  <article
                    key={item.label}
                    className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${getSurfaceStyles(theme, 'checklist')} ${sharedTokens.motion}`}
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-2xl border ${getSurfaceStyles(
                        theme,
                        'badge',
                      )} ${sharedTokens.motion}`}
                    >
                      {item.label[0]}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className={`text-xs ${mutedText}`}>{item.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
