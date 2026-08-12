import React, { Dispatch, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react'

// Keys for persisted storage
const TIMER_SETTINGS_KEY = 'pomodoro_timer_settings'

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

type StorageValidator<T> = (value: unknown) => value is T

type DurationFieldKey = 'focus' | 'shortBreak' | 'longBreak' | 'sessionsBeforeLongBreak'
type ToggleFieldKey = 'autoStartFocus' | 'autoStartBreaks' | 'soundEnabled'

type PresetKey = 'classic' | 'deepWork' | 'custom'
type DurationPreset = Pick<TimerSettings, DurationFieldKey>

type ShortcutHint = {
  shortcut: string
  description: string
}

// Preset duration values
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

// Preset labels/descriptions
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

// Default timer settings
const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  sessionsBeforeLongBreak: 4,
  autoStartFocus: false,
  autoStartBreaks: false,
  soundEnabled: true,
}

// Keyboard shortcut hints
const shortcutHints: ShortcutHint[] = [
  { shortcut: 'Space', description: 'Start or pause the currently selected timer' },
  { shortcut: 'R', description: 'Reset the current session timer' },
  { shortcut: 'S', description: 'Skip ahead to the next session' },
]

// Validate that a parsed value is TimerSettings
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

// Hook: detect prefers-reduced-motion
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

// Hook: persisted state to localStorage with validator
const usePersistedState = <T,>(
  key: string,
  fallback: () => T,
  validator: StorageValidator<T>,
): [T, Dispatch<SetStateAction<T>>] => {
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback()
    try {
      const stored = window.localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (validator(parsed)) return parsed
      }
    } catch {
      // ignore
    }
    return fallback()
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // ignore
    }
  }, [key, state])

  return [state, setState]
}

export default function App() {
  const prefersReducedMotion = usePrefersReducedMotion()
  const focusRingClasses = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500'
  const reducedMotionAttribute = prefersReducedMotion ? 'motion-reduce:transition-none motion-reduce:transform-none' : ''

  const rootClasses = 'min-h-screen px-6 py-10 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50'

  // Persisted settings state
  const [timerSettings, setTimerSettings] = usePersistedState<TimerSettings>(
    TIMER_SETTINGS_KEY,
    () => DEFAULT_TIMER_SETTINGS,
    isTimerSettings,
  )

  // Determine which preset matches current durations
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

  // Handlers for preset and custom durations
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

  return (
    <div className={rootClasses}>
      <section
        className={`rounded-3xl border border-slate-200 bg-white/80 dark:border-slate-700 dark:bg-slate-900/70 px-5 py-6 shadow-lg shadow-slate-400/10 ${reducedMotionAttribute}`}
        aria-label="Pomodoro settings and shortcut list"
      >
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
            <fieldset className="space-y-3" aria-label="Preset timer styles" role="group">
              <legend className="text-xs uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500 mb-2">
                Preset style
              </legend>
              <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Preset timer options">
                {Object.entries(PRESET_CONFIG).map(([key, cfg]) => (
                  <label
                    key={key}
                    htmlFor={`preset-${key}`}
                    className={`flex items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm font-semibold text-slate-700 transition-colors focus-within:border-sky-500 focus-within:ring-0 dark:text-slate-300 ${focusRingClasses}`}
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
          {/* Shortcut Hints Column */}
          <div className="flex flex-col gap-3">
            {shortcutHints.map(hint => (
              <article
                key={hint.shortcut}
                className="flex flex-col gap-1 rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3 text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-50"
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
    </div>
  )
}
