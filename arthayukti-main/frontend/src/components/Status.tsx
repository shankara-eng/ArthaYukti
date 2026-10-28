import type { Remote } from '../state/useRemote'
import { useStore } from '../state/useStore'
import { Card } from './Cards'
import { SecondaryButton } from './Controls'

export function LoadingNote() {
  const { text } = useStore()
  return (
    <p role="status" className="text-muted">
      {text.common.loading}
    </p>
  )
}

export function ErrorNote() {
  const { text } = useStore()
  return (
    <Card>
      <p role="alert">{text.common.offline}</p>
      <SecondaryButton icon="forward" onClick={() => window.location.reload()}>
        {text.common.retry}
      </SecondaryButton>
    </Card>
  )
}

/** Shows a loading or error note until the data is there; calls `children` once it is. */
export function Await<T>({
  remote,
  children,
}: {
  remote: Remote<T>
  children: (data: T) => React.ReactNode
}) {
  // A failed request hides the earlier answer: numbers from before the change must not stay
  // on screen as if they were still right.
  if (remote.error) return <ErrorNote />
  if (remote.data) {
    return (
      <>
        {children(remote.data)}
        {remote.loading ? <LoadingNote /> : null}
      </>
    )
  }
  return <LoadingNote />
}
