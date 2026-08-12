import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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

const sessionModeLabel: Record<SessionMode, string> = {
  focus: 'Focus',
  shortBreak: 'Short break',
  longBreak: 'Long break',
}

const historySessionLabel: Record<SessionMode, string> = {
  focus: 'Focus session',
  shortBreak: 'Short break',
  longBreak: 'Long break',
}

const sessionRingGradient: Record<SessionMode, string> = {
  focus: 'from-[#4c6fff] via-[#6f7bff] to-[#8a5eff]',
  shortBreak: 'from-[#2ac6d1] via-[#60c0ff] to-[#b27bff]',
  longBreak: 'from-[#ffd47d] via-[#ffaf7c] to-[#ff7c7c]',
}

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

const formatDuration = (minutes: number) => `${String(minutes).padStart(2, '0')}:00`

const formatCountdown = (seconds: number) => {
  const clamped = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(clamped / 60)
  const remainder = clamped % 60
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

const TimerCenterpiece = ({
  mode,
  timerState,
  remainingSeconds,
  durationSeconds,
  countdownDisplay,
  sessionsUntilLongBreak,
  theme,
  sessionLabel,
  stateLabel,
}: {
  mode: SessionMode
  timerState: TimerPhase
  remainingSeconds: number
  durationSeconds: number
  countdownDisplay: string
  sessionsUntilLongBreak: number
  theme: 'light' | 'dark'
  sessionLabel: string
  stateLabel: string
}) => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    isBrowser ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  )

  useEffect(() => {
    if (!isBrowser) {
      return undefined
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches)

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange)
    } else {
      mediaQuery.addListener(handleChange)
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange)
      } else {
        mediaQuery.removeListener(handleChange)
      }
    }
  }, [])

  const elapsedPercentage = durationSeconds > 0 ? 1 - remainingSeconds / durationSeconds : 0
  const elapsedAngle = Math.min(360, Math.max(0, elapsedPercentage * 360))
  const ringGradient = sessionRingGradient[mode]

  const radialProgressStyle = durationSeconds > 0
    ? {
        backgroundImage: `conic-gradient(rgba(255,255,255,0.85) ${elapsedAngle}deg, rgba(15,23,42,0.2) ${elapsedAngle}deg)`,
      }
    : undefined

  const clockFaceClasses = theme === 'light' ? 'bg-white/80 text-slate-900' : 'bg-slate-950/80 text-white'

  return (
    <section
      className={`rounded-3xl border ${theme === 'light' ? 'border-slate-200/80' : 'border-white/10'} bg-gradient-to-br p-6 pt-8 ${sharedTokens.motion} ${prefersReducedMotion ? 'transition-none' : 'motion-safe:duration-500'}`}
      role="region"
      aria-label="Pomodoro timer centerpiece"
    >
      <div className="mx-auto h-[280px] w-[280px]">
        <div
          className={`h-full w-full rounded-full border border-white/10 bg-gradient-to-br ${ringGradient} shadow-[0_30px_80px_rgba(2,4,10,0.6)]`}
        >
          <div
            className="m-4 flex h-[calc(100%-32px)] w-[calc(100%-32px)] items-center justify-center rounded-full border border-white/10"
            style={radialProgressStyle}
            aria-hidden="true"
          >
            <div className={`flex h-full w-full flex-col items-center justify-center rounded-full border border-white/10 px-4 ${clockFaceClasses}`}>
              <p className="text-xs uppercase tracking-[0.4em] text-white/70">{sessionLabel}</p>
              <p className="text-[0.65rem] uppercase tracking-[0.35em] text-white/60">{stateLabel}</p>
              <p className="mt-3 text-6xl font-black tracking-tight sm:text-[4rem]">{countdownDisplay}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-1 text-left">
        <p className={`text-xs uppercase tracking-[0.35em] ${theme === 'light' ? 'text-slate-500' : 'text-slate-300'}`}>Session</p>
        <p className={`text-sm ${theme === 'light' ? 'text-slate-600' : 'text-slate-200'}`}>
          Next break in {sessionsUntilLongBreak} session{sessionsUntilLongBreak > 1 ? 's' : ''}
        </p>
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {sessionLabel} session {stateLabel}. {countdownDisplay} remaining.
      </div>
    </section>
  )
}

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

  const handleSessionComplete = useCallback(
    (completedMode: SessionMode) => {
      const now = new Date()
      const formattedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

      setHistoryEntries((prev) => [
        {
          label: `${historySessionLabel[completedMode]} • ${formatDuration(timerSettings[completedMode])}`,
          time: `Today • ${formattedTime}`,
          type: completedMode,
        },
        ...prev,
      ])
    },
    [timerSettings, setHistoryEntries],
  )

  const {
    mode,
    timerState,
    remainingSeconds,
    durationSeconds,
    selectMode,
    start,
    pause,
    resume,
    reset,
    skip,
  } = usePomodoroTimer(timerSettings, handleSessionComplete)

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
    if (timerState !== 'completed') {
      return
    }
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

  const countdownDisplay = formatCountdown(remainingSeconds)
  const sessionStateLabel: Record<TimerPhase, string> = {
    idle: 'Ready to start',
    running: 'In progress',
    paused: 'Paused',
    completed: 'Completed',
  }
  const currentStateLabel = sessionStateLabel[timerState]

  const sessionTabs: {
    mode: SessionMode
    label: string
    duration: number
  }[] = [
    { mode: 'focus', label: 'Focus session', duration: timerSettings.focus },
    { mode: 'shortBreak', label: 'Short break', duration: timerSettings.shortBreak },
    { mode: 'longBreak', label: 'Long break', duration: timerSettings.longBreak },
  ]

  let primaryActionLabel = 'Start'
  let primaryActionHandler = start
  let primaryActionAriaLabel = `${sessionModeLabel[mode]} session is ready to begin`

  if (timerState === 'running') {
    primaryActionLabel = 'Pause'
    primaryActionHandler = pause
    primaryActionAriaLabel = 'Pause the current timer'
  } else if (timerState === 'paused') {
    primaryActionLabel = 'Resume'
    primaryActionHandler = resume
    primaryActionAriaLabel = 'Resume the paused timer'
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
            <p className="text-xs tracking-[0.3em] uppercase text-slate-500">Theme</p>
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
                  className={`${controlButtonBase} ${getSurfaceStyles(theme, 'button')} ${sharedTokens.motion} ${timerState !== 'completed' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  type="button"
                  onClick={logFocusSession}
                  disabled={timerState !== 'completed'}
                  aria-disabled={timerState !== 'completed'}
                  aria-label={timerState === 'completed' ? 'Sync completed focus session' : 'No completed session to sync'}
                >
                  Sync
                </button>
              </div>
            </div>

            {/* ... rest of component unchanged ... */}
          </section>

          {/* ... rest of component unchanged ... */}
        </main>
      </div>
    </div>
  )
}

const usePomodoroTimer = (
  timerSettings: TimerSettings,
  onSessionComplete?: (completedMode: SessionMode) => void,
) => {
  const [mode, setMode] = useState<SessionMode>('focus')
  const [timerState, setTimerState] = useState<TimerPhase>('idle')
  const [endAt, setEndAt] = useState<number | null>(null)
  const [pausedSeconds, setPausedSeconds] = useState<number | null>(null)
  const [tick, setTick] = useState(() => Date.now())
  const intervalRef = useRef<number | null>(null)
  const focusCycleRef = useRef(0)
  const completionHandledRef = useRef(false)

  const sessionDurations = useMemo(
    () => ({
      focus: Math.max(60, Math.round(timerSettings.focus * 60)),
      shortBreak: Math.max(60, Math.round(timerSettings.shortBreak * 60)),
      longBreak: Math.max(60, Math.round(timerSettings.longBreak * 60)),
    }),
    [timerSettings.focus, timerSettings.shortBreak, timerSettings.longBreak],
  )

  const durationSeconds = sessionDurations[mode]
  const isRunning = timerState === 'running'

  useEffect(() => {
    if (!isBrowser) {
      return
    }

    if (!isRunning) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    intervalRef.current = window.setInterval(() => {
      setTick(Date.now())
    }, 250)

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [isRunning])

  useEffect(() => {
    if (!isRunning || endAt === null) {
      return
    }

    if (Date.now() >= endAt) {
      setTimerState('completed')
      setEndAt(null)
      setPausedSeconds(null)
    }
  }, [endAt, isRunning, tick])

  useEffect(() => {
    const maxActiveFocuses = Math.max(0, timerSettings.sessionsBeforeLongBreak - 1)
    if (focusCycleRef.current > maxActiveFocuses) {
      focusCycleRef.current = maxActiveFocuses
    }
  }, [timerSettings.sessionsBeforeLongBreak])

  const remainingSeconds = useMemo(() => {
    if (timerState === 'running' && endAt !== null) {
      return Math.max(0, Math.round((endAt - tick) / 1000))
    }

    if (timerState === 'paused' && pausedSeconds !== null) {
      return pausedSeconds
    }

    if (timerState === 'completed') {
      return 0
    }

    return durationSeconds
  }, [timerState, endAt, tick, pausedSeconds, durationSeconds])

  const pickNextMode = () => {
    if (mode !== 'focus') {
      return 'focus'
    }

    const nextFocusCount = focusCycleRef.current + 1
    if (nextFocusCount >= timerSettings.sessionsBeforeLongBreak) {
      focusCycleRef.current = 0
      return 'longBreak'
    }

    focusCycleRef.current = nextFocusCount
    return 'shortBreak'
  }

  const selectMode = (selectedMode: SessionMode) => {
    setMode(selectedMode)
    setTimerState('idle')
    setEndAt(null)
    setPausedSeconds(null)
  }

  const start = () => {
    if (timerState === 'running') {
      return
    }

    const now = Date.now()
    setEndAt(now + durationSeconds * 1000)
    setPausedSeconds(null)
    setTimerState('running')
    setTick(now)
  }

  const pause = () => {
    if (timerState !== 'running' || endAt === null) {
      return
    }

    const nextRemaining = Math.max(0, Math.round((endAt - Date.now()) / 1000))
    setPausedSeconds(nextRemaining)
    setEndAt(null)
    setTimerState('paused')
  }

  const resume = () => {
    if (timerState !== 'paused' || pausedSeconds === null) {
      return
    }

    const now = Date.now()
    setEndAt(now + pausedSeconds * 1000)
    setPausedSeconds(null)
    setTimerState('running')
    setTick(now)
  }

  const reset = () => {
    setTimerState('idle')
    setEndAt(null)
    setPausedSeconds(null)
  }

  const skip = () => {
    const nextMode = pickNextMode()
    selectMode(nextMode)
  }

  useEffect(() => {
    if (timerState !== 'completed') {
      completionHandledRef.current = false
      return
    }

    if (completionHandledRef.current) {
      return
    }

    completionHandledRef.current = true
    const completedMode = mode
    onSessionComplete?.(completedMode)

    const nextMode = pickNextMode()
    const shouldAutoStart = nextMode === 'focus' ? timerSettings.autoStartFocus : timerSettings.autoStartBreaks

    if (shouldAutoStart) {
      const now = Date.now()
      setMode(nextMode)
      setEndAt(now + sessionDurations[nextMode] * 1000)
      setPausedSeconds(null)
      setTimerState('running')
      setTick(now)
      return
    }

    setMode(nextMode)
    setTimerState('idle')
    setEndAt(null)
    setPausedSeconds(null)
  }, [timerState, mode, timerSettings, onSessionComplete, pickNextMode, sessionDurations])

  return {
    mode,
    timerState,
    remainingSeconds,
    durationSeconds,
    selectMode,
    start,
    pause,
    resume,
    reset,
    skip,
  }
}
