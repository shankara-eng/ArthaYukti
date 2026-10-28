import type { ReactNode } from 'react'
import { useModulesCopy } from '../state/useModulesCopy'
import type { Remote } from '../state/useRemote'

export function Panel({ id, title, aside, children }: { id?: string; title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} tabIndex={id ? -1 : undefined} className="glass flex scroll-mt-24 flex-col gap-4 rounded-3xl p-5 outline-none">
      {title || aside ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title ? (
            <h2 id={id ? `${id}-title` : undefined} className="font-display text-[20px] font-bold tracking-tight">
              {title}
            </h2>
          ) : null}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Stat({ label, value, tone, note }: { label: string; value: string; tone?: 'good' | 'late'; note?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[14px] text-muted">{label}</p>
      <p className={`font-figures text-[26px] leading-tight font-semibold ${tone === 'late' ? 'text-late' : tone === 'good' ? 'text-ontime' : ''}`}>{value}</p>
      {note ? <p className="text-[13px] text-muted">{note}</p> : null}
    </div>
  )
}

export function Notice({ children, tone }: { children: ReactNode; tone?: 'warn' }) {
  return <p className={`rounded-xl px-4 py-3 text-[14px] ${tone === 'warn' ? 'bg-blush' : 'bg-sand'}`}>{children}</p>
}

export function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="font-display text-[22px] font-bold tracking-tight">{title}</h2>
      <div className="flex flex-col gap-2 text-muted">{children}</div>
    </Panel>
  )
}

/** Shows a loading or failure note until the data arrives, then calls `children`. */
export function Loaded<T>({ remote, children }: { remote: Remote<T>; children: (data: T) => ReactNode }) {
  const m = useModulesCopy().common
  if (remote.error) {
    return (
      <p role="alert" className="rounded-xl bg-blush px-4 py-3 text-[15px] font-semibold text-late">
        {m.failed}{' '}
        <button type="button" onClick={remote.reload} className="underline">
          {m.retry}
        </button>
      </p>
    )
  }
  if (!remote.data) {
    return (
      <p role="status" className="text-muted">
        {m.loading}
      </p>
    )
  }
  return <>{children(remote.data)}</>
}

export function Table({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-left text-[15px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-[13px] text-muted">
          <tr>
            {head.map((label) => (
              <th key={label} scope="col" className="border-b border-line py-2 pr-4 font-normal">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, index) => (
            <tr key={index} className="border-b border-line/60">
              {cells.map((cell, position) => (
                <td key={position} className={`py-2 pr-4 ${position > 0 ? 'font-figures' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
