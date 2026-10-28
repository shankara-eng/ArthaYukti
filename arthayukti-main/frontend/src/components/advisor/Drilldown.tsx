import type { AdvisorAnalysis } from '../../api/types'
import type { AdvisorCopy } from '../../i18n/advisor'
import { money, signedMoney } from '../../lib/advisor'
import { Panel, Table } from '../panel'

const SHOWN_DETAILS = ['monthly_saving', 'total_contributed', 'interest_saved', 'interest_before', 'interest_after', 'extra_total_paid', 'payoff_before', 'payoff_after', 'months_saved', 'start_month', 'end_month']
const MONEY_DETAILS = new Set(['monthly_saving', 'total_contributed', 'interest_saved', 'interest_before', 'interest_after', 'extra_total_paid'])

/** The figures, assumptions and goal changes behind each path, so nothing in a recommendation is unexplained. */
export function Drilldown({ analysis, t }: { analysis: AdvisorAnalysis; t: AdvisorCopy }) {
  const d = t.drill
  return (
    <Panel id="advisor-drill" title={d.title}>
      <p className="text-muted">{d.lead}</p>
      {analysis.scenarios.map((s) => (
        <details key={s.id} className="rounded-2xl border border-line bg-surface/60 p-4">
          <summary className="cursor-pointer font-semibold">{s.title}</summary>
          <div className="mt-3 flex flex-col gap-3 text-[15px]">
            {s.violations.length > 0 ? (
              <div>
                <p className="font-semibold text-late">{d.violations}</p>
                <ul className="list-disc pl-5">
                  {s.violations.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <p className="font-semibold">{d.assumptions}</p>
              <ul className="list-disc pl-5 text-muted">
                {s.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-semibold">{d.details}</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                {Object.entries(s.details)
                  .filter(([key, value]) => SHOWN_DETAILS.includes(key) && value !== null && value !== undefined)
                  .map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted">{key.replace(/_/g, ' ')}</dt>
                      <dd className="font-figures">{MONEY_DETAILS.has(key) ? money(String(value)) : String(value)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
            <div>
              <p className="font-semibold">{d.changes}</p>
              {s.deltas.goal_changes.length === 0 ? (
                <p className="text-muted">{d.none}</p>
              ) : (
                <ul className="list-disc pl-5">
                  {s.deltas.goal_changes.map((g) => (
                    <li key={g.goal_id}>
                      {t.goals.effect(g.label, t.goals.status[g.status_before], t.goals.status[g.status_after])} ({signedMoney(g.gap_change)})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </details>
      ))}
      <h3 className="font-semibold">{d.yearly}</h3>
      <Table
        caption={d.yearly}
        head={[t.overview.year, t.overview.cash, t.overview.assets, t.overview.liabilities, t.overview.net]}
        rows={analysis.trajectory_years.map((y) => [String(y.year), money(y.closing_cash), money(y.closing_assets), money(y.closing_liabilities), money(y.closing_net_worth)])}
      />
    </Panel>
  )
}
