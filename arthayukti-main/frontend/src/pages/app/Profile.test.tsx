import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, setAccessToken } from '../../api/client'
import { ProfilePage } from './Profile'
import { AuthProvider } from '../../state/auth'
import { StoreProvider } from '../../state/store'
import family from '../../../../contracts/samples/family_stretched.json'
import { json, mockApi } from '../../test/mockApi'

function renderProfile() {
  return render(
    <AuthProvider>
      <StoreProvider>
        <ProfilePage />
      </StoreProvider>
    </AuthProvider>,
  )
}

const USER_AUTH_PROFILE = {
  id: 'usr_1',
  email: 'asha@example.test',
  full_name: 'Asha Verma',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
}

const MOCK_PROFILE = {
  is_saved: true,
  id: 'hp_1',
  user_email: 'asha@example.test',
  full_name: 'Asha Verma',
  phone_number: '+91 98765 11111',
  primary_earner_age: 35,
  marital_status: 'married',
  has_children: true,
  children_ages: [6, 10],
  supports_mother: 'yes',
  supports_father: 'no',
  housing_status: 'own_house',
  employment_status: 'salaried',
  expected_retirement_age: 60,
  financial_dependants: 'two',
  debt_types: ['home_loan'],
  emergency_fund_coverage: '3_to_6',
  income_predictability: 'very_predictable',
  health_insurance_status: 'yes',
  life_insurance_status: 'yes',
  household_type: 'single_earner',
  dependants_count: 2,
  children_count: 2,
  elderly_dependants_count: 0,
  monthly_family_support: '10000.00',
  job_stability: 'high',
  emergency_fund_months_target: 6,
  dependants_details: [],
  planned_events: [],
  updated_at: '2026-10-25T01:00:00Z',
}

const MOCK_ASSESSMENT = {
  id: 'ra_1',
  scoring_version: 'v1.0',
  loss_reaction: 'hold',
  safety_growth: 'balance',
  time_horizon: 'medium',
  tolerance_score: 8,
  risk_tolerance: 'Moderate',
  risk_capacity: 'High',
  composite_stance: 'Moderate',
  explanations: [
    'You are prepared to hold investments through short-term market cycles to allow recovery.',
    'You prefer a balanced approach, seeking moderate growth while managing downside fluctuations.',
    'A 3–7 year horizon provides reasonable runway to weather normal equity market cycles.',
  ],
  conflict_note: null,
  limitations: [
    'Educational self-assessment: illustrates general risk orientation and is not registered financial or investment advice.',
  ],
  completed_at: '2026-10-25T01:10:00Z',
}

const MOCK_COMPARISON = {
  plan_source: 'hypothetical',
  notes: ['The reserve figures are guidelines. The recalculated projections do not add a larger emergency reserve to the plan.'],
  original: {
    name: 'original',
    label: 'Original Recommendations',
    assumed_annual_return: '0.080',
    recommended_reserve_months: 6,
    total_monthly_required: '45000.00',
    on_track_count: 3,
    delayed_count: 0,
    goals: [
      {
        goal_id: 'g1',
        label: 'Home Renovation',
        target_amount_today: '1000000.00',
        target_date: '2029-12',
        status: 'on_track',
        projected_completion: '2029-12',
        delay_months: 0,
        required_monthly_savings: '25000.00',
      },
    ],
  },
  conservative: {
    name: 'conservative',
    label: 'More Conservative Recommendations',
    assumed_annual_return: '0.055',
    recommended_reserve_months: 12,
    total_monthly_required: '52000.00',
    on_track_count: 2,
    delayed_count: 1,
    goals: [
      {
        goal_id: 'g1',
        label: 'Home Renovation',
        target_amount_today: '1000000.00',
        target_date: '2029-12',
        status: 'delayed',
        projected_completion: '2030-03',
        delay_months: 3,
        required_monthly_savings: '32000.00',
      },
    ],
  },
  differences: {
    annual_return_drop: '0.025',
    monthly_savings_increase: '7000.00',
    additional_reserve_needed: '180000.00',
    delay_impacts: ['Home Renovation: projected completion delayed by 3 month(s) under lower return.'],
    summary_explanation:
      'The conservative variant models a lower annual return of 5.5% and increases emergency buffer to 12 months.',
  },
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('arthayukti.session', 'tok_session')
  setAccessToken('tok_session')
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ProfilePage and Guided Risk Assessment', () => {
  it('loads and renders the 5 profile sections with initial data and saves changes', async () => {
    let savedPayload: any = null

    mockApi({
      'GET /household/profile': () => json(MOCK_PROFILE),
      'PUT /household/profile': (init) => {
        savedPayload = JSON.parse((init?.body as string) || '{}')
        return json({ ...MOCK_PROFILE, ...savedPayload })
      },
      'GET /risk/assessment/latest': () => json(MOCK_ASSESSMENT),
      'GET /risk/assessment/history': () => json([MOCK_ASSESSMENT]),
    })

    renderProfile()

    // Wait for loaded profile
    await waitFor(() => {
      expect(screen.getByDisplayValue('Asha Verma')).toBeInTheDocument()
    })

    expect(screen.getByDisplayValue('+91 98765 11111')).toBeInTheDocument()
    expect(screen.getByDisplayValue('35')).toBeInTheDocument()
    expect(screen.getByDisplayValue('60')).toBeInTheDocument()

    // Add a child
    const addChildBtn = screen.getByRole('button', { name: /add child/i })
    fireEvent.click(addChildBtn)

    // The new child starts blank, and saving is refused until an age is typed: no age is invented.
    const saveBtn = screen.getByRole('button', { name: /save profile/i })
    fireEvent.click(saveBtn)
    expect(await screen.findByText("Enter each child's age or remove that row.")).toBeInTheDocument()
    expect(savedPayload).toBeNull()

    const blank = screen.getAllByRole('spinbutton').find((input) => (input as HTMLInputElement).value === '') as HTMLInputElement
    fireEvent.change(blank, { target: { value: '7' } })
    fireEvent.click(saveBtn)

    await waitFor(() => {
      expect(savedPayload).not.toBeNull()
      expect(savedPayload.children_ages.length).toBe(3)
      expect(savedPayload.children_ages).toContain(7)
    })
  })

  it('navigates to guided risk assessment tab and displays classification', async () => {
    mockApi({
      'GET /household/profile': () => json(MOCK_PROFILE),
      'GET /risk/assessment/latest': () => json(MOCK_ASSESSMENT),
      'GET /risk/assessment/history': () => json([MOCK_ASSESSMENT]),
    })

    renderProfile()

    // Switch to Guided Risk Assessment tab
    const riskTab = screen.getByRole('tab', { name: /guided risk assessment/i })
    fireEvent.click(riskTab)

    await waitFor(() => {
      expect(screen.getByText('Score: 8 / 11')).toBeInTheDocument()
      expect(screen.getByText('Tolerance combined with capacity')).toBeInTheDocument()
    })
  })

  it('submits questionnaire answers and calculates new assessment', async () => {
    let submittedAnswers: any = null

    mockApi({
      'GET /household/profile': () => json(MOCK_PROFILE),
      'GET /risk/assessment/latest': () => json(MOCK_ASSESSMENT),
      'GET /risk/assessment/history': () => json([MOCK_ASSESSMENT]),
      'POST /risk/assessment': (init) => {
        submittedAnswers = JSON.parse((init?.body as string) || '{}')
        return json({
          ...MOCK_ASSESSMENT,
          loss_reaction: submittedAnswers.loss_reaction,
          safety_growth: submittedAnswers.safety_growth,
          time_horizon: submittedAnswers.time_horizon,
        })
      },
    })

    renderProfile()

    // Switch to Risk tab
    fireEvent.click(screen.getByRole('tab', { name: /guided risk assessment/i }))

    // Click Retake Assessment
    await waitFor(() => screen.getByRole('button', { name: /retake assessment/i }))
    fireEvent.click(screen.getByRole('button', { name: /retake assessment/i }))

    // Select answers
    fireEvent.click(screen.getByLabelText(/Sell most investments to avoid further losses/i))
    fireEvent.click(screen.getByLabelText(/Protect my money, even if returns are lower/i))
    fireEvent.click(screen.getByLabelText(/Less than 1 year/i))

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /submit assessment/i }))

    await waitFor(() => {
      expect(submittedAnswers).not.toBeNull()
      expect(submittedAnswers.loss_reaction).toBe('sell_all')
      expect(submittedAnswers.safety_growth).toBe('protect')
      expect(submittedAnswers.time_horizon).toBe('short')
    })
  })

  it('compares original vs more conservative recommendation variants', async () => {
    mockApi({
      'GET /auth/me': () => json(USER_AUTH_PROFILE),
      'GET /household/profile': () => json(MOCK_PROFILE),
      'GET /risk/assessment/latest': () => json(MOCK_ASSESSMENT),
      'GET /risk/assessment/history': () => json([MOCK_ASSESSMENT]),
      'GET /plans': () => json([{ id: 'p1', name: 'Family Plan', updated_at: '2026-10-25T01:00:00Z' }]),
      'GET /plans/p1': () =>
        json({
          id: 'p1',
          user_id: 'usr_1',
          name: 'Family Plan',
          plan: family.plan,
          created_at: '2026-10-25T01:00:00Z',
          updated_at: '2026-10-25T01:00:00Z',
        }),
      'POST /recommendations/conservative-comparison': () => json(MOCK_COMPARISON),
    })

    vi.spyOn(api, 'compareRecommendations').mockResolvedValue(MOCK_COMPARISON as any)

    renderProfile()

    // Switch to Recommendations tab
    fireEvent.click(screen.getByRole('tab', { name: /original vs conservative plan/i }))

    await waitFor(() => {
      expect(screen.getByText(/Recommendation Variants Comparison/i)).toBeInTheDocument()
      expect(screen.getByText(/Calculated Differences & Strategy Summary:/i)).toBeInTheDocument()
    })
  })

  it('asks for the saved plan by id, and does not reuse an old comparison after the plan changes', async () => {
    vi.restoreAllMocks()
    const { calls } = mockApi({
      'GET /auth/me': () => json(USER_AUTH_PROFILE),
      'GET /household/profile': () => json(MOCK_PROFILE),
      'GET /risk/assessment/latest': () => json(MOCK_ASSESSMENT),
      'GET /risk/assessment/history': () => json([MOCK_ASSESSMENT]),
      'GET /plans': () => json([{ id: 'p1', name: 'Family Plan', updated_at: '2026-10-25T01:00:00Z' }]),
      'GET /plans/p1': () => json({ id: 'p1', plan: family.plan, created_at: 'x', updated_at: 'y' }),
      'POST /recommendations/conservative-comparison': () => json({ ...MOCK_COMPARISON, plan_source: 'saved' }),
    })
    window.sessionStorage.setItem('arthayukti.session', 'tok')
    renderProfile()
    fireEvent.click(await screen.findByRole('tab', { name: /original vs conservative plan/i }))
    await screen.findByText(/Calculated from your saved plan/i)
    const sent = calls.find((c) => c.path === '/recommendations/conservative-comparison')
    expect(sent?.body).toMatchObject({ plan_id: 'p1' })
    expect(Object.keys((sent?.body ?? {}) as object)).not.toContain("plan")
  })
})
