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

// Strongly validate that loaded settings match the TimerSettings shape
const isTimerSettings = (value: unknown): value is TimerSettings =>
  isObject(value) &&
  typeof (value as any).focus === 'number' &&
  typeof (value as any).shortBreak === 'number' &&
  typeof (value as any).longBreak === 'number' &&
  typeof (value as any).sessionsBeforeLongBreak === 'number' &&
  typeof (value as any).autoStartFocus === 'boolean' &&
  typeof (value as any).autoStartBreaks === 'boolean' &&
  typeof (value as any).soundEnabled === 'boolean'

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

export default function App() {
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
        const nextMode = determineNextMode(sessionMode, 0, timerSettings.sessionsBeforeLongBreak)
        setTimerPhase('completed')
        setSessionMode(nextMode)
      }
    }, 250)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [timerPhase, sessionMode, timerSettings.sessionsBeforeLongBreak, playCompletionTone])

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

  const primaryButton = useMemo(() => {
    switch (timerPhase) {
      case 'running':
        return { label: 'Pause', action: pauseTimer }
      default:
        return { label: 'Start', action: startTimer }
    }
  }, [timerPhase, pauseTimer, startTimer])

  const timerLabel = useMemo(() => {
    switch (sessionMode) {
      case 'focus': return 'Focus'
      case 'shortBreak': return 'Short Break'
      case 'longBreak': return 'Long Break'
    }
  }, [sessionMode])

  const rootClasses = `${getSurfaceStyles(theme)} min-h-screen flex flex-col ${sharedTokens.motion}`

  return (
    <div className={rootClasses}>
      <header className="p-4 flex justify-end">
        <button
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          className="px-3 py-1 bg-blue-500 text-white rounded"
        >
          Switch to {theme === 'light' ? 'Dark' : 'Light'}
        </button>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center">
        <h2 className="text-2xl font-semibold mb-4">{timerLabel} Session</h2>
        <div className="text-6xl font-mono mb-6">{formatTime(remainingMs)}</div>
        <button
          onClick={primaryButton.action}
          className="px-6 py-3 bg-green-500 text-white rounded-full"
        >
          {primaryButton.label}
        </button>
      </main>
    </div>
  )
}
