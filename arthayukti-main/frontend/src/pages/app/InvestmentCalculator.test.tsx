import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InvestmentCalculatorPage } from './InvestmentCalculatorPage'
import { AuthProvider } from '../../state/auth'
import { StoreProvider } from '../../state/store'

const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <AuthProvider>
      <StoreProvider>{ui}</StoreProvider>
    </AuthProvider>,
  )
}

describe('InvestmentCalculatorPage (Calculator Tab)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('renders dedicated heading, description, and initial unconfigured Calculator 1 on first visit', () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    expect(screen.getByRole('heading', { level: 1, name: 'Investment Calculator' })).toBeInTheDocument()
    expect(screen.getByText(/Model, calculate, and compare your/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calculator 1' })).toBeInTheDocument()
    expect(screen.getByText('Choose Calculator Type')).toBeInTheDocument()
    expect(screen.getByText('Lump-Sum Calculator')).toBeInTheDocument()
    expect(screen.getByText('SIP Calculator')).toBeInTheDocument()
  })

  it('configures and calculates a Lump-Sum investment with results, donut chart, and schedule', async () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    // Select Lump-Sum
    fireEvent.click(screen.getByText('Configure Lump-Sum →'))

    // Verify inputs appear
    expect(screen.getByLabelText(/Initial Investment Amount/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Expected Annual Return/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Investment Duration/i)).toBeInTheDocument()

    // Click Calculate
    const calcBtn = screen.getByRole('button', { name: /Calculate Lump-Sum Outcomes/i })
    fireEvent.click(calcBtn)

    // Verify key figures appear in results
    expect(await screen.findByText('Corpus Distribution')).toBeInTheDocument()
    expect(screen.getByText('Growth Trajectory Over Time')).toBeInTheDocument()
    expect(screen.getByText(/Wealth Multiplier/i)).toBeInTheDocument()

    // Expand yearly schedule
    const scheduleBtn = screen.getByRole('button', { name: /Year-by-Year Growth Breakdown Schedule/i })
    fireEvent.click(scheduleBtn)
    const tables = screen.getAllByRole('table')
    expect(tables.length).toBeGreaterThan(0)
    expect(within(tables[tables.length - 1]).getByText('Year 10')).toBeInTheDocument()
  })

  it('configures and calculates a SIP investment with annual step-up', async () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    // Select SIP
    fireEvent.click(screen.getByText('Configure SIP →'))

    // Verify SIP inputs appear
    expect(screen.getByLabelText(/Recurring Contribution Amount/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Contribution Frequency/i)).toBeInTheDocument()
    expect(screen.getByText(/Annual SIP Step-Up/i)).toBeInTheDocument()

    // Click Calculate
    const calcBtn = screen.getByRole('button', { name: /Calculate SIP Outcomes/i })
    fireEvent.click(calcBtn)

    // Results appear
    expect(await screen.findByText('Corpus Distribution')).toBeInTheDocument()
    expect(screen.getAllByText('Calculated').length).toBeGreaterThan(0)
  })

  it('adds a new independent calculator (Calculator 2) without modifying existing calculators', async () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    // Configure Calculator 1 as Lump-Sum and calculate
    fireEvent.click(screen.getByText('Configure Lump-Sum →'))
    fireEvent.click(screen.getByRole('button', { name: /Calculate Lump-Sum Outcomes/i }))
    expect(await screen.findByText('Corpus Distribution')).toBeInTheDocument()

    // Click Add Calculator
    const addBtn = screen.getByRole('button', { name: /Add Calculator/i })
    fireEvent.click(addBtn)

    // Verify Calculator 2 is appended and unconfigured while Calculator 1 remains calculated
    expect(screen.getByRole('heading', { name: 'Calculator 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calculator 2' })).toBeInTheDocument()
    expect(screen.getByText('Your Calculator Collection (2)')).toBeInTheDocument()

    // Configure Calculator 2 as SIP
    const sipButtons = screen.getAllByText('Configure SIP →')
    fireEvent.click(sipButtons[sipButtons.length - 1])

    expect(screen.getAllByText(/SIP Calculator/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Lump-Sum Calculator/).length).toBeGreaterThan(0)
  })

  it('marks calculator as requiring recalculation when inputs change after calculation', async () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    fireEvent.click(screen.getByText('Configure Lump-Sum →'))
    fireEvent.click(screen.getByRole('button', { name: /Calculate Lump-Sum Outcomes/i }))
    expect(await screen.findByText('Corpus Distribution')).toBeInTheDocument()

    // Change duration
    const durationInput = screen.getByLabelText(/Investment Duration/i)
    fireEvent.change(durationInput, { target: { value: '15' } })

    // Verify outdated badge and notice appear
    expect(await screen.findByText('Needs Recalculation')).toBeInTheDocument()
    expect(screen.getByText(/Inputs have changed since this calculation/i)).toBeInTheDocument()
  })

  it('compiles all calculated calculators into consolidated comparison view and supports CSV export', async () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    // Calculate Calculator 1 as Lump-Sum
    fireEvent.click(screen.getByText('Configure Lump-Sum →'))
    fireEvent.click(screen.getByRole('button', { name: /Calculate Lump-Sum Outcomes/i }))

    // Add Calculator 2 and calculate as SIP
    fireEvent.click(screen.getByRole('button', { name: /Add Calculator/i }))
    const sipButtons = screen.getAllByText('Configure SIP →')
    fireEvent.click(sipButtons[sipButtons.length - 1])
    const calcButtons = screen.getAllByRole('button', { name: /Calculate.*Outcomes/i })
    fireEvent.click(calcButtons[calcButtons.length - 1])

    // Click Compile All Calculators
    const compileBtn = screen.getByRole('button', { name: /Compile All Calculators/i })
    fireEvent.click(compileBtn)

    // Consolidated view should be visible
    expect(await screen.findByText('Consolidated Comparison & Portfolio View')).toBeInTheDocument()
    expect(screen.getByText('Combined Invested')).toBeInTheDocument()
    expect(screen.getByText('Combined Estimated Gains')).toBeInTheDocument()
    expect(screen.getByText('Combined Aggregate Totals')).toBeInTheDocument()

    // Mock CSV download
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const exportBtn = screen.getByRole('button', { name: /Export CSV Comparison/i })
    fireEvent.click(exportBtn)

    expect(createUrl).toHaveBeenCalled()
    createUrl.mockRestore()
    revokeUrl.mockRestore()
  })

  it('renumbers remaining unnamed calculators consistently while preserving custom names on deletion', async () => {
    renderWithProviders(<InvestmentCalculatorPage />)

    // Add Calculator 2 and Calculator 3
    fireEvent.click(screen.getByRole('button', { name: /Add Calculator/i }))
    fireEvent.click(screen.getByRole('button', { name: /Add Calculator/i }))

    expect(screen.getByRole('heading', { name: 'Calculator 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calculator 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calculator 3' })).toBeInTheDocument()

    // Rename Calculator 2 to "My Custom Plan"
    const renameButtons = screen.getAllByLabelText(/Rename Calculator/i)
    fireEvent.click(renameButtons[1]) // Calculator 2 edit button
    const nameInput = screen.getByDisplayValue('Calculator 2')
    fireEvent.change(nameInput, { target: { value: 'My Custom Plan' } })
    fireEvent.click(screen.getByLabelText('Confirm name'))

    expect(screen.getByRole('heading', { name: 'My Custom Plan' })).toBeInTheDocument()

    // Delete Calculator 1
    const deleteButtons = screen.getAllByLabelText(/Delete/i)
    fireEvent.click(deleteButtons[0]) // click delete on Calculator 1
    const confirmBtn = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(confirmBtn)

    // After deleting Calculator 1:
    // Custom name "My Custom Plan" is preserved!
    // The previous Calculator 3 was unnamed, so it becomes Calculator 2!
    expect(screen.getByRole('heading', { name: 'My Custom Plan' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calculator 2' })).toBeInTheDocument()
  })

  it('persists calculator state across renders using localStorage', () => {
    const { unmount } = renderWithProviders(<InvestmentCalculatorPage />)

    // Add Calculator 2
    fireEvent.click(screen.getByRole('button', { name: /Add Calculator/i }))
    expect(screen.getByRole('heading', { name: 'Calculator 2' })).toBeInTheDocument()

    // Unmount and remount (simulating page reload)
    unmount()
    renderWithProviders(<InvestmentCalculatorPage />)

    expect(screen.getByRole('heading', { name: 'Calculator 1' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Calculator 2' })).toBeInTheDocument()
  })
})
