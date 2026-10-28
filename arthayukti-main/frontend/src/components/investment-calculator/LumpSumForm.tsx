import type { CompoundingFrequency, LumpSumInputs, TaxMethod } from '../../lib/investmentEngine'
import { AmountField, SelectField, TextField } from '../forms'

interface LumpSumFormProps {
  inputs: LumpSumInputs
  onChange: (inputs: LumpSumInputs) => void
}

export function LumpSumForm({ inputs, onChange }: LumpSumFormProps) {
  const update = <K extends keyof LumpSumInputs>(key: K, value: LumpSumInputs[K]) => {
    onChange({ ...inputs, [key]: value })
  }

  const compoundingOptions: { value: CompoundingFrequency; label: string }[] = [
    { value: 'annually', label: 'Annually (1x per year — standard)' },
    { value: 'semi_annually', label: 'Semi-Annually (2x per year)' },
    { value: 'quarterly', label: 'Quarterly (4x per year)' },
    { value: 'monthly', label: 'Monthly (12x per year)' },
  ]

  const taxMethodOptions: { value: TaxMethod; label: string }[] = [
    { value: 'none', label: 'None (Tax-free / Exempt e.g. PPF, exempt bonds)' },
    { value: 'flat', label: 'Flat Tax (Flat rate applied to all investment gains)' },
    { value: 'ltcg_exemption', label: 'LTCG with Exemption (Tax on gains above exemption threshold)' },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <div className="sm:col-span-2 lg:col-span-3">
        <TextField
          label="Investment Name / Label"
          placeholder="e.g. Nifty 50 Index Lump-Sum, Fixed Deposit"
          value={inputs.investmentName}
          onChange={(val) => update('investmentName', val)}
          hint="Give this scenario a name to easily identify it in the comparison table"
          maxLength={80}
        />
      </div>

      <div>
        <AmountField
          label="Initial Investment Amount (₹)"
          value={inputs.initialAmount}
          onChange={(val) => update('initialAmount', val)}
          hint="One-time principal deposited on day one"
        />
      </div>

      <div>
        <TextField
          label="Expected Annual Return (%)"
          placeholder="12.0"
          inputMode="decimal"
          value={inputs.expectedReturnPercent}
          onChange={(val) => update('expectedReturnPercent', val)}
          hint="Projected annual growth rate (e.g. 12 for 12%)"
        />
      </div>

      <div>
        <TextField
          label="Investment Duration (Years)"
          placeholder="10"
          inputMode="numeric"
          value={inputs.durationYears}
          onChange={(val) => update('durationYears', val)}
          hint="Total investment tenure (1 to 60 years)"
        />
      </div>

      <div className="sm:col-span-2 lg:col-span-2">
        <SelectField
          label="Compounding Frequency"
          value={inputs.compoundingFrequency}
          onChange={(val) => update('compoundingFrequency', val)}
          options={compoundingOptions}
          hint="Frequency at which accrued returns are reinvested into the principal"
        />
      </div>

      <div>
        <TextField
          label="Annual Inflation Rate (%)"
          placeholder="6.0"
          inputMode="decimal"
          value={inputs.inflationRatePercent}
          onChange={(val) => update('inflationRatePercent', val)}
          hint="Used to calculate real future purchasing power"
        />
      </div>

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
                hint="Taxes are evaluated once at maturity upon realization of gains"
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
