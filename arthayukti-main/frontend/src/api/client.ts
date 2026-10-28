import type {
  SpendingCategory,
  SpendingChangeInput,
  SpendingInflationInput,
  SpendingPlan,
  SpendingPlanInput,
  SpendingSettings,
  SpendingTrajectory,
  AccountCreateRequest,
  AccountResponse,
  AuthResponse,
  CompareResult,
  CSVImportResponse,
  ExportResponse,
  FixResult,
  InsuranceDashboardSummary,
  IntentSuggestions,
  InsuranceReminderItem,
  InvestmentCreateRequest,
  InvestmentResponse,
  LiabilityCreateRequest,
  LiabilityResponse,
  MessageResponse,
  NetWorthResponse,
  Plan,
  PlanRecord,
  PlanSummary,
  PolicyCreateRequest,
  PolicyResponse,
  ProjectionResult,
  SampleDetail,
  Scenario,
  TradeoffResult,
  TransactionResponse,
  UserProfile,
  AIConsultResponse,
  EscalationCreateRequest,
  IncomeProjectionResponse,
  AgreementDraft,
  AgreementOut,
  AgreementSummary,
  RecoveryEvaluation,
  RecoveryInput,
  RecoverySearchRequest,
  RecoverySearchResponse,
  ReviewResult,
  CalculatorCompareEntry,
  CalculatorCompareResponse,
  CalculatorConfig,
  CalculatorResult,
  CalculatorScenario,
  CalculatorScenarioSummary,
  MaturityDecisionNeeded,
  EscalationHistoryResponse,
  EscalationResponse,
  MarketQuoteResponse,
  ProcessEscalationEventRequest,
  RescueRequest,
  RescueResponse,
  TransactionCreateRequest,
  HouseholdProfileResponse,
  HouseholdProfileUpdateRequest,
  RiskCapacityIndicatorResponse,
  RiskAssessmentResponse,
  RiskAssessmentSubmitRequest,
  RiskAssessmentHistoryItem,
  ConservativeComparisonResponse,
  AIExplanation,
  DebtTrajectory,
  ApplyLedgerResult,
  ExpenditureProjection,
  HoldingPosition,
  HoldingTransaction,
  HoldingTransactionCreate,
  AmortizationRequest,
  AmortizationResponse,
  EmergencyAnalysis,
  Preferences,
  StrategyComparisonRequest,
  StrategyComparisonResponse,
  AIStatus,
  SituationDraft,
  TrajectoryRequest,
  TrajectoryResult,
  AdvisorAnalysis,
  AdvisorChange,
  AdvisorChat,
  AdvisorCompare,
  AdvisorDecision,
  AdvisorDecisionRequest,
  AdvisorScenario,
  PortfolioResponse,
  PortfolioHistory,
  PortfolioSearch,
  PortfolioHoldingCreate,
  PortfolioHoldingUpdate,
  PortfolioHoldingSaved,
} from './types'

// The hosted API's first address (arthayukti-api.onrender.com) belongs to a service that no longer answers; the live one
// is arthayukti-api-y7ah.onrender.com. A site still built with the old address is pointed at the live one, so it never
// calls a dead host. Anywhere else the setting is used as given.
const RETIRED_API_HOST = /^https?:\/\/arthayukti-api\.onrender\.com\/?$/
const LIVE_API_HOST = 'https://arthayukti-api-y7ah.onrender.com'
const configured = import.meta.env.VITE_API_BASE_URL ?? ''
const BASE = RETIRED_API_HOST.test(configured) ? LIVE_API_HOST : configured.replace(/\/$/, '')
const PREFIX = `${BASE}/api/v1`

export class ApiFailure extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 0) {
    super(message)
    this.code = code
    this.status = status
  }
}

// The access token is held here, in memory. The session store may also keep it for the life of
// the browser tab so a refresh does not sign the person out.
let accessToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

/** Called when a signed-in request is refused with 401, so the app can end the session. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers)
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  let response: Response
  try {
    response = await fetch(`${PREFIX}${path}`, { ...init, headers })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiFailure('offline', 'The service is not reachable.')
  }
  if (!response.ok) {
    let code = 'http_error'
    let message = `Request failed (${response.status}).`
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // keep the generic message
    }
    if (response.status === 401 && accessToken && code === 'unauthorized') onUnauthorized?.()
    throw new ApiFailure(code, message, response.status)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function send<T>(method: string, path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) => send<T>('POST', path, body, signal)
const put = <T>(path: string, body: unknown, signal?: AbortSignal) => send<T>('PUT', path, body, signal)
const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal })
const remove = <T = void>(path: string) => request<T>(path, { method: 'DELETE' })

const incomeBody = (source: { planId: string } | { plan: Plan }, horizonMonths: number) =>
  'planId' in source
    ? { plan_id: source.planId, horizon_months: horizonMonths }
    : { plan: source.plan, horizon_months: horizonMonths }

export const api = {
  health: (signal?: AbortSignal) => get<{ status: string }>('/health', signal),
  sample: (id: string, signal?: AbortSignal) => get<SampleDetail>(`/samples/${id}`, signal),
  project: (plan: Plan, scenario: Scenario | undefined, signal?: AbortSignal) =>
    post<ProjectionResult>('/projections', { plan, scenario, include_monthly: true }, signal),
  fixes: (plan: Plan, scenario: Scenario | undefined, signal?: AbortSignal) =>
    post<FixResult>('/fixes', { plan, scenario }, signal),
  compare: (plan: Plan, scenarios: Scenario[], signal?: AbortSignal) =>
    post<CompareResult>('/compare', { plan, scenarios }, signal),
  tradeoffs: (plan: Plan, scenario: Scenario | undefined, signal?: AbortSignal) =>
    post<TradeoffResult>('/tradeoffs', { plan, scenario }, signal),

  // Accounts and sessions
  signup: (email: string, password: string, fullName: string) =>
    post<AuthResponse>('/auth/signup', { email, password, full_name: fullName }),
  login: (email: string, password: string) => post<AuthResponse>('/auth/login', { email, password }),
  me: (signal?: AbortSignal) => get<UserProfile>('/auth/me', signal),
  logout: () => post<MessageResponse>('/auth/logout', {}),
  requestPasswordReset: (email: string) =>
    post<MessageResponse>('/auth/password-reset/request', { email }),
  resetPassword: (token: string, newPassword: string, signal?: AbortSignal) =>
    post<MessageResponse>('/auth/password-reset/confirm', { token, new_password: newPassword }, signal),
  exportData: (signal?: AbortSignal) => get<ExportResponse>('/auth/export-data', signal),
  deleteAccount: () => request<MessageResponse>('/auth/delete-account', { method: 'DELETE' }),

  // Saved plans
  plans: (signal?: AbortSignal) => get<PlanSummary[]>('/plans', signal),
  plan: (id: string, signal?: AbortSignal) => get<PlanRecord>(`/plans/${id}`, signal),
  createPlan: (plan: Plan) => post<PlanRecord>('/plans', plan),
  updatePlan: (id: string, plan: Plan) => send<PlanRecord>('PUT', `/plans/${id}`, plan),

  // Financial records
  netWorth: (signal?: AbortSignal) => get<NetWorthResponse>('/financials/net-worth', signal),
  accounts: (signal?: AbortSignal) => get<AccountResponse[]>('/financials/accounts', signal),
  createAccount: (body: AccountCreateRequest) => post<AccountResponse>('/financials/accounts', body),
  investments: (signal?: AbortSignal) => get<InvestmentResponse[]>('/financials/investments', signal),
  createInvestment: (body: InvestmentCreateRequest) =>
    post<InvestmentResponse>('/financials/investments', body),
  liabilities: (signal?: AbortSignal) => get<LiabilityResponse[]>('/financials/liabilities', signal),
  createLiability: (body: LiabilityCreateRequest) =>
    post<LiabilityResponse>('/financials/liabilities', body),
  transactions: (signal?: AbortSignal) => get<TransactionResponse[]>('/financials/transactions', signal),
  importTransactions: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<CSVImportResponse>('/financials/transactions/import', { method: 'POST', body: form })
  },

  parseIntent: (prompt: string) => post<IntentSuggestions>('/ai/parse-intent', { prompt }),
  consult: (plan: Plan, scenario: Scenario | undefined, prompt: string) =>
    post<AIConsultResponse>('/ai/consult', { plan, scenario, user_prompt: prompt }),
  rescue: (body: RescueRequest) => post<RescueResponse>('/rescue/analyze', body),
  incomeProjection: (source: { planId: string } | { plan: Plan }, horizonMonths: number, signal?: AbortSignal) =>
    post<IncomeProjectionResponse>('/income/projection', incomeBody(source, horizonMonths), signal),
  incomeProjectionCsv: async (source: { planId: string } | { plan: Plan }, horizonMonths: number): Promise<Blob> => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
      response = await fetch(`${PREFIX}/income/projection/csv`, { method: 'POST', headers, body: JSON.stringify(incomeBody(source, horizonMonths)) })
    } catch {
      throw new ApiFailure('offline', 'The service is not reachable.')
    }
    if (!response.ok) throw new ApiFailure('http_error', `Export failed (${response.status}).`, response.status)
    return response.blob()
  },
  expenditureProjection: (source: { planId: string } | { plan: Plan }, horizonMonths: number, signal?: AbortSignal) =>
    post<ExpenditureProjection>('/expenditure/projection', incomeBody(source, horizonMonths), signal),
  expenditureProjectionCsv: async (source: { planId: string } | { plan: Plan }, horizonMonths: number): Promise<Blob> => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
      response = await fetch(`${PREFIX}/expenditure/projection/csv`, { method: 'POST', headers, body: JSON.stringify(incomeBody(source, horizonMonths)) })
    } catch {
      throw new ApiFailure('offline', 'The service is not reachable.')
    }
    if (!response.ok) throw new ApiFailure('http_error', `Export failed (${response.status}).`, response.status)
    return response.blob()
  },
  // Expenditure plans (stored per person; every figure on the page comes from the trajectory)
  spendingPlans: (signal?: AbortSignal) => get<SpendingPlan[]>('/expenditure/plans', signal),
  spendingCreatePlan: (body: SpendingPlanInput) => post<SpendingPlan>('/expenditure/plans', body),
  spendingUpdatePlan: (id: string, body: SpendingPlanInput) => put<SpendingPlan>(`/expenditure/plans/${id}`, body),
  spendingDeletePlan: (id: string) => remove(`/expenditure/plans/${id}`),
  spendingStopPlan: (id: string) => post<SpendingPlan>(`/expenditure/plans/${id}/stop`, {}),
  spendingReactivatePlan: (id: string) => post<SpendingPlan>(`/expenditure/plans/${id}/reactivate`, {}),
  spendingAddChange: (id: string, body: SpendingChangeInput) => post<SpendingPlan>(`/expenditure/plans/${id}/changes`, body),
  spendingRemoveChange: (id: string, changeId: string) => remove<SpendingPlan>(`/expenditure/plans/${id}/changes/${changeId}`),
  spendingCategories: (signal?: AbortSignal) => get<SpendingCategory[]>('/expenditure/categories', signal),
  spendingCreateCategory: (name: string) => post<SpendingCategory>('/expenditure/categories', { name }),
  spendingUpdateCategory: (id: string, body: { name?: string; archived?: boolean }) => put<SpendingCategory>(`/expenditure/categories/${id}`, body),
  spendingHideCategory: (key: string, hidden: boolean) => put<SpendingCategory>(`/expenditure/categories/system/${key}`, { hidden }),
  spendingDeleteCategory: (id: string, reassignTo?: string) =>
    remove(`/expenditure/categories/${id}${reassignTo ? `?reassign_to=${encodeURIComponent(reassignTo)}` : ''}`),
  spendingApplyToPlan: (plan: Plan, months = 240) => post<Plan>('/expenditure/apply-to-plan', { plan, months }),
  spendingSettings: (signal?: AbortSignal) => get<SpendingSettings>('/expenditure/settings', signal),
  spendingSetHorizon: (years: number) => put<SpendingSettings>('/expenditure/settings', { horizon_years: years }),
  spendingSetInflation: (body: SpendingInflationInput) => post<SpendingSettings>('/expenditure/settings/inflation', body),
  spendingRemoveRateChange: (id: string) => remove<SpendingSettings>(`/expenditure/settings/inflation/${id}`),
  spendingTrajectory: (signal?: AbortSignal) => get<SpendingTrajectory>('/expenditure/trajectory', signal),
  spendingTrajectoryCsv: async (granularity: 'yearly' | 'monthly' = 'yearly'): Promise<Blob> => {
    const headers = new Headers()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
      response = await fetch(`${PREFIX}/expenditure/trajectory.csv?granularity=${granularity}`, { headers })
    } catch {
      throw new ApiFailure('offline', 'The service is not reachable.')
    }
    if (!response.ok) throw new ApiFailure('http_error', `Export failed (${response.status}).`, response.status)
    return response.blob()
  },
  debtTrajectory: (signal?: AbortSignal) => get<DebtTrajectory>('/debt/trajectory', signal),
  // Stock portfolio (prices are fetched by the server; the browser never calls the price service)
  portfolio: (signal?: AbortSignal) => get<PortfolioResponse>('/portfolio', signal),
  portfolioRefresh: (signal?: AbortSignal) => post<PortfolioResponse>('/portfolio/refresh', {}, signal),
  portfolioSearch: (query: string, signal?: AbortSignal) => get<PortfolioSearch>(`/portfolio/search?q=${encodeURIComponent(query)}`, signal),
  portfolioHistory: (range: string, signal?: AbortSignal) => get<PortfolioHistory>(`/portfolio/history?range=${encodeURIComponent(range)}`, signal),
  portfolioAdd: (body: PortfolioHoldingCreate) => post<PortfolioHoldingSaved>('/portfolio/holdings', body),
  portfolioEdit: (id: string, body: PortfolioHoldingUpdate) => send<PortfolioHoldingSaved>('PUT', `/portfolio/holdings/${id}`, body),
  portfolioDelete: (id: string) => request<void>(`/portfolio/holdings/${id}`, { method: 'DELETE' }),
  // Financial Trajectory
  trajectory: (body: TrajectoryRequest, signal?: AbortSignal) => post<TrajectoryResult>('/trajectory/project', body, signal),
  // AI Financial Advisor (every figure is calculated by the server; the key never reaches the browser)
  advisorAnalyze: (body: { plan_id?: string; language: 'en' | 'hi'; use_ai: boolean }) => post<AdvisorAnalysis>('/advisor/analyze', body),
  advisorLatest: (signal?: AbortSignal) => get<AdvisorAnalysis>('/advisor/analyses/latest', signal),
  advisorAnalysis: (id: string, signal?: AbortSignal) => get<AdvisorAnalysis>(`/advisor/analyses/${id}`, signal),
  advisorScenario: (analysisId: string, change: AdvisorChange) => post<AdvisorScenario>('/advisor/scenarios', { analysis_id: analysisId, change }),
  advisorCompare: (analysisId: string, scenarioIds: string[]) => post<AdvisorCompare>('/advisor/compare', { analysis_id: analysisId, scenario_ids: scenarioIds }),
  advisorDecision: (analysisId: string, recommendationId: string, body: AdvisorDecisionRequest) =>
    post<AdvisorDecision>(`/advisor/recommendations/${encodeURIComponent(recommendationId)}/decision?analysis_id=${encodeURIComponent(analysisId)}`, body),
  advisorChat: (analysisId: string, message: string, language: 'en' | 'hi') => post<AdvisorChat>('/advisor/chat', { analysis_id: analysisId, message, language }),
  // Holdings ledger
  holdingTransactions: (holdingId: string, signal?: AbortSignal) =>
    get<HoldingTransaction[]>(`/financials/investments/${holdingId}/transactions`, signal),
  addHoldingTransaction: (holdingId: string, body: HoldingTransactionCreate) =>
    post<HoldingTransaction>(`/financials/investments/${holdingId}/transactions`, body),
  deleteHoldingTransaction: (holdingId: string, transactionId: string) =>
    request<void>(`/financials/investments/${holdingId}/transactions/${transactionId}`, { method: 'DELETE' }),
  holdingPosition: (holdingId: string, signal?: AbortSignal) => get<HoldingPosition>(`/financials/investments/${holdingId}/position`, signal),
  applyHoldingLedger: (holdingId: string) => post<ApplyLedgerResult>(`/financials/investments/${holdingId}/apply-ledger`, {}),
  holdingLedgerCsv: async (holdingId: string): Promise<Blob> => {
    const headers = new Headers()
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
      response = await fetch(`${PREFIX}/financials/investments/${holdingId}/ledger.csv`, { headers })
    } catch {
      throw new ApiFailure('offline', 'The service is not reachable.')
    }
    if (!response.ok) throw new ApiFailure('http_error', `Export failed (${response.status}).`, response.status)
    return response.blob()
  },
  // Settings that follow the person
  preferences: (signal?: AbortSignal) => get<Preferences>('/auth/preferences', signal),
  updatePreferences: (defaultInflationAnnual: string) =>
    send<Preferences>('PUT', '/auth/preferences', { default_inflation_annual: defaultInflationAnnual }),
  // Emergency fund, debts
  // A plan with no goals is not a valid plan yet, so only its spending is sent and the server works out the essentials.
  emergencyAnalyze: (plan: Plan, targetMonths: number | null, signal?: AbortSignal) =>
    post<EmergencyAnalysis>(
      '/emergency-fund/analyze',
      plan.goals.length > 0
        ? { plan, target_months: targetMonths }
        : { expenses: plan.expenses ?? [], commitments: plan.commitments ?? [], as_of: plan.as_of, target_months: targetMonths },
      signal,
    ),
  debtAmortize: (body: AmortizationRequest, signal?: AbortSignal) => post<AmortizationResponse>('/debt/amortize', body, signal),
  debtCompare: (body: StrategyComparisonRequest, signal?: AbortSignal) =>
    post<StrategyComparisonResponse>('/debt/compare-strategies', body, signal),
  // AI help (the key lives only on the server)
  aiStatus: (signal?: AbortSignal) => get<AIStatus>('/ai/status', signal),
  aiSituationDraft: (text: string, currentMonth: string, signal?: AbortSignal) =>
    post<SituationDraft>('/ai/situation-draft', { text, current_month: currentMonth }, signal),
  aiExplainRecovery: (input: RecoveryInput, language: 'en' | 'hi', signal?: AbortSignal) =>
    post<AIExplanation>('/ai/explain-recovery', { input, language }, signal),
  // Plan B
  recoverySearch: (body: RecoverySearchRequest, signal?: AbortSignal) =>
    post<RecoverySearchResponse>('/recovery/search', body, signal),
  recoveryEvaluate: (body: RecoveryInput, signal?: AbortSignal) =>
    post<RecoveryEvaluation>('/recovery/evaluate', body, signal),
  agreements: (signal?: AbortSignal) => get<AgreementSummary[]>('/recovery/agreements', signal),
  agreement: (id: string, signal?: AbortSignal) => get<AgreementOut>(`/recovery/agreements/${id}`, signal),
  agreementVersion: (id: string, version: number, signal?: AbortSignal) =>
    get<AgreementOut>(`/recovery/agreements/${id}/versions/${version}`, signal),
  createAgreement: (name: string, draft: AgreementDraft, clientToken: string) =>
    post<AgreementOut>('/recovery/agreements', { name, draft, client_token: clientToken }),
  reviseAgreement: (id: string, draft: AgreementDraft, expectedVersion: number, changeNote: string) =>
    send<AgreementOut>('PUT', `/recovery/agreements/${id}`, { draft, expected_version: expectedVersion, change_note: changeNote }),
  reviewAgreement: (id: string, body: { as_of_month: string; liquid_cash: string; monthly_income: string; recovery_confirmed: boolean }) =>
    post<ReviewResult>(`/recovery/agreements/${id}/review`, body),
  deleteAgreement: (id: string) => request<void>(`/recovery/agreements/${id}`, { method: 'DELETE' }),

  // Investment calculators
  calcRun: (config: CalculatorConfig, signal?: AbortSignal) => post<CalculatorResult>('/calculators/run', config, signal),
  calcMaturityCheck: (config: CalculatorConfig, signal?: AbortSignal) =>
    post<MaturityDecisionNeeded[]>('/calculators/maturity-check', config, signal),
  calcExport: async (config: CalculatorConfig): Promise<Blob> => {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
    let response: Response
    try {
      response = await fetch(`${PREFIX}/calculators/export`, { method: 'POST', headers, body: JSON.stringify(config) })
    } catch {
      throw new ApiFailure('offline', 'The service is not reachable.')
    }
    if (!response.ok) throw new ApiFailure('http_error', `Export failed (${response.status}).`, response.status)
    return response.blob()
  },
  calcCompare: (entries: CalculatorCompareEntry[], commonDate: string | null, signal?: AbortSignal) =>
    post<CalculatorCompareResponse>('/calculators/compare', { entries, ...(commonDate ? { common_date: commonDate } : {}) }, signal),
  calcScenarios: (signal?: AbortSignal) => get<CalculatorScenarioSummary[]>('/calculators/scenarios', signal),
  calcScenario: (id: string, signal?: AbortSignal) => get<CalculatorScenario>(`/calculators/scenarios/${id}`, signal),
  calcCreateScenario: (name: string, config: CalculatorConfig) => post<CalculatorScenario>('/calculators/scenarios', { name, config }),
  calcUpdateScenario: (id: string, name: string, config: CalculatorConfig) =>
    send<CalculatorScenario>('PUT', `/calculators/scenarios/${id}`, { name, config }),
  calcDeleteScenario: (id: string) => request<void>(`/calculators/scenarios/${id}`, { method: 'DELETE' }),
  marketQuote: (symbol: string, signal?: AbortSignal) =>
    get<MarketQuoteResponse>(`/market/quotes/${encodeURIComponent(symbol)}`, signal),
  createTransaction: (body: TransactionCreateRequest) => post<TransactionResponse>('/financials/transactions', body),

  // Insurance
  policies: (signal?: AbortSignal) => get<PolicyResponse[]>('/insurance/policies', signal),
  createPolicy: (body: PolicyCreateRequest) => post<PolicyResponse>('/insurance/policies', body),
  insuranceDashboard: (signal?: AbortSignal) =>
    get<InsuranceDashboardSummary>('/insurance/dashboard', signal),
  reminders: (signal?: AbortSignal) => get<InsuranceReminderItem[]>('/insurance/reminders', signal),
  acknowledgeReminder: (id: string) => post<{ status: string }>(`/insurance/reminders/${id}/ack`, {}),
  policy: (id: string, signal?: AbortSignal) => get<PolicyResponse>(`/insurance/policies/${id}`, signal),
  createEscalation: (body: EscalationCreateRequest) => post<EscalationResponse>('/insurance/escalations', body),
  escalation: (id: string, signal?: AbortSignal) => get<EscalationResponse>(`/insurance/escalations/${id}`, signal),
  escalationHistory: (id: string, signal?: AbortSignal) =>
    get<EscalationHistoryResponse[]>(`/insurance/escalations/${id}/history`, signal),
  processEscalation: (id: string, body: ProcessEscalationEventRequest) =>
    post<EscalationHistoryResponse>(`/insurance/escalations/${id}/process-event`, body),

  // Household Profile & Life Context
  getHouseholdProfile: (signal?: AbortSignal) => get<HouseholdProfileResponse>('/household/profile', signal),
  updateHouseholdProfile: (body: HouseholdProfileUpdateRequest) =>
    send<HouseholdProfileResponse>('PUT', '/household/profile', body),
  getRiskCapacity: (signal?: AbortSignal) =>
    get<RiskCapacityIndicatorResponse>('/household/risk-capacity', signal),

  // Guided Risk Assessment
  submitRiskAssessment: (body: RiskAssessmentSubmitRequest) =>
    post<RiskAssessmentResponse>('/risk/assessment', body),
  getLatestRiskAssessment: (signal?: AbortSignal) =>
    get<RiskAssessmentResponse>('/risk/assessment/latest', signal),
  getRiskAssessmentHistory: (signal?: AbortSignal) =>
    get<RiskAssessmentHistoryItem[]>('/risk/assessment/history', signal),

  // Recommendations: Original vs More Conservative
  compareRecommendations: (source: { planId: string } | { plan: Plan }, scenario?: Scenario, signal?: AbortSignal) =>
    post<ConservativeComparisonResponse>(
      '/recommendations/conservative-comparison',
      'planId' in source ? { plan_id: source.planId, scenario } : { plan: source.plan, scenario },
      signal,
    ),
}

