import { Panel } from '../../components/panel'
import type { Route } from '../../lib/route'
import { useRestructureCopy } from '../../state/useRestructureCopy'

/** Shown on the homepage of an account that has not entered anything yet: where to begin, in any order. */
export function GettingStarted({ navigate }: { navigate: (route: Route) => void }) {
  const t = useRestructureCopy().start
  return (
    <Panel id="dash-start" title={t.title}>
      <p className="text-muted">{t.body}</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {t.steps.map((step) => (
          <li key={step.route} className="flex flex-col gap-2 rounded-2xl border border-line p-4">
            <h3 className="font-semibold">{step.title}</h3>
            <p className="text-[14px] text-muted">{step.body}</p>
            <button type="button" onClick={() => navigate(step.route as Route)} className="min-h-10 self-start rounded-xl bg-brand px-4 font-semibold text-white">
              {t.open}
              <span className="sr-only"> {step.title}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[14px] text-muted">{t.guided}</p>
      <button type="button" onClick={() => navigate('onboarding')} className="min-h-11 self-start rounded-xl border border-line px-4 font-semibold">
        {t.guidedAction}
      </button>
    </Panel>
  )
}
