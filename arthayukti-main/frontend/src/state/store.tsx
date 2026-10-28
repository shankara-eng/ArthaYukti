import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import { fromPaise, toPaise } from '../lib/money'
import type { Expense, FixOption, Goal, IncomeStream, Plan, SampleDetail } from '../api/types'
import { copy } from '../i18n/copy'
import type { Language } from '../lib/months'
import { blankPlan, hasGoals, MAX_GOALS, newGoal } from '../lib/blank'
import { addMonths } from '../lib/months'
import { currentOrder } from '../lib/tradeoffs'
import { ownScenario, scenarioFor, withFix, type Choice } from '../lib/scenarios'
import { useAuth } from './useAuth'
import { StoreContext, type AccountState, type Store } from './useStore'
import { useRemote } from './useRemote'

const LANGUAGE_KEY = 'arthayukti.language'
const EXAMPLE_ID = 'household'
const EDIT_DELAY_MS = 200


function readLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === 'hi' ? 'hi' : 'en'
  } catch {
    return 'en'
  }
}

/** A scheduled line keeps its entered amount in step with the monthly figure typed elsewhere; a plain line just takes it. */
function withMonthly(expense: Expense, monthly: string): Expense {
  if (!expense.start_month) return { ...expense, monthly }
  const months = expense.frequency === 'yearly' ? 12n : expense.frequency === 'quarterly' ? 3n : 1n
  return { ...expense, monthly, amount: fromPaise(toPaise(monthly) * months) }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readLanguage)
  const [sample, setSample] = useState<SampleDetail | null>(null)
  const [sampleError, setSampleError] = useState<string | null>(null)
  const [exampleLoading, setExampleLoading] = useState(false)
  const [source, setSource] = useState<'own' | 'example' | null>(null)
  const [shockAmount, setShockAmount] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [choice, setChoiceState] = useState<Choice>('normal')
  const [fix, setFix] = useState<FixOption | null>(null)
  const [previousOrder, setPreviousOrder] = useState<string[] | null>(null)
  const auth = useAuth()
  const [accountState, setAccountState] = useState<AccountState>('idle')
  const [planId, setPlanId] = useState<string | null>(null)
  const [savedJson, setSavedJson] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [inflation, setInflationState] = useState<{ rate: string; isDefault: boolean } | null>(null)

  useEffect(() => {
    document.documentElement.lang = copy[language].htmlLang
  }, [language])

  const startOwn = useCallback(() => {
    setSample(null)
    setSampleError(null)
    setPlan(blankPlan())
    setSource('own')
    setChoiceState('normal')
    setFix(null)
    setShockAmount('')
    setPreviousOrder(null)
  }, [])

  /** Loads the labelled example only when someone asks for it. Returns whether it loaded. */
  const loadExample = useCallback(async () => {
    setExampleLoading(true)
    setSampleError(null)
    try {
      const loaded = await api.sample(EXAMPLE_ID)
      setSample(loaded)
      setPlan(loaded.plan)
      setSource('example')
      setChoiceState('normal')
      setFix(null)
      setPreviousOrder(null)
      return true
    } catch {
      setSampleError('offline')
      return false
    } finally {
      setExampleLoading(false)
    }
  }, [])

  const startOver = useCallback(() => {
    setSample(null)
    setPlan(null)
    setSource(null)
    setChoiceState('normal')
    setFix(null)
    setShockAmount('')
    setPreviousOrder(null)
  }, [])

  // A signed-in person's own saved plan replaces anything shown before sign-in.
  const [previousAuth, setPreviousAuth] = useState(auth.status)
  if (auth.status !== previousAuth) {
    setPreviousAuth(auth.status)
    if (auth.status !== 'authenticated') {
      setAccountState('idle')
      setPlanId(null)
      setSavedJson(null)
      setSaveError(null)
      setInflationState(null)
      startOver()
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || accountState !== 'idle') return
    const controller = new AbortController()
    ;(async () => {
      try {
        // The person's own default inflation, when it can be read; a failure here never blocks the account.
        const prefs = await api.preferences(controller.signal).catch(() => null)
        if (prefs) setInflationState({ rate: prefs.default_inflation_annual, isDefault: prefs.is_default })
        const summaries = await api.plans(controller.signal)
        if (summaries.length === 0) {
          // A new account starts with an empty plan on screen, not saved until the person enters something and saves.
          const empty = blankPlan(undefined, undefined, prefs?.default_inflation_annual)
          setSample(null)
          setPlan(empty)
          setSource('own')
          setSavedJson(JSON.stringify(empty))
          setAccountState('ready')
          return
        }
        const record = await api.plan(summaries[0].id, controller.signal)
        setSample(null)
        setPlan(record.plan)
        setSource('own')
        setPlanId(record.id)
        setSavedJson(JSON.stringify(record.plan))
        setAccountState('ready')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setAccountState('error')
      }
    })()
    return () => controller.abort()
  }, [auth.status, accountState])

  const reloadPlan = useCallback(async () => {
    if (!planId) return
    try {
      const record = await api.plan(planId)
      setPlan(record.plan)
      setSavedJson(JSON.stringify(record.plan))
    } catch {
      // The plan on screen stays as it was; the next sign-in reads the saved one.
    }
  }, [planId])

  const replacePlan = useCallback((next: Plan) => {
    setSample(null)
    setPlan(next)
    setSource('own')
    setChoiceState('normal')
    setFix(null)
  }, [])

  const savePlan = useCallback(async (next?: Plan) => {
    const toSave = next ?? plan
    if (!toSave || auth.status !== 'authenticated') return false
    setSaving(true)
    setSaveError(null)
    try {
      const record = planId ? await api.updatePlan(planId, toSave) : await api.createPlan(toSave)
      setPlanId(record.id)
      setSavedJson(JSON.stringify(record.plan))
      return true
    } catch {
      setSaveError('failed')
      return false
    } finally {
      setSaving(false)
    }
  }, [plan, planId, auth.status])

  const dirty = plan !== null && auth.status === 'authenticated' && JSON.stringify(plan) !== savedJson

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next)
    } catch {
      // the choice still works for this visit
    }
  }, [])

  const setChoice = useCallback((next: Choice) => {
    setChoiceState(next)
    setFix(null)
  }, [])

  const situation = useMemo(
    () =>
      sample
        ? scenarioFor(sample, choice)
        : plan
          ? ownScenario(plan, choice, shockAmount)
          : undefined,
    [sample, plan, choice, shockAmount],
  )
  const scenario = useMemo(() => withFix(situation, fix), [situation, fix])
  const activeChoice: Choice = choice !== 'normal' && !situation ? 'normal' : choice

  const ready = hasGoals(plan)
  const projectionKey = ready ? JSON.stringify([plan, scenario]) : null
  const projection = useRemote(
    projectionKey,
    (signal) => api.project(plan as Plan, scenario, signal),
    EDIT_DELAY_MS,
  )

  const baselineKey = ready && fix ? JSON.stringify([plan, situation]) : null
  const baseline = useRemote(
    baselineKey,
    (signal) => api.project(plan as Plan, situation, signal),
    EDIT_DELAY_MS,
  )

  const fixesKey = ready ? JSON.stringify([plan, situation]) : null
  const fixes = useRemote(
    fixesKey,
    (signal) => api.fixes(plan as Plan, situation, signal),
    EDIT_DELAY_MS,
  )

  const update = useCallback((change: (current: Plan) => Plan) => {
    setPlan((current) => (current ? change(current) : current))
    setFix(null)
  }, [])

  const setIncome = useCallback(
    (streamId: string, amount: string) =>
      update((current) => ({
        ...current,
        income_streams: current.income_streams.map((stream) => {
          if (stream.id !== streamId) return stream
          if (stream.start_year == null) return { ...stream, monthly_net: amount }
          // A scheduled stream keeps its own frequency: the monthly figure typed here becomes its amount.
          const months = stream.frequency === 'yearly' ? 12n : stream.frequency === 'quarterly' ? 3n : 1n
          return { ...stream, monthly_net: amount, amount: fromPaise(toPaise(amount) * months) }
        }),
      })),
    [update],
  )

  const setIncomeStreams = useCallback(
    (streams: IncomeStream[]) => update((current) => ({ ...current, income_streams: streams })),
    [update],
  )

  const setExpense = useCallback(
    (expenseId: string, amount: string) =>
      update((current) => ({
        ...current,
        expenses: (current.expenses ?? []).map((expense) =>
          expense.id === expenseId ? withMonthly(expense, amount) : expense,
        ),
      })),
    [update],
  )

  const setExpenseLines = useCallback(
    (lines: Expense[]) => update((current) => ({ ...current, expenses: lines })),
    [update],
  )

  const setExpenseGrowth = useCallback(
    (rate: string) =>
      update((current) => ({ ...current, assumptions: { ...current.assumptions, expense_growth_annual: rate } })),
    [update],
  )

  const setGoalAmount = useCallback(
    (goalId: string, amount: string) =>
      update((current) => ({
        ...current,
        goals: current.goals.map((goal) =>
          goal.id === goalId ? { ...goal, target_amount_today: amount } : goal,
        ),
      })),
    [update],
  )

  const setGoalDate = useCallback(
    (goalId: string, month: string) =>
      update((current) => ({
        ...current,
        goals: current.goals.map((goal) =>
          goal.id === goalId ? { ...goal, target_date: month } : goal,
        ),
      })),
    [update],
  )

  const moveGoal = useCallback(
    (goalId: string, direction: 'up' | 'down') =>
      update((current) => {
        const ordered = [...current.goals].sort((a, b) => a.priority - b.priority)
        const index = ordered.findIndex((goal) => goal.id === goalId)
        const swapWith = direction === 'up' ? index - 1 : index + 1
        if (index < 0 || swapWith < 0 || swapWith >= ordered.length) return current
        const first = ordered[index]
        const second = ordered[swapWith]
        return {
          ...current,
          goals: current.goals.map((goal) => {
            if (goal.id === first.id) return { ...goal, priority: second.priority }
            if (goal.id === second.id) return { ...goal, priority: first.priority }
            return goal
          }),
        }
      }),
    [update],
  )

  const rank = useCallback(
    (goalIds: string[]) =>
      update((current) => ({
        ...current,
        goals: current.goals.map((goal) => {
          const position = goalIds.indexOf(goal.id)
          return position < 0 ? goal : { ...goal, priority: position + 1 }
        }),
      })),
    [update],
  )

  const addGoal = useCallback(
    (type: Goal['type'], label: string, amount: string, targetDate: string) =>
      update((current) =>
        current.goals.length >= MAX_GOALS
          ? current
          : { ...current, goals: [...current.goals, newGoal(current, type, label, amount, targetDate)] },
      ),
    [update],
  )

  const removeGoal = useCallback(
    (goalId: string) =>
      update((current) => ({
        ...current,
        goals: current.goals.filter((goal) => goal.id !== goalId),
      })),
    [update],
  )

  const applyOrder = useCallback(
    (goalIds: string[]) => {
      if (plan) setPreviousOrder(currentOrder(plan))
      rank(goalIds)
    },
    [plan, rank],
  )

  const undoOrder = useCallback(() => {
    if (previousOrder) rank(previousOrder)
    setPreviousOrder(null)
  }, [previousOrder, rank])

  const setInflation = useCallback(async (rate: string) => {
    try {
      const saved = await api.updatePreferences(rate)
      setInflationState({ rate: saved.default_inflation_annual, isDefault: saved.is_default })
      return true
    } catch {
      return false
    }
  }, [])

  const applyInflationToPlan = useCallback(() => {
    if (!inflation) return
    update((current) => ({ ...current, assumptions: { ...current.assumptions, general_inflation_annual: inflation.rate } }))
  }, [inflation, update])

  const setEmergencyReserve = useCallback(
    (amount: string) =>
      update((current) => ({
        ...current,
        goals: current.goals.map((goal) => (goal.type === 'emergency_fund' ? { ...goal, current_savings: amount } : goal)),
      })),
    [update],
  )

  const addEmergencyGoal = useCallback(
    (targetAmount: string) =>
      update((current) =>
        current.goals.length >= MAX_GOALS || current.goals.some((goal) => goal.type === 'emergency_fund')
          ? current
          : { ...current, goals: [...current.goals, newGoal(current, 'emergency_fund', 'Emergency fund', targetAmount, addMonths(current.as_of, 12))] },
      ),
    [update],
  )

  const resetPlan = useCallback(() => {
    if (sample) setPlan(sample.plan)
    else if (source === 'own') setPlan(blankPlan())
    setPreviousOrder(null)
    setChoiceState('normal')
    setFix(null)
  }, [sample, source])

  const value: Store = {
    accountState: auth.status === 'authenticated' && accountState === 'idle' ? 'loading' : accountState,
    planId,
    dirty,
    saving,
    saveError,
    savePlan,
    reloadPlan,
    replacePlan,
    language,
    setLanguage,
    text: copy[language],
    sample,
    sampleError,
    exampleLoading,
    source,
    startOwn,
    loadExample,
    startOver,
    shockAmount,
    setShockAmount,
    addGoal,
    removeGoal,
    plan,
    choice,
    activeChoice,
    setChoice,
    fix,
    setFix,
    scenario,
    situation,
    projection,
    baseline,
    fixes,
    setIncome,
    setIncomeStreams,
    setExpense,
    setExpenseLines,
    setExpenseGrowth,
    setGoalAmount,
    setGoalDate,
    moveGoal,
    applyOrder,
    previousOrder,
    undoOrder,
    resetPlan,
    inflation,
    setInflation,
    applyInflationToPlan,
    setEmergencyReserve,
    addEmergencyGoal,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}
