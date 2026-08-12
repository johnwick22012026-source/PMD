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

type ShortcutHint = {
  shortcut: string
  description: string
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

const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  sessionsBeforeLongBreak: 4,
  autoStartFocus: false,
  autoStartBreaks: false,
  soundEnabled: true,
}

const shortcutHints: ShortcutHint[] = [
  { shortcut: 'Space', description: 'Start or pause the currently selected timer' },
  { shortcut: 'R', description: 'Reset the current session timer' },
  { shortcut: 'S', description: 'Skip ahead to the next session' },
]

const isTimerSettings: StorageValidator<TimerSettings> = (value): value is TimerSettings => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

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

const usePersistedState = <T,>(
  key: string,
  fallback: () => T,
  validator: StorageValidator<T>,
): [T, Dispatch<SetStateAction<T>>] => {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return fallback()
    }

    try {
      const stored = window.localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (validator(parsed)) {
          return parsed
        }
      }
    } catch {
      // ignore malformed data intentionally
    }

    return fallback()
  })

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // ignore write errors
    }
  }, [key, state])

  return [state, setState]
}

// ... rest of validators, read/write local methods, hooks, utilities remain unchanged ...

export default function App() {
  // ... existing state declarations, hooks, timer logic unchanged ...

  const rootClasses = 'min-h-screen px-6 py-10 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50'

  // PASSED-IN SETTINGS STATE
  const [timerSettings, setTimerSettings] = usePersistedState<TimerSettings>(
    TIMER_SETTINGS_KEY,
    () => DEFAULT_TIMER_SETTINGS,
    isTimerSettings,
  )

  // Derive which preset matches current durations
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
      setTimerSettings(prev => ({
        ...prev,
        ...PRESET_DURATION_SETTINGS[key],
      }))
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

  // ... rest of hooks and logic unchanged ...

  return (
    <div className={rootClasses}>
      {/* ... header, main task, summary, history, timer sections unchanged ... */}

      {/* Settings & shortcuts section with new Timer Settings UI */}
      <section className="rounded-3xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70 px-5 py-6 shadow-lg shadow-slate-400/10">
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
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          {/* Timer Settings Column */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Timer Settings</h4>
            <fieldset>
              <legend className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mb-2">
                Preset style
              </legend>
              <div className="flex gap-4">
                {Object.entries(PRESET_CONFIG).map(([key, cfg]) => (
                  <label key={key} className="flex items-center text-sm text-slate-700 dark:text-slate-300">
                    <input
                      type="radio"
                      name="preset"
                      value={key}
                      checked={presetKey === key}
                      onChange={() =>
                        key !== 'custom'
                          ? handlePresetSelect(key as Exclude<PresetKey, 'custom'>)
                          : null
                      }
                      className="mr-2"
                    />
                    {cfg.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {presetKey === 'custom' && (
              <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-300">
                <div className="flex justify-between">
                  <label>Focus (min)</label>
                  <input
                    type="number"
                    min={1}
                    value={timerSettings.focus}
                    onChange={e => handleDurationChange('focus', Number(e.target.value) || 1)}
                    className="w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800"
                  />
                </div>
                <div className="flex justify-between">
                  <label>Short Break (min)</label>
                  <input
                    type="number"
                    min={1}
                    value={timerSettings.shortBreak}
                    onChange={e => handleDurationChange('shortBreak', Number(e.target.value) || 1)}
                    className="w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800"
                  />
                </div>
                <div className="flex justify-between">
                  <label>Long Break (min)</label>
                  <input
                    type="number"
                    min={1}
                    value={timerSettings.longBreak}
                    onChange={e => handleDurationChange('longBreak', Number(e.target.value) || 1)}
                    className="w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800"
                  />
                </div>
                <div className="flex justify-between">
                  <label>Sessions before long break</label>
                  <input
                    type="number"
                    min={1}
                    value={timerSettings.sessionsBeforeLongBreak}
                    onChange={e =>
                      handleDurationChange('sessionsBeforeLongBreak', Number(e.target.value) || 1)
                    }
                    className="w-16 text-right rounded border px-2 py-1 bg-white dark:bg-slate-800"
                  />
                </div>
              </div>
            )}
            <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-300">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={timerSettings.autoStartFocus}
                  onChange={toggleAutoStartFocus}
                  className="mr-2"
                />
                Auto-start focus
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={timerSettings.autoStartBreaks}
                  onChange={toggleAutoStartBreaks}
                  className="mr-2"
                />
                Auto-start breaks
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={timerSettings.soundEnabled}
                  onChange={toggleSound}
                  className="mr-2"
                />
                Sound alerts
              </label>
            </div>
          </div>
          {/* Shortcut Hints Column */}
          <div className="flex flex-col gap-3">
            {shortcutHints.map(hint => (
              <article
                key={hint.shortcut}
                className="flex flex-col gap-1 rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-50"
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
    </div>
  )
}
