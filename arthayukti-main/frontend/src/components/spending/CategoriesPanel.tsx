import { useState } from 'react'
import { api } from '../../api/client'
import type { SpendingCategory } from '../../api/types'
import { useAction } from '../../state/useAction'
import { FormError, SelectField, TextField } from '../forms'
import { Panel } from '../panel'
import { failureText } from './failure'

/** Flat categories: predefined ones can be hidden, your own can be renamed, archived, or deleted once nothing uses them. */
export function CategoriesPanel({ categories, onChanged }: { categories: SpendingCategory[]; onChanged: () => void }) {
  const action = useAction()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [target, setTarget] = useState('sys:other')

  const run = (job: () => Promise<unknown>, after?: () => void) =>
    void action.run(async () => {
      await job()
      after?.()
      onChanged()
    })

  const targets = categories.filter((c) => !c.archived && !c.hidden && c.id !== deleting).map((c) => ({ value: c.id, label: c.name }))

  return (
    <Panel id="spending-categories" title="Categories">
      <ul className="flex flex-col divide-y divide-line/60">
        {categories.map((category) => (
          <li key={category.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              {renaming?.id === category.id ? (
                <div className="flex items-end gap-2">
                  <div className="w-52">
                    <TextField label="New name" value={renaming.name} onChange={(value) => setRenaming({ id: category.id, name: value })} maxLength={60} />
                  </div>
                  <button type="button" className="min-h-11 rounded-xl bg-ink px-4 font-semibold text-white" onClick={() => run(() => api.spendingUpdateCategory(category.id, { name: renaming.name }), () => setRenaming(null))}>
                    Save
                  </button>
                  <button type="button" className="min-h-11 px-2 underline" onClick={() => setRenaming(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <span className={category.hidden || category.archived ? 'text-muted' : 'font-semibold'}>{category.name}</span>
                  <span className="ml-2 text-[13px] text-muted">
                    {category.kind === 'system' ? 'Predefined' : 'Yours'}
                    {category.hidden ? ' · hidden' : ''}
                    {category.archived ? ' · archived' : ''} · {category.plan_count} {category.plan_count === 1 ? 'plan' : 'plans'}
                  </span>
                </>
              )}
            </div>
            {renaming?.id === category.id ? null : (
              <div className="flex flex-wrap gap-3 text-[14px]">
                {category.kind === 'system' ? (
                  <button type="button" className="underline" onClick={() => run(() => api.spendingHideCategory(category.id.replace('sys:', ''), !category.hidden))}>
                    {category.hidden ? 'Show' : 'Hide'}
                  </button>
                ) : (
                  <>
                    <button type="button" className="underline" onClick={() => setRenaming({ id: category.id, name: category.name })}>
                      Rename
                    </button>
                    <button type="button" className="underline" onClick={() => run(() => api.spendingUpdateCategory(category.id, { archived: !category.archived }))}>
                      {category.archived ? 'Restore' : 'Archive'}
                    </button>
                    <button type="button" className="text-late underline" onClick={() => setDeleting(deleting === category.id ? null : category.id)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            )}
            {deleting === category.id ? (
              <div className="flex w-full flex-wrap items-end gap-3 rounded-xl bg-sand/50 p-3">
                {category.plan_count > 0 ? (
                  <div className="min-w-56">
                    <SelectField label={`Move its ${category.plan_count} plan${category.plan_count === 1 ? '' : 's'} to`} value={target} onChange={setTarget} options={targets} />
                  </div>
                ) : (
                  <p>Delete “{category.name}”? Nothing uses it.</p>
                )}
                <button type="button" className="min-h-11 rounded-xl bg-late px-4 font-semibold text-white" onClick={() => run(() => api.spendingDeleteCategory(category.id, category.plan_count > 0 ? target : undefined), () => setDeleting(null))}>
                  Confirm delete
                </button>
                <button type="button" className="min-h-11 px-2 underline" onClick={() => setDeleting(null)}>
                  Keep it
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (name.trim()) run(() => api.spendingCreateCategory(name.trim()), () => setName(''))
        }}
      >
        <div className="w-64">
          <TextField label="Add your own category" value={name} onChange={setName} maxLength={60} />
        </div>
        <button type="submit" disabled={!name.trim() || action.busy} className="min-h-11 rounded-xl border border-ink px-4 font-semibold disabled:opacity-50">
          Add
        </button>
      </form>
      {action.failure ? <FormError>{failureText(action.failure)}</FormError> : null}
    </Panel>
  )
}
