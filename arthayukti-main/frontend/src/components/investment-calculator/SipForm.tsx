import type { SipFrequency, SipInputs, StepUpMode, TaxMethod } from '../../lib/investmentEngine'
import { AmountField, SelectField, TextField } from '../forms'

interface SipFormProps {
  inputs: SipInputs
  onChange: (inputs: SipInputs) => void
}

export function SipForm({ inputs, onChange }: SipFormProps) {
  const update = <K extends keyof SipInputs>(key: K, value: SipInputs[K]) => {
    onChange({ ...inputs, [key]: value })
  }

  const frequencyOptions: { value: SipFrequency; label: string }[] = [
    { value: 'monthly', label: 'Monthly (12 installments/year — standard)' },
    { value: 'quarterly', label: 'Quarterly (4 installments/year)' },
    { value: 'annual', label: 'Annual (1 installment/year)' },
  ]

  const stepUpOptions: { value: StepUpMode; label: string }[] = [
    { value: 'none', label: 'None (Fixed regular contribution throughout)' },
    { value: 'percent', label: 'Percentage Step-Up (% increase every year)' },
    { value: 'amount', label: 'Fixed Amount Step-Up (₹ increase every year)' },
  ]

  const taxMethodOptions: { value: TaxMethod; label: string }[] = [
    { value: 'none', label: 'None (Tax-free / Exempt e.g. PPF, ELSS within limit)' },
    { value: 'flat', label: 'Flat Tax (Flat rate applied to all investment gains)' },
    { value: 'ltcg_exemption', label: 'LTCG with Exemption (Tax on gains above exemption threshold)' },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3">
        <TextField
          label="Investment Name / Label"
          placeholder="e.g. Parag Parikh Flexi Cap SIP, Retirement Core"
          value={inputs.investmentName}
          onChange={(val) => update('investmentName', val)}
          hint="Give this scenario a name to easily identify it in the comparison table"
          maxLength={80}
        />
      </div>

      <div>
        <AmountField
          label="Recurring Contribution Amount (₹)"
          value={inputs.recurringAmount}
          onChange={(val) => update('recurringAmount', val)}
          hint="Periodic amount invested on each installment date"
        />
      </div>

      <div>
        <SelectField
          label="Contribution Frequency"
          value={inputs.frequency}
          onChange={(val) => update('frequency', val)}
          options={frequencyOptions}
          hint="Installment frequency (monthly is primary)"
        />
      </div>

      <div>
        <AmountField
          label="Optional Initial Lump-Sum (₹)"
          value={inputs.initialAmount}
          onChange={(val) => update('initialAmount', val)}
          hint="Optional lump-sum deposit made on day one alongside regular SIP"
        />
      </div>

      <div>
        <TextField
          label="Investment Duration (Years)"
          placeholder="10"
          inputMode="numeric"
          value={inputs.durationYears}
          onChange={(val) => update('durationYears', val)}
          hint="Total SIP tenure (1 to 60 years)"
        />
      </div>

      <div>
        <TextField
          label="Expected Annual Return (%)"
          placeholder="12.0"
          inputMode="decimal"
          value={inputs.expectedReturnPercent}
          onChange={(val) => update('expectedReturnPercent', val)}
          hint="Projected CAGR return compounded monthly"
        />
      </div>

      <div>
        <TextField
          label="Annual Inflation Rate (%)"
          placeholder="6.0"
          inputMode="decimal"
          value={inputs.inflationRatePercent}
          onChange={(val) => update('inflationRatePercent', val)}
          hint="Used to compute real future purchasing power"
        />
      </div>

      {/* Annual Step-Up Section */}
      <div className="sm:col-span-2 lg:col-span-3">
        <div className="rounded-2xl border border-line bg-paper/50 p-4">
          <p className="mb-1 text-[14px] font-semibold text-ink">Annual SIP Step-Up (Top-up)</p>
          <p className="mb-3 text-[13px] text-muted">
            Automatically increase your contribution every 12 months as your income grows (from Year 2 onwards).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <SelectField
                label="Step-Up Method"
                value={inputs.stepUpMode}
                onChange={(val) => update('stepUpMode', val)}
                options={stepUpOptions}
              />
            </div>

            {inputs.stepUpMode === 'percent' && (
              <div>
                <TextField
                  label="Annual Step-Up Percentage (%)"
                  placeholder="10.0"
                  inputMode="decimal"
                  value={inputs.stepUpValue}
                  onChange={(val) => update('stepUpValue', val)}
                  hint="e.g. 10 for a 10% increase every year"
                />
              </div>
            )}

            {inputs.stepUpMode === 'amount' && (
              <div>
                <AmountField
                  label="Annual Step-Up Amount (₹)"
                  value={inputs.stepUpValue}
                  onChange={(val) => update('stepUpValue', val)}
                  hint="e.g. ₹1,000 extra added to your monthly installment each year"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Taxation Section */}
      <div className="sm:col-span-2 lg:col-span-3">
        <div className="rounded-2xl border border-line bg-paper/50 p-4">
          <p className="mb-3 text-[14px] font-semibold text-ink">Taxation Rules & Settings</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-1">
              <SelectField
                label="Tax Calculation Method"
                value={inputs.taxMethod}
                onChange={(val) => update('taxMethod', val)}
                options={taxMethodOptions}
                hint="Taxes evaluated at maturity upon realization of gains"
              />
            </div>

            {inputs.taxMethod !== 'none' && (
              <div>
                <TextField
                  label="Applicable Tax Rate (%)"
                  placeholder="12.5"
                  inputMode="decimal"
                  value={inputs.taxRatePercent}
                  onChange={(val) => update('taxRatePercent', val)}
                  hint="e.g. 12.5% for equity LTCG, 20% for debt"
                />
              </div>
            )}

            {inputs.taxMethod === 'ltcg_exemption' && (
              <div>
                <AmountField
                  label="Tax Exemption / Deduction Amount (₹)"
                  value={inputs.taxExemptionAmount}
                  onChange={(val) => update('taxExemptionAmount', val)}
                  hint="Section 112A exemption threshold (standard ₹1,25,000)"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
