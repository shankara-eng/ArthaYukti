import { useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { PageActionsSlot } from '../state/pageActionsSlot'

/** Lets a page put its own controls into the shell's toolbar, next to the heading. */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionsSlot)
  return slot ? createPortal(children, slot) : null
}
