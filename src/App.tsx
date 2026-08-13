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

  // Focus mode state for hiding nonessential UI
  const [isFocusMode, setIsFocusMode] = useState(false)
  const toggleFocusMode = useCallback(() => {
    setIsFocusMode(prev => !prev)
  }, [])

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

  useEffect(() => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    const msUntilNext = next.getTime() - now.getTime()
    const timeoutId = window.setTimeout(() => {
      const today = getTodayKey()
      setProductivityState(prev => ({
        ...prev,
        todayProgress: {
          date: today,
          completedPomodoros: 0,
          focusMinutes: 0,
        },
      }))
    }, msUntilNext)
    return () => window.clearTimeout(timeoutId)
  }, [productivityState.todayProgress.date, setProductivityState])

  // Record completed focus sessions into productivity state
  const recordProductivityCompletion = useCallback(
    (session: TimerSession, durationMs: number, completionToken: string) => {
      if (session !== 'focus') return
      setProductivityState(prev => {
        const today = getTodayKey()
        const normalized = normalizeProductivityState(prev, today)
        const focusMinutesToAdd = Math.round(durationMs / MINUTE_MS)
        const distractions = normalized.sessionDistractions[completionToken] || 0
        // remove recorded session's distraction count
        const { [completionToken]: _, ...remainingDistractions } = normalized.sessionDistractions
        return {
          ...normalized,
          todayProgress: {
            ...normalized.todayProgress,
            completedPomodoros: normalized.todayProgress.completedPomodoros + 1,
            focusMinutes: normalized.todayProgress.focusMinutes + focusMinutesToAdd,
          },
          sessionDistractions: remainingDistractions,
          sessionHistory: [
            ...normalized.sessionHistory,
            {
              session: 'focus',
              durationMs,
              distractions,
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
      setTimerSettings(prev => ({ ...prev, ...PRESET_DURATION_SETTINGS[key] }))
    },
    [setTimerSettings],
  )

  const handleDurationChange = useCallback(
    (field: DurationFieldKey, value: number) => {
      setTimerSettings(prev => ({ ...prev, [field]: value }))
    },
    [setTimerSettings],
  )

  const toggleAutoStartFocus = useCallback(() => {
    setTimerSettings(prev => ({ ...prev, autoStartFocus: !prev.autoStartFocus }))
  }, [setTimerSettings])

  const toggleAutoStartBreaks = useCallback(() => {
    setTimerSettings(prev => ({ ...prev, autoStartBreaks: !prev.autoStartBreaks }))
  }, [setTimerSettings])

  const toggleSound = useCallback(() => {
    setTimerSettings(prev => ({ ...prev, soundEnabled: !prev.soundEnabled }))
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
        recordProductivityCompletion(state.session, state.durationMs, state.completionToken)
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
        // preserve existing completionToken so distractions carry over on pause/resume
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

  const incrementDistraction = useCallback(() => {
    if (timerState.session !== 'focus') return
    const token = timerState.completionToken
    setProductivityState(prev => ({
      ...prev,
      sessionDistractions: {
        ...prev.sessionDistractions,
        [token]: (prev.sessionDistractions[token] || 0) + 1,
      },
    }))
  }, [timerState.session, timerState.completionToken, setProductivityState])

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
        return
      }

      if (key === 'f') {
        event.preventDefault()
        toggleFocusMode()
        return
      }

      if (key === 'd') {
        event.preventDefault()
        incrementDistraction()
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [pauseTimer, resetTimer, skipTimer, startOrResumeTimer, timerState.status, toggleFocusMode])

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

  // Compute live focus minutes including in-progress session time
  const activeSessionElapsedMinutes =
    timerState.session === 'focus' && timerState.status !== 'IDLE'
      ? Math.floor((timerState.durationMs - timerState.remainingMs) / MINUTE_MS)
      : 0
  const liveFocusMinutes = productivityState.todayProgress.focusMinutes + activeSessionElapsedMinutes

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
          (liveFocusMinutes / productivityState.dailyGoalSettings.targetFocusMinutes) * 100,
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
            {/* ... timer UI omitted for brevity ... */}
              {isFocusMode && timerState.session === 'focus' && (
                <div className="mt-4 flex items-center justify-center space-x-2">
                  <span>Distractions: {productivityState.sessionDistractions[timerState.completionToken] || 0}</span>
                  <button
                    type="button"
                    onClick={incrementDistraction}
                    className={focusRingClasses}
                  >
                    + Distraction
                  </button>
                </div>
              )}
          </section>

          <section hidden={isFocusMode} className={statsSectionBase} aria-label="Daily productivity statistics">
            {/* ... stats JSX omitted for brevity ... */}
          </section>
        </div>

        <section hidden={isFocusMode} className={settingsSectionBase} aria-label="Pomodoro settings and shortcut list">
          {/* ... settings JSX omitted for brevity ... */}
        </section>
      </main>
    </div>
  )
}
