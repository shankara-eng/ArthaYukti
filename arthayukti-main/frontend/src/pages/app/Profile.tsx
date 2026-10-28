import { useState } from 'react'
import {
  CheckCircle2,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import { api } from '../../api/client'
import type {
  ConservativeComparisonResponse,
  HouseholdProfileResponse,
  HouseholdProfileUpdateRequest,
  RiskAssessmentHistoryItem,
  RiskAssessmentResponse,
} from '../../api/types'
import { FormError, SelectField, TextField } from '../../components/forms'
import { Loaded, Panel, Table } from '../../components/panel'
import { formatMoney } from '../../lib/money'
import { useAction } from '../../state/useAction'
import { useRemote } from '../../state/useRemote'
import { useStore } from '../../state/useStore'
import type { PageProps } from '../types'

type ProfileTab = 'profile' | 'risk' | 'recommendations'

export function ProfilePage({ navigate }: { navigate?: PageProps['navigate'] }) {
  const [tab, setTab] = useState<ProfileTab>('profile')
  const { language, plan } = useStore()
  const isHi = language === 'hi'

  const profileRemote = useRemote('household-profile', (signal) => api.getHouseholdProfile(signal))
  const riskRemote = useRemote('latest-risk-assessment', (signal) =>
    api.getLatestRiskAssessment(signal).catch(() => null),
  )
  const historyRemote = useRemote('risk-assessment-history', (signal) =>
    api.getRiskAssessmentHistory(signal).catch(() => []),
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Tab Switcher */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'profile'}
          onClick={() => setTab('profile')}
          className={`flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold transition-all ${
            tab === 'profile'
              ? 'bg-brand text-white shadow-sm'
              : 'border border-line bg-paper text-ink hover:bg-sand/60'
          }`}
        >
          <Users size={18} />
          {isHi ? 'उपयोगकर्ता प्रोफ़ाइल' : 'User Profile'}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'risk'}
          onClick={() => setTab('risk')}
          className={`flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold transition-all ${
            tab === 'risk'
              ? 'bg-brand text-white shadow-sm'
              : 'border border-line bg-paper text-ink hover:bg-sand/60'
          }`}
        >
          <Shield size={18} />
          {isHi ? 'निर्देशित जोखिम मूल्यांकन' : 'Guided Risk Assessment'}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={tab === 'recommendations'}
          onClick={() => setTab('recommendations')}
          className={`flex min-h-11 items-center gap-2 rounded-xl px-4 font-semibold transition-all ${
            tab === 'recommendations'
              ? 'bg-brand text-white shadow-sm'
              : 'border border-line bg-paper text-ink hover:bg-sand/60'
          }`}
        >
          <ShieldCheck size={18} />
          {isHi ? 'मूल बनाम अधिक रूढ़िवादी सिफारिशें' : 'Original vs Conservative Plan'}
        </button>
      </div>

      {/* Tab 1: Profile Form */}
      {tab === 'profile' ? (
        <Loaded remote={profileRemote}>
          {(profile) => (
            <ProfileForm
              initial={profile}
              onSaved={() => {
                profileRemote.reload()
                riskRemote.reload()
              }}
              navigate={navigate}
              isHi={isHi}
            />
          )}
        </Loaded>
      ) : null}

      {/* Tab 2: Guided Risk Assessment */}
      {tab === 'risk' ? (
        <RiskAssessmentView
          latest={riskRemote.data ?? null}
          history={historyRemote.data ?? []}
          onCompleted={() => {
            riskRemote.reload()
            historyRemote.reload()
          }}
          isHi={isHi}
        />
      ) : null}

      {/* Tab 3: Original vs Conservative Recommendations */}
      {tab === 'recommendations' ? (
        <ConservativeRecommendationsView plan={plan} isHi={isHi} navigate={navigate} />
      ) : null}
    </div>
  )
}

/* =========================================================================================
   1. USER PROFILE FORM (5 Sections)
   ========================================================================================= */

interface ProfileFormProps {
  initial: HouseholdProfileResponse
  onSaved: () => void
  navigate?: PageProps['navigate']
  isHi: boolean
}

function ProfileForm({ initial, onSaved, navigate, isHi }: ProfileFormProps) {
  // Section 1: Personal Details
  const [fullName, setFullName] = useState(initial.full_name ?? '')
  const [phoneNumber, setPhoneNumber] = useState(initial.phone_number ?? '')
  const [age, setAge] = useState(initial.primary_earner_age ? String(initial.primary_earner_age) : '')
  const [maritalStatus, setMaritalStatus] = useState<string>(initial.marital_status ?? '')

  // Section 2: Family & Dependants
  const [hasChildren, setHasChildren] = useState<boolean | null>(initial.has_children ?? null)
  const [childrenAges, setChildrenAges] = useState<(number | null)[]>(initial.children_ages ?? [])
  const [supportsMother, setSupportsMother] = useState<string>(initial.supports_mother ?? '')
  const [supportsFather, setSupportsFather] = useState<string>(initial.supports_father ?? '')
  const [financialDependants, setFinancialDependants] = useState<string>(initial.financial_dependants ?? '')

  // Section 3: Housing & Employment
  const [housingStatus, setHousingStatus] = useState<string>(initial.housing_status ?? '')
  const [employmentStatus, setEmploymentStatus] = useState<string>(initial.employment_status ?? '')
  const [employmentOther, setEmploymentOther] = useState<string>(initial.employment_other ?? '')

  // Section 4: Financial Resilience
  const [debtTypes, setDebtTypes] = useState<string[]>(initial.debt_types ?? [])
  const [emergencyCoverage, setEmergencyCoverage] = useState<string>(initial.emergency_fund_coverage ?? '')
  const [incomePredictability, setIncomePredictability] = useState<string>(initial.income_predictability ?? '')
  const [healthInsurance, setHealthInsurance] = useState<string>(initial.health_insurance_status ?? '')
  const [lifeInsurance, setLifeInsurance] = useState<string>(initial.life_insurance_status ?? '')

  // Section 5: Retirement Planning
  const isRetired = employmentStatus === 'retired'
  const [retirementAge, setRetirementAge] = useState(
    initial.expected_retirement_age ? String(initial.expected_retirement_age) : '',
  )

  const [savedSuccess, setSavedSuccess] = useState(false)
  const [agesError, setAgesError] = useState(false)
  const saveAction = useAction()

  // Child ages manipulation
  function addChild() {
    // A new child starts blank: an age is never invented.
    setChildrenAges([...childrenAges, null])
    setHasChildren(true)
  }

  function removeChild(index: number) {
    const next = childrenAges.filter((_, i) => i !== index)
    setChildrenAges(next)
    if (next.length === 0) setHasChildren(false)
  }

  function updateChildAge(index: number, val: string) {
    const num = parseInt(val, 10)
    const next = [...childrenAges]
    next[index] = isNaN(num) ? null : Math.max(0, Math.min(100, num))
    setChildrenAges(next)
  }

  // Debt types toggle with mutual exclusivity
  function toggleDebtType(type: string) {
    if (type === 'no_debt') {
      setDebtTypes(['no_debt'])
      return
    }
    const filtered = debtTypes.filter((t) => t !== 'no_debt')
    if (filtered.includes(type)) {
      setDebtTypes(filtered.filter((t) => t !== type))
    } else {
      setDebtTypes([...filtered, type])
    }
  }

  async function handleSave() {
    setSavedSuccess(false)
    setAgesError(false)
    if (hasChildren && childrenAges.some((a) => a === null)) {
      setAgesError(true)
      return
    }
    const payload: HouseholdProfileUpdateRequest = {
      full_name: fullName.trim() || null,
      phone_number: phoneNumber.trim() || null,
      primary_earner_age: age ? parseInt(age, 10) : null,
      marital_status: maritalStatus ? (maritalStatus as any) : null,
      has_children: hasChildren,
      children_ages: hasChildren ? (childrenAges as number[]) : [],
      supports_mother: supportsMother ? (supportsMother as any) : null,
      supports_father: supportsFather ? (supportsFather as any) : null,
      housing_status: housingStatus ? (housingStatus as any) : null,
      employment_status: employmentStatus ? (employmentStatus as any) : null,
      ...(employmentStatus === 'other' ? { employment_other: employmentOther.trim() } : {}),
      expected_retirement_age: isRetired ? null : retirementAge ? parseInt(retirementAge, 10) : null,
      financial_dependants: financialDependants ? (financialDependants as any) : null,
      debt_types: debtTypes.length > 0 ? (debtTypes as any) : null,
      emergency_fund_coverage: emergencyCoverage ? (emergencyCoverage as any) : null,
      income_predictability: incomePredictability ? (incomePredictability as any) : null,
      health_insurance_status: healthInsurance ? (healthInsurance as any) : null,
      life_insurance_status: lifeInsurance ? (lifeInsurance as any) : null,
    }

    const ok = await saveAction.run(() => api.updateHouseholdProfile(payload))
    if (ok) {
      setSavedSuccess(true)
      onSaved()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {savedSuccess ? (
        <div role="status" className="flex items-center gap-3 rounded-2xl bg-sage/60 p-4 font-semibold text-ink">
          <CheckCircle2 className="text-ontime" size={20} />
          <span>
            {isHi
              ? 'प्रोफ़ाइल सहेज ली गई। इसका उपयोग अभी सिर्फ़ जोखिम क्षमता के आकलन में होता है।'
              : 'Profile saved. It is used for your risk capacity assessment only; your plan figures are not changed by it.'}
          </span>
        </div>
      ) : null}

      {/* SECTION 1: Personal Details */}
      <Panel title={isHi ? '1. व्यक्तिगत विवरण' : '1. Personal Details'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={isHi ? 'पूरा नाम' : 'Full Name'}
            value={fullName}
            onChange={setFullName}
            placeholder="e.g. Ramesh Kumar"
          />
          <TextField
            label={isHi ? 'ईमेल पता' : 'Email Address'}
            value={initial.user_email ?? ''}
            onChange={() => undefined}
            hint={isHi ? 'खाता ईमेल (साइन-इन से जुड़ा हुआ)' : 'Registered account email (managed via login)'}
          />
          <TextField
            label={isHi ? 'फ़ोन नंबर' : 'Phone Number'}
            value={phoneNumber}
            onChange={setPhoneNumber}
            placeholder="+91 98765 43210"
          />
          <TextField
            label={isHi ? 'आपकी आयु (वर्ष)' : 'Age (years)'}
            value={age}
            type="text"
            onChange={(val) => setAge(val.replace(/\D/g, '').slice(0, 3))}
            placeholder="e.g. 34"
            hint={isHi ? '18 से 100 वर्ष के बीच' : 'Must be between 18 and 100'}
          />
          <SelectField
            label={isHi ? 'वैवाहिक स्थिति' : 'Marital Status'}
            value={maritalStatus}
            onChange={setMaritalStatus}
            options={[
              { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
              { value: 'married', label: isHi ? 'विवाहित' : 'Married' },
              { value: 'not_married', label: isHi ? 'अविवाहित / अन्य' : 'Not married' },
            ]}
          />
        </div>
      </Panel>

      {/* SECTION 2: Family & Dependants */}
      <Panel title={isHi ? '2. परिवार और आश्रित' : '2. Family & Dependants'}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-semibold">
              {isHi ? 'क्या आपके बच्चे हैं?' : 'Do you currently have children?'}
            </span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="hasChildren"
                  checked={hasChildren === true}
                  onChange={() => {
                    setHasChildren(true)
                    if (childrenAges.length === 0) setChildrenAges([5])
                  }}
                  className="size-4 text-brand"
                />
                {isHi ? 'हाँ' : 'Yes'}
              </label>
              <label className="flex items-center gap-2 text-[15px]">
                <input
                  type="radio"
                  name="hasChildren"
                  checked={hasChildren === false}
                  onChange={() => {
                    setHasChildren(false)
                    setChildrenAges([])
                  }}
                  className="size-4 text-brand"
                />
                {isHi ? 'नहीं' : 'No'}
              </label>
            </div>
          </div>

          {hasChildren ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sand/30 p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{isHi ? 'बच्चों की आयु' : 'Children Ages'}</span>
                <button
                  type="button"
                  onClick={addChild}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-[13px] font-semibold hover:bg-sand"
                >
                  <Plus size={16} />
                  {isHi ? 'बच्चा जोड़ें' : 'Add Child'}
                </button>
              </div>

              {childrenAges.length === 0 ? (
                <p className="text-[14px] text-muted">
                  {isHi ? 'कोई बच्चा नहीं जोड़ा गया।' : 'No children records added yet.'}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  {childrenAges.map((childAge, idx) => (
                    <div key={idx} className="flex items-center gap-2 rounded-xl glass p-2.5">
                      <span className="text-[14px] font-medium text-muted">
                        #{idx + 1}:
                      </span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={childAge ?? ''}
                        onChange={(e) => updateChildAge(idx, e.target.value)}
                        className="w-16 rounded-lg border border-line px-2 py-1 text-center font-semibold"
                      />
                      <span className="text-[13px] text-muted">{isHi ? 'वर्ष' : 'yrs'}</span>
                      <button
                        type="button"
                        onClick={() => removeChild(idx)}
                        aria-label={`Remove child ${idx + 1}`}
                        className="ml-auto text-muted hover:text-late"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={isHi ? 'माता के प्रति वित्तीय ज़िम्मेदारी' : 'Financial Support for Mother'}
              value={supportsMother}
              onChange={setSupportsMother}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'yes', label: isHi ? 'हाँ, वित्तीय सहायता देते हैं' : 'Yes (Financially supported)' },
                { value: 'no', label: isHi ? 'नहीं' : 'No' },
                { value: 'unsure', label: isHi ? 'निश्चित नहीं / लागू नहीं' : 'Unsure / Not applicable' },
              ]}
            />
            <SelectField
              label={isHi ? 'पिता के प्रति वित्तीय ज़िम्मेदारी' : 'Financial Support for Father'}
              value={supportsFather}
              onChange={setSupportsFather}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'yes', label: isHi ? 'हाँ, वित्तीय सहायता देते हैं' : 'Yes (Financially supported)' },
                { value: 'no', label: isHi ? 'नहीं' : 'No' },
                { value: 'unsure', label: isHi ? 'निश्चित नहीं / लागू नहीं' : 'Unsure / Not applicable' },
              ]}
            />
            <SelectField
              label={isHi ? 'कुल वित्तीय आश्रित' : 'Total Financial Dependants'}
              value={financialDependants}
              onChange={setFinancialDependants}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'none', label: isHi ? 'कोई नहीं (None)' : 'None' },
                { value: 'one', label: isHi ? 'एक (1)' : 'One' },
                { value: 'two', label: isHi ? 'दो (2)' : 'Two' },
                { value: 'three', label: isHi ? 'तीन (3)' : 'Three' },
                { value: 'four_or_more', label: isHi ? 'चार या अधिक (4+)' : 'Four or more' },
              ]}
            />
          </div>
        </div>
      </Panel>

      {/* SECTION 3: Housing & Employment */}
      <Panel title={isHi ? '3. आवास और रोज़गार' : '3. Housing & Employment'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={isHi ? 'आवास की स्थिति' : 'Housing Status'}
            value={housingStatus}
            onChange={setHousingStatus}
            options={[
              { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
              { value: 'own_house', label: isHi ? 'स्वयं का घर (Own house)' : 'Own house' },
              { value: 'rented_house', label: isHi ? 'किराए का मकान (Rented house)' : 'Rented house' },
            ]}
          />
          <SelectField
            label={isHi ? 'रोज़गार की स्थिति' : 'Employment Status'}
            value={employmentStatus}
            onChange={setEmploymentStatus}
            options={[
              { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
              { value: 'salaried', label: isHi ? 'वेतनभोगी (Salaried)' : 'Salaried' },
              { value: 'self_employed', label: isHi ? 'स्व-रोज़गार (Self-employed)' : 'Self-employed' },
              { value: 'business_owner', label: isHi ? 'व्यापार स्वामी (Business owner)' : 'Business owner' },
              { value: 'student', label: isHi ? 'विद्यार्थी (Student)' : 'Student' },
              { value: 'unemployed', label: isHi ? 'बेरोज़गार (Unemployed)' : 'Unemployed' },
              { value: 'retired', label: isHi ? 'सेवानिवृत्त (Retired)' : 'Retired' },
              { value: 'other', label: isHi ? 'अन्य (Other)' : 'Other' },
            ]}
          />
          {employmentStatus === 'other' ? (
            <TextField
              label={isHi ? 'अपना काम बताएँ (वैकल्पिक)' : 'Describe your work (optional)'}
              value={employmentOther}
              onChange={setEmploymentOther}
              maxLength={100}
            />
          ) : null}
        </div>
      </Panel>

      {/* SECTION 4: Financial Resilience */}
      <Panel title={isHi ? '4. वित्तीय लचीलापन और सुरक्षा' : '4. Financial Resilience'}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[15px] font-semibold">
              {isHi ? 'बकाया ऋण के प्रकार' : 'Outstanding Debt Types'}
            </span>
            <p className="text-[13px] text-muted">
              {isHi
                ? 'यदि कोई ऋण नहीं है, तो "कोई ऋण नहीं" चुनें। विस्तृत शेष राशि ऋण मॉड्यूल में देखी जा सकती है।'
                : 'Selecting "No outstanding debt" excludes active loan types. Detailed loan amounts are managed in the Debts module.'}
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { id: 'no_debt', label: isHi ? 'कोई बकाया ऋण नहीं' : 'No outstanding debt' },
                { id: 'home_loan', label: isHi ? 'गृह ऋण (Home loan)' : 'Home loan' },
                { id: 'education_loan', label: isHi ? 'शिक्षा ऋण (Education loan)' : 'Education loan' },
                { id: 'personal_loan', label: isHi ? 'व्यक्तिगत ऋण (Personal loan)' : 'Personal loan' },
                { id: 'vehicle_loan', label: isHi ? 'वाहन ऋण (Vehicle loan)' : 'Vehicle loan' },
                { id: 'other', label: isHi ? 'अन्य ऋण' : 'Other debt' },
                { id: 'multiple', label: isHi ? 'एकाधिक ऋण प्रकार' : 'Multiple debt types' },
              ].map((opt) => (
                <label
                  key={opt.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-[14px] font-medium transition-all ${
                    debtTypes.includes(opt.id)
                      ? 'border-brand bg-sage/40 text-ink'
                      : 'border-line bg-paper text-muted hover:border-ink/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={debtTypes.includes(opt.id)}
                    onChange={() => toggleDebtType(opt.id)}
                    className="size-4 rounded text-brand"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            {navigate ? (
              <button
                type="button"
                onClick={() => navigate('debts')}
                className="mt-1 self-start text-[13px] font-semibold text-brand underline"
              >
                {isHi ? 'ऋण और देयताएं मॉड्यूल खोलें →' : 'View or edit loan records in Debts module →'}
              </button>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label={isHi ? 'आपातकालीन निधि कवरेज' : 'Emergency Fund Coverage'}
              value={emergencyCoverage}
              onChange={setEmergencyCoverage}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'none', label: isHi ? 'कोई आपातकालीन निधि नहीं' : 'No emergency fund' },
                { value: 'less_than_3', label: isHi ? '3 महीने से कम' : 'Less than 3 months' },
                { value: '3_to_6', label: isHi ? '3 से 6 महीने' : '3–6 months' },
                { value: 'more_than_6', label: isHi ? '6 महीने से अधिक' : 'More than 6 months' },
                { value: 'not_sure', label: isHi ? 'निश्चित नहीं' : 'Not sure' },
              ]}
            />
            <SelectField
              label={isHi ? 'आय की पूर्वानुमेयता' : 'Income Predictability'}
              value={incomePredictability}
              onChange={setIncomePredictability}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'very_predictable', label: isHi ? 'अत्यधिक पूर्वानुमेय (नियमित वेतन)' : 'Very predictable' },
                { value: 'mostly_predictable', label: isHi ? 'अधिकतर पूर्वानुमेय' : 'Mostly predictable' },
                { value: 'varies_significantly', label: isHi ? 'काफी भिन्न होती है' : 'Varies significantly' },
                { value: 'seasonal_project', label: isHi ? 'मौसमी या परियोजना आधारित' : 'Seasonal or project-based' },
                { value: 'no_income', label: isHi ? 'वर्तमान में कोई आय नहीं' : 'Currently no income' },
                { value: 'not_sure', label: isHi ? 'निश्चित नहीं' : 'Not sure' },
              ]}
            />
            <SelectField
              label={isHi ? 'स्वास्थ्य बीमा (Health Insurance)' : 'Health Insurance'}
              value={healthInsurance}
              onChange={setHealthInsurance}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'yes', label: isHi ? 'हाँ, सक्रिय पॉलिसी है' : 'Yes (Active cover)' },
                { value: 'no', label: isHi ? 'नहीं' : 'No' },
                { value: 'not_sure', label: isHi ? 'निश्चित नहीं' : 'Not sure' },
              ]}
            />
            <SelectField
              label={isHi ? 'जीवन बीमा (Life Insurance / Term)' : 'Life Insurance Cover'}
              value={lifeInsurance}
              onChange={setLifeInsurance}
              options={[
                { value: '', label: isHi ? 'चुनें (अनुत्तरित)' : 'Select (Unanswered)' },
                { value: 'yes', label: isHi ? 'हाँ, सक्रिय पॉलिसी है' : 'Yes (Active cover)' },
                { value: 'no', label: isHi ? 'नहीं' : 'No' },
                { value: 'not_sure', label: isHi ? 'निश्चित नहीं' : 'Not sure' },
              ]}
            />
          </div>
        </div>
      </Panel>

      {/* SECTION 5: Retirement Planning */}
      <Panel title={isHi ? '5. सेवानिवृत्ति योजना' : '5. Retirement Planning'}>
        <div className="grid gap-4 sm:grid-cols-2">
          {isRetired ? (
            <div className="rounded-xl border border-line bg-sand/40 p-3.5">
              <span className="text-[14px] font-semibold text-muted">
                {isHi ? 'सेवानिवृत्ति की स्थिति:' : 'Retirement Status:'}
              </span>
              <p className="font-semibold text-ink">
                {isHi ? 'आप पहले से सेवानिवृत्त हैं।' : 'Already retired (Employment set to Retired).'}
              </p>
            </div>
          ) : (
            <TextField
              label={isHi ? 'अपेक्षित सेवानिवृत्ति आयु (वर्ष)' : 'Expected Retirement Age (years)'}
              value={retirementAge}
              onChange={(val) => setRetirementAge(val.replace(/\D/g, '').slice(0, 3))}
              placeholder="e.g. 60"
              hint={isHi ? '30 से 100 वर्ष के बीच' : 'Age when you plan to stop active employment (e.g. 58-65)'}
            />
          )}
        </div>
      </Panel>

      {/* Save Action */}
      {agesError ? (
        <FormError>{isHi ? 'हर बच्चे की आयु भरें या उस पंक्ति को हटाएँ।' : "Enter each child's age or remove that row."}</FormError>
      ) : null}
      {saveAction.failure ? <FormError>{saveAction.failure.message}</FormError> : null}
      <button
        type="button"
        disabled={saveAction.busy}
        onClick={() => void handleSave()}
        className="min-h-12 self-start rounded-xl bg-brand px-8 font-semibold text-white shadow-sm disabled:opacity-60"
      >
        {saveAction.busy ? (isHi ? 'सहेजा जा रहा है…' : 'Saving Profile…') : isHi ? 'प्रोफ़ाइल सहेजें' : 'Save Profile'}
      </button>
    </div>
  )
}

/* =========================================================================================
   2. GUIDED RISK ASSESSMENT COMPONENT
   ========================================================================================= */

interface RiskAssessmentViewProps {
  latest: RiskAssessmentResponse | null
  history: RiskAssessmentHistoryItem[]
  onCompleted: () => void
  isHi: boolean
}

function RiskAssessmentView({ latest, history, onCompleted, isHi }: RiskAssessmentViewProps) {
  const [retakeRequested, setRetakeRequested] = useState(false)
  const isTaking = retakeRequested || !latest
  const [lossReaction, setLossReaction] = useState<string>('')
  const [safetyGrowth, setSafetyGrowth] = useState<string>('')
  const [timeHorizon, setTimeHorizon] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)

  const submitAction = useAction()

  async function handleSubmit() {
    setValidationError(null)
    if (!lossReaction || !safetyGrowth || !timeHorizon) {
      setValidationError(isHi ? 'कृपया सभी 3 प्रश्नों का उत्तर दें।' : 'Please answer all 3 required questions.')
      return
    }

    const ok = await submitAction.run(() =>
      api.submitRiskAssessment({
        loss_reaction: lossReaction as any,
        safety_growth: safetyGrowth as any,
        time_horizon: timeHorizon as any,
      }),
    )
    if (ok) {
      setRetakeRequested(false)
      onCompleted()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title={isHi ? 'निर्देशित जोखिम मूल्यांकन' : 'Guided Risk Assessment'}
        aside={
          latest && !isTaking ? (
            <button
              type="button"
              onClick={() => {
                setLossReaction('')
                setSafetyGrowth('')
                setTimeHorizon('')
                setRetakeRequested(true)
              }}
              className="flex items-center gap-1.5 rounded-xl border border-line bg-paper px-4 py-2 text-[14px] font-semibold hover:bg-sand"
            >
              <RefreshCw size={16} />
              {isHi ? 'पुनः मूल्यांकन करें' : 'Retake Assessment'}
            </button>
          ) : null
        }
      >
        <p className="text-[15px] text-muted">
          {isHi
            ? 'यह मूल्यांकन आपकी मनोवैज्ञानिक जोखिम सहिष्णुता (Risk Tolerance) और आपकी वास्तविक वित्तीय क्षमता (Risk Capacity) को अलग-अलग मापता है।'
            : 'This questionnaire evaluates your psychological tolerance for market volatility independently from your financial capacity to absorb losses.'}
        </p>

        {isTaking ? (
          <div className="flex flex-col gap-6">
            {/* Question 1 */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sand/30 p-4">
              <span className="font-semibold text-ink">
                {isHi
                  ? '1. यदि आपके निवेश में अल्पकालिक 20% की गिरावट आती है, तो आपकी क्या प्रतिक्रिया होगी?'
                  : '1. Reaction to a hypothetical 20% investment loss:'}
              </span>
              <div className="flex flex-col gap-2">
                {[
                  {
                    id: 'sell_all',
                    label: isHi
                      ? 'आगे के नुकसान से बचने के लिए अधिकांश निवेश बेच देंगे'
                      : 'Sell most investments to avoid further losses',
                  },
                  {
                    id: 'reduce_some',
                    label: isHi ? 'कुछ निवेश कम करेंगे और सुरक्षित फंड में डालेंगे' : 'Reduce some investments',
                  },
                  {
                    id: 'hold',
                    label: isHi ? 'बाजार की रिकवरी की प्रतीक्षा करेंगे और निवेश बनाए रखेंगे' : 'Hold and wait for recovery',
                  },
                  {
                    id: 'invest_more',
                    label: isHi
                      ? 'गिरावट को अवसर मानकर यदि संभव हो तो और निवेश करेंगे'
                      : 'Consider investing more if appropriate',
                  },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-[15px] font-medium transition-all ${
                      lossReaction === opt.id
                        ? 'border-brand bg-sage/60 text-ink'
                        : 'border-line bg-paper text-muted hover:border-ink/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="q1"
                      value={opt.id}
                      checked={lossReaction === opt.id}
                      onChange={() => setLossReaction(opt.id)}
                      className="size-4 text-brand"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Question 2 */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sand/30 p-4">
              <span className="font-semibold text-ink">
                {isHi
                  ? '2. सुरक्षा बनाम विकास के बीच आपकी क्या प्राथमिकता है?'
                  : '2. Preference for safety versus growth:'}
              </span>
              <div className="flex flex-col gap-2">
                {[
                  {
                    id: 'protect',
                    label: isHi
                      ? 'पैसे की सुरक्षा सर्वोपरि है, भले ही रिटर्न कम हो'
                      : 'Protect my money, even if returns are lower',
                  },
                  {
                    id: 'balance',
                    label: isHi
                      ? 'संतुलित विकास और सीमित उतार-चढ़ाव स्वीकार्य है'
                      : 'Balance growth with the possibility of losses',
                  },
                  {
                    id: 'grow',
                    label: isHi
                      ? 'महत्वपूर्ण उतार-चढ़ाव स्वीकार करते हुए अधिकतम दीर्घकालिक विकास'
                      : 'Grow my money while accepting substantial fluctuations',
                  },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-[15px] font-medium transition-all ${
                      safetyGrowth === opt.id
                        ? 'border-brand bg-sage/60 text-ink'
                        : 'border-line bg-paper text-muted hover:border-ink/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="q2"
                      value={opt.id}
                      checked={safetyGrowth === opt.id}
                      onChange={() => setSafetyGrowth(opt.id)}
                      className="size-4 text-brand"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Question 3 */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-sand/30 p-4">
              <span className="font-semibold text-ink">
                {isHi
                  ? '3. आपके अधिकांश वित्तीय लक्ष्यों के लिए आपका सामान्य निवेश समय क्षितिज (Time Horizon) क्या है?'
                  : '3. Investment time horizon:'}
              </span>
              <div className="flex flex-col gap-2">
                {[
                  { id: 'short', label: isHi ? '1 वर्ष से कम' : 'Less than 1 year' },
                  { id: 'medium_short', label: isHi ? '1 से 3 वर्ष' : '1–3 years' },
                  { id: 'medium', label: isHi ? '3 से 7 वर्ष' : '3–7 years' },
                  { id: 'long', label: isHi ? '7 वर्ष से अधिक' : 'More than 7 years' },
                ].map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-[15px] font-medium transition-all ${
                      timeHorizon === opt.id
                        ? 'border-brand bg-sage/60 text-ink'
                        : 'border-line bg-paper text-muted hover:border-ink/40'
                    }`}
                  >
                    <input
                      type="radio"
                      name="q3"
                      value={opt.id}
                      checked={timeHorizon === opt.id}
                      onChange={() => setTimeHorizon(opt.id)}
                      className="size-4 text-brand"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {validationError ? <FormError>{validationError}</FormError> : null}
            {submitAction.failure ? <FormError>{submitAction.failure.message}</FormError> : null}

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={submitAction.busy}
                onClick={() => void handleSubmit()}
                className="min-h-12 rounded-xl bg-brand px-8 font-semibold text-white shadow-sm disabled:opacity-60"
              >
                {submitAction.busy
                  ? isHi
                    ? 'मूल्यांकन हो रहा है…'
                    : 'Evaluating…'
                  : isHi
                    ? 'मूल्यांकन जमा करें'
                    : 'Submit Assessment'}
              </button>
              {latest ? (
                <button
                  type="button"
                  onClick={() => setRetakeRequested(false)}
                  className="min-h-12 rounded-xl border border-line px-5 font-semibold"
                >
                  {isHi ? 'रद्द करें' : 'Cancel'}
                </button>
              ) : null}
            </div>
          </div>
        ) : latest ? (
          /* RESULTS SCREEN */
          <div className="flex flex-col gap-6">
            {latest.profile_changed_since ? (
              <p role="status" className="rounded-xl bg-blush px-4 py-3 text-[14px]">
                {isHi
                  ? 'इस आकलन के बाद आपकी प्रोफ़ाइल बदली है, इसलिए जोखिम क्षमता का आकलन पुराना हो सकता है। नए जवाबों के लिए दोबारा आकलन करें।'
                  : 'Your profile changed after this assessment, so its risk-capacity reading may be out of date. Retake it to refresh the result.'}
              </p>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1 rounded-2xl glass p-4">
                <span className="text-[13px] font-semibold text-muted uppercase">
                  {isHi ? 'जोखिम सहिष्णुता (Tolerance)' : 'Risk Tolerance'}
                </span>
                <span className="text-[22px] font-bold text-ink">{latest.risk_tolerance}</span>
                <span className="text-[13px] text-muted">
                  {isHi ? `स्कोर: ${latest.tolerance_score} / 11` : `Score: ${latest.tolerance_score} / 11`}
                </span>
              </div>

              <div className="flex flex-col gap-1 rounded-2xl glass p-4">
                <span className="text-[13px] font-semibold text-muted uppercase">
                  {isHi ? 'जोखिम क्षमता (Capacity)' : 'Risk Capacity'}
                </span>
                <span className="text-[22px] font-bold text-ink">{latest.risk_capacity}</span>
                <span className="text-[13px] text-muted">
                  {isHi ? 'तरलता व ऋण से मूल्यांकित' : 'From liquid reserves & commitments'}
                </span>
              </div>

              <div className="flex flex-col gap-1 rounded-2xl border border-brand bg-sage/30 p-4">
                <span className="text-[13px] font-semibold text-brand uppercase">
                  {isHi ? 'समग्र अनुशंसित दृष्टिकोण' : 'Composite Stance'}
                </span>
                <span className="text-[22px] font-bold text-brand">{latest.composite_stance}</span>
                <span className="text-[13px] text-muted">
                  {isHi ? 'सहिष्णुता व क्षमता का संतुलन' : 'Tolerance combined with capacity'}
                </span>
              </div>
            </div>

            {/* Conflict Note if present */}
            {latest.conflict_note ? (
              <div className="flex items-start gap-3 rounded-2xl bg-amber-50 p-4 border border-amber-200 text-amber-900">
                <ShieldAlert className="shrink-0 text-amber-700" size={24} />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">{isHi ? 'महत्वपूर्ण अवलोकन' : 'Important Alignment Notice'}</span>
                  <p className="text-[14px] leading-relaxed">{latest.conflict_note}</p>
                </div>
              </div>
            ) : null}

            {/* Explanations */}
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-sand/30 p-4">
              <span className="font-semibold text-ink">
                {isHi ? 'आपके उत्तरों का विश्लेषण:' : 'Why you received this classification:'}
              </span>
              <ul className="list-disc pl-5 text-[14px] leading-relaxed text-muted">
                {latest.explanations.map((line, idx) => (
                  <li key={idx} className="text-ink">
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            {/* Limitations Notice */}
            <div className="flex flex-col gap-1 text-[13px] text-muted">
              <span className="font-semibold text-ink">
                {isHi ? 'सीमाएं और अस्वीकरण:' : 'Assessment Scope & Limitations:'}
              </span>
              <ul className="list-disc pl-5">
                {latest.limitations.map((lim, idx) => (
                  <li key={idx}>{lim}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Panel>

      {/* History Panel */}
      {history.length > 0 ? (
        <Panel title={isHi ? 'पिछले मूल्यांकन का इतिहास' : 'Assessment History'}>
          <p className="text-[14px] text-muted">
            {isHi
              ? 'पुनः मूल्यांकन करने पर आपके पिछले परिणाम मिटाए नहीं जाते। वे संदर्भ के लिए यहाँ संरक्षित हैं।'
              : 'Previous assessments are preserved for audit and progress tracking.'}
          </p>
          <Table
            caption={isHi ? 'इतिहास' : 'History'}
            head={[
              isHi ? 'दिनांक' : 'Date',
              isHi ? 'सहिष्णुता' : 'Risk Tolerance',
              isHi ? 'क्षमता' : 'Risk Capacity',
              isHi ? 'समग्र दृष्टिकोण' : 'Composite Stance',
              isHi ? 'स्कोर' : 'Score',
            ]}
            rows={history.map((h) => [
              h.completed_at.slice(0, 10),
              h.risk_tolerance,
              h.risk_capacity,
              h.composite_stance,
              `${h.tolerance_score} / 11`,
            ])}
          />
        </Panel>
      ) : null}
    </div>
  )
}

/* =========================================================================================
   3. ORIGINAL VS MORE CONSERVATIVE RECOMMENDATIONS
   ========================================================================================= */

interface ConservativeRecommendationsViewProps {
  plan: any
  isHi: boolean
  navigate?: PageProps['navigate']
}

function ConservativeRecommendationsView({ plan, isHi, navigate }: ConservativeRecommendationsViewProps) {
  const [selectedVariant, setSelectedVariant] = useState<'original' | 'conservative'>('conservative')

  const { planId, dirty } = useStore()
  // The saved plan is used as it is on the server; with unsaved edits the figures on screen are sent as a
  // hypothetical. Any edit changes the key, so the comparison is never left showing an earlier plan.
  const useSaved = planId !== null && !dirty
  const comparisonRemote = useRemote<ConservativeComparisonResponse>(
    plan ? JSON.stringify(['recommendation-comparison', useSaved ? planId : plan]) : null,
    (signal) =>
      plan
        ? api.compareRecommendations(useSaved && planId ? { planId } : { plan }, undefined, signal)
        : Promise.reject('No plan'),
  )

  if (!plan) {
    return (
      <Panel title={isHi ? 'कोई सक्रिय योजना नहीं' : 'No Active Plan'}>
        <p className="text-muted">
          {isHi
            ? 'सिफारिशों की तुलना देखने के लिए पहले एक वित्तीय योजना लोड या बनाएं।'
            : 'Please create or load a financial plan first to compare recommendation variants.'}
        </p>
        {navigate ? (
          <button
            type="button"
            onClick={() => navigate('goals')}
            className="self-start rounded-xl bg-brand px-5 py-2.5 font-semibold text-white"
          >
            {isHi ? 'लक्ष्य पृष्ठ पर जाएं' : 'Go to Goals'}
          </button>
        ) : null}
      </Panel>
    )
  }

  return (
    <Loaded remote={comparisonRemote}>
      {(comparison) => {
        const orig = comparison.original
        const cons = comparison.conservative
        const diff = comparison.differences
        const active = selectedVariant === 'original' ? orig : cons

        return (
          <div className="flex flex-col gap-6">
            <Panel title={isHi ? 'मूल बनाम अधिक रूढ़िवादी सिफारिशें' : 'Recommendation Variants Comparison'}>
              <p className="text-[15px] leading-relaxed text-muted">
                {isHi
                  ? 'यह तुलना आपके baseline लक्ष्य सिफारिशों को एक अधिक रक्षात्मक और रूढ़िवादी दृष्टिकोण के साथ मापती है।'
                  : 'Compare your baseline goal recommendations against an intentionally defensive, lower-risk alternative that prioritizes capital preservation and higher liquidity buffers.'}
              </p>

              <p className="text-[13px] text-muted">
                {comparison.plan_source === 'saved'
                  ? isHi ? 'आपकी सहेजी योजना से गणना।' : 'Calculated from your saved plan.'
                  : isHi ? 'काल्पनिक योजना: अभी की (बिना सहेजी) संख्याओं से गणना।' : 'Hypothetical: calculated from the plan figures on screen, which may include unsaved edits.'}
              </p>
              {comparison.notes.length > 0 ? (
                <ul className="list-disc pl-5 text-[14px] text-muted">
                  {comparison.notes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}

              {/* Toggle Switcher */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedVariant('original')}
                  className={`min-h-11 rounded-xl px-5 font-semibold transition-all ${
                    selectedVariant === 'original'
                      ? 'bg-brand text-white shadow-sm'
                      : 'border border-line bg-paper text-ink hover:bg-sand/60'
                  }`}
                >
                  {isHi ? 'मूल सिफारिशें' : 'Original Recommendations'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedVariant('conservative')}
                  className={`min-h-11 rounded-xl px-5 font-semibold transition-all ${
                    selectedVariant === 'conservative'
                      ? 'bg-brand text-white shadow-sm'
                      : 'border border-line bg-paper text-ink hover:bg-sand/60'
                  }`}
                >
                  {isHi ? 'अधिक रूढ़िवादी सिफारिशें' : 'More Conservative Recommendations'}
                </button>
              </div>

              {/* Explanatory Banner */}
              <div className="rounded-2xl bg-sand/60 p-4 border border-line">
                <span className="font-semibold text-ink">
                  {isHi ? 'गणना अंतर सारांश:' : 'Calculated Differences & Strategy Summary:'}
                </span>
                <p className="mt-1 text-[14px] leading-relaxed text-ink">{diff.summary_explanation}</p>
              </div>

              {/* Metric Comparison Cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1 rounded-2xl glass p-4">
                  <span className="text-[13px] font-semibold text-muted uppercase">
                    {isHi ? 'वार्षिक रिटर्न मान्यता' : 'Assumed Annual Return'}
                  </span>
                  <span className="font-figures text-[24px] font-bold text-ink">
                    {(parseFloat(active.assumed_annual_return) * 100).toFixed(1)}%
                  </span>
                  <span className="text-[13px] text-muted">
                    {selectedVariant === 'conservative'
                      ? isHi
                        ? `${(parseFloat(diff.annual_return_drop) * 100).toFixed(1)}% कम रिटर्न दर`
                        : `${(parseFloat(diff.annual_return_drop) * 100).toFixed(1)}% lower return floor`
                      : isHi
                        ? 'बेसलाइन रिटर्न दर'
                        : 'Baseline return rate'}
                  </span>
                </div>

                <div className="flex flex-col gap-1 rounded-2xl glass p-4">
                  <span className="text-[13px] font-semibold text-muted uppercase">
                    {isHi ? 'अनुशंसित आपातकालीन बफ़र' : 'Emergency Buffer Target'}
                  </span>
                  <span className="font-figures text-[24px] font-bold text-ink">
                    {active.recommended_reserve_months} {isHi ? 'महीने' : 'months'}
                  </span>
                  <span className="text-[13px] text-muted">
                    {selectedVariant === 'conservative'
                      ? isHi
                        ? 'विस्तारित रक्षात्मक सुरक्षा'
                        : 'Expanded defensive runway'
                      : isHi
                        ? 'मानक रिज़र्व लक्ष्य'
                        : 'Standard reserve target'}
                  </span>
                </div>

                <div className="flex flex-col gap-1 rounded-2xl glass p-4">
                  <span className="text-[13px] font-semibold text-muted uppercase">
                    {isHi ? 'कुल आवश्यक मासिक बचत' : 'Total Required Monthly'}
                  </span>
                  <span className="font-figures text-[24px] font-bold text-ink">
                    {formatMoney(active.total_monthly_required)}
                  </span>
                  <span className="text-[13px] text-muted">
                    {selectedVariant === 'conservative'
                      ? `+${formatMoney(diff.monthly_savings_increase)} ${isHi ? 'अतिरिक्त/माह' : 'extra/month'}`
                      : isHi
                        ? 'मूल मासिक आवश्यकता'
                        : 'Original monthly requirement'}
                  </span>
                </div>

                <div className="flex flex-col gap-1 rounded-2xl glass p-4">
                  <span className="text-[13px] font-semibold text-muted uppercase">
                    {isHi ? 'समय पर लक्ष्य' : 'Goals On Track'}
                  </span>
                  <span className="font-figures text-[24px] font-bold text-ontime">
                    {active.on_track_count} / {active.goals.length}
                  </span>
                  <span className="text-[13px] text-muted">
                    {active.delayed_count > 0
                      ? `${active.delayed_count} ${isHi ? 'विलंबित' : 'delayed or at risk'}`
                      : isHi
                        ? 'सभी लक्ष्य समय पर'
                        : 'All goals feasible'}
                  </span>
                </div>
              </div>

              {/* Goal by Goal Breakdown */}
              <div className="flex flex-col gap-3">
                <span className="font-semibold text-ink">
                  {selectedVariant === 'conservative'
                    ? isHi
                      ? 'रूढ़िवादी मान्यताओं के तहत लक्ष्य स्थिति:'
                      : 'Goal Projections Under Conservative Variant:'
                    : isHi
                      ? 'मूल मान्यताओं के तहत लक्ष्य स्थिति:'
                      : 'Goal Projections Under Original Variant:'}
                </span>

                <Table
                  caption="Goals"
                  head={[
                    isHi ? 'लक्ष्य' : 'Goal',
                    isHi ? 'लक्षित राशि' : 'Target Amount',
                    isHi ? 'समय सीमा' : 'Target Date',
                    isHi ? 'स्थिति' : 'Status',
                    isHi ? 'आवश्यक मासिक बचत' : 'Required Monthly Savings',
                  ]}
                  rows={active.goals.map((g) => [
                    g.label,
                    formatMoney(g.target_amount_today),
                    g.target_date,
                    g.status === 'on_track' ? (
                      <span key={`${g.goal_id}-s`} className="font-semibold text-ontime">{isHi ? 'समय पर' : 'On Track'}</span>
                    ) : (
                      <span key={`${g.goal_id}-s`} className="font-semibold text-late">
                        {isHi ? `विलंबित (${g.delay_months} माह)` : `Delayed (${g.delay_months}m)`}
                      </span>
                    ),
                    formatMoney(g.required_monthly_savings),
                  ])}
                />
              </div>

              {/* Delay Impacts List */}
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-sand/30 p-4">
                <span className="font-semibold text-ink">
                  {isHi ? 'रूढ़िवादी दृष्टिकोण के विशिष्ट प्रभाव:' : 'Specific Impact on Goals:'}
                </span>
                <ul className="list-disc pl-5 text-[14px] leading-relaxed text-muted">
                  {diff.delay_impacts.map((line, idx) => (
                    <li key={idx} className="text-ink">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          </div>
        )
      }}
    </Loaded>
  )
}
