import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const THEME_KEY = 'pomodoro_theme'
const TIMER_SETTINGS_KEY = 'pomodoro_timer_settings'
const CURRENT_TASK_KEY = 'pomodoro_current_task'
const HISTORY_KEY = 'pomodoro_history'
const TIMER_STATE_KEY = 'pomodoro_timer_state'
const CYCLE_STATE_KEY = 'pomodoro_cycle_state'

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
type TimerPhase = 'idle' | 'running' | 'paused' | 'completed' | 'nextSession'

type PersistedTimerState = {
  mode: SessionMode
  timerState: TimerPhase
  endAt: number | null
  pausedRemainingMs: number | null
}

type CycleState = {
  focusStreak: number
  completedFocusSessions: number
}

type PresetKey = 'classic' | 'deepWork' | 'custom'

type DurationPreset = Pick<TimerSettings, DurationFieldKey>

const PRESET_DURATION_SETTINGS: Record<Exclude<PresetKey, 'custom'>, DurationPreset> = {
  classic: {
    focus: 25,
    shortBreak: 5,
    longBreak: 15,
    sessionsBeforeLongBreak: 4,
  },
  deepWork: {
    focus: 90,
    shortBreak: 15,
    longBreak: 30,
    sessionsBeforeLongBreak: 2,
  },
}

const PRESET_CONFIG: Record<PresetKey, { label: string; description: string }> = {
  classic: {
    label: 'Classic',
    description: '25 / 5 / 15 • 4-cycle rhythm',
  },
  deepWork: {
    label: 'Deep Work',
    description: '90 / 15 / 30 • 2-cycle focus',
  },
  custom: {
    label: 'Custom',
    description: 'Fine tune durations in Settings',
  },
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

const DEFAULT_CYCLE_STATE: CycleState = {
  focusStreak: 0,
  completedFocusSessions: 0,
}

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
  value === 'idle' ||
  value === 'running' ||
  value === 'paused' ||
  value === 'completed' ||
  value === 'nextSession'

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

const isCycleState = (value: unknown): value is CycleState =>
  isObject(value) &&
  typeof (value as any).focusStreak === 'number' &&
  typeof (value as any).completedFocusSessions === 'number'

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

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.ceil(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

const getSessionDurationMs = (mode: SessionMode, settings: TimerSettings) => {
  switch (mode) {
    case 'focus':
      return settings.focus * 60 * 1000
    case 'shortBreak':
      return settings.shortBreak * 60 * 1000
    case 'longBreak':
      return settings.longBreak * 60 * 1000
  }
}

const durationsMatch = (candidate: DurationPreset, settings: TimerSettings) =>
  candidate.focus === settings.focus &&
  candidate.shortBreak === settings.shortBreak &&
  candidate.longBreak === settings.longBreak &&
  candidate.sessionsBeforeLongBreak === settings.sessionsBeforeLongBreak

const getActivePreset = (settings: TimerSettings): PresetKey =>
  durationsMatch(PRESET_DURATION_SETTINGS.classic, settings)
    ? 'classic'
    : durationsMatch(PRESET_DURATION_SETTINGS.deepWork, settings)
      ? 'deepWork'
      : 'custom'

const stateCopy: Record<TimerPhase, { headline: string; description: string }> = {
  idle: {
    headline: 'Ready to focus',
    description: 'Set your intention and kick off the session when you are ready.',
  },
  running: {
    headline: 'Focus in progress',
    description: 'Stay calm. Breathe. The countdown is steady and drift-free.',
  },
  paused: {
    headline: 'Session paused',
    description: 'You can resume without losing your progress.',
  },
  completed: {
    headline: 'Session complete',
    description: 'Reflect briefly before you move into the next session.',
  },
  nextSession: {
    headline: 'Next session queued',
    description: 'You are set for the upcoming rhythm — start when you are ready.',
  },
}

const determineNextMode = (
  current: SessionMode,
  focusStreak: number,
  sessionsBeforeLongBreak: number,
): SessionMode => {
  if (current === 'focus') {
    const nextStreak = focusStreak + 1
    return nextStreak >= sessionsBeforeLongBreak ? 'longBreak' : 'shortBreak'
  }
  return 'focus'
}

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
  const [currentTask] = usePersistedState<string>(
    CURRENT_TASK_KEY,
    () => '',
    (value): value is string => typeof value === 'string',
  )
  const [historyEntries] = usePersistedState<HistoryEntry[]>(
    HISTORY_KEY,
    () => DEFAULT_HISTORY_ENTRIES,
    isHistoryEntryArray,
  )
  const [cycleState, setCycleState] = usePersistedState<CycleState>(
    CYCLE_STATE_KEY,
    () => ({ ...DEFAULT_CYCLE_STATE }),
    isCycleState,
  )

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const [selectedPreset, setSelectedPreset] = useState<PresetKey>(() => getActivePreset(timerSettings))
  const customConfigCTARef = useRef<HTMLButtonElement>(null)

  // Keep selectedPreset in sync when timerSettings change externally
  useEffect(() => {
    setSelectedPreset(getActivePreset(timerSettings))
  }, [timerSettings])

  useEffect(() => {
    if (selectedPreset === 'custom') {
      customConfigCTARef.current?.focus()
    }
  }, [selectedPreset])

  const handleSelectPreset = (preset: PresetKey) => {
    if (preset === 'custom') {
      setSelectedPreset('custom')
      return
    }
    setTimerSettings((prev) => ({ ...prev, ...PRESET_DURATION_SETTINGS[preset] }))
    setSelectedPreset(preset)
  }

  const safeCycleLength = Math.max(1, timerSettings.sessionsBeforeLongBreak)
  const currentCycleIndex = Math.min(cycleState.focusStreak + 1, safeCycleLength)
  const completedPomodoros = cycleState.completedFocusSessions

  const cycleSegments = useMemo(() => {
    const completedInCycle = Math.min(cycleState.focusStreak, safeCycleLength)
    return Array.from({ length: safeCycleLength }, (_, idx) => {
      if (idx < completedInCycle) {
        return { index: idx, status: 'completed' as const }
      }
      if (idx === completedInCycle) {
        return { index: idx, status: 'current' as const }
      }
      return { index: idx, status: 'pending' as const }
    })
  }, [safeCycleLength, cycleState.focusStreak])

  const longBreakMilestoneIndex = safeCycleLength - 1

  const [sessionMode, setSessionMode] = useState<SessionMode>('focus')
  const [timerPhase, setTimerPhase] = useState<TimerPhase>('idle')
  const [remainingMs, setRemainingMs] = useState(() => getSessionDurationMs('focus', timerSettings))
  const [pausedMs, setPausedMs] = useState<number | null>(null)
  const [pendingNextMode, setPendingNextMode] = useState<SessionMode>(() =>
    determineNextMode('focus', cycleState.focusStreak, timerSettings.sessionsBeforeLongBreak),
  )

  const timerIntervalRef = useRef<number | null>(null)
  const targetEndRef = useRef<number | null>(null)

  const sessionDurationMs = useMemo(() => getSessionDurationMs(sessionMode, timerSettings), [sessionMode, timerSettings])

  const handleCompletion = useCallback(() => {
    const nextMode = determineNextMode(
      sessionMode,
      cycleState.focusStreak,
      timerSettings.sessionsBeforeLongBreak,
    )

    if (sessionMode === 'focus') {
      setCycleState((prev) => {
        const nextStreak = prev.focusStreak + 1
        const reachedThreshold = nextStreak >= timerSettings.sessionsBeforeLongBreak
        return {
          focusStreak: reachedThreshold ? 0 : nextStreak,
          completedFocusSessions: prev.completedFocusSessions + 1,
        }
      })
    }

    setPendingNextMode(nextMode)
    setTimerPhase('completed')
    setRemainingMs(0)
    targetEndRef.current = null
  }, [cycleState.focusStreak, sessionMode, timerSettings.sessionsBeforeLongBreak, setCycleState])

  useEffect(() => {
    if (timerPhase === 'idle' || timerPhase === 'nextSession') {
      setRemainingMs(sessionDurationMs)
      setPausedMs(null)
    }
  }, [sessionDurationMs, timerPhase])

  useEffect(() => {
    if (timerPhase !== 'running') {
      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
      return
    }

    timerIntervalRef.current = window.setInterval(() => {
      const now = Date.now()
      const target = targetEndRef.current ?? now
      const difference = Math.max(0, target - now)
      setRemainingMs(difference)
      if (difference <= 0) {
        window.clearInterval(timerIntervalRef.current!)    
        timerIntervalRef.current = null
        handleCompletion()
      }
    }, 250)

    return () => {
      if (timerIntervalRef.current !== null) {
        window.clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
  }, [timerPhase, handleCompletion])

  useEffect(() => {
    if (timerPhase === 'completed') {
      return
    }
    const upcoming = determineNextMode(
      sessionMode,
      cycleState.focusStreak,
      timerSettings.sessionsBeforeLongBreak,
    )
    setPendingNextMode((current) => (current === upcoming ? current : upcoming))
  }, [timerPhase, sessionMode, cycleState.focusStreak, timerSettings.sessionsBeforeLongBreak])

  const startTimer = useCallback(() => {
    if (timerPhase === 'running') {
      return
    }
    const duration = timerPhase === 'paused' && pausedMs !== null ? pausedMs : remainingMs
    const endAt = Date.now() + Math.max(0, duration)
    targetEndRef.current = endAt
    setTimerPhase('running')
    setPausedMs(null)
    setRemainingMs(Math.max(0, duration))
  }, [pausedMs, remainingMs, timerPhase])

  const pauseTimer = () => {
    if (timerPhase !== 'running') {
      return
    }
    const now = Date.now()
    const remaining = Math.max(0, (targetEndRef.current ?? now) - now)
    targetEndRef.current = null
    window.clearInterval(timerIntervalRef.current!)  
    timerIntervalRef.current = null
    setPausedMs(remaining)
    setRemainingMs(remaining)
    setTimerPhase('paused')
  }

  const resetTimer = () => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }
    targetEndRef.current = null
    setPausedMs(null)
    setRemainingMs(sessionDurationMs)
    setTimerPhase('idle')
  }

  const prepareNextSession = () => {
    setSessionMode(pendingNextMode)
    setRemainingMs(getSessionDurationMs(pendingNextMode, timerSettings))
    setTimerPhase('nextSession')
  }

  const status = stateCopy[timerPhase]
  const primaryButton = useMemo(() => {
    switch (timerPhase) {
      case 'running':
        return { label: 'Pause session', action: pauseTimer }
      case 'paused':
        return { label: 'Resume session', action: startTimer }
      case 'completed':
        return { label: 'Next session', action: prepareNextSession }
      default:
        return { label: 'Start session', action: startTimer }
    }
  }, [timerPhase, pauseTimer, startTimer, prepareNextSession])

  const activeState = timerPhase === 'running' || timerPhase === 'paused'
  const progress = sessionDurationMs === 0 ? 0 : 1 - remainingMs / sessionDurationMs
  const progressDegrees = Math.min(360, Math.max(0, progress * 360))

  const statusBadgeStyles = {
    idle: 'bg-sky-500/10 text-sky-400',
    running: 'bg-emerald-500/10 text-emerald-300',
    paused: 'bg-amber-500/10 text-amber-300',
    completed: 'bg-purple-500/10 text-purple-300',
    nextSession: 'bg-slate-500/10 text-slate-200',
  }

  const circleBackground = `conic-gradient(rgba(16,185,129,0.65) ${progressDegrees}deg, rgba(15,23,42,0.2) ${progressDegrees}deg)`

  const rootClasses = `${getSurfaceStyles(theme, 'shell')} min-h-screen ${sharedTokens.motion}`
  const mutedText = theme === 'light' ? 'text-slate-500' : 'text-slate-400'

  const timerLabel = useMemo(() => {
    switch (sessionMode) {
      case 'focus':
        return 'Focus session'
      case 'shortBreak':
        return 'Short break'
      case 'longBreak':
        return 'Long break'
      default:
        return 'Session'
    }
  }, [sessionMode])

  const presetButtonClasses = (key: PresetKey) => {
    const baseStyles = 'flex-1 min-w-[120px] rounded-2xl border px-4 py-3 text-left transition-colors duration-200'
    const focused = `${sharedTokens.motion} ${sharedTokens.focusRing}`
    const isActive = selectedPreset === key
    const palette =
      key === 'custom'
        ? 'border-dashed border-amber-300/70 bg-amber-500/10 text-amber-100'
        : isActive
          ? 'border-emerald-400/60 bg-emerald-500/10 text-emerald-50'
          : 'border-slate-700/80 bg-slate-900/60 text-slate-200 hover:border-slate-500'
    return `${baseStyles} ${focused} ${palette}`
  }

  const presetDurationRows: { label: string; value: string }[] = [
    { label: 'Focus', value: `${timerSettings.focus} min` },
    { label: 'Short break', value: `${timerSettings.shortBreak} min` },
    { label: 'Long break', value: `${timerSettings.longBreak} min` },
    { label: 'Cycles before long break', value: `${timerSettings.sessionsBeforeLongBreak}` },
  ]

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
              onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
              aria-pressed={theme === 'dark'}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              className={`${sharedTokens.motion} ${sharedTokens.focusRing} group relative inline-flex items-center gap-2 rounded-full border border-white/10 bg-gradient-to-r from-slate-800 via-slate-900 to-slate-900 px-4 py-2 shadow-lg shadow-slate-950/30 text-sm font-semibold uppercase tracking-[0.35em]`}
            >
              <span className="text-white">{theme === 'light' ? 'Premium light' : 'Premium dark'}</span>
              <span className={`${sharedTokens.motion} inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-slate-50 text-slate-900 transition-transform duration-200 group-aria-pressed:translate-x-0`}>
                {theme === 'light' ? '☀' : '☾'}
              </span>
            </button>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <section
            className={`${getSurfaceStyles(theme, 'card')} ${sharedTokens.cardCorners} ${sharedTokens.cardPadding} space-y-6 border border-white/10`}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Cycle</p>
                <p className="text-2xl font-semibold tracking-tight">Cycle {currentCycleIndex} of {safeCycleLength}</p>
              </div>
              <div className="rounded-full border border-slate-500/30 bg-slate-900/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.35em] text-slate-200">
                Completed Pomodoros {completedPomodoros}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-4 text-sm text-slate-400">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-300">
                  {timerSettings.sessionsBeforeLongBreak === 0 ? 0 : longBreakMilestoneIndex + 1}
                </span>
                <p className="text-sm text-slate-400">
                  {`You are ${cycleState.focusStreak === longBreakMilestoneIndex ? 'on the final focus before' : 'building toward'} the long-break milestone to stay refreshed.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {cycleSegments.map((segment) => {
                  const base = 'flex-1 min-w-[64px] rounded-2xl border px-3 py-2 text-center transition duration-200'
                  const isMilestone = segment.index === longBreakMilestoneIndex
                  const statusClass =
                    segment.status === 'completed'
                      ? 'bg-emerald-500/90 text-slate-950 border-transparent'
                      : segment.status === 'current'
                        ? 'bg-slate-200 text-slate-900 border-slate-300 shadow-lg'
                        : 'bg-slate-900/60 text-slate-200 border-slate-800'
                  const milestoneRing = isMilestone ? 'ring-2 ring-amber-400/70' : ''
                  return (
                    <div
                      key={`cycle-${segment.index}`}
                      className={`${base} ${statusClass} ${milestoneRing} flex flex-col gap-1 justify-center`}
                      aria-label={`Cycle step ${segment.index + 1} ${isMilestone ? '(long break milestone)' : ''}`}
                    >
                      <span className="text-xs uppercase tracking-[0.35em] text-slate-400">
                        Step {segment.index + 1}
                      </span>
                      <span className="text-lg font-semibold">
                        {segment.index + 1}
                      </span>
                      {isMilestone && (
                        <span className="text-[0.6rem] uppercase tracking-[0.4em] text-amber-300">
                          Long break
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          {/* Timer and controls section */}
          <section
            className={`${getSurfaceStyles(theme, 'card')} ${sharedTokens.cardCorners} ${sharedTokens.cardPadding} space-y-6 border border-white/10`}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{status.headline}</h2>
              <span className={`px-2 py-1 text-xs uppercase rounded ${statusBadgeStyles[timerPhase]}`}>{timerPhase}</span>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.35em] text-slate-400">Session preset</p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {(['classic', 'deepWork', 'custom'] as PresetKey[]).map((preset) => {
                    const config = PRESET_CONFIG[preset]
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSelectPreset(preset)}
                        className={presetButtonClasses(preset)}
                        aria-pressed={selectedPreset === preset}
                      >
                        <span className="text-sm font-semibold uppercase tracking-[0.3em]">
                          {config.label}
                        </span>
                        <p className="text-[0.65rem] text-slate-300">{config.description}</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                {presetDurationRows.map((row) => (
                  <div
                    key={row.label}
                    className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3"
                  >
                    <p className="text-xs uppercase tracking-[0.35em] text-slate-400">{row.label}</p>
                    <p className="text-lg font-semibold">{row.value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-sm">
                <p className="text-slate-400">Refine your rhythm anytime with the full settings panel.</p>
                <button
                  ref={customConfigCTARef}
                  type="button"
                  onClick={() => setSelectedPreset('custom')}
                  className={`${sharedTokens.motion} ${sharedTokens.focusRing} rounded-full border border-slate-500/60 bg-slate-900/80 px-5 py-2 text-xs uppercase tracking-[0.3em] text-white shadow-lg shadow-slate-950/40 transition hover:border-sky-500/80`}
                >
                  Open settings
                </button>
              </div>
            </div>

            <div className="flex justify-center">
              <div
                className="relative flex items-center justify-center rounded-full"
                style={{ width: '200px', height: '200px', background: circleBackground }}
              >
                <span className="text-5xl font-mono tabular-nums">{formatTime(remainingMs)}</span>
              </div>
            </div>
            <p className="text-center text-sm text-slate-400">{status.description}</p>
            <div className="flex justify-center gap-4">
              <button
                type="button"
                onClick={primaryButton.action}
                className="rounded-full bg-sky-500 px-5 py-2 text-white hover:bg-sky-600 focus:outline-none"
              >
                {primaryButton.label}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                disabled={!activeState}
                className="rounded-full bg-slate-200 px-5 py-2 text-slate-800 hover:bg-slate-300 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}
