import {
  Dispatch,
  FormEvent,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

const THEME_KEY = 'pomodoro_theme'
const TIMER_SETTINGS_KEY = 'pomodoro_timer_settings'
const HISTORY_KEY = 'pomodoro_history'
const TIMER_STATE_KEY = 'pomodoro_timer_state'
const CYCLE_STATE_KEY = 'pomodoro_cycle_state'
const CURRENT_TASK_KEY = 'pomodoro_current_task'

const notificationApiAvailable = () => typeof window !== 'undefined' && 'Notification' in window

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
  durationMs?: number
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

type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

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

const DEFAULT_HISTORY_ENTRIES: HistoryEntry[] = []

const DEFAULT_CYCLE_STATE: CycleState = {
  focusStreak: 0,
  completedFocusSessions: 0,
}

const isBrowser = typeof window !== 'undefined'

const sharedTokens = {
  motion: 'motion-safe:transition motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none',
  focusRing: 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400',
}

const lightSurfaces = {
  shell: 'bg-slate-50 text-slate-900',
}

const darkSurfaces = {
  shell: 'bg-slate-950 text-slate-100',
}

const getSurfaceStyles = (theme: 'light' | 'dark') =>
  theme === 'light' ? lightSurfaces.shell : darkSurfaces.shell

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isTheme = (value: unknown): value is 'light' | 'dark' =>
  value === 'light' || value === 'dark'

const isTimerSettings = (value: unknown): value is TimerSettings =>
  isObject(value) &&
  typeof (value as any).focus === 'number' &&
  typeof (value as any).shortBreak === 'number' &&
  typeof (value as any).longBreak === 'number' &&
  typeof (value as any).sessionsBeforeLongBreak === 'number' &&
  typeof (value as any).autoStartFocus === 'boolean' &&
  typeof (value as any).autoStartBreaks === 'boolean' &&
  typeof (value as any).soundEnabled === 'boolean'

const isHistoryEntry = (value: unknown): value is HistoryEntry =>
  isObject(value) &&
  typeof (value as any).label === 'string' &&
  typeof (value as any).time === 'string' &&
  ['focus', 'shortBreak', 'longBreak'].includes((value as any).type) &&
  ((value as any).durationMs === undefined || typeof (value as any).durationMs === 'number')

const isHistory = (value: unknown): value is HistoryEntry[] =>
  Array.isArray(value) && value.every(isHistoryEntry)

const isCycleState = (value: unknown): value is CycleState =>
  isObject(value) &&
  typeof (value as any).focusStreak === 'number' &&
  typeof (value as any).completedFocusSessions === 'number'

const isTaskTitle = (value: unknown): value is string => typeof value === 'string'

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
  if (!isBrowser) return
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

const resolvePreferredTheme = (): 'light' | 'dark' => {
  if (!isBrowser) return 'dark'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const isPersistedTimerState = (value: unknown): value is PersistedTimerState =>
  isObject(value) &&
  ['focus', 'shortBreak', 'longBreak'].includes((value as any).mode) &&
  ['idle', 'running', 'paused', 'completed', 'nextSession'].includes((value as any).timerState) &&
  ((value as any).endAt === null || (typeof (value as any).endAt === 'number' && Number.isFinite((value as any).endAt))) &&
  ((value as any).pausedRemainingMs === null || typeof (value as any).pausedRemainingMs === 'number')

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

const stateCopy: Record<TimerPhase, { headline: string; description: string }> = {
  idle: { headline: 'Ready to focus', description: '' },
  running: { headline: 'Focus in progress', description: '' },
  paused: { headline: 'Session paused', description: '' },
  completed: { headline: 'Session complete', description: '' },
  nextSession: { headline: 'Next session queued', description: '' },
}

const sessionLabels: Record<SessionMode, string> = {
  focus: 'Focus',
  shortBreak: 'Short Break',
  longBreak: 'Long Break',
}

const normalizeNotificationPermission = (value: NotificationPermission): NotificationPermissionState => {
  if (value === 'granted') return 'granted'
  if (value === 'denied') return 'denied'
  return 'default'
}

const formatDurationLabel = (milliseconds: number) => {
  if (milliseconds <= 0) {
    return '0m'
  }
  const totalMinutes = Math.floor(milliseconds / 1000 / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export default function App() {
  const notificationSupported = useMemo(() => notificationApiAvailable(), [])

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() => {
    if (!notificationSupported) {
      return 'unsupported'
    }
    return normalizeNotificationPermission(Notification.permission)
  })

  const [theme, setTheme] = usePersistedState<'light' | 'dark'>(
    THEME_KEY,
    resolvePreferredTheme,
    isTheme,
  )

  const [timerSettings] = usePersistedState<TimerSettings>(
    TIMER_SETTINGS_KEY,
    () => DEFAULT_TIMER_SETTINGS,
    isTimerSettings,
  )

  const [currentTask, setCurrentTask] = usePersistedState<string>(
    CURRENT_TASK_KEY,
    () => '',
    isTaskTitle,
  )

  const [taskInput, setTaskInput] = useState<string>('')

  useEffect(() => {
    setTaskInput(currentTask)
  }, [currentTask])

  const persistedTimer = useMemo(() => readPersistedTimerState(), [])

  const [sessionMode, setSessionMode] = useState<SessionMode>(() => persistedTimer.mode)
  const [timerPhase, setTimerPhase] = useState<TimerPhase>(() => persistedTimer.timerState)
  const [pausedMs, setPausedMs] = useState<number | null>(() => persistedTimer.pausedRemainingMs)
  const [remainingMs, setRemainingMs] = useState<number>(() => {
    if (persistedTimer.timerState === 'running' && persistedTimer.endAt) {
      return Math.max(0, persistedTimer.endAt - Date.now())
    }
    if (persistedTimer.timerState === 'paused' && persistedTimer.pausedRemainingMs != null) {
      return persistedTimer.pausedRemainingMs
    }
    return getSessionDurationMs(persistedTimer.mode, timerSettings)
  })

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [completedMode, setCompletedMode] = useState<SessionMode | null>(null)

  const [history, setHistory] = usePersistedState<HistoryEntry[]>(
    HISTORY_KEY,
    () => DEFAULT_HISTORY_ENTRIES,
    isHistory,
  )
  const [cycleState, setCycleState] = usePersistedState<CycleState>(
    CYCLE_STATE_KEY,
    () => DEFAULT_CYCLE_STATE,
    isCycleState,
  )

  const nextMode = useMemo(
    () =>
      determineNextMode(
        sessionMode,
        cycleState.focusStreak,
        timerSettings.sessionsBeforeLongBreak,
      ),
    [sessionMode, cycleState.focusStreak, timerSettings.sessionsBeforeLongBreak],
  )

  const targetEndRef = useRef<number | null>(null)
  const intervalRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioErrorRef = useRef<boolean>(false)

  const playCompletionTone = useCallback(() => {
    if (!timerSettings.soundEnabled) {
      return
    }
    if (!isBrowser || audioErrorRef.current) {
      return
    }
    try {
      const AudioContextConstructor =
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).AudioContext ||
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextConstructor) {
        audioErrorRef.current = true
        return
      }
      const context = audioContextRef.current ?? new AudioContextConstructor()
      audioContextRef.current = context
      if (context.state === 'suspended') {
        context.resume().catch(() => {
          audioErrorRef.current = true
        })
      }
      const now = context.currentTime
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = 440
      oscillator.connect(gain)
      gain.connect(context.destination)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
      oscillator.start(now)
      oscillator.stop(now + 0.35)
      oscillator.onended = () => {
        oscillator.disconnect()
        gain.disconnect()
      }
    } catch (error) {
      console.error(error)
      audioErrorRef.current = true
    }
  }, [timerSettings.soundEnabled])

  const showSessionNotification = useCallback(
    (completed: SessionMode, upcoming: SessionMode) => {
      if (!notificationSupported || notificationPermission !== 'granted') {
        return
      }
      try {
        new Notification(`${sessionLabels[completed]} session finished`, {
          body: `Next up: ${sessionLabels[upcoming]}. Tap to continue your flow.`,
          silent: !timerSettings.soundEnabled,
        })
      } catch (error) {
        console.error('Unable to show notification', error)
      }
    },
    [notificationPermission, notificationSupported, timerSettings.soundEnabled],
  )

  useEffect(() => {
    if (persistedTimer.timerState === 'running' && persistedTimer.endAt) {
      targetEndRef.current = persistedTimer.endAt
    }
  }, [persistedTimer])

  useEffect(() => {
    writeLocalValue(TIMER_STATE_KEY, {
      mode: sessionMode,
      timerState: timerPhase,
      endAt: targetEndRef.current,
      pausedRemainingMs: pausedMs,
    })
  }, [sessionMode, timerPhase, pausedMs])

  useEffect(() => {
    if (timerPhase !== 'running') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }
    intervalRef.current = window.setInterval(() => {
      const now = Date.now()
      const target = targetEndRef.current ?? now
      const diff = Math.max(0, target - now)
      setRemainingMs(diff)
      if (diff <= 0) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        playCompletionTone()
        setCompletedMode(sessionMode)
        const upcoming = determineNextMode(
          sessionMode,
          cycleState.focusStreak,
          timerSettings.sessionsBeforeLongBreak,
        )
        setTimerPhase('completed')
        setPausedMs(null)
        setRemainingMs(0)
        targetEndRef.current = null

        const sessionDurationMs = getSessionDurationMs(sessionMode, timerSettings)
        setHistory(prev => [
          ...prev,
          {
            label: sessionLabels[sessionMode],
            time: new Date().toISOString(),
            type: sessionMode,
            durationMs: sessionDurationMs,
          },
        ])

        setCycleState(prev => {
          if (sessionMode === 'focus') {
            const newStreak = prev.focusStreak + 1
            return { focusStreak: newStreak, completedFocusSessions: prev.completedFocusSessions + 1 }
          }
          return { ...prev, focusStreak: 0 }
        })

        showSessionNotification(sessionMode, upcoming)
      }
    }, 250)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [
    timerPhase,
    sessionMode,
    timerSettings,
    playCompletionTone,
    cycleState.focusStreak,
    showSessionNotification,
  ])

  useEffect(() => {
    if (!isBrowser) return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const set = () => setPrefersReducedMotion(mediaQuery.matches)
    set()
    const handler = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches)
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handler)
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handler)
    }
    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handler)
      } else if (typeof mediaQuery.removeListener === 'function') {
        mediaQuery.removeListener(handler)
      }
    }
  }, [])

  const requestNotificationPermission = useCallback(() => {
    if (!notificationSupported) {
      return
    }
    Notification.requestPermission()
      .then(permission => {
        setNotificationPermission(normalizeNotificationPermission(permission))
      })
      .catch(() => {
        setNotificationPermission('denied')
      })
  }, [notificationSupported])

  const startTimer = useCallback(() => {
    if (timerPhase === 'running') return
    const dur = timerPhase === 'paused' && pausedMs != null ? pausedMs : remainingMs
    const endAt = Date.now() + Math.max(0, dur)
    targetEndRef.current = endAt
    setTimerPhase('running')
  }, [pausedMs, remainingMs, timerPhase])

  const pauseTimer = () => {
    if (timerPhase !== 'running') return
    const now = Date.now()
    const rem = Math.max(0, (targetEndRef.current ?? now) - now)
    if (intervalRef.current) clearInterval(intervalRef.current)
    targetEndRef.current = null
    setPausedMs(rem)
    setRemainingMs(rem)
    setTimerPhase('paused')
  }

  const handleContinueToNextSession = useCallback(() => {
    const upcoming = determineNextMode(
      sessionMode,
      cycleState.focusStreak,
      timerSettings.sessionsBeforeLongBreak,
    )
    const sessionDuration = getSessionDurationMs(upcoming, timerSettings)
    const endAt = Date.now() + Math.max(0, sessionDuration)
    targetEndRef.current = endAt
    setSessionMode(upcoming)
    setRemainingMs(sessionDuration)
    setPausedMs(null)
    setCompletedMode(null)
    setTimerPhase('running')
  }, [sessionMode, cycleState.focusStreak, timerSettings])

  const primaryButton = useMemo(() => {
    switch (timerPhase) {
      case 'running':
        return { label: 'Pause', action: pauseTimer }
      default:
        return { label: 'Start', action: startTimer }
    }
  }, [timerPhase, pauseTimer, startTimer])

  const timerLabel = useMemo(() => sessionLabels[sessionMode], [sessionMode])

  const completionPanelVisible = timerPhase === 'completed' && completedMode !== null
  const completionLabel = completedMode ? sessionLabels[completedMode] : ''
  const upcomingLabel = sessionLabels[nextMode]
  const completionPanelMotionClass = prefersReducedMotion
    ? 'transition-none'
    : `${sharedTokens.motion}`

  const notificationStatusLabel = useMemo(() => {
    switch (notificationPermission) {
      case 'granted':
        return 'Notifications enabled'
      case 'denied':
        return 'Notifications blocked — adjust your browser settings to re-enable.'
      case 'unsupported':
        return 'Notifications are unavailable in this browser.'
      default:
        return 'Notifications disabled — click to allow session alerts.'
    }
  }, [notificationPermission])

  const notificationButtonLabel = useMemo(() => {
    if (notificationPermission === 'granted') {
      return 'Notifications enabled'
    }
    if (notificationPermission === 'denied') {
      return 'Retry enabling notifications'
    }
    if (notificationSupported) {
      return 'Enable notifications'
    }
    return 'Notifications unavailable'
  }, [notificationPermission, notificationSupported])

  const focusHistory = history.filter(entry => entry.type === 'focus')
  const breakHistory = history.filter(entry => entry.type !== 'focus')
  const totalFocusMs = focusHistory.reduce((acc, entry) => acc + (entry.durationMs ?? getSessionDurationMs('focus', timerSettings)), 0)
  const longestFocusMs = focusHistory.reduce(
    (max, entry) => Math.max(max, entry.durationMs ?? 0),
    0,
  )
  const currentCycleLabel = `${Math.max(cycleState.focusStreak, 0)}/${timerSettings.sessionsBeforeLongBreak}`
  const focusTimeLabel = formatDurationLabel(totalFocusMs)
  const longestFocusLabel = longestFocusMs > 0 ? formatDurationLabel(longestFocusMs) : '—'
  const focusMinutes = Math.round(totalFocusMs / 1000 / 60)
  const statsRows = [
    {
      label: 'Focus Time',
      value: focusTimeLabel,
      meta: `${focusMinutes} min`,
    },
    {
      label: 'Pomodoros',
      value: `${focusHistory.length}`,
      meta: 'Completed focus sessions',
    },
    {
      label: 'Sessions',
      value: `${history.length}`,
      meta: 'All sessions today',
    },
    {
      label: 'Current Streak',
      value: `${cycleState.focusStreak}`,
      meta: `Consecutive focus sessions`,
    },
  ]
  const extraStats = [
    {
      label: 'Breaks',
      value: `${breakHistory.length}`,
      meta: 'Short + long',
    },
    {
      label: 'Current Cycle',
      value: currentCycleLabel,
      meta: `${cycleState.focusStreak > 0 ? 'In progress' : 'Resting'}`,
    },
    {
      label: 'Longest Focus',
      value: longestFocusLabel,
      meta: 'Longest uninterrupted session',
    },
  ]

  const rootClasses = `${getSurfaceStyles(theme)} min-h-screen flex flex-col ${sharedTokens.motion}`

  const handleTaskSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = taskInput.trim()
      if (!trimmed) {
        setCurrentTask('')
        return
      }
      setCurrentTask(trimmed)
    },
    [setCurrentTask, taskInput],
  )

  const handleClearTask = useCallback(() => {
    setCurrentTask('')
    setTaskInput('')
  }, [setCurrentTask])

  return (
    <div className={rootClasses}>
      <header className="p-4 flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
        <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          <span>{notificationStatusLabel}</span>
          <button
            type="button"
            onClick={requestNotificationPermission}
            disabled={!notificationSupported || notificationPermission === 'granted'}
            className={`px-3 py-1 rounded-full text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-white focus-visible:outline-none ${
              notificationSupported && notificationPermission !== 'granted'
                ? 'bg-sky-600 hover:bg-sky-500'
                : 'bg-slate-500 cursor-not-allowed'
            } ${sharedTokens.motion}`}
          >
            {notificationButtonLabel}
          </button>
        </div>
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="px-3 py-1 bg-blue-500 text-white rounded text-sm font-semibold"
        >
          Switch to {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-6">
        <div className="w-full max-w-3xl flex flex-col gap-6">
          <section className="rounded-3xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70 px-5 py-4 shadow-lg shadow-slate-400/10">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Current task</h3>
                {currentTask ? (
                  <button
                    type="button"
                    onClick={handleClearTask}
                    className={`text-sm font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 ${sharedTokens.focusRing}`}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                Keep your work session anchored
              </p>
            </div>
            <div className="mt-3 flex flex-col gap-3">
              <form onSubmit={handleTaskSubmit} className="flex items-center gap-2">
                <label htmlFor="task-input" className="sr-only">
                  Enter current task
                </label>
                <input
                  id="task-input"
                  type="text"
                  value={taskInput}
                  onChange={event => setTaskInput(event.target.value)}
                  placeholder="Describe what you're working on"
                  className={`flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 ${sharedTokens.focusRing}`}
                />
                <button
                  type="submit"
                  className="rounded-2xl bg-sky-600 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white shadow-lg shadow-sky-500/40 hover:bg-sky-500 focus-visible:outline-none"
                >
                  Save
                </button>
              </form>
              <div
                className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200"
                aria-live="polite"
              >
                {currentTask ? (
                  <span className="font-medium text-slate-900 dark:text-slate-50">
                    {currentTask}
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">
                    No task yet — jot down what you want to stay focused on, then start the timer.
                  </span>
                )}
              </div>
            </div>
          </section>
          <section className="rounded-3xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70 px-5 py-6 shadow-lg shadow-slate-400/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400 dark:text-slate-500">Today</p>
                <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
                  Productivity summary
                </h3>
              </div>
              <span className="text-xs font-mono tracking-[0.2em] text-slate-400 dark:text-slate-500">
                Updated live
              </span>
            </div>
            <div className="mt-6 grid gap-4 grid-cols-2 md:grid-cols-4">
              {statsRows.map(row => (
                <article
                  key={row.label}
                  className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-50"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">{row.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{row.value}</p>
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                    {row.meta}
                  </p>
                </article>
              ))}
            </div>
            <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              {extraStats.map(stat => (
                <article
                  key={stat.label}
                  className="rounded-2xl border border-slate-100 bg-white/60 px-4 py-3 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-50"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">{stat.label}</p>
                  <p className="mt-2 text-xl font-semibold">{stat.value}</p>
                  <p className="text-[0.65rem] uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                    {stat.meta}
                  </p>
                </article>
              ))}
            </div>
          </section>
          <section className="flex flex-col items-center gap-4">
            <h2 className="text-2xl font-semibold">{timerLabel} Session</h2>
            <div className="text-6xl font-mono">{formatTime(remainingMs)}</div>
            <div
              className={`
                ${completionPanelMotionClass}
                ${completionPanelVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'}
                relative w-full max-w-md rounded-2xl border border-white/40 bg-white/90 dark:bg-slate-900/80 dark;border-slate-700/80 p-6 flex flex-col gap-3 shadow-lg
              `}
              aria-live="polite"
              role="status"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                Session complete
              </p>
              <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {completionLabel} session finished!
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Ready for the next chapter? {upcomingLabel} is standing by to keep you in flow.
              </p>
              <button
                type="button"
                onClick={handleContinueToNextSession}
                className="mt-2 px-4 py-2 bg-emerald-600 text-white rounded-full text-sm font-semibold shadow-lg shadow-emerald-400/30"
              >
                Start {upcomingLabel}
              </button>
            </div>
            <button
              onClick={primaryButton.action}
              disabled={timerPhase === 'completed'}
              className={`
                px-6 py-3 rounded-full text-white ${
                  timerPhase === 'running' ? 'bg-amber-500' : 'bg-green-500'
                }
                ${timerPhase === 'completed' ? 'opacity-50 cursor-not-allowed' : ''}
              `}
            >
              {primaryButton.label}
            </button>
          </section>
        </div>
      </main>
    </div>
  )
}
