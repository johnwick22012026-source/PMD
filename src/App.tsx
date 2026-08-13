import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

// Keys for persisted storage
const TIMER_SETTINGS_KEY = 'pomodoro_timer_settings'
const TIMER_STATE_KEY = 'pomodoro_timer_state'
const PRODUCTIVITY_STATE_KEY = 'pomodoro_productivity_state'
const TIMER_STATE_VERSION = 1
const MINUTE_MS = 60 * 1000

// Timer settings structure
type TimerSettings = {
  focus: number
  shortBreak: number
  longBreak: number
  sessionsBeforeLongBreak: number
  autoStartFocus: boolean
  autoStartBreaks: boolean
  soundEnabled: boolean
}

type TimerSession = 'focus' | 'shortBreak' | 'longBreak'
type TimerStatus = 'IDLE' | 'RUNNING' | 'PAUSED'

type StorageValidator<T> = (value: unknown) => value is T

type DurationFieldKey = 'focus' | 'shortBreak' | 'longBreak' | 'sessionsBeforeLongBreak'
type ToggleFieldKey = 'autoStartFocus' | 'autoStartBreaks' | 'soundEnabled'

type PresetKey = 'classic' | 'deepWork' | 'custom'
type DurationPreset = Pick<TimerSettings, DurationFieldKey>

type ShortcutHint = {
  shortcut: string
  description: string
}

type TimerState = {
  version: number
  session: TimerSession
  status: TimerStatus
  durationMs: number
  remainingMs: number
  endAt: number | null
  cycleCount: number
  completionToken: string
}

type PersistedTimerState = {
  version?: number
  session: TimerSession
  status: TimerStatus
  durationMs: number
  remainingMs: number
  endAt: number | null
  cycleCount: number
  completionToken?: string
}

type DailyGoalSettings = {
  targetPomodoros: number
  targetFocusMinutes: number
}

type DailyProgress = {
  date: string
  completedPomodoros: number
  focusMinutes: number
}

type SessionHistoryEntry = {
  session: TimerSession
  durationMs: number
  distractions: number
  task?: string
}

type ProductivityState = {
  dailyGoalSettings: DailyGoalSettings
  todayProgress: DailyProgress
  sessionDistractions: Record<string, number>
  taskPomodoroTotals: Record<string, number>
  sessionHistory: SessionHistoryEntry[]
}

type SafeStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  isAvailable: boolean
}

type SafeAudioPlayer = {
  play: () => void
}

const TIMER_SESSIONS: TimerSession[] = ['focus', 'shortBreak', 'longBreak']
const TIMER_STATUSES: TimerStatus[] = ['IDLE', 'RUNNING', 'PAUSED']

const TEXTUAL_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
])

const isTimerSession = (value: unknown): value is TimerSession =>
  typeof value === 'string' && TIMER_SESSIONS.includes(value as TimerSession)

const isTimerStatus = (value: unknown): value is TimerStatus =>
  typeof value === 'string' && TIMER_STATUSES.includes(value as TimerStatus)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const generateToken = (session: TimerSession, endAt: number | null) =>
  `${session}-${endAt ?? 'idle'}-${Date.now()}-${Math.random().toString(16).slice(2)}`

const getSessionDurationMs = (session: TimerSession, settings: TimerSettings) => {
  switch (session) {
    case 'focus':
      return settings.focus * MINUTE_MS
    case 'shortBreak':
      return settings.shortBreak * MINUTE_MS
    case 'longBreak':
      return settings.longBreak * MINUTE_MS
    default:
      return settings.focus * MINUTE_MS
  }
}

const computeNextSession = (
  current: TimerSession,
  cycleCount: number,
  sessionsBeforeLongBreak: number,
): { nextSession: TimerSession; nextCycleCount: number } => {
  if (current === 'focus') {
    const incremented = cycleCount + 1
    if (incremented >= sessionsBeforeLongBreak) {
      return { nextSession: 'longBreak', nextCycleCount: 0 }
    }
    return { nextSession: 'shortBreak', nextCycleCount: incremented }
  }

  if (current === 'longBreak') {
    return { nextSession: 'focus', nextCycleCount: 0 }
  }

  return { nextSession: 'focus', nextCycleCount: cycleCount }
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

const shortcutHints: ShortcutHint[] = [
  { shortcut: 'Space', description: 'Start or pause the currently selected timer' },
  { shortcut: 'R', description: 'Reset the current session timer' },
  { shortcut: 'S', description: 'Skip ahead to the next session' },
]

const isTimerSettings: StorageValidator<TimerSettings> = (value): value is TimerSettings => {
  if (typeof value !== 'object' || value === null) return false

  const candidate = value as Partial<TimerSettings>
  return (
    typeof candidate.focus === 'number' &&
    typeof candidate.shortBreak === 'number' &&
    typeof candidate.longBreak === 'number' &&
    typeof candidate.sessionsBeforeLongBreak === 'number' &&
    typeof candidate.autoStartFocus === 'boolean' &&
    typeof candidate.autoStartBreaks === 'boolean' &&
    typeof candidate.soundEnabled === 'boolean'
  )
}

const getTodayKey = () => new Date().toISOString().split('T')[0]

const isDailyGoalSettings = (value: unknown): value is DailyGoalSettings => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as DailyGoalSettings
  return (
    typeof candidate.targetPomodoros === 'number' &&
    typeof candidate.targetFocusMinutes === 'number'
  )
}

const isDailyProgress = (value: unknown): value is DailyProgress => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as DailyProgress
  return (
    typeof candidate.date === 'string' &&
    typeof candidate.completedPomodoros === 'number' &&
    typeof candidate.focusMinutes === 'number'
  )
}

const isRecordOfNumbers = (value: unknown): value is Record<string, number> => {
  if (typeof value !== 'object' || value === null) return false
  return Object.values(value as Record<string, unknown>).every(item => typeof item === 'number')
}

const isProductivityState: StorageValidator<ProductivityState> = (value): value is ProductivityState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ProductivityState>
  return (
    isDailyGoalSettings(candidate.dailyGoalSettings) &&
    isDailyProgress(candidate.todayProgress) &&
    isRecordOfNumbers(candidate.sessionDistractions ?? {}) &&
    isRecordOfNumbers(candidate.taskPomodoroTotals ?? {})
  )
}

const buildDefaultProductivityState = (): ProductivityState => ({
  dailyGoalSettings: {
    targetPomodoros: 4,
    targetFocusMinutes: 120,
  },
  todayProgress: {
    date: getTodayKey(),
    completedPomodoros: 0,
    focusMinutes: 0,
  },
  sessionDistractions: {},
  taskPomodoroTotals: {},
  sessionHistory: [],
})

const normalizeProductivityState = (state: ProductivityState, today = getTodayKey()): ProductivityState => {
  if (state.todayProgress.date === today) {
    return state
  }
  return {
    ...state,
    todayProgress: {
      date: today,
      completedPomodoros: 0,
      focusMinutes: 0,
    },
  }
}

const isTypingElement = (target: EventTarget | null) => {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return TEXTUAL_INPUT_TYPES.has(target.type)
  }
  return false
}

// Resilient storage helpers
const memoryStorage: Record<string, string> = {}

const safeStorage: SafeStorage = (() => {
  let available = false
  if (typeof window !== 'undefined') {
    try {
      const testKey = '__pomodoro_storage_test__'
      window.localStorage.setItem(testKey, '1')
      window.localStorage.removeItem(testKey)
      available = true
    } catch {
      available = false
    }
  }

  return {
    isAvailable: available,
    getItem(key: string) {
      if (available) {
        try {
          return window.localStorage.getItem(key)
        } catch {
          // Fall through to memory storage
        }
      }
      return memoryStorage[key] ?? null
    },
    setItem(key: string, value: string) {
      if (available) {
        try {
          window.localStorage.setItem(key, value)
          return
        } catch {
          // degrade to memory storage
        }
      }
      memoryStorage[key] = value
    },
    removeItem(key: string) {
      if (available) {
        try {
          window.localStorage.removeItem(key)
          return
        } catch {
          // degrade to memory storage
        }
      }
      delete memoryStorage[key]
    },
  }
})()

const canShowNotifications = () =>
  typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'

const showBrowserNotification = (title: string, options?: NotificationOptions) => {
  if (!canShowNotifications()) return
  try {
    new Notification(title, { silent: true, ...options })
  } catch {
    // ignore notification delivery failures
  }
}

const createSafeAudioPlayer = (): SafeAudioPlayer | null => {
  if (typeof window === 'undefined') return null
  const extendedWindow = window as Window & {
    AudioContext?: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
  const AudioConstructor = extendedWindow.AudioContext ?? extendedWindow.webkitAudioContext
  if (!AudioConstructor) return null

  try {
    const context = new AudioConstructor()
    const resumeContext = () => {
      if (context.state === 'suspended') {
        context.resume().catch(() => {})
      }
    }

    return {
      play() {
        resumeContext()
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(520, context.currentTime)
        gain.gain.setValueAtTime(0.18, context.currentTime)
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start()
        oscillator.stop(context.currentTime + 0.15)
      },
    }
  } catch {
    return null
  }
}

const usePrefersReducedMotion = () => {
  const [prefersReduced, setPrefersReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setPrefersReduced(mediaQuery.matches)

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return prefersReduced
}

const usePersistedState = <T,>(
  key: string,
  defaultValue: () => T,
  validator?: StorageValidator<T>,
): [T, Dispatch<SetStateAction<T>>] => {
  const [state, setState] = useState<T>(() => {
    if (!safeStorage.isAvailable && typeof window === 'undefined') {
      return defaultValue()
    }

    try {
      const stored = safeStorage.getItem(key)
      if (stored) {
        const parsed: unknown = JSON.parse(stored)
        if (validator) {
          if (validator(parsed)) {
            return parsed
          }
        } else {
          return parsed as T
        }
      }
    } catch {
      // ignore parsing or access errors
    }

    return defaultValue()
  })

  useEffect(() => {
    try {
      safeStorage.setItem(key, JSON.stringify(state))
    } catch {
      // ignore storage write failures
    }
  }, [key, state])

  return [state, setState]
}

const buildIdleState = (
  session: TimerSession,
  cycleCount: number,
  settings: TimerSettings,
): TimerState => {
  const durationMs = getSessionDurationMs(session, settings)
  return {
    version: TIMER_STATE_VERSION,
    session,
    status: 'IDLE',
    durationMs,
    remainingMs: durationMs,
    endAt: null,
    cycleCount,
    completionToken: generateToken(session, null),
  }
}

const getPersistedStateGuard = (value: unknown): value is PersistedTimerState => {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    isTimerSession(candidate.session) &&
    isTimerStatus(candidate.status) &&
    typeof candidate.durationMs === 'number' &&
    typeof candidate.remainingMs === 'number' &&
    (typeof candidate.endAt === 'number' || candidate.endAt === null) &&
    typeof candidate.cycleCount === 'number'
  )
}

const formatTime = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

export default function App() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const focusRingClasses = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500'
  const reducedMotionAttribute = prefersReducedMotion
    ? 'motion-reduce:transition-none motion-reduce:transform-none'
    : ''

  const rootClasses =
    'min-h-screen overflow-x-hidden px-4 py-10 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50'

  const mainGridClasses =
    'mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[1.15fr_0.85fr]'

  const timerSectionBase = `min-h-0 min-w-0 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-lg shadow-slate-400/10 dark:border-slate-700 dark:bg-slate-900/70 ${reducedMotionAttribute}`
  const settingsSectionBase = `min-h-0 min-w-0 rounded-3xl border border-slate-200 bg-white/80 px-5 py-6 shadow-lg shadow-slate-400/10 dark:border-slate-700 dark:bg-slate-900/70 ${reducedMotionAttribute}`
  const statsSectionBase = `min-h-0 min-w-0 rounded-3xl border border-slate-200 bg-white/80 p-6 shadow-lg shadow-slate-400/10 dark:border-slate-700 dark:bg-slate-900/70 ${reducedMotionAttribute}`

  const [timerSettings, setTimerSettings] = usePersistedState<TimerSettings>(
    TIMER_SETTINGS_KEY,
    () => DEFAULT_TIMER_SETTINGS,
    isTimerSettings,
  )

  const [productivityState, setProductivityState] = usePersistedState<ProductivityState>(
    PRODUCTIVITY_STATE_KEY,
    buildDefaultProductivityState,
    isProductivityState,
  )

  useEffect(() => {
    const today = getTodayKey()
    if (productivityState.todayProgress.date === today) return
    setProductivityState(prev => ({
      ...prev,
      todayProgress: {
        date: today,
        completedPomodoros: 0,
        focusMinutes: 0,
      },
    }))
  }, [productivityState.todayProgress.date, setProductivityState])

  const recordProductivityCompletion = useCallback(
    (session: TimerSession, durationMs: number) => {
      if (session !== 'focus') return
      setProductivityState(prev => {
        const today = getTodayKey()
        const normalized = normalizeProductivityState(prev, today)
        const focusMinutesToAdd = Math.round(durationMs / MINUTE_MS)
        return {
          ...normalized,
          todayProgress: {
            ...normalized.todayProgress,
            completedPomodoros: normalized.todayProgress.completedPomodoros + 1,
            focusMinutes: normalized.todayProgress.focusMinutes + focusMinutesToAdd,
          },
          sessionHistory: [
            ...normalized.sessionHistory,
            {
              session: 'focus',
              durationMs,
              distractions: 0,
            },
          ],
        }
      })
    },
    [setProductivityState],
  )

  const presetKey: PresetKey = useMemo(() => {
    const { focus, shortBreak, longBreak, sessionsBeforeLongBreak } = timerSettings
    if (
      focus === PRESET_DURATION_SETTINGS.classic.focus &&
      shortBreak === PRESET_DURATION_SETTINGS.classic.shortBreak &&
      longBreak === PRESET_DURATION_SETTINGS.classic.longBreak &&
      sessionsBeforeLongBreak === PRESET_DURATION_SETTINGS.classic.sessionsBeforeLongBreak
    ) {
      return 'classic'
    }
    if (
      focus === PRESET_DURATION_SETTINGS.deepWork.focus &&
      shortBreak === PRESET_DURATION_SETTINGS.deepWork.shortBreak &&
      longBreak === PRESET_DURATION_SETTINGS.deepWork.longBreak &&
      sessionsBeforeLongBreak === PRESET_DURATION_SETTINGS.deepWork.sessionsBeforeLongBreak
    ) {
      return 'deepWork'
    }
    return 'custom'
  }, [timerSettings])

  const handlePresetSelect = useCallback(
    (key: Exclude<PresetKey, 'custom'>) => {
      setTimerSettings((prev: TimerSettings) => ({ ...prev, ...PRESET_DURATION_SETTINGS[key] }))
    },
    [setTimerSettings],
  )

  const handleDurationChange = useCallback(
    (field: DurationFieldKey, value: number) => {
      setTimerSettings((prev: TimerSettings) => ({ ...prev, [field]: value }))
    },
    [setTimerSettings],
  )

  const toggleAutoStartFocus = useCallback(() => {
    setTimerSettings((prev: TimerSettings) => ({ ...prev, autoStartFocus: !prev.autoStartFocus }))
  }, [setTimerSettings])

  const toggleAutoStartBreaks = useCallback(() => {
    setTimerSettings((prev: TimerSettings) => ({ ...prev, autoStartBreaks: !prev.autoStartBreaks }))
  }, [setTimerSettings])

  const toggleSound = useCallback(() => {
    setTimerSettings((prev: TimerSettings) => ({ ...prev, soundEnabled: !prev.soundEnabled }))
  }, [setTimerSettings])

  // Daily goal configuration
  const pomodoroGoalEnabled = productivityState.dailyGoalSettings.targetPomodoros > 0
  const focusGoalEnabled = productivityState.dailyGoalSettings.targetFocusMinutes > 0
  const togglePomodoroGoal = useCallback(() => {
    setProductivityState(prev => {
      const defaultPomodoros = buildDefaultProductivityState().dailyGoalSettings.targetPomodoros
      return {
        ...prev,
        dailyGoalSettings: {
          ...prev.dailyGoalSettings,
          targetPomodoros: prev.dailyGoalSettings.targetPomodoros > 0 ? 0 : defaultPomodoros,
        },
      }
    })
  }, [setProductivityState])
  const toggleFocusGoal = useCallback(() => {
    setProductivityState(prev => {
      const defaultFocus = buildDefaultProductivityState().dailyGoalSettings.targetFocusMinutes
      return {
        ...prev,
        dailyGoalSettings: {
          ...prev.dailyGoalSettings,
          targetFocusMinutes: prev.dailyGoalSettings.targetFocusMinutes > 0 ? 0 : defaultFocus,
        },
      }
    })
  }, [setProductivityState])
  const handlePomodoroGoalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value) || 0
    setProductivityState(prev => ({
      ...prev,
      dailyGoalSettings: {
        ...prev.dailyGoalSettings,
        targetPomodoros: val,
      },
    }))
  }, [setProductivityState])
  const handleFocusTimeGoalChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value) || 0
    setProductivityState(prev => ({
      ...prev,
      dailyGoalSettings: {
        ...prev.dailyGoalSettings,
        targetFocusMinutes: val,
      },
    }))
  }, [setProductivityState])

  const completionGuardRef = useRef<string | null>(null)
  const audioPlayerRef = useRef<SafeAudioPlayer | null>(null)
  const previousSessionRef = useRef<TimerSession>('focus')

  useEffect(() => {
    audioPlayerRef.current = createSafeAudioPlayer()
  }, [])

  const completeSessionState = useCallback(
    (state: TimerState, now: number): TimerState | null => {
      if (completionGuardRef.current === state.completionToken) return null
      completionGuardRef.current = state.completionToken
      if (state.session === 'focus') {
        recordProductivityCompletion(state.session, state.durationMs)
      }
      const { nextSession, nextCycleCount } = computeNextSession(
        state.session,
        state.cycleCount,
        timerSettings.sessionsBeforeLongBreak,
      )
      const durationMs = getSessionDurationMs(nextSession, timerSettings)
      const shouldAutoStart = nextSession === 'focus' ? timerSettings.autoStartFocus : timerSettings.autoStartBreaks
      const endAt = shouldAutoStart ? now + durationMs : null
      const status: TimerStatus = shouldAutoStart ? 'RUNNING' : 'IDLE'
      const nextToken = generateToken(nextSession, endAt)

      return {
        version: TIMER_STATE_VERSION,
        session: nextSession,
        status,
        durationMs,
        remainingMs: durationMs,
        endAt,
        cycleCount: nextCycleCount,
        completionToken: nextToken,
      }
    },
    [recordProductivityCompletion, timerSettings],
  )

  const [timerState, setTimerState] = useState<TimerState>(() =>
    buildIdleState('focus', 0, DEFAULT_TIMER_SETTINGS),
  )

  const hydrateTimerFromStorage = useCallback(() => {
    try {
      const stored = safeStorage.getItem(TIMER_STATE_KEY)
      if (!stored) {
        setTimerState(prev => buildIdleState(prev.session, prev.cycleCount, timerSettings))
        return
      }
      const parsed: unknown = JSON.parse(stored)
      if (!getPersistedStateGuard(parsed)) {
        setTimerState(prev => buildIdleState(prev.session, prev.cycleCount, timerSettings))
        return
      }

      const durationMs = getSessionDurationMs(parsed.session, timerSettings)
      const now = Date.now()
      let normalizedRemaining = clamp(parsed.remainingMs ?? durationMs, 0, durationMs)
      let normalizedEndAt = parsed.endAt
      const cycleCount = Number.isNaN(parsed.cycleCount) ? 0 : parsed.cycleCount
      const completionToken = parsed.completionToken ?? generateToken(parsed.session, parsed.endAt)

      if (parsed.status === 'RUNNING') {
        const derivedRemaining = parsed.endAt ? Math.max(0, parsed.endAt - now) : normalizedRemaining
        normalizedRemaining = clamp(derivedRemaining, 0, durationMs)
        if (normalizedRemaining <= 0) {
          const baseState: TimerState = {
            version: TIMER_STATE_VERSION,
            session: parsed.session,
            status: 'RUNNING',
            durationMs,
            remainingMs: 0,
            endAt: parsed.endAt,
            cycleCount,
            completionToken,
          }
          const completed = completeSessionState(baseState, now)
          if (completed) {
            setTimerState(completed)
            return
          }
          normalizedRemaining = durationMs
          normalizedEndAt = null
        } else {
          normalizedEndAt = parsed.endAt && parsed.endAt > now ? parsed.endAt : now + normalizedRemaining
        }
      } else if (parsed.status === 'PAUSED') {
        normalizedEndAt = null
      } else {
        normalizedEndAt = null
        normalizedRemaining = clamp(normalizedRemaining, 0, durationMs)
      }

      let normalizedStatus: TimerStatus = 'IDLE'
      if (parsed.status === 'PAUSED') {
        normalizedStatus = 'PAUSED'
      } else if (parsed.status === 'RUNNING') {
        normalizedStatus = 'RUNNING'
      }

      setTimerState({
        version: TIMER_STATE_VERSION,
        session: parsed.session,
        status: normalizedStatus,
        durationMs,
        remainingMs: normalizedRemaining,
        endAt: normalizedStatus === 'RUNNING' ? normalizedEndAt : null,
        cycleCount,
        completionToken,
      })
    } catch {
      setTimerState(prev => buildIdleState(prev.session, prev.cycleCount, timerSettings))
    }
  }, [completeSessionState, timerSettings])

  useEffect(() => {
    hydrateTimerFromStorage()
  }, [hydrateTimerFromStorage])

  useEffect(() => {
    if (!safeStorage.isAvailable || typeof window === 'undefined') return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        hydrateTimerFromStorage()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [hydrateTimerFromStorage])

  useEffect(() => {
    if (!safeStorage.isAvailable || typeof window === 'undefined') return
    const handleStorage = (event: StorageEvent) => {
      if (event.key === TIMER_STATE_KEY) {
        hydrateTimerFromStorage()
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [hydrateTimerFromStorage])

  useEffect(() => {
    try {
      safeStorage.setItem(TIMER_STATE_KEY, JSON.stringify(timerState))
    } catch {
      // ignore storage write failures
    }
  }, [timerState])

  const startOrResumeTimer = useCallback(() => {
    setTimerState(prev => {
      if (prev.status === 'RUNNING') return prev
      const now = Date.now()
      const nextEndAt = now + prev.remainingMs
      return {
        ...prev,
        status: 'RUNNING',
        endAt: nextEndAt,
        completionToken: generateToken(prev.session, nextEndAt),
      }
    })
  }, [])

  const pauseTimer = useCallback(() => {
    setTimerState(prev => {
      if (prev.status !== 'RUNNING' || !prev.endAt) return prev
      const now = Date.now()
      const remaining = Math.max(0, prev.endAt - now)
      return {
        ...prev,
        status: 'PAUSED',
        endAt: null,
        remainingMs: remaining,
      }
    })
  }, [])

  const resetTimer = useCallback(() => {
    setTimerState(prev => buildIdleState(prev.session, prev.cycleCount, timerSettings))
    completionGuardRef.current = null
  }, [timerSettings])

  const skipTimer = useCallback(() => {
    setTimerState(prev => {
      const next = completeSessionState(prev, Date.now())
      return next ?? prev
    })
  }, [completeSessionState])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (isTypingElement(event.target)) return
      const key = event.key.toLowerCase()
      if (key === ' ' || key === 'spacebar') {
        event.preventDefault()
        if (timerState.status === 'RUNNING') {
          pauseTimer()
        } else {
          startOrResumeTimer()
        }
        return
      }

      if (key === 'r') {
        resetTimer()
        return
      }

      if (key === 's') {
        skipTimer()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pauseTimer, resetTimer, skipTimer, startOrResumeTimer, timerState.status])

  useEffect(() => {
    if (timerState.status !== 'RUNNING') return

    const interval = window.setInterval(() => {
      setTimerState(prev => {
        if (prev.status !== 'RUNNING' || !prev.endAt) return prev
        const now = Date.now()
        const nextRemaining = Math.max(0, prev.endAt - now)
        if (nextRemaining <= 0) {
          const nextState = completeSessionState(prev, now)
          return nextState ?? prev
        }
        if (nextRemaining === prev.remainingMs) return prev
        return { ...prev, remainingMs: nextRemaining }
      })
    }, 250)

    return () => window.clearInterval(interval)
  }, [timerState.status, completeSessionState])

  const timerLabel = useMemo(() => {
    switch (timerState.session) {
      case 'focus':
        return 'Focus'
      case 'shortBreak':
        return 'Short Break'
      case 'longBreak':
        return 'Long Break'
      default:
        return 'Focus'
    }
  }, [timerState.session])

  useEffect(() => {
    if (previousSessionRef.current === timerState.session) return
    previousSessionRef.current = timerState.session

    if (timerSettings.soundEnabled) {
      try {
        audioPlayerRef.current?.play()
      } catch {
        // fail silently when audio playback is blocked
      }
    }

    const notificationBody =
      timerState.session === 'focus'
        ? 'Refocus on your priority task and keep the momentum going.'
        : 'Pause, breathe, and enjoy a well-earned break.'

    showBrowserNotification(`${timerLabel} session started`, {
      body: notificationBody,
    })
  }, [timerLabel, timerSettings.soundEnabled, timerState.session])

  const progressPercent = useMemo(() => {
    if (timerState.durationMs <= 0) return 0
    return clamp(100 - Math.round((timerState.remainingMs / timerState.durationMs) * 100), 0, 100)
  }, [timerState.durationMs, timerState.remainingMs])

  const primaryButtonLabel = timerState.status === 'RUNNING' ? 'Pause' : 'Start'
  const showResumeHint = timerState.status === 'PAUSED'
  const focusSessionsRemaining = Math.max(
    0,
    timerSettings.sessionsBeforeLongBreak - timerState.cycleCount,
  )

  const pomodoroGoalPercent = productivityState.dailyGoalSettings.targetPomodoros
    ? clamp(
        Math.round(
          (productivityState.todayProgress.completedPomodoros /
            productivityState.dailyGoalSettings.targetPomodoros) *
            100,
        ),
        0,
        100,
      )
    : 0
  const focusGoalPercent = productivityState.dailyGoalSettings.targetFocusMinutes
    ? clamp(
        Math.round(
          (productivityState.todayProgress.focusMinutes /
            productivityState.dailyGoalSettings.targetFocusMinutes) *
            100,
        ),
        0,
        100,
      )
    : 0

  return (
    <div className={rootClasses}>
      <main className={`${mainGridClasses} lg:space-y-0`}>
        <div className="space-y-6">
          <section className={timerSectionBase} aria-label="Pomodoro timer control">
            <header className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.4em] text-slate-400 dark:text-slate-500">Current session</p>
                <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">
                  {timerLabel}
                </h1>
              </div>
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {focusSessionsRemaining === 0
                  ? 'Next long break is ready'
                  : `${focusSessionsRemaining} focus session${focusSessionsRemaining === 1 ? '' : 's'} until long break`}
              </p>
            </header>
            <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
              <div
                className="flex min-h-[12rem] flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 px-6 py-8 text-center shadow-inner shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-950/50"
                aria-live="polite"
                aria-atomic="true"
              >
                <span className="text-2xl font-semibold text-slate-500 dark:text-slate-400">
                  {timerState.session === 'focus' ? 'Focus time' : 'Break time'}
                </span>
                <p className="mt-3 text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
                  {formatTime(timerState.remainingMs)}
                </p>
                <p className="mt-1 text-sm uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                  {timerState.status === 'RUNNING' ? 'Running' : timerState.status === 'PAUSED' ? 'Paused' : 'Ready'}
                </p>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-100/60 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progressPercent}
                  />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  {progressPercent}% complete
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {timerState.status === 'PAUSED' ? 'Resume the clock to continue.' : 'Keep focus and stay present.'}
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={timerState.status === 'RUNNING' ? pauseTimer : startOrResumeTimer}
                className={`group rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-lg transition ${focusRingClasses} ${timerState.status === 'RUNNING' ? 'hover:bg-slate-800 dark:hover:bg-slate-700' : 'hover:bg-slate-800 dark:hover:bg-slate-700'}`}
                aria-label={primaryButtonLabel}
              >
                {primaryButtonLabel}
                {showResumeHint && <span className="ml-2 text-[0.65rem] font-normal uppercase tracking-[0.3em]">Resume</span>}
              </button>
              <button
                type="button"
                onClick={resetTimer}
                className={`rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-600 transition ${focusRingClasses} hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-50`}
              >
                Reset
              </button>
              <button
                type="button"
                onClick={skipTimer}
                className={`rounded-full border border-transparent px-5 py-3 text-sm font-semibold text-slate-600 transition ${focusRingClasses} hover:border-slate-200 hover:bg-slate-100 dark:hover:border-slate-700 dark:hover:bg-slate-900/40`}
              >
                Skip
              </button>
            </div>
          </section>

          <section className={statsSectionBase} aria-label="Daily productivity statistics">
            <header className="flex flex-col gap-1">
              <p className="text-xs uppercase tracking-[0.4em] text-slate-400 dark:text-slate-500">Today&apos;s Stats</p>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Daily progress</h2>
            </header>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <article className="rounded-2xl border border-slate-100 bg-slate-50/90 p-4 text-left shadow-sm shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">Sessions completed</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-50">{productivityState.todayProgress.completedPomodoros}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Focused moments of progress</p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-300"
                    style={{ width: `${pomodoroGoalPercent}%` }}
                    role="presentation"
                  />
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  {pomodoroGoalPercent}% of goal
                </p>
              </article>
              <article className="rounded-2xl border border-slate-100 bg-slate-50/90 p-4 text-left shadow-sm shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900/60">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">Minutes focused</p>
                <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-slate-50">{productivityState.todayProgress.focusMinutes}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Time tracked in focus sessions</p>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-sky-500 transition-all duration-300"
                    style={{ width: `${focusGoalPercent}%` }}
                    role="presentation"
                  />
                </div>
                <p className="mt-1 text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                  {focusGoalPercent}% of goal
                </p>
              </article>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="space-y-2 rounded-2xl border border-slate-100 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className={`flex items-center justify-between ${focusRingClasses}`}>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">Pomodoro goal</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {pomodoroGoalEnabled
                        ? `${productivityState.todayProgress.completedPomodoros} / ${productivityState.dailyGoalSettings.targetPomodoros}`
                        : 'Not set'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={togglePomodoroGoal}
                    className={`rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] ${focusRingClasses} ${pomodoroGoalEnabled ? 'border-sky-500 text-sky-500' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
                  >
                    {pomodoroGoalEnabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Target</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={productivityState.dailyGoalSettings.targetPomodoros}
                  onChange={handlePomodoroGoalChange}
                  className={`w-full rounded border px-2 py-1 text-right text-slate-900 dark:bg-slate-800 dark:text-slate-50 ${focusRingClasses}`}
                  aria-label="Daily pomodoro target"
                />
              </div>
              <div className="space-y-2 rounded-2xl border border-slate-100 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className={`flex items-center justify-between ${focusRingClasses}`}>
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">Focus minutes goal</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {focusGoalEnabled
                        ? `${productivityState.todayProgress.focusMinutes} / ${productivityState.dailyGoalSettings.targetFocusMinutes}`
                        : 'Not set'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={toggleFocusGoal}
                    className={`rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] ${focusRingClasses} ${focusGoalEnabled ? 'border-emerald-500 text-emerald-500' : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-300'}`}
                  >
                    {focusGoalEnabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
                <label className="text-xs uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">Target minutes</label>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={productivityState.dailyGoalSettings.targetFocusMinutes}
                  onChange={handleFocusTimeGoalChange}
                  className={`w-full rounded border px-2 py-1 text-right text-slate-900 dark:bg-slate-800 dark:text-slate-50 ${focusRingClasses}`}
                  aria-label="Daily focus minutes target"
                />
              </div>
            </div>
          </section>
        </div>

        <section className={settingsSectionBase} aria-label="Pomodoro settings and shortcut list">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Settings & shortcuts</h3>
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                Keyboard friendly
              </span>
            </div>
            <p className="text-[0.75rem] text-slate-500 dark:text-slate-400">
              Navigate the timer without touching your mouse and keep visual focus cues intact.
            </p>
          </div>
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="space-y-6">
              <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Timer Settings</h4>
              <fieldset className="space-y-3" aria-label="Preset timer styles" role="group">
                <legend className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mb-2">
                  Preset style
                </legend>
                <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Preset timer options">
                  {Object.entries(PRESET_CONFIG).map(([key, cfg]) => (
                    <label
                      key={key}
                      htmlFor={`preset-${key}`}
                      className={`flex min-w-[10rem] items-start gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-semibold text-slate-700 transition-colors focus-within:border-sky-500 focus-within:ring-0 dark:text-slate-300 ${focusRingClasses}`}
                    >
                      <input
                        id={`preset-${key}`}
                        type="radio"
                        name="preset"
                        value={key}
                        checked={presetKey === key}
                        onChange={() => key !== 'custom' && handlePresetSelect(key as Exclude<PresetKey, 'custom'>)}
                        aria-describedby={`preset-${key}-description`}
                        className={`form-radio h-4 w-4 text-sky-500 focus-visible:outline-none ${focusRingClasses}`}
                      />
                      <div>
                        <span>{cfg.label}</span>
                        <p
                          id={`preset-${key}-description`}
                          className="text-xs font-normal text-slate-500 dark:text-slate-400"
                        >
                          {cfg.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </fieldset>
              {presetKey === 'custom' && (
                <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-300">
                  <div className="flex items-center justify-between" role="group" aria-label="Custom focus duration">
                    <label htmlFor="custom-focus" className="font-medium">
                      Focus (min)
                    </label>
                    <input
                      id="custom-focus"
                      type="number"
                      min={1}
                      value={timerSettings.focus}
                      onChange={e => handleDurationChange('focus', Number(e.target.value) || 1)}
                      className={`w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800 ${focusRingClasses}`}
                      aria-label="Adjust focus duration in minutes"
                    />
                  </div>
                  <div className="flex items-center justify-between" role="group" aria-label="Custom short break duration">
                    <label htmlFor="custom-short" className="font-medium">
                      Short Break (min)
                    </label>
                    <input
                      id="custom-short"
                      type="number"
                      min={1}
                      value={timerSettings.shortBreak}
                      onChange={e => handleDurationChange('shortBreak', Number(e.target.value) || 1)}
                      className={`w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800 ${focusRingClasses}`}
                      aria-label="Adjust short break duration in minutes"
                    />
                  </div>
                  <div className="flex items-center justify-between" role="group" aria-label="Custom long break duration">
                    <label htmlFor="custom-long" className="font-medium">
                      Long Break (min)
                    </label>
                    <input
                      id="custom-long"
                      type="number"
                      min={1}
                      value={timerSettings.longBreak}
                      onChange={e => handleDurationChange('longBreak', Number(e.target.value) || 1)}
                      className={`w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800 ${focusRingClasses}`}
                      aria-label="Adjust long break duration in minutes"
                    />
                  </div>
                  <div
                    className="flex items-center justify-between"
                    role="group"
                    aria-label="Custom sessions before triggering a long break"
                  >
                    <label htmlFor="custom-sessions" className="font-medium">
                      Sessions before long break
                    </label>
                    <input
                      id="custom-sessions"
                      type="number"
                      min={1}
                      value={timerSettings.sessionsBeforeLongBreak}
                      onChange={e => handleDurationChange('sessionsBeforeLongBreak', Number(e.target.value) || 1)}
                      className={`w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800 ${focusRingClasses}`}
                      aria-label="Adjust number of focus sessions before a long break"
                    />
                  </div>
                </div>
              )}
              <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <label className={`flex items-center gap-2 ${focusRingClasses}`}>
                  <input
                    type="checkbox"
                    checked={timerSettings.autoStartFocus}
                    onChange={toggleAutoStartFocus}
                    className={`h-5 w-5 rounded border text-sky-500 focus-visible:outline-none ${focusRingClasses}`}
                    aria-checked={timerSettings.autoStartFocus}
                  />
                  Auto-start focus
                </label>
                <label className={`flex items-center gap-2 ${focusRingClasses}`}>
                  <input
                    type="checkbox"
                    checked={timerSettings.autoStartBreaks}
                    onChange={toggleAutoStartBreaks}
                    className={`h-5 w-5 rounded border text-sky-500 focus-visible:outline-none ${focusRingClasses}`}
                    aria-checked={timerSettings.autoStartBreaks}
                  />
                  Auto-start breaks
                </label>
                <label className={`flex items-center gap-2 ${focusRingClasses}`}>
                  <input
                    type="checkbox"
                    checked={timerSettings.soundEnabled}
                    onChange={toggleSound}
                    className={`h-5 w-5 rounded border text-sky-500 focus-visible:outline-none ${focusRingClasses}`}
                    aria-checked={timerSettings.soundEnabled}
                  />
                  Sound alerts
                </label>
              </div>
            </div>
            <div className="space-y-3">
              {shortcutHints.map(hint => (
                <article
                  key={hint.shortcut}
                  className="flex min-h-[4.5rem] min-w-0 flex-col gap-1 rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-50"
                  role="region"
                  aria-label={`Shortcut hint for ${hint.shortcut}`}
                >
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                    {hint.shortcut}
                  </span>
                  <p className="text-sm font-semibold">{hint.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
