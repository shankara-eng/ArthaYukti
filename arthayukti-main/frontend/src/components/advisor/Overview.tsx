import type { AdvisorAnalysis } from '../../api/types'
import type { AdvisorCopy } from '../../i18n/advisor'
import { money } from '../../lib/advisor'
import { monthLabelLong, type Language } from '../../lib/months'
import { Notice, Panel, Stat, Table } from '../panel'

const SEVERITY_CLASS = { info: 'text-muted', warning: 'text-late', critical: 'text-late' } as const

function List({ title, items, none }: { title: string; items: string[]; none: string }) {
  return (
    <div>
      <h4 className="text-[14px] font-semibold">{title}</h4>
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">{none}</p>
      ) : (
        <ul className="list-disc pl-5 text-[14px]">
          {items.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Where the person stands today: the headline figures, what the engine found, and the data limits. */
export function Overview({ analysis, t, language }: { analysis: AdvisorAnalysis; t: AdvisorCopy; language: Language }) {
  const o = t.overview
  const m = analysis.baseline_metrics
  const q = analysis.data_quality
  const years = analysis.trajectory_years
  const first = years[0]
  const last = years[years.length - 1]
  return (
    <>
      <Panel id="advisor-overview" title={o.title}>
        <p className="text-[16px]">{analysis.report.overall_summary}</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Stat label={o.achievable} value={o.ofGoals(m.goals_achievable, m.goals_total)} tone={m.goals_achievable === m.goals_total ? 'good' : 'late'} />
          <Stat label={o.minCash} value={money(m.minimum_cash)} note={o.inMonth(monthLabelLong(m.minimum_cash_month, language))} tone={m.uncovered_cash_months > 0 ? 'late' : undefined} />
          <Stat label={o.surplus} value={money(m.monthly_surplus)} />
          <Stat label={o.gap} value={money(m.total_funding_gap)} />
          <Stat label={o.netWorth} value={money(m.horizon_net_worth)} />
          <Stat label={o.netWorthReal} value={money(m.horizon_net_worth_real)} />
        </div>
        <h3 className="font-semibold">{o.findings}</h3>
        <ul className="flex flex-col gap-2">
          {analysis.report.key_findings.map((f) => (
            <li key={f.id} className="rounded-xl bg-sand/60 px-4 py-2.5 text-[15px]">
              <span className={`mr-2 font-semibold ${SEVERITY_CLASS[f.severity]}`}>{o.severity[f.severity]}:</span>
              {f.text}
            </li>
          ))}
        </ul>
      </Panel>

      {years.length > 0 ? (
        <Panel id="advisor-baseline" title={o.baseline}>
          {first && last ? <p className="text-[14px] text-muted">{o.baselineText(String(first.year), String(last.year), money(first.closing_net_worth), money(last.closing_net_worth))}</p> : null}
          <Table
            caption={o.baseline}
            head={[o.year, o.cash, o.assets, o.liabilities, o.net, o.real]}
            rows={years.map((y) => [String(y.year), money(y.closing_cash), money(y.closing_assets), money(y.closing_liabilities), money(y.closing_net_worth), money(y.closing_net_worth_real)])}
          />
        </Panel>
      ) : null}

      <Panel id="advisor-quality" title={o.quality} aside={<span className="text-[13px] font-semibold">{o.complete[q.completeness]}</span>}>
        <Notice>{o.unknownNote}</Notice>
        <div className="grid gap-4 md:grid-cols-2">
          <List title={o.missing} items={q.missing_fields} none={o.none} />
          <List title={o.stale} items={q.stale_values} none={o.none} />
          <List title={o.assumed} items={q.assumptions} none={o.none} />
          <List title={o.conflicts} items={q.conflicts} none={o.none} />
        </div>
      </Panel>
    </>
  )
}
