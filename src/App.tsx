import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

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
const TIMER_STATE_KEY = 'pomodoro_timer_state'

type TimerSettings = {
  focus: number
  shortBreak: number
  longBreak: number
  sessionsBeforeLongBreak: number
  autoStartFocus: boolean
  autoStartBreaks: boolean
  soundEnabled: boolean
}

type StorageValidator<T> = (value: unknown) => value is T

type DurationFieldKey = 'focus' | 'shortBreak' | 'longBreak' | 'sessionsBeforeLongBreak'
type ToggleFieldKey = 'autoStartFocus' | 'autoStartBreaks' | 'soundEnabled'

type HistoryEntry = {
  label: string
  time: string
  type: 'focus' | 'shortBreak' | 'longBreak'
}

type SessionMode = 'focus' | 'shortBreak' | 'longBreak'
type TimerPhase = 'idle' | 'running' | 'paused' | 'completed'

type PersistedTimerState = {
  mode: SessionMode
  timerState: TimerPhase
  endAt: number | null
  pausedRemainingMs: number | null
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

const isBrowser = typeof window !== 'undefined'

const sharedTokens = {
  motion: 'motion-safe:transition motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none',
  focusRing: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400',
  cardPadding: 'p-6 md:p-8',
  cardCorners: 'rounded-3xl',
}

const lightSurfaces = {
  shell: 'bg-slate-50 text-slate-900',
  card: 'bg-white/80 border-slate-200/70 shadow-[0_25px_60px_rgba(15,23,42,0.3)]',
}

const darkSurfaces = {
  shell: 'bg-slate-950 text-slate-100',
  card: 'bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border border-white/5 shadow-[0_20px_45px_rgba(8,15,32,0.5)]',
}

const getSurfaceStyles = (theme: 'light' | 'dark', key: keyof typeof lightSurfaces) =>
  theme === 'light' ? lightSurfaces[key] : darkSurfaces[key]

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
  } catch {
    return fallback()
  }
}

const writeLocalValue = (key: string, value: unknown) => {
  if (!isBrowser) {
    return
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore write errors
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
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const isHistoryEntryArray = (value: unknown): value is HistoryEntry[] =>
  Array.isArray(value) && value.every(
    (item) =>
      isObject(item) &&
      typeof (item as any).label === 'string' &&
      typeof (item as any).time === 'string' &&
      ['focus', 'shortBreak', 'longBreak'].includes((item as any).type),
  )

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
  } = value as any
  return (
    typeof focus === 'number' &&
    typeof shortBreak === 'number' &&
    typeof longBreak === 'number' &&
    typeof sessionsBeforeLongBreak === 'number' &&
    typeof autoStartFocus === 'boolean' &&
    typeof autoStartBreaks === 'boolean' &&
    typeof soundEnabled === 'boolean'
  )
}

const isTimerPhase = (value: unknown): value is TimerPhase =>
  value === 'idle' || value === 'running' || value === 'paused' || value === 'completed'

const isPersistedTimerState = (value: unknown): value is PersistedTimerState => {
  if (!isObject(value)) {
    return false
  }
  const { mode, timerState, endAt, pausedRemainingMs } = value as any
  const validMode = ['focus', 'shortBreak', 'longBreak'].includes(mode)
  const validTimerState = isTimerPhase(timerState)
  const validEndAt = endAt === null || (typeof endAt === 'number' && Number.isFinite(endAt))
  const validPaused = pausedRemainingMs === null || (typeof pausedRemainingMs === 'number' && pausedRemainingMs >= 0)
  return validMode && validTimerState && validEndAt && validPaused
}

const getFallbackTimerState = (): PersistedTimerState => ({
  mode: 'focus',
  timerState: 'idle',
  endAt: null,
  pausedRemainingMs: null,
})

const sanitizePersistedTimerState = (state: PersistedTimerState): PersistedTimerState => {
  if (state.timerState === 'running' && state.endAt === null) {
    return { ...state, timerState: 'idle' }
  }
  if (state.timerState === 'paused' && state.pausedRemainingMs === null) {
    return { ...state, timerState: 'idle', pausedRemainingMs: null }
  }
  return state
}

const readPersistedTimerState = (): PersistedTimerState =>
  sanitizePersistedTimerState(
    readLocalValue(TIMER_STATE_KEY, getFallbackTimerState, isPersistedTimerState),
  )

export default function App() {
  const [theme, setTheme] = usePersistedState<'light' | 'dark'>(
    THEME_KEY,
    resolvePreferredTheme,
    isTheme,
  )
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

  const rootClasses = `${getSurfaceStyles(theme, 'shell')} min-h-screen ${sharedTokens.motion}`
  const mutedText = theme === 'light' ? 'text-slate-500' : 'text-slate-400'

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))
  const themeLabel = theme === 'light' ? 'Premium light' : 'Premium dark'

  return (
    <div className={rootClasses}>
      <div className="max-w-6xl mx-auto px-4 py-6 md:py-10 space-y-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className={`${mutedText} uppercase tracking-[0.4em] text-xs`}>Premium Pomodoro</p>
            <h1 className="text-3xl md:text-4xl font-semibold">Focus workspace</h1>
            <p className={`text-sm md:text-base ${mutedText}`}>Clear sessions, track cycles, stay intentional.</p>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Theme</p>
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className={`${sharedTokens.motion} ${sharedTokens.focusRing} group relative inline-flex items-center gap-2 rounded-full border border-white/10 bg-gradient-to-r from-slate-800 via-slate-900 to-slate-900 px-4 py-2 shadow-lg shadow-slate-950/30 text-sm font-semibold uppercase tracking-[0.35em]`}
            >
              <span className="text-white">{themeLabel}</span>
              <span
                className={`${sharedTokens.motion} inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-slate-50 text-slate-900 transition-transform duration-200 group-aria-pressed:translate-x-0`}
              >
                {theme === 'light' ? '☀' : '☾'}
              </span>
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {sections.map(({ label, description }) => (
            <section
              key={label}
              className={`${sharedTokens.cardCorners} ${sharedTokens.cardPadding} ${getSurfaceStyles(theme, 'card')} ${sharedTokens.motion}`}
            >
              <h2 className="text-lg font-semibold">{label}</h2>
              <p className={`text-sm ${mutedText}`}>{description}</p>
            </section>
          ))}
        </main>
      </div>
    </div>
  )
}

// Note: Pomodoro timer hook and TimerCenterpiece components omitted for brevity; implement as needed
